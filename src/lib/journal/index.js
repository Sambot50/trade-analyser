// Orchestration du journal : produire, écrire, résoudre.

import { construireEnregistrement, cheminDossier, ligneIndex, ligneMiseAJour, construireResume,
         reduireIndex, HORIZON_RESOLUTION_MINUTES } from './schema.js';
import { genererRapport } from './report.js';
import { genererSchemaDoc } from './schema-doc.js';
import { resoudreIssue } from './resolve.js';
import { recupererBougiesPaginees, symboleResolvable, MINUTES_PAR_BOUGIE } from './market.js';
import { deposerDansTampon, listerTampon, majEntree, ecrireFichier, ajouterLigne,
         sousDossier, lireLignesIndex } from './store.js';

export * from './store.js';
export { reduireIndex } from './schema.js';

const HORIZON_BOUGIES = HORIZON_RESOLUTION_MINUTES / MINUTES_PAR_BOUGIE;

/** Horodatage ISO 8601 UTC à la seconde, sans millisecondes. */
export function maintenantIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function dataUrlVersBlob(dataUrl) {
  const [entete, donnees] = dataUrl.split(',');
  const typeMime = /:(.*?);/.exec(entete)?.[1] ?? 'application/octet-stream';
  const binaire = atob(donnees);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new Blob([octets], { type: typeMime });
}

export async function empreinte(blob) {
  const condensat = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(condensat)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Enregistre une analyse : tampon d'abord, disque ensuite si disponible.
 * Le tampon en premier garantit qu'une analyse n'est jamais perdue, même si
 * l'écriture disque échoue.
 */
export async function enregistrerAnalyse({ analyse, moteur, captureDataUrl, overlayDataUrl, dimensions, dossierRacine }) {
  const horodatage = maintenantIso();
  const capture = dataUrlVersBlob(captureDataUrl);
  const overlay = overlayDataUrl ? dataUrlVersBlob(overlayDataUrl) : null;

  const record = construireEnregistrement({
    analyse,
    moteur,
    horodatage,
    fichiers: {
      capture: {
        nom: 'capture.png',
        largeur: dimensions?.largeur ?? null,
        hauteur: dimensions?.hauteur ?? null,
        typeMime: capture.type,
        octets: capture.size,
        sha256: await empreinte(capture),
      },
      overlay: overlay ? { nom: 'overlay.png', typeMime: overlay.type, octets: overlay.size } : null,
    },
  });

  await deposerDansTampon({ record, capture, overlay, ecritSurDisque: false });

  if (dossierRacine) {
    try {
      await deverserSurDisque(dossierRacine);
    } catch (err) {
      // L'analyse est au tampon : la perte est impossible, seul le miroir a échoué.
      return { record, erreurDisque: err.message };
    }
  }
  return { record, erreurDisque: null };
}

/** Écrit sur disque toutes les entrées du tampon qui n'y sont pas encore. */
export async function deverserSurDisque(racine) {
  const entrees = await listerTampon();
  const enAttente = entrees.filter((e) => !e.ecritSurDisque);

  for (const entree of enAttente) {
    const dossier = await sousDossier(racine, cheminDossier(entree.record));

    // Images d'abord, JSON ensuite, ligne d'index en dernier : l'index ne
    // référence ainsi que des dossiers complets.
    if (entree.capture) await ecrireFichier(dossier, 'capture.png', entree.capture);
    if (entree.overlay) await ecrireFichier(dossier, 'overlay.png', entree.overlay);
    await ecrireFichier(dossier, 'analyse.json', JSON.stringify(entree.record, null, 2));
    await ajouterLigne(racine, 'index.jsonl', ligneIndex(entree.record));

    await majEntree(entree.record.id, (e) => ({ ...e, ecritSurDisque: true }));
  }

  if (enAttente.length) await regenererFichiersRacine(racine);
  return enAttente.length;
}

export async function regenererFichiersRacine(racine) {
  const lignes = reduireIndex(await lireLignesIndex(racine));
  await ecrireFichier(racine, 'RAPPORT.md', genererRapport(lignes, { genereLe: maintenantIso() }));
  await ecrireFichier(racine, 'SCHEMA.md', genererSchemaDoc());
  return lignes;
}

/** Applique un résultat : réécrit analyse.json, ajoute une ligne d'index, régénère le rapport. */
export async function appliquerResultat({ racine, id, resultat }) {
  const entree = await majEntree(id, (e) => {
    const record = { ...e.record, resultat };
    record.resume = construireResume(record);
    return { ...e, record };
  });

  if (racine) {
    const dossier = await sousDossier(racine, cheminDossier(entree.record));
    await ecrireFichier(dossier, 'analyse.json', JSON.stringify(entree.record, null, 2));
    await ajouterLigne(racine, 'index.jsonl', ligneMiseAJour(entree.record, maintenantIso()));
    await regenererFichiersRacine(racine);
  }
  return entree.record;
}

export function resultatManuel(statut, note = '') {
  return { statut, source: 'manuelle', constateLe: maintenantIso(), detail: null, note };
}

/**
 * Tente de résoudre toutes les analyses sans issue tranchée.
 * Renvoie un compte rendu par analyse — y compris les échecs, qui sont une
 * information et non un incident à masquer.
 */
export async function resoudreEnAttente({ racine, signal } = {}) {
  const entrees = await listerTampon();
  const aResoudre = entrees.filter((e) => !e.record.resultat || e.record.resultat.statut === 'en_cours');
  const rapport = [];

  for (const { record } of aResoudre) {
    const symbole = record.marche.symbole;

    if (!symboleResolvable(symbole)) {
      rapport.push({ id: record.id, issue: 'non_resolvable',
        message: `${symbole ?? 'symbole inconnu'} : pas de source publique, saisie manuelle requise.` });
      continue;
    }

    const depuisMs = Date.parse(record.horodatage);

    try {
      const bougies = await recupererBougiesPaginees({ symbole, depuisMs, nombre: HORIZON_BOUGIES, signal });
      const { statut, detail } = resoudreIssue({
        plan: record.plan, bougies, horizonBougies: HORIZON_BOUGIES,
      });

      if (statut === 'en_cours') {
        rapport.push({ id: record.id, issue: 'en_cours', message: 'Trop tôt, on réessaiera.' });
        continue;
      }

      await appliquerResultat({
        racine, id: record.id,
        resultat: { statut, source: 'automatique', constateLe: maintenantIso(), detail, note: '' },
      });
      rapport.push({ id: record.id, issue: statut, message: null });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      rapport.push({ id: record.id, issue: 'echec', message: err.message });
    }
  }

  return rapport;
}
