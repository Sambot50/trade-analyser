// Résolution automatique de l'issue d'un plan de trade à partir de bougies.
//
// Logique pure : elle ne connaît ni le réseau, ni la source des bougies. Ce
// qui la rend testable exhaustivement — et c'est nécessaire, parce qu'une
// erreur ici fausserait silencieusement toute la mesure. Elle l'a fait.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Une seule règle de sortie par plan, choisie AVANT d'ouvrir.             │
// │                                                                         │
// │ La version précédente créditait +1 R à un trade passé par TP1 puis      │
// │ stoppé, tout en créditant +2 R s'il allait jusqu'à TP2. C'est une       │
// │ option gratuite : à l'instant où le prix touche 1 R, il faut choisir —  │
// │ encaisser ou tenir — et on ne peut pas savoir laquelle était la bonne   │
// │ sans regarder la suite. Une lecture du futur, dans la règle de sortie.  │
// │                                                                         │
// │ Mesuré sur 200 000 marches aléatoires, où toute espérance doit être     │
// │ nulle : +0,330 R avec cette convention, −0,001 R avec une sortie ferme  │
// │ à 1 R, −0,007 R avec une tenue jusqu'à 2 R. Elle fabriquait un tiers    │
// │ d'unité de risque par trade à partir de rien.                           │
// └─────────────────────────────────────────────────────────────────────────┘

export const STATUTS = ['non_declenche', 'stop', 'tp1', 'tp2', 'ambigu', 'horizon_depasse', 'en_cours'];

/**
 * Les deux règles de sortie mesurables sans stop mobile.
 *
 * `champ` désigne le SEUL prix qui clôt le trade en gain ; l'autre objectif
 * n'existe pas pour cette règle. `gain` est ce que vaut ce gain en unités de
 * risque, et `seuil` le taux de réussite qui annule l'espérance hors coûts.
 */
export const OBJECTIFS = {
  '1r': { champ: 'prixTp1', statut: 'tp1', gain: 1, seuil: 0.5 },
  '2r': { champ: 'prixTp2', statut: 'tp2', gain: 2, seuil: 1 / 3 },
};

export function reglageObjectif(objectif) {
  const reglage = OBJECTIFS[objectif];
  if (!reglage) {
    // Pas de valeur par défaut : une convention de sortie implicite est
    // exactement ce qui a faussé toutes les mesures précédentes.
    throw new Error(`Objectif de sortie manquant ou inconnu : "${objectif}". Attendu ${Object.keys(OBJECTIFS).join(' ou ')}.`);
  }
  return reglage;
}

/** Ce que vaut une issue, en unités de risque. null si elle ne compte pas. */
export function gainEnR(statut, objectif) {
  const reglage = reglageObjectif(objectif);
  if (statut === reglage.statut) return reglage.gain;
  if (statut === 'stop') return -1;
  return null;
}

/**
 * @param plan    { direction, prixEntree, prixStopLoss, prixTp1, prixTp2 }
 * @param bougies [{ ouvertureMs, plusHaut, plusBas }] triées chronologiquement,
 *                à partir de l'horodatage de l'analyse
 * @param horizonBougies nombre de bougies couvrant l'horizon de résolution
 * @param objectif '1r' ou '2r' — la règle de sortie, obligatoire
 *
 * @returns { statut, detail }
 */
export function resoudreIssue({ plan, bougies, horizonBougies, objectif }) {
  const reglage = reglageObjectif(objectif);
  const prixCible = plan[reglage.champ];

  const examinees = bougies.slice(0, horizonBougies);
  const horizonCouvert = bougies.length >= horizonBougies;

  const estLong = plan.direction === 'BUY';
  const toucheEntree = (b) => (estLong ? b.plusBas <= plan.prixEntree : b.plusHaut >= plan.prixEntree);
  const toucheStop = (b) => (estLong ? b.plusBas <= plan.prixStopLoss : b.plusHaut >= plan.prixStopLoss);
  const toucheCible = (b) => (estLong ? b.plusHaut >= prixCible : b.plusBas <= prixCible);

  const indexEntree = examinees.findIndex(toucheEntree);

  if (indexEntree === -1) {
    // Pas encore déclenché. Tant que l'horizon n'est pas couvert, rien n'est
    // acquis : le prix peut encore venir chercher l'entrée.
    return {
      statut: horizonCouvert ? 'non_declenche' : 'en_cours',
      detail: { bougiesExaminees: examinees.length, declencheLe: null, objectif },
    };
  }

  const declencheLe = examinees[indexEntree].ouvertureMs;

  for (let i = indexEntree; i < examinees.length; i++) {
    const b = examinees[i];
    const stop = toucheStop(b);
    const cible = toucheCible(b);

    // Une même bougie touchant le stop et l'objectif ne dit pas l'ordre.
    // Deviner biaiserait la mesure : on le déclare et on exclut le cas.
    if (stop && cible) {
      return {
        statut: 'ambigu',
        detail: {
          bougiesExaminees: i + 1,
          declencheLe,
          objectif,
          bougieAmbigueMs: b.ouvertureMs,
          raison: "La bougie touche le stop et l'objectif ; son OHLC ne dit pas dans quel ordre.",
        },
      };
    }

    if (cible) {
      return { statut: reglage.statut, detail: { bougiesExaminees: i + 1, declencheLe, objectif, atteintLe: b.ouvertureMs } };
    }

    // Le stop clôt le trade, définitivement. Un objectif intermédiaire frôlé
    // en chemin ne rapporte rien : on n'y était pas sorti.
    if (stop) {
      return { statut: 'stop', detail: { bougiesExaminees: i + 1, declencheLe, objectif, stopToucheLe: b.ouvertureMs } };
    }
  }

  return {
    statut: horizonCouvert ? 'horizon_depasse' : 'en_cours',
    detail: { bougiesExaminees: examinees.length, declencheLe, objectif },
  };
}

/** Un statut compte-t-il dans les statistiques de réussite ? */
export function compteDansLesStats(statut) {
  return statut === 'stop' || statut === 'tp1' || statut === 'tp2';
}

export function estGagnant(statut) {
  return statut === 'tp1' || statut === 'tp2';
}
