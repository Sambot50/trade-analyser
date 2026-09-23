// Amplitude maximale atteinte par le prix, dans le sens du trade et contre lui.
//
// L'issue seule ne dit pas tout. Un stop touché de justesse après que le prix
// soit allé à deux doigts du TP1 n'est pas le même échec qu'un stop pris
// immédiatement : le premier signale un stop trop serré, le second une lecture
// fausse. Ces deux amplitudes distinguent les deux cas.

/**
 * @param plan    { direction, prixEntree, prixStopLoss }
 * @param bougies bougies à partir du déclenchement, incluse
 * @returns { faveurMax, contreMax, faveurMaxPrix, contreMaxPrix } ou null
 */
export function calculerExcursions(plan, bougies) {
  if (!bougies?.length) return null;

  const estLong = plan.direction === 'BUY';
  let faveurMax = 0;
  let contreMax = 0;
  let faveurMaxPrix = plan.prixEntree;
  let contreMaxPrix = plan.prixEntree;

  for (const b of bougies) {
    const faveur = estLong ? b.plusHaut - plan.prixEntree : plan.prixEntree - b.plusBas;
    const contre = estLong ? plan.prixEntree - b.plusBas : b.plusHaut - plan.prixEntree;

    if (faveur > faveurMax) {
      faveurMax = faveur;
      faveurMaxPrix = estLong ? b.plusHaut : b.plusBas;
    }
    if (contre > contreMax) {
      contreMax = contre;
      contreMaxPrix = estLong ? b.plusBas : b.plusHaut;
    }
  }

  return { faveurMax, contreMax, faveurMaxPrix, contreMaxPrix };
}

/**
 * Rapporte les excursions à la distance au stop.
 *
 * `contreEnR` proche de 1 signifie que le stop a été frôlé : le trade a tenu
 * de peu. `faveurEnR` dit combien de fois le risque a été gagné au mieux,
 * avant l'issue — un TP1 à 0,87 R alors que le prix est allé à 2,5 R indique
 * un objectif posé trop près.
 */
export function enUnitesDeRisque(excursions, plan) {
  if (!excursions) return null;
  const risque = Math.abs(plan.prixEntree - plan.prixStopLoss);
  if (!risque) return null;

  return {
    faveurEnR: Math.round((excursions.faveurMax / risque) * 100) / 100,
    contreEnR: Math.round((excursions.contreMax / risque) * 100) / 100,
  };
}
