// Ce que le modèle affirme, face à ce que l'image mesure.
//
// Les deux lectures portent sur LA MÊME capture et ne se doivent rien : l'une
// interprète, l'autre mesure. Les mettre côte à côte est le seul moyen de
// savoir ce que vaut la première — et c'est une question qu'aucune des deux ne
// peut trancher seule.
//
// Deux confrontations, et elles ne disent pas la même chose.
//
// L'ÉCART D'AXE est un fait vérifiable : si le modèle a mal situé les prix,
// tous ses niveaux sont décalés d'autant, et le plan paraît crédible tout en
// visant à côté. C'est l'erreur la plus coûteuse parce qu'elle est invisible.
//
// LES NIVEAUX DANS LES ZONES est une question de cohérence, pas de vérité. Un
// plan posé sur un order block mesuré s'appuie sur quelque chose ; un plan
// posé nulle part peut avoir raison, mais il ne s'appuie sur rien de visible.

/** Le prix qu'annonce le repère du modèle à une hauteur donnée. */
export function prixSelonLeModele(repere, y, hauteurImage) {
  if (!repere || !(hauteurImage > 0)) return null;
  const { priceTop, priceBottom, plotTopRatio, plotBottomRatio } = repere;
  if (![priceTop, priceBottom, plotTopRatio, plotBottomRatio].every(Number.isFinite)) return null;
  const etendueRatio = plotBottomRatio - plotTopRatio;
  if (!etendueRatio) return null;
  const part = (y / hauteurImage - plotTopRatio) / etendueRatio;
  return priceTop - part * (priceTop - priceBottom);
}

/**
 * De combien les deux axes divergent, en fraction de l'étendue mesurée.
 *
 * Échantillonné sur toute la hauteur du tracé : une divergence peut être nulle
 * au milieu et forte aux extrémités, si le modèle s'est trompé d'amplitude
 * plutôt que de niveau.
 */
export function ecartDesAxes(repere, echelle, zone, hauteurImage, { points = 9 } = {}) {
  if (!repere || !echelle?.prixDeY || !zone) return null;
  const hautMesure = echelle.prixDeY(zone.y0);
  const basMesure = echelle.prixDeY(zone.y1);
  const etendue = Math.abs(hautMesure - basMesure);
  if (!(etendue > 0)) return null;

  const ecarts = [];
  for (let i = 0; i < points; i++) {
    const y = zone.y0 + ((zone.y1 - zone.y0) * i) / (points - 1);
    const duModele = prixSelonLeModele(repere, y, hauteurImage);
    if (!Number.isFinite(duModele)) return null;
    ecarts.push(Math.abs(duModele - echelle.prixDeY(y)) / etendue);
  }
  const moyen = ecarts.reduce((s, x) => s + x, 0) / ecarts.length;
  return {
    moyen, pire: Math.max(...ecarts), etendue,
    hautMesure, basMesure,
    hautModele: prixSelonLeModele(repere, zone.y0, hauteurImage),
    basModele: prixSelonLeModele(repere, zone.y1, hauteurImage),
  };
}

const NIVEAUX = [
  ['entry', 'Entrée'], ['stopLoss', 'Stop'], ['tp1', 'TP 1'], ['tp2', 'TP 2'],
];

/**
 * Chaque niveau du plan, situé par rapport aux zones mesurées.
 *
 * `distance` est exprimée en fraction de l'étendue : un niveau à 0,02 est à
 * deux pour cent du graphique de la zone la plus proche, ce qui est près ;
 * à 0,30, il n'a rien à voir avec elle.
 */
export function niveauxDansLesZones(analyse, orderBlocks, etendue) {
  if (!analyse || !Array.isArray(orderBlocks) || !(etendue > 0)) return [];
  return NIVEAUX
    .filter(([cle]) => Number.isFinite(analyse[cle]))
    .map(([cle, libelle]) => {
      const prix = analyse[cle];
      let dedans = null;
      let plusProche = null;
      for (const ob of orderBlocks) {
        const { bas, haut } = ob.zone ?? {};
        if (!Number.isFinite(bas) || !Number.isFinite(haut)) continue;
        if (prix >= bas && prix <= haut) { dedans = ob; break; }
        const d = Math.min(Math.abs(prix - bas), Math.abs(prix - haut)) / etendue;
        if (!plusProche || d < plusProche.distance) plusProche = { ob, distance: d };
      }
      return {
        cle, libelle, prix,
        dansUneZone: Boolean(dedans),
        index: dedans ? dedans.index : plusProche?.ob.index ?? null,
        sens: (dedans ?? plusProche?.ob)?.sens ?? null,
        distance: dedans ? 0 : plusProche?.distance ?? null,
      };
    });
}

/** Seuil au-delà duquel un décalage d'axe fausse plus que le stop ne protège. */
export const ECART_PREOCCUPANT = 0.01;

/** La confrontation complète, prête à afficher. */
export function confronter(analyse, lecture, hauteurImage) {
  if (!analyse || !lecture?.ok) return null;
  const axes = ecartDesAxes(analyse.scale, lecture.echelle, lecture.zone, hauteurImage);
  const obs = lecture.analyses?.orderBlocks ?? [];
  const etendue = axes?.etendue
    ?? Math.abs(lecture.echelle.prixDeY(lecture.zone.y0) - lecture.echelle.prixDeY(lecture.zone.y1));
  const niveaux = niveauxDansLesZones(analyse, obs, etendue);
  return {
    axes,
    niveaux,
    appuyes: niveaux.filter((n) => n.dansUneZone).length,
    total: niveaux.length,
    axeDouteux: Boolean(axes && axes.pire > ECART_PREOCCUPANT),
  };
}
