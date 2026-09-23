// Fréquences observées, avec leur incertitude.
//
// Un taux sans intervalle de confiance est une illusion de précision :
// 3 succès sur 5 font « 60 % », mais l'intervalle va de 23 % à 88 %. Rien
// n'est mesuré. Tout chiffre produit ici porte donc sa propre incertitude.

/**
 * Intervalle de Wilson, à 95 % par défaut.
 *
 * Préféré à l'intervalle normal, qui dérape sur les petits échantillons et
 * sur les proportions proches de 0 ou 1 — exactement les cas qu'on
 * rencontrera au début.
 */
export function intervalleWilson(succes, total, z = 1.96) {
  if (!total) return null;

  const p = succes / total;
  const denominateur = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominateur;
  const demiLargeur = (z / denominateur) * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));

  return {
    proportion: arrondir(p),
    bas: arrondir(Math.max(0, centre - demiLargeur)),
    haut: arrondir(Math.min(1, centre + demiLargeur)),
    total,
    succes,
  };
}

/**
 * Un échantillon est-il assez grand pour conclure ?
 *
 * Critère : l'intervalle doit être plus étroit que `largeurMax`. À 20 cas,
 * il fait typiquement 40 points — on ne peut rien en dire.
 */
export function conclusionPossible(intervalle, largeurMax = 0.2) {
  if (!intervalle) return { possible: false, raison: 'aucune observation' };

  const largeur = intervalle.haut - intervalle.bas;
  return largeur <= largeurMax
    ? { possible: true, largeur: arrondir(largeur) }
    : {
        possible: false,
        largeur: arrondir(largeur),
        raison: `intervalle de ${(largeur * 100).toFixed(0)} points, trop large pour conclure`,
      };
}

/**
 * Espérance par trade, en unités de risque.
 *
 * C'est le seul chiffre qui dise si une règle gagne de l'argent. Un taux de
 * réussite élevé avec un ratio défavorable reste perdant.
 */
export function esperanceEnR({ gagnants, perdants, ratioMoyen, coutEnR = 0 }) {
  const total = gagnants + perdants;
  if (!total) return null;

  const p = gagnants / total;
  return arrondir(p * ratioMoyen - (1 - p) * 1 - coutEnR, 3);
}

function arrondir(n, decimales = 4) {
  return Number(n.toFixed(decimales));
}
