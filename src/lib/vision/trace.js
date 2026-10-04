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
import { dessinables } from '../marche/trouvailles.js';

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
export function rectanglesDesTrouvailles(lecture, largeurImage) {
  if (!lecture?.ok) return [];
  // Tout ce qui porte une zone se dessine, quelle que soit la figure. Nommer
  // les order blocks ici obligerait à revenir modifier ce fichier à chaque
  // analyse ajoutée — et un oubli donnerait une figure détectée, enregistrée,
  // jugeable, mais invisible sur l'image.
  // Le repli sur `orderBlocks` sert les lectures produites avant le contrat :
  // elles n'ont pas de type, et sans lui rien ne se dessinerait plus.
  const liste = (lecture.analyses?.trouvailles ?? lecture.analyses?.orderBlocks ?? [])
    .map((t) => (t?.type ? t : { ...t, type: 'order_block' }));

  return dessinables(liste)
    .map((t) => rectangleDeLOrderBlock(t, lecture.bougies, lecture.echelle, largeurImage))
    .filter(Boolean)
    // Dans l'ordre des bougies, pas dans celui de la détection : c'est l'ordre
    // de lecture du graphique, et il décide aussi de quel rectangle se dessine
    // par-dessus l'autre quand deux zones se chevauchent.
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
