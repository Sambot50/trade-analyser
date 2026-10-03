// Reporter sur l'image ce qui a été mesuré dedans.
//
// La lecture rend des order blocks exprimés en PRIX et en INDICES de bougie.
// Les tracer demande de refaire le chemin inverse : le prix redevient une
// ordonnée par `yDePrix`, et l'indice redevient une abscisse par le centre de
// la bougie, relevé lors de l'extraction.
//
// Ces fonctions ne dessinent rien. Elles calculent des rectangles, et c'est
// pour cela qu'elles se testent : une zone mal placée se verrait à l'écran,
// mais seulement si on la regarde, et seulement si on sait où elle devrait
// être.

/** Une zone d'order block, en pixels de l'image analysée. */
export function rectangleDeLOrderBlock(ob, bougies, echelle, largeurImage) {
  if (!ob?.zone || !echelle?.yDePrix) return null;
  const ancre = bougies?.[ob.index];
  if (!ancre || !Number.isFinite(ancre.centreX)) return null;

  const yHaut = echelle.yDePrix(ob.zone.haut);
  const yBas = echelle.yDePrix(ob.zone.bas);
  if (!Number.isFinite(yHaut) || !Number.isFinite(yBas)) return null;

  // Une zone part de sa bougie et court vers la droite : elle reste valable
  // tant que le prix n'y est pas revenu, donc jusqu'au bord.
  const x = Math.max(0, ancre.centreX - (ancre.largeur ?? 2) / 2);
  return {
    index: ob.index,
    sens: ob.sens ?? null,
    x,
    y: Math.min(yHaut, yBas),
    largeur: Math.max(1, largeurImage - x),
    hauteur: Math.max(1, Math.abs(yBas - yHaut)),
    prixHaut: ob.zone.haut,
    prixBas: ob.zone.bas,
    qualificatifs: ob.qualificatifs ?? null,
  };
}

/**
 * Tous les rectangles d'une lecture réussie, les plus récents en dernier.
 *
 * Rend un tableau vide plutôt que `null` : l'appelant dessine en boucle, et
 * une absence ne doit pas l'obliger à se protéger.
 */
export function rectanglesDesOrderBlocks(lecture, largeurImage) {
  if (!lecture?.ok || !lecture.analyses?.orderBlocks?.length) return [];
  return lecture.analyses.orderBlocks
    .map((ob) => rectangleDeLOrderBlock(ob, lecture.bougies, lecture.echelle, largeurImage))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

/** Les mentions à écrire sur une zone, de la plus parlante à la moins. */
export function etiquetteDuRectangle(rect) {
  const q = rect?.qualificatifs ?? {};
  const marques = [
    q.priseDeLiquidite && 'liquidité',
    q.fvg && 'FVG',
    q.premiumDiscount?.ote && 'OTE',
  ].filter(Boolean);
  const sens = rect?.sens === 'haussier' ? 'OB ↑' : rect?.sens === 'baissier' ? 'OB ↓' : 'OB';
  return marques.length ? `${sens} · ${marques.join(' · ')}` : sens;
}
