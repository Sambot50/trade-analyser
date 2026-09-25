// Pont entre ce que rend un modèle de vision et ce que résout le journal.
//
// Le modèle parle en `entry / stopLoss / tp1 / tp2`. Le résolveur parle en
// `prixEntree / prixStopLoss / prixTp1 / prixTp2`. La traduction tient en dix
// lignes, et elle vit ici plutôt que recopiée dans chaque script : c'est le
// genre de recopie qui finit par diverger, et une divergence entre ce qu'on
// affiche et ce qu'on résout serait invisible.

/** Plan résoluble à partir d'une analyse de modèle déjà validée. */
export function planDepuisAnalyse(analyse) {
  const risque = Math.abs(analyse.entry - analyse.stopLoss);
  return {
    direction: analyse.direction,
    prixEntree: analyse.entry,
    prixStopLoss: analyse.stopLoss,
    prixTp1: analyse.tp1,
    prixTp2: analyse.tp2,
    risque,
  };
}

/**
 * La géométrie d'un plan, indépendamment du moment où il a été posé.
 *
 * Ce sont ces proportions que le contrôle rejouera à des instants tirés au
 * sort : si les plans du modèle ne font pas mieux que la même géométrie posée
 * n'importe quand, le modèle n'apporte rien. Le sens est conservé, faute de
 * quoi un marché haussier se ferait passer pour du talent.
 *
 * Tout est rapporté au prix de référence, donc transposable à un autre niveau
 * de prix — un plan sur l'or à 1900 se rejoue à 2400 sans distorsion.
 */
export function geometrieDuPlan(plan, prixReference) {
  if (!(prixReference > 0)) throw new Error('Prix de référence absent ou nul.');

  return {
    direction: plan.direction,
    // Où se pose l'entrée par rapport au prix du moment.
    ecartEntree: (plan.prixEntree - prixReference) / prixReference,
    // Distances au stop et aux objectifs, en fraction du prix.
    risque: Math.abs(plan.prixEntree - plan.prixStopLoss) / prixReference,
    tp1: Math.abs(plan.prixTp1 - plan.prixEntree) / prixReference,
    tp2: Math.abs(plan.prixTp2 - plan.prixEntree) / prixReference,
  };
}

/** Rejoue une géométrie à un autre prix de référence. */
export function planDepuisGeometrie(geometrie, prixReference) {
  if (!(prixReference > 0)) throw new Error('Prix de référence absent ou nul.');

  const estLong = geometrie.direction === 'BUY';
  const signe = estLong ? 1 : -1;
  const entree = prixReference * (1 + geometrie.ecartEntree);
  const risque = prixReference * geometrie.risque;

  return {
    direction: geometrie.direction,
    prixEntree: entree,
    prixStopLoss: entree - signe * risque,
    prixTp1: entree + signe * prixReference * geometrie.tp1,
    prixTp2: entree + signe * prixReference * geometrie.tp2,
    risque,
  };
}
