// Contrôle par permutation : la règle bat-elle le hasard sur ces données-là ?
//
// Le découpage en deux moitiés ne répond pas à cette question. Il attrape un
// réglage sur-ajusté, pas une règle qui n'a jamais rien eu à exploiter : si
// l'avantage est nul, il est nul dans les deux moitiés, et rien ne le signale.
// C'est exactement ce qui s'est produit — 53,4 % sur du BTCUSDT réel, 53,2 %
// sur une marche aléatoire.
//
// Le principe : rejouer les MÊMES détecteurs sur les MÊMES bougies, remises
// dans un ordre tiré au sort. Tout ce qui tient à la structure temporelle —
// tendances, cassures, order blocks — disparaît ; tout le reste survit
// intact. Si la règle rend le même chiffre après mélange, elle ne lisait pas
// la structure.

/**
 * Générateur pseudo-aléatoire à graine (mulberry32).
 *
 * Deux exécutions de même graine donnent le même résultat : un contrôle qu'on
 * ne peut pas rejouer ne se vérifie pas, et `Math.random` rendrait chaque
 * chiffre impossible à contester comme à confirmer.
 */
export function generateurAleatoire(graine = 1) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, sur place. */
export function melanger(tableau, alea) {
  for (let i = tableau.length - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [tableau[i], tableau[j]] = [tableau[j], tableau[i]];
  }
  return tableau;
}

/**
 * Forme d'une bougie, exprimée en rendements logarithmiques relatifs à son
 * ouverture, plus l'écart avec la clôture précédente.
 *
 * Décomposer ainsi permet de remettre les bougies dans un autre ordre sans
 * rien changer à chacune : un marteau reste un marteau, une bougie de +2 %
 * reste une bougie de +2 %. Seule la SUITE est détruite. C'est la seule
 * hypothèse nulle qui ait du sens ici — mélanger les prix eux-mêmes
 * produirait des séries qu'aucun marché ne pourrait engendrer.
 */
export function formeDe(bougie, precedente) {
  for (const p of [bougie.ouverture, bougie.plusHaut, bougie.plusBas, bougie.cloture]) {
    if (!Number.isFinite(p) || p <= 0) {
      throw new Error('Prix nul ou négatif : le contrôle par permutation suppose des prix strictement positifs.');
    }
  }

  return {
    ecart: precedente ? Math.log(bougie.ouverture / precedente.cloture) : 0,
    haut: Math.log(bougie.plusHaut / bougie.ouverture),
    bas: Math.log(bougie.plusBas / bougie.ouverture),
    cloture: Math.log(bougie.cloture / bougie.ouverture),
    volume: bougie.volume,
    volumeAcheteur: bougie.volumeAcheteur,
    nombreTrades: bougie.nombreTrades,
  };
}

/**
 * Une série de mêmes bougies, dans un ordre tiré au sort.
 *
 * Les horodatages restent ceux de la série d'origine : le mélange porte sur
 * les prix, pas sur le temps. Sans quoi les week-ends du forex se
 * retrouveraient au milieu de la semaine et l'agrégation vers les unités
 * supérieures n'aurait plus de sens.
 *
 * @param taillePaquet 1 pour un mélange bougie par bougie — le hasard le plus
 *   pur. Au-delà, les bougies se déplacent par paquets consécutifs, ce qui
 *   conserve la structure courte : une règle qui survit au mélange simple
 *   mais s'effondre par paquets exploitait quelque chose de plus long qu'une
 *   bougie.
 */
export function melangerBougies(bougies, alea, taillePaquet = 1) {
  if (bougies.length < 2) return bougies.map((b) => ({ ...b }));
  if (!Number.isInteger(taillePaquet) || taillePaquet < 1) {
    throw new Error('taillePaquet doit être un entier positif.');
  }

  const formes = bougies.map((b, i) => formeDe(b, i ? bougies[i - 1] : null));

  const paquets = [];
  for (let i = 0; i < formes.length; i += taillePaquet) {
    paquets.push(formes.slice(i, i + taillePaquet));
  }
  const melangees = melanger(paquets, alea).flat();

  let clotureePrecedente = bougies[0].ouverture;
  return bougies.map((origine, i) => {
    const f = melangees[i];
    // La première bougie part du prix de départ réel : son écart d'ouverture
    // n'aurait rien à quoi se raccrocher.
    const ouverture = i === 0 ? clotureePrecedente : clotureePrecedente * Math.exp(f.ecart);
    const cloture = ouverture * Math.exp(f.cloture);
    clotureePrecedente = cloture;

    const volumeAcheteur = f.volumeAcheteur;
    return {
      ouvertureMs: origine.ouvertureMs,
      fermetureMs: origine.fermetureMs,
      ouverture,
      plusHaut: ouverture * Math.exp(f.haut),
      plusBas: ouverture * Math.exp(f.bas),
      cloture,
      volume: f.volume,
      volumeAcheteur,
      volumeVendeur: typeof volumeAcheteur === 'number' ? f.volume - volumeAcheteur : null,
      delta: typeof volumeAcheteur === 'number' ? 2 * volumeAcheteur - f.volume : null,
      nombreTrades: f.nombreTrades,
    };
  });
}

/**
 * Proportion de tirages de contrôle qui égalent ou dépassent la valeur
 * observée — le p unilatéral du test de permutation.
 *
 * Lecture : 0,03 signifie que trois tirages sur cent font aussi bien que le
 * réel sans rien exploiter du tout. 0,45 signifie que le réel est un tirage
 * parmi d'autres.
 *
 * Le +1 au numérateur et au dénominateur n'est pas une coquette : sans lui,
 * un p de 0 laisserait croire à une impossibilité alors qu'on n'a simplement
 * pas tiré assez de fois. Avec cent tirages, le plancher est 1/101.
 */
export function valeurP(observee, controles) {
  const valides = controles.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!valides.length || typeof observee !== 'number' || !Number.isFinite(observee)) return null;

  const auMoinsAussiBons = valides.filter((v) => v >= observee).length;
  return {
    p: arrondir((auMoinsAussiBons + 1) / (valides.length + 1)),
    auMoinsAussiBons,
    tirages: valides.length,
    plancher: arrondir(1 / (valides.length + 1)),
  };
}

/** Bornes et quartiles d'un échantillon de contrôle. */
export function resumeDistribution(valeurs) {
  const tri = valeurs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!tri.length) return null;

  return {
    nombre: tri.length,
    minimum: arrondir(tri[0]),
    premierQuartile: arrondir(quantile(tri, 0.25)),
    mediane: arrondir(quantile(tri, 0.5)),
    dernierQuartile: arrondir(quantile(tri, 0.75)),
    maximum: arrondir(tri[tri.length - 1]),
    moyenne: arrondir(tri.reduce((a, v) => a + v, 0) / tri.length),
  };
}

function quantile(tri, q) {
  const pos = (tri.length - 1) * q;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  return bas === haut ? tri[bas] : tri[bas] + (tri[haut] - tri[bas]) * (pos - bas);
}

function arrondir(n) {
  return Number(n.toFixed(4));
}
