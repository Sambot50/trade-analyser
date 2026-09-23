// Résolution automatique de l'issue d'un plan de trade à partir de bougies.
//
// Logique pure : elle ne connaît ni le réseau, ni la source des bougies. Ce
// qui la rend testable exhaustivement — et c'est nécessaire, parce qu'une
// erreur ici fausserait silencieusement toute la mesure.

export const STATUTS = ['non_declenche', 'stop', 'tp1', 'tp2', 'ambigu', 'horizon_depasse', 'en_cours'];

/**
 * @param plan    { direction, prixEntree, prixStopLoss, prixTp1, prixTp2 }
 * @param bougies [{ ouvertureMs, plusHaut, plusBas }] triées chronologiquement,
 *                à partir de l'horodatage de l'analyse
 * @param horizonBougies nombre de bougies couvrant l'horizon de résolution
 *
 * @returns { statut, detail }
 */
export function resoudreIssue({ plan, bougies, horizonBougies }) {
  const examinees = bougies.slice(0, horizonBougies);
  const horizonCouvert = bougies.length >= horizonBougies;

  const estLong = plan.direction === 'BUY';
  const toucheEntree = (b) => (estLong ? b.plusBas <= plan.prixEntree : b.plusHaut >= plan.prixEntree);
  const toucheStop = (b) => (estLong ? b.plusBas <= plan.prixStopLoss : b.plusHaut >= plan.prixStopLoss);
  const toucheTp1 = (b) => (estLong ? b.plusHaut >= plan.prixTp1 : b.plusBas <= plan.prixTp1);
  const toucheTp2 = (b) => (estLong ? b.plusHaut >= plan.prixTp2 : b.plusBas <= plan.prixTp2);

  const indexEntree = examinees.findIndex(toucheEntree);

  if (indexEntree === -1) {
    // Pas encore déclenché. Tant que l'horizon n'est pas couvert, rien n'est
    // acquis : le prix peut encore venir chercher l'entrée.
    return {
      statut: horizonCouvert ? 'non_declenche' : 'en_cours',
      detail: { bougiesExaminees: examinees.length, declencheLe: null },
    };
  }

  const declencheLe = examinees[indexEntree].ouvertureMs;
  let meilleurAtteint = null;

  for (let i = indexEntree; i < examinees.length; i++) {
    const b = examinees[i];
    const stop = toucheStop(b);
    const tp1 = toucheTp1(b);
    const tp2 = toucheTp2(b);

    // Une même bougie touchant le stop et un objectif ne dit pas l'ordre.
    // Deviner biaiserait la mesure : on le déclare et on exclut le cas.
    if (stop && (tp1 || tp2)) {
      return {
        statut: 'ambigu',
        detail: {
          bougiesExaminees: i + 1,
          declencheLe,
          bougieAmbigueMs: b.ouvertureMs,
          raison: 'La bougie touche le stop et un objectif ; son OHLC ne dit pas dans quel ordre.',
        },
      };
    }

    if (tp2) return { statut: 'tp2', detail: { bougiesExaminees: i + 1, declencheLe, atteintLe: b.ouvertureMs } };

    if (stop) {
      // Convention : un objectif déjà atteint n'est pas effacé par un stop
      // ultérieur — le trade avait été sécurisé au moins en partie.
      return {
        statut: meilleurAtteint ?? 'stop',
        detail: { bougiesExaminees: i + 1, declencheLe, stopTouchéLe: b.ouvertureMs },
      };
    }

    if (tp1) meilleurAtteint = 'tp1';
  }

  if (meilleurAtteint) {
    return { statut: meilleurAtteint, detail: { bougiesExaminees: examinees.length, declencheLe } };
  }

  return {
    statut: horizonCouvert ? 'horizon_depasse' : 'en_cours',
    detail: { bougiesExaminees: examinees.length, declencheLe },
  };
}

/** Un statut compte-t-il dans les statistiques de réussite ? */
export function compteDansLesStats(statut) {
  return statut === 'stop' || statut === 'tp1' || statut === 'tp2';
}

export function estGagnant(statut) {
  return statut === 'tp1' || statut === 'tp2';
}
