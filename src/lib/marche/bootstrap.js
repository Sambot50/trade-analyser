// Un témoin bâti à partir des données elles-mêmes.
//
// Une marche aléatoire à volatilité constante est un mauvais témoin pour un
// marché, et la mesure l'a montré : au même seuil de compression, le GC réel
// contient SEPT FOIS plus de ranges que la marche. La raison est le
// regroupement de volatilité — un marché alterne des périodes calmes et des
// périodes agitées, une marche à sigma fixe non. Les ranges comparés n'étaient
// donc pas les mêmes objets.
//
// Le rééchantillonnage par blocs répond à ça. On découpe la série réelle en
// tronçons de bougies consécutives, on les retire au hasard avec remise, et on
// les recolle en les décalant pour que les prix se rejoignent.
//
// CE QU'IL CONSERVE : la forme de chaque bougie, la distribution des
// amplitudes, et le regroupement de volatilité À L'INTÉRIEUR d'un bloc.
// CE QU'IL DÉTRUIT : toute dépendance au-delà de la longueur d'un bloc.
//
// La longueur des blocs est donc le réglage qui compte, et il n'est pas
// neutre. Un bloc plus long que la fenêtre de détection plus l'horizon
// laisserait la structure cherchée intacte À L'INTÉRIEUR du bloc, et le témoin
// reproduirait l'effet qu'il est censé ne pas avoir. Un bloc trop court
// détruirait aussi le regroupement de volatilité qu'on veut garder.

/** Générateur reproductible : deux appels avec la même graine donnent la même série. */
function generateur(graine) {
  let etat = graine >>> 0 || 1;
  return () => {
    etat ^= etat << 13; etat >>>= 0;
    etat ^= etat >> 17;
    etat ^= etat << 5; etat >>>= 0;
    return etat / 4294967296;
  };
}

/**
 * Une série rééchantillonnée par blocs, de même longueur que l'originale.
 *
 * Les blocs sont recollés par DÉCALAGE : chaque bloc est translaté pour que sa
 * première ouverture rejoigne la dernière clôture du précédent. Sans ça, la
 * série sauterait à chaque jointure, et ces sauts seraient pris pour des
 * sorties de range — on fabriquerait l'évènement qu'on veut compter.
 *
 * Les horodatages sont réécrits régulièrement : ceux d'origine n'ont plus de
 * sens une fois les tronçons mélangés, et les garder laisserait croire à une
 * chronologie qui n'existe pas.
 */
export function reechantillonnerParBlocs(bougies, { longueurBloc = 24, graine = 1, pasMs = null } = {}) {
  if (!Array.isArray(bougies) || bougies.length < longueurBloc * 2) return [];

  const alea = generateur(graine);
  const pas = pasMs ?? deduirePas(bougies);
  const sortie = [];
  let decalage = 0;
  let ms = bougies[0]?.ouvertureMs ?? 0;

  while (sortie.length < bougies.length) {
    const debut = Math.floor(alea() * (bougies.length - longueurBloc));
    const bloc = bougies.slice(debut, debut + longueurBloc);
    if (!bloc.length) break;

    // Le décalage qui recolle ce bloc au précédent.
    const precedente = sortie.at(-1);
    decalage = precedente ? precedente.cloture - bloc[0].ouverture : 0;

    for (const b of bloc) {
      if (sortie.length >= bougies.length) break;
      sortie.push({
        ouverture: b.ouverture + decalage,
        plusHaut: b.plusHaut + decalage,
        plusBas: b.plusBas + decalage,
        cloture: b.cloture + decalage,
        volume: b.volume,
        ouvertureMs: ms,
        fermetureMs: ms + pas - 1,
      });
      ms += pas;
    }
  }
  return sortie;
}

/** Le pas de temps le plus fréquent de la série, pour réécrire les horodatages. */
function deduirePas(bougies) {
  const ecarts = new Map();
  for (let i = 1; i < Math.min(bougies.length, 500); i++) {
    const d = bougies[i].ouvertureMs - bougies[i - 1].ouvertureMs;
    if (d > 0) ecarts.set(d, (ecarts.get(d) ?? 0) + 1);
  }
  let pas = 900_000; let max = 0;
  for (const [d, n] of ecarts) if (n > max) { max = n; pas = d; }
  return pas;
}

/**
 * Plusieurs tirages, pour que le témoin ait sa propre dispersion.
 *
 * Un seul tirage donnerait un chiffre, pas une référence. C'est la dispersion
 * entre tirages qui dit ce que vaut l'écart observé.
 */
export function tirages(bougies, { nombre = 12, longueurBloc = 24, pasMs = null } = {}) {
  const out = [];
  for (let g = 1; g <= nombre; g++) {
    out.push(reechantillonnerParBlocs(bougies, { longueurBloc, graine: g * 7919, pasMs }));
  }
  return out;
}
