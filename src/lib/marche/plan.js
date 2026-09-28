// Ce que la fiche donne VRAIMENT, une fois ses trois distances jouées ensemble.
//
// La fiche pose un stop au q90 de l'excursion contraire à 1 h, un objectif au
// q75 de l'excursion favorable à 4 h, et un passage à seuil nul à la médiane
// 1 h. Trois quantiles, mesurés SÉPARÉMENT sur trois distributions.
//
// Personne n'avait mesuré ce qu'ils donnent ENSEMBLE. « Il te faut 41 % de
// gagnants » est de l'arithmétique sur le rapport gain/risque ; ce n'est pas
// un taux observé, et rien ne dit qu'on l'atteint.
//
// Ici, 1 R vaut LA DISTANCE DU STOP — la définition d'un opérateur, et non la
// hauteur de la bougie d'ancrage qu'utilisait HYP-001. Les deux unités ne se
// comparent pas ; DEC-033 a montré ce qu'une unité qui change à chaque trade
// fait à un chiffre.

/** Quantile d'une série DÉJÀ triée, par interpolation linéaire. */
export function quantile(triees, p) {
  if (!triees.length) return null;
  if (triees.length === 1) return triees[0];
  const rang = (triees.length - 1) * p;
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  if (bas === haut) return triees[bas];
  return triees[bas] + (rang - bas) * (triees[haut] - triees[bas]);
}

/**
 * Montée et baisse maximales après la clôture de `index`, en fraction du prix.
 *
 * On part de la CLÔTURE : c'est le premier prix auquel on peut agir en voyant
 * la bougie. Rend `null` si l'horizon n'est pas complet, plutôt qu'un chiffre
 * calculé sur une fenêtre tronquée.
 */
export function excursions(serie, index, horizon) {
  const depart = serie[index]?.cloture;
  if (!(depart > 0)) return null;
  if (index + horizon >= serie.length) return null;

  let haut = depart;
  let bas = depart;
  for (let i = index + 1; i <= index + horizon; i++) {
    if (serie[i].plusHaut > haut) haut = serie[i].plusHaut;
    if (serie[i].plusBas < bas) bas = serie[i].plusBas;
  }
  return { montee: (haut - depart) / depart, baisse: (depart - bas) / depart };
}

/**
 * Le sort d'une position menée selon la fiche.
 *
 * `stop`, `objectif` et `be` sont des DISTANCES EN PRIX depuis l'entrée.
 *
 * Deux règles d'honnêteté, parce qu'une bougie de 15 minutes ne dit pas dans
 * quel ordre ses extrêmes ont été touchés :
 *
 *   — une bougie qui atteint l'objectif ET le stop rend `ambigu`, sans valeur.
 *     Trancher fabriquerait du rendement dans un sens ou dans l'autre.
 *   — le passage à seuil nul ne prend effet qu'à la bougie SUIVANTE. Supposer
 *     qu'il protège déjà à l'intérieur de la bougie qui l'a déclenché
 *     reviendrait à lire l'ordre des prix qu'on n'a pas.
 */
export function jouerLePlan(serie, index, { sens, stop, objectif, be, horizon }) {
  const entree = serie[index]?.cloture;
  if (!(entree > 0) || !(stop > 0) || !(objectif > 0)) return null;
  if (index + horizon >= serie.length) return null;

  let seuilNul = false;

  for (let i = index + 1; i <= index + horizon; i++) {
    const b = serie[i];
    const favorable = sens > 0 ? b.plusHaut - entree : entree - b.plusBas;
    const contraire = sens > 0 ? entree - b.plusBas : b.plusHaut - entree;

    const toucheObjectif = favorable >= objectif;
    const toucheStop = seuilNul ? contraire >= 0 : contraire >= stop;

    if (toucheObjectif && toucheStop) return { issue: 'ambigu', R: null };
    if (toucheObjectif) return { issue: 'objectif', R: objectif / stop };
    if (toucheStop) return seuilNul ? { issue: 'seuilNul', R: 0 } : { issue: 'stop', R: -1 };

    if (!seuilNul && be > 0 && favorable >= be) seuilNul = true;
  }

  const fin = serie[index + horizon].cloture;
  return { issue: 'temps', R: ((fin - entree) * sens) / stop };
}

/**
 * Les distances de la fiche, tirées d'un historique d'excursions.
 *
 * Rend `null` tant que l'historique est trop court : un quantile à 90 % sur
 * quarante observations n'en décrit aucune.
 */
export function distancesDuPlan(historique, sens, prix, minimum = 200) {
  if (historique.length < minimum) return null;

  const contraireH1 = historique.map((h) => (sens > 0 ? h.baisseH1 : h.monteeH1)).sort((a, b) => a - b);
  const favorableH1 = historique.map((h) => (sens > 0 ? h.monteeH1 : h.baisseH1)).sort((a, b) => a - b);
  const favorableH4 = historique.map((h) => (sens > 0 ? h.monteeH4 : h.baisseH4)).sort((a, b) => a - b);

  const stop = quantile(contraireH1, 0.9) * prix;
  const objectif = quantile(favorableH4, 0.75) * prix;
  const be = quantile(favorableH1, 0.5) * prix;
  if (!(stop > 0) || !(objectif > 0)) return null;
  return { stop, objectif, be, n: historique.length };
}

const TRANCHES = Object.freeze([1, 1.5, 2, 3, 4, 6, 10]);

/** L'étiquette de tranche d'un rapport volume ÷ médiane, ou null sous 1×. */
export function trancheDe(rapport) {
  if (!(rapport >= TRANCHES[0])) return null;
  for (let i = TRANCHES.length - 1; i >= 0; i--) {
    if (rapport >= TRANCHES[i]) {
      return i === TRANCHES.length - 1 ? `≥ ${TRANCHES[i]}×` : `${TRANCHES[i]}–${TRANCHES[i + 1]}×`;
    }
  }
  return null;
}

export { TRANCHES };
