// Structure de marché : pivots, cassures, tendance.
//
// Logique pure sur un tableau de bougies. Aucune notion d'unité de temps :
// c'est l'appelant qui décide quelles bougies donner. Le même code sert donc
// au biais H1 et à la détection 15 minutes.

import { estHaussiere } from './bougies.js';

export const HAUSSIER = 'haussier';
export const BAISSIER = 'baissier';
export const INDETERMINE = 'indetermine';

/**
 * Pivots hauts et bas.
 *
 * Un pivot haut est une bougie dont le plus haut dépasse strictement celui
 * des `fenetre` bougies de chaque côté. La comparaison stricte écarte les
 * plateaux : trois sommets à l'identique ne produisent aucun pivot, ce qui
 * est préférable à en produire trois.
 *
 * Conséquence à connaître : un pivot n'est confirmé que `fenetre` bougies
 * après coup. C'est le retard inhérent à la méthode, pas un défaut.
 */
export function pivots(bougies, fenetre = 5) {
  if (fenetre < 1) throw new Error('La fenêtre des pivots doit valoir au moins 1.');

  const hauts = [];
  const bas = [];

  for (let i = fenetre; i < bougies.length - fenetre; i++) {
    let estHaut = true;
    let estBas = true;

    for (let j = i - fenetre; j <= i + fenetre; j++) {
      if (j === i) continue;
      if (bougies[j].plusHaut >= bougies[i].plusHaut) estHaut = false;
      if (bougies[j].plusBas <= bougies[i].plusBas) estBas = false;
      if (!estHaut && !estBas) break;
    }

    if (estHaut) hauts.push({ index: i, ms: bougies[i].ouvertureMs, prix: bougies[i].plusHaut, sens: 'haut' });
    if (estBas) bas.push({ index: i, ms: bougies[i].ouvertureMs, prix: bougies[i].plusBas, sens: 'bas' });
  }

  return { hauts, bas, tous: [...hauts, ...bas].sort((a, b) => a.index - b.index) };
}

/**
 * Cassures de structure.
 *
 * Chaque évènement est daté de l'instant où il devient CONNU, c'est-à-dire de
 * la fermeture de la bougie qui le produit. Tout le reste de la chaîne en
 * dépend : c'est ce qui interdit d'agir sur une information pas encore
 * disponible.
 *
 * Une cassure est retenue sur **clôture** au-delà du dernier pivot opposé,
 * jamais sur simple mèche : une mèche qui dépasse puis revient est un
 * balayage de liquidité, pas une cassure. C'est le choix le plus strict, donc
 * celui qui produit le moins de faux signaux.
 *
 * `BOS` prolonge la tendance en cours, `CHoCH` la retourne.
 *
 * Un pivot n'est utilisable qu'une fois confirmé, soit `fenetre` bougies
 * après son sommet. Ne pas en tenir compte reviendrait à lire le futur.
 */
export function cassures(bougies, fenetre = 5) {
  return parcourir(bougies, fenetre).evenements;
}

/**
 * L'état de la structure APRÈS la dernière bougie fournie : tendance, dernier
 * évènement, et niveau d'invalidation.
 *
 * L'invalidation est le dernier pivot opposé encore intact : en tendance
 * haussière, le dernier creux confirmé, dont la cassure en clôture serait un
 * CHoCH baissier ; en tendance baissière, le dernier sommet. Il vaut null tant
 * qu'aucun pivot opposé n'est confirmé depuis la dernière cassure.
 *
 * Même parcours que `cassures`, donc mêmes garanties : seuls les pivots déjà
 * confirmés comptent, rien n'est lu au-delà de la dernière bougie.
 */
export function etatStructure(bougies, fenetre = 5) {
  const { evenements, tendance, dernierHaut, dernierBas } = parcourir(bougies, fenetre);
  const invalidation = tendance === HAUSSIER ? dernierBas : tendance === BAISSIER ? dernierHaut : null;
  return {
    tendance,
    dernierEvenement: evenements.at(-1) ?? null,
    invalidation: invalidation ? { prix: invalidation.prix, index: invalidation.index, ms: invalidation.ms } : null,
    dernierHaut: dernierHaut ? { prix: dernierHaut.prix, index: dernierHaut.index } : null,
    dernierBas: dernierBas ? { prix: dernierBas.prix, index: dernierBas.index } : null,
    evenements,
  };
}

function parcourir(bougies, fenetre) {
  const { tous } = pivots(bougies, fenetre);
  const evenements = [];

  let tendance = INDETERMINE;
  let dernierHaut = null;
  let dernierBas = null;
  let prochainPivot = 0;

  for (let i = 0; i < bougies.length; i++) {
    // Intégrer les pivots devenus confirmés à cette bougie, et pas avant.
    while (prochainPivot < tous.length && tous[prochainPivot].index + fenetre <= i) {
      const p = tous[prochainPivot];
      if (p.sens === 'haut') dernierHaut = p;
      else dernierBas = p;
      prochainPivot++;
    }

    const c = bougies[i].cloture;

    if (dernierHaut && c > dernierHaut.prix) {
      evenements.push(creerCassure(bougies, i, HAUSSIER, tendance, dernierHaut, dernierBas));
      tendance = HAUSSIER;
      dernierHaut = null; // le niveau est consommé
    } else if (dernierBas && c < dernierBas.prix) {
      evenements.push(creerCassure(bougies, i, BAISSIER, tendance, dernierBas, dernierHaut));
      tendance = BAISSIER;
      dernierBas = null;
    }
  }

  return { evenements, tendance, dernierHaut, dernierBas };
}

function creerCassure(bougies, index, sens, tendanceAvant, niveauCasse, origine) {
  const b = bougies[index];
  if (b.fermetureMs === undefined) {
    throw new Error('Bougie sans fermetureMs : impossible de dater une cassure sans lire le futur.');
  }

  return {
    index,
    // La cassure est constatée SUR LA CLÔTURE : elle n'est connue qu'à la
    // fermeture de la bougie, jamais à son ouverture. Dater à l'ouverture
    // ferait remonter l'information de toute la durée de la bougie — une
    // heure entière en H1.
    ms: b.fermetureMs,
    msOuverture: b.ouvertureMs,
    sens,
    type: tendanceAvant !== INDETERMINE && tendanceAvant !== sens ? 'CHoCH' : 'BOS',
    tendanceAvant,
    prixCasse: niveauCasse.prix,
    // Indice du pivot opposé d'où est partie l'impulsion : c'est dans cet
    // intervalle que se trouve l'order block.
    indexOrigine: origine?.index ?? Math.max(0, index - 50),
  };
}

/**
 * Tendance à chaque instant, d'après la dernière cassure.
 * Sert de filtre de biais : on interroge la tendance H1 à l'heure d'un signal
 * 15 minutes pour savoir si le signal va dans le bon sens.
 */
export function tendanceAuFilDuTemps(evenements) {
  return evenements.map((e) => ({ ms: e.ms, tendance: e.sens }));
}

/** Tendance en vigueur à un instant donné. Recherche dichotomique. */
export function tendanceA(serie, ms) {
  let lo = 0;
  let hi = serie.length - 1;
  let trouve = null;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (serie[mid].ms <= ms) { trouve = serie[mid]; lo = mid + 1; } else hi = mid - 1;
  }

  return trouve?.tendance ?? INDETERMINE;
}

/**
 * Les points structurels nommés : chaque pivot confirmé comparé au précédent
 * du même côté.
 *
 *   HH  sommet plus haut   ·  LH  sommet plus bas
 *   HL  creux plus haut    ·  LL  creux plus bas
 *
 * Le premier sommet et le premier creux n'ont pas de précédent : ils sont
 * nommés H et L. Un pivot égal au précédent (rare, la comparaison des pivots
 * est stricte) est compté comme plus bas pour un sommet, plus haut pour un
 * creux — il n'a pas dépassé.
 *
 * Chaque point est daté de sa CONFIRMATION, `fenetre` bougies après le
 * sommet : avant, on ne pouvait pas savoir que c'en était un.
 */
export function pointsStructurels(bougies, fenetre = 5) {
  const { tous } = pivots(bougies, fenetre);
  let haut = null;
  let bas = null;
  return tous.map((p) => {
    let type;
    if (p.sens === 'haut') {
      type = haut === null ? 'H' : p.prix > haut.prix ? 'HH' : 'LH';
      haut = p;
    } else {
      type = bas === null ? 'L' : p.prix < bas.prix ? 'LL' : 'HL';
      bas = p;
    }
    const confirmation = bougies[p.index + fenetre];
    return { type, prix: p.prix, index: p.index, ms: p.ms, confirmeMs: confirmation.fermetureMs ?? confirmation.ouvertureMs };
  });
}
