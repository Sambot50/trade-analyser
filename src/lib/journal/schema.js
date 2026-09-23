// Format d'enregistrement du journal.
//
// Contrainte de conception : un enregistrement doit être interprétable SEUL,
// par un humain comme par un agent, sans lire le code qui l'a produit. D'où
// les noms complets, les unités explicites, les seuils embarqués, et le
// résumé en langue naturelle. Le surcoût en octets est sans commune mesure
// avec le coût d'une mauvaise interprétation six mois plus tard.

import { breakEvenRate, computeRR, rrVerdict } from '../analysis.js';

// v2 (2026-09-23) : la règle de sortie devient explicite. En v1, un trade
// passé par TP1 puis stoppé était compté comme un gain de +1 R tout en
// pouvant valoir +2 R s'il allait plus loin — une option gratuite qui
// fabriquait +0,33 R par trade sur des données sans aucune structure. Les
// enregistrements v1 restent lisibles mais ne se comparent pas aux v2.
export const SCHEMA_VERSION = 2;

/**
 * Règle de sortie du journal : tenue jusqu'à 2 R, stop sinon.
 *
 * Choisie parce que les plans produits portent déjà un TP2 et que c'est la
 * règle que le backtest mesure par défaut. Toucher 1 R en chemin ne rapporte
 * rien : on n'y était pas sorti.
 */
export const OBJECTIF_JOURNAL = '2r';

export const SEUILS_RATIO = {
  defavorableEnDessousDe: 1,
  bonneAsymetrieAPartirDe: 2,
};

/** Horizon de résolution, en minutes, au-delà duquel un trade est déclaré non résolu. */
export const HORIZON_RESOLUTION_MINUTES = 24 * 60;

const DEVISES_COTATION = ['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'BNB'];

/**
 * Devise dans laquelle les prix sont exprimés, déduite du symbole.
 * Renvoie null plutôt qu'une supposition : un agent doit pouvoir distinguer
 * « inconnu » de « faux ».
 */
export function deviseDeCotation(symbole) {
  if (typeof symbole !== 'string') return null;
  const nettoye = symbole.toUpperCase().replace(/[\s/\-_]/g, '');

  for (const devise of DEVISES_COTATION) {
    if (nettoye.endsWith(devise) && nettoye.length > devise.length) return devise;
  }
  return null;
}

/** Identifiant stable, trié chronologiquement, lisible. */
export function construireId(horodatage, symbole, uniteTemps) {
  const symboleNettoye = (symbole || 'INCONNU').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tf = (uniteTemps || '?').replace(/[^A-Za-z0-9]/g, '');
  return `${horodatage}-${symboleNettoye}-${tf}`;
}

/** Chemin du dossier de l'analyse, relatif à la racine du journal. */
export function cheminDossier(record) {
  const jour = record.horodatage.slice(0, 10);
  const heure = record.horodatage.slice(11, 19).replace(/:/g, '');
  const symbole = (record.marche.symbole || 'INCONNU').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tf = (record.marche.uniteTemps || '?').replace(/[^A-Za-z0-9]/g, '');
  return `${jour}/${heure}-${symbole}-${tf}`;
}

/**
 * Phrase de résumé, lue en premier par un agent.
 * Elle doit contenir tout ce qui permet de trier sans ouvrir le reste.
 */
export function construireResume(record) {
  const { plan, marche, resultat } = record;
  const sens = plan.direction === 'BUY' ? 'Long' : 'Short';
  const devise = marche.devise ? ` ${marche.devise}` : '';
  const ratio = plan.ratioRisqueRendementTp1;

  const issue = resultat
    ? `issue ${resultat.statut} (${resultat.source})`
    : 'issue non constatée';

  return (
    `${sens} ${marche.symbole} ${marche.uniteTemps} à ${plan.prixEntree}${devise}, ` +
    `stop ${plan.prixStopLoss}, TP1 ${plan.prixTp1}, TP2 ${plan.prixTp2} — ` +
    `ratio ${plan.verdictRatio} de ${ratio ?? '?'}, ` +
    `confiance déclarée ${record.lecture.confianceDeclareeParLeModele} %, ${issue}.`
  );
}

/**
 * Construit l'enregistrement complet d'une analyse.
 *
 * @param analyse  analyse normalisée telle qu'affichée
 * @param moteur   { fournisseur, modele, dureeMs }
 * @param fichiers { capture: {nom, largeur, hauteur, typeMime, octets, sha256}, overlay: {...} }
 * @param horodatage ISO 8601 UTC à la seconde
 */
export function construireEnregistrement({ analyse, moteur, fichiers, horodatage }) {
  const risque = Math.abs(analyse.entry - analyse.stopLoss);
  const gainTp1 = Math.abs(analyse.tp1 - analyse.entry);
  const gainTp2 = Math.abs(analyse.tp2 - analyse.entry);

  const rr1 = computeRR(analyse.entry, analyse.stopLoss, analyse.tp1);
  const rr2 = computeRR(analyse.entry, analyse.stopLoss, analyse.tp2);
  const verdict = rrVerdict(rr1);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    id: construireId(horodatage, analyse.symbol, analyse.timeframe),
    resume: null, // rempli plus bas, une fois le reste connu
    horodatage,

    moteur: {
      fournisseur: moteur.fournisseur,
      modele: moteur.modele,
      dureeMs: moteur.dureeMs ?? null,
    },

    marche: {
      symbole: analyse.symbol ?? null,
      uniteTemps: analyse.timeframe ?? null,
      devise: deviseDeCotation(analyse.symbol),
      commentaireDevise: 'Tous les prix de cet enregistrement sont exprimés dans cette devise.',
    },

    lecture: {
      biais: analyse.bias ?? null,
      confianceDeclareeParLeModele: analyse.confidence ?? null,
      commentaireConfiance:
        'Valeur produite par le modèle lui-même, de 0 à 100. Ce n’est pas une mesure, ' +
        'et elle ne doit pas être traitée comme une probabilité.',
      repereAxeDesPrix: analyse.scale
        ? {
            prixGraduationHaute: analyse.scale.priceTop,
            hauteurGraduationHaute: analyse.scale.plotTopRatio,
            prixGraduationBasse: analyse.scale.priceBottom,
            hauteurGraduationBasse: analyse.scale.plotBottomRatio,
            commentaire:
              'Hauteurs en fraction de la hauteur de l’image, 0 en haut, 1 en bas. ' +
              'Ces deux points définissent la projection prix vers pixel.',
          }
        : null,
    },

    plan: {
      direction: analyse.direction,
      prixEntree: analyse.entry,
      prixStopLoss: analyse.stopLoss,
      prixTp1: analyse.tp1,
      prixTp2: analyse.tp2,
      distanceRisque: arrondir(risque),
      distanceGainTp1: arrondir(gainTp1),
      distanceGainTp2: arrondir(gainTp2),
      ratioRisqueRendementTp1: rr1,
      ratioRisqueRendementTp2: rr2,
      tauxReussiteEquilibre: arrondir(breakEvenRate(rr1), 4),
      commentaireTauxEquilibre:
        'Proportion de trades gagnants nécessaire pour ne rien perdre avec ce ratio.',
      verdictRatio: verdict.tone === 'bad' ? 'defavorable'
        : verdict.tone === 'weak' ? 'modere'
        : verdict.tone === 'good' ? 'bonne_asymetrie'
        : 'indisponible',
      seuilsVerdictRatio: SEUILS_RATIO,

      // La règle de sortie fait partie du plan : sans elle, un statut « stop »
      // ne dit pas si le prix avait frôlé 1 R en chemin, ni si ça comptait.
      // Deux enregistrements de règles différentes ne se comparent pas.
      objectifDeSortie: OBJECTIF_JOURNAL,
      commentaireObjectifDeSortie: OBJECTIF_JOURNAL === '2r'
        ? "Tenue jusqu'à TP2. Toucher TP1 en chemin ne rapporte rien : on n'y était pas sorti."
        : 'Sortie ferme à TP1. TP2 n’est pas visé.',
    },

    raisonnement: Array.isArray(analyse.reasoning) ? analyse.reasoning : [],

    controles: {
      coherenceDirectionnelle: true, // une analyse incohérente n'est jamais enregistrée
      repereValide: Boolean(analyse.scale),
      commentaire:
        'Une analyse dont l’ordonnancement contredit la direction est rejetée avant ' +
        'enregistrement : le journal ne contient que des plans cohérents.',
    },

    fichiers: {
      capture: fichiers?.capture ?? null,
      overlay: fichiers?.overlay ?? null,
    },

    resultat: null,
    commentaireResultat:
      'null tant que l’issue n’est pas constatée. Statuts possibles : ' +
      'non_declenche, stop, tp1, tp2, ambigu, horizon_depasse.',
  };

  record.resume = construireResume(record);
  return record;
}

function arrondir(n, decimales = 8) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Number(n.toFixed(decimales));
}

/** Ligne compacte pour index.jsonl : ni raisonnement, ni commentaires, ni images. */
export function ligneIndex(record) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: record.id,
    horodatage: record.horodatage,
    dossier: cheminDossier(record),
    modele: record.moteur.modele,
    dureeMs: record.moteur.dureeMs,
    symbole: record.marche.symbole,
    uniteTemps: record.marche.uniteTemps,
    devise: record.marche.devise,
    direction: record.plan.direction,
    prixEntree: record.plan.prixEntree,
    prixStopLoss: record.plan.prixStopLoss,
    prixTp1: record.plan.prixTp1,
    prixTp2: record.plan.prixTp2,
    objectifDeSortie: record.plan.objectifDeSortie,
    ratioRisqueRendementTp1: record.plan.ratioRisqueRendementTp1,
    verdictRatio: record.plan.verdictRatio,
    confianceDeclareeParLeModele: record.lecture.confianceDeclareeParLeModele,
    statut: record.resultat?.statut ?? null,
    sourceResultat: record.resultat?.source ?? null,
  };
}

/** Ligne de mise à jour, ajoutée à l'index quand une issue est constatée. */
export function ligneMiseAJour(record, maintenant) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: record.id,
    maj: maintenant,
    statut: record.resultat?.statut ?? null,
    sourceResultat: record.resultat?.source ?? null,
  };
}

/**
 * Réduit un journal d'évènements en état courant : dernière ligne par id.
 * L'index est un journal, pas une table — c'est ce qui permet de ne jamais
 * le réécrire.
 */
export function reduireIndex(lignes) {
  const parId = new Map();
  for (const ligne of lignes) {
    if (!ligne?.id) continue;
    parId.set(ligne.id, { ...(parId.get(ligne.id) || {}), ...ligne });
  }
  return [...parId.values()].sort((a, b) => a.horodatage < b.horodatage ? -1 : 1);
}
