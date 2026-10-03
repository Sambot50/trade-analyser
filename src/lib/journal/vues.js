// Le catalogue du journal.
//
// Un arbre de dossiers ne donne qu'UNE hiérarchie : ranger par symbole
// interdit de parcourir par mois, ranger par issue interdit de parcourir par
// symbole. Or « qu'est-ce qui marche » se pose dans tous les sens à la fois.
//
// Les dossiers datés restent donc le rangement — une adresse stable, inscrite
// dans l'index, qu'on ne déplace pas. Les vues sont le catalogue : des fiches
// régénérées à chaque écriture, qui ne contiennent RIEN d'unique. Les
// supprimer ne perd rien ; elles reviennent à la prochaine écriture.

import { ETATS, trouvaillesDe, compteParEtat, tauxValidation } from './jugement.js';
import { libelleDuType } from '../marche/trouvailles.js';

const LIBELLE_ETAT = { en_attente: 'en attente', valide: 'validés', invalide: 'invalidés' };

const jour = (horodatage) => String(horodatage ?? '').slice(0, 10) || 'sans-date';
const mois = (horodatage) => String(horodatage ?? '').slice(0, 7) || 'sans-date';

function grouper(lignes, clef) {
  const m = new Map();
  for (const l of lignes) {
    const k = clef(l);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(l);
  }
  return m;
}

/** Une zone, en une ligne de tableau. */
function rang(ob) {
  const zone = Number.isFinite(ob.prixBasDeZone) && Number.isFinite(ob.prixHautDeZone)
    ? `${ob.prixBasDeZone} – ${ob.prixHautDeZone}`
    : '—';
  const q = ob.qualificatifs
    ? Object.entries(ob.qualificatifs).filter(([, v]) => v === true).map(([k]) => k).join(', ')
    : '';
  return `| ${ob.horodatage?.slice(11, 16) ?? '—'} | ${libelleDuType(ob.type)} | ${ob.symbole ?? 'INCONNU'} `
    + `| ${ob.uniteTemps ?? '—'} | ${ob.sens ?? '—'} | ${zone} | ${q || '—'} | \`${ob.dossier ?? '—'}\` |`;
}

const ENTETE = '| heure | figure | symbole | ut | sens | zone | critères | dossier |\n|---|---|---|---|---|---|---|---|';

function fiche(titre, obs, note) {
  const out = [`# ${titre}`, ''];
  if (note) { out.push(note, ''); }
  if (!obs.length) {
    out.push('Rien ici pour l’instant.');
    return out.join('\n') + '\n';
  }
  out.push(`${obs.length} zone${obs.length > 1 ? 's' : ''}.`, '', ENTETE);
  for (const ob of obs) out.push(rang(ob));
  out.push('');
  return out.join('\n');
}

/**
 * Toutes les fiches, en chemins relatifs à la racine du journal.
 *
 * Rendues en mémoire plutôt qu'écrites ici : la fonction reste pure, donc
 * vérifiable sans disque, et l'appelant décide quoi faire des chemins — les
 * écrire, les comparer, ou les afficher.
 */
export function genererVues(lignes, { genereLe } = {}) {
  const obs = trouvaillesDe(lignes);
  const fichiers = new Map();

  // Validité d'abord, date ensuite.
  for (const etat of ETATS) {
    const duGroupe = obs.filter((o) => (o.etat ?? 'en_attente') === etat);
    const parJour = grouper(duGroupe, (o) => jour(o.horodatage));
    for (const [j, liste] of parJour) {
      fichiers.set(`vues/par-validite/${etat}/${j}.md`,
        fiche(`${LIBELLE_ETAT[etat]} — ${j}`, liste));
    }
    // Une fiche d'ensemble par état, pour ne pas avoir à ouvrir chaque jour.
    fichiers.set(`vues/par-validite/${etat}/TOUT.md`,
      fiche(`Toutes les zones ${LIBELLE_ETAT[etat]}`, duGroupe,
        etat === 'en_attente'
          ? 'Du plus ancien au plus récent : une zone d’il y a trois jours a eu le temps '
            + 'd’être tranchée, une zone d’il y a dix minutes non.'
          : null));
  }

  for (const [type, liste] of grouper(obs, (o) => o.type ?? 'inconnu')) {
    fichiers.set(`vues/par-figure/${type}.md`, fiche(libelleDuType(type), liste));
  }

  for (const [symbole, liste] of grouper(obs, (o) => o.symbole ?? 'INCONNU')) {
    fichiers.set(`vues/par-symbole/${symbole}.md`, fiche(`${symbole}`, liste));
  }

  for (const [m, liste] of grouper(obs, (o) => mois(o.horodatage))) {
    fichiers.set(`vues/par-mois/${m}.md`, fiche(`${m}`, liste));
  }

  fichiers.set('vues/LISEZMOI.md', lisezmoi(lignes, genereLe));
  return fichiers;
}

function lisezmoi(lignes, genereLe) {
  const t = tauxValidation(lignes);
  const c = compteParEtat(lignes);
  return `# Catalogue

${genereLe ? `Régénéré le ${genereLe}.` : ''}

Ce dossier ne contient **rien d'unique**. Chaque fiche se recalcule depuis
\`index.jsonl\`, à la racine du journal. Supprimer \`vues/\` ne perd rien.

Les dossiers datés, eux, sont le rangement : leur chemin est inscrit dans
l'index, et les déplacer casserait les références.

## Où l'on en est

| | |
|---|---|
| zones en attente | ${c.en_attente} |
| validées | ${c.valide} |
| invalidées | ${c.invalide} |
| taux de validation | ${t.taux === null ? '— (rien de tranché)' : `${(t.taux * 100).toFixed(1)} % sur ${t.tranches}`} |

Les zones en attente sont **exclues** du taux, pas comptées perdantes : une
zone que le prix n'a pas encore atteinte n'a rien échoué. Les compter ferait
baisser le taux à mesure qu'on détecte.

## Ce qui sert à quoi

| | |
|---|---|
| \`par-validite/\` | ton jugement, puis la date — commence par \`en_attente/TOUT.md\` |
| \`par-figure/\` | order blocks, et les figures qui s'y ajouteront |
| \`par-symbole/\` | tout ce qui concerne un instrument |
| \`par-mois/\` | la vue chronologique |

**Pour backtester, ne lis pas ces fiches.** Lis \`index.jsonl\` : un objet JSON
par ligne, une ligne par évènement. Les vues sont pour l'œil, l'index pour la
machine.
`;
}
