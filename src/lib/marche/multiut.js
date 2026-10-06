// La brique Multi-UT : l'état de la structure sur plusieurs unités de temps,
// en un tableau — la forme de l'indicateur « KTA MTF » de la référence.
//
// CONTRAT (FEUILLE-DE-ROUTE.md § 4) :
//   tableauMultiUT(bougies1m, { aMs, unites, fenetre, seance })
//     → { lignes: [{ unite, tendance, evenement, ageBougies, ageMs,
//                    invalidation, distance, cloture, nombre, points }],
//         biais: { score, sur, poids }, lecture }
//
// Les bougies d'entrée sont des bougies d'UNE minute, d'un seul instrument et
// d'un seul contrat. Toutes les unités en sont déduites, ce qui garantit
// qu'elles décrivent exactement le même marché.
//
// AUCUNE LECTURE DU FUTUR. À l'instant `aMs`, seules comptent les bougies de
// chaque unité déjà FERMÉES : la bougie de 4 h en cours n'est pas encore une
// bougie, elle ne fait ni pivot ni cassure.
//
// LE BIAIS PONDÉRÉ EST UN RÉSUMÉ, PAS UN SIGNAL. Il additionne le sens de
// chaque unité, pondéré par des poids déclarés ici et affichés. Aucune mesure
// ne dit encore qu'il prédit quoi que ce soit : c'est l'objet du Labo (E8).

import { etatStructure, pointsStructurels, HAUSSIER, BAISSIER, INDETERMINE } from './structure.js';
import { agregerSeance, SEANCE } from './seance.js';

export const UNITES_MTF = Object.freeze(['5m', '15m', '30m', '1h', '4h', '1d']);

/**
 * Poids de chaque unité dans le biais, total 10. Plus l'unité est longue, plus
 * elle pèse : c'est la convention de la lecture « de haut en bas ». Ces poids
 * reproduisent le « +2 / 10 » de la capture de référence ; ils ne sont pas
 * optimisés, et ne doivent pas l'être sur les données qu'on mesure.
 */
export const POIDS = Object.freeze({ '5m': 1, '15m': 1, '30m': 1, '1h': 2, '4h': 2, '1d': 3 });

const COURTES = ['5m', '15m', '30m', '1h'];
const LONGUES = ['4h', '1d'];

const signe = (t) => (t === HAUSSIER ? 1 : t === BAISSIER ? -1 : 0);

/** Une ligne du tableau : l'état de la structure d'une unité à l'instant. */
export function ligneUnite(bougies, unite, fenetre) {
  if (!bougies.length) {
    return { unite, tendance: INDETERMINE, evenement: null, ageBougies: null, ageMs: null, invalidation: null, distance: null, cloture: null, nombre: 0, points: [] };
  }
  const etat = etatStructure(bougies, fenetre);
  const derniere = bougies.at(-1);
  const e = etat.dernierEvenement;
  const invalidation = etat.invalidation?.prix ?? null;
  return {
    unite,
    tendance: etat.tendance,
    evenement: e ? { type: e.type, sens: e.sens, ms: e.ms } : null,
    // L'âge en bougies de l'unité, et en temps : la plateforme de référence
    // l'affiche en bougies.
    ageBougies: e ? bougies.length - 1 - e.index : null,
    ageMs: e ? derniere.fermetureMs - e.ms : null,
    invalidation,
    // Distance relative de la dernière clôture au niveau d'invalidation.
    distance: invalidation !== null ? Math.abs(derniere.cloture - invalidation) / derniere.cloture : null,
    cloture: derniere.cloture,
    nombre: bougies.length,
    // Les quatre derniers points structurels confirmés (HH, HL, LH, LL).
    points: pointsStructurels(bougies, fenetre).slice(-4).map(({ type, prix, ms }) => ({ type, prix, ms })),
  };
}

/** Le biais pondéré, de −10 à +10 quand toutes les unités sont présentes. */
export function biaisPondere(lignes, poids = POIDS) {
  let score = 0;
  let sur = 0;
  for (const l of lignes) {
    const p = poids[l.unite] ?? 0;
    sur += p;
    score += p * signe(l.tendance);
  }
  return { score, sur, poids };
}

/**
 * La lecture du tableau, en une phrase.
 *
 *   - toutes les unités dans le même sens        → alignement
 *   - longues d'accord, courtes majoritairement contre → repli dans la tendance
 *     de fond : attendre un CHoCH dans le sens de fond en petite unité
 *   - longues en désaccord                       → structure confuse, range probable
 *   - sinon                                      → tendances mêlées
 *
 * Descriptive : elle dit ce que montre le tableau, pas ce qu'il faut faire.
 */
export function lecture(lignes) {
  const sens = Object.fromEntries(lignes.map((l) => [l.unite, signe(l.tendance)]));
  const presentes = lignes.filter((l) => l.tendance !== INDETERMINE);
  if (!presentes.length) return { code: 'indetermine', texte: 'Structure indéterminée : pas assez de bougies.' };

  const tous = presentes.map((l) => signe(l.tendance));
  if (presentes.length === lignes.length && tous.every((x) => x === tous[0])) {
    return { code: 'alignement', texte: `Alignement ${tous[0] > 0 ? 'haussier' : 'baissier'} sur toutes les unités.` };
  }

  const longues = LONGUES.map((u) => sens[u]).filter((x) => x !== undefined && x !== 0);
  if (longues.length === LONGUES.length && longues[0] !== longues[1]) {
    return { code: 'conflit', texte: '4 h et Daily en conflit : structure confuse, range probable.' };
  }
  if (longues.length === LONGUES.length) {
    const fond = longues[0];
    const contre = COURTES.filter((u) => sens[u] === -fond).length;
    if (contre > COURTES.length / 2) {
      const fleche = fond > 0 ? '▲' : '▼';
      return { code: 'repli', texte: `Repli dans la tendance de fond ${fond > 0 ? 'haussière' : 'baissière'} : attendre un CHoCH ${fleche} en petite unité.` };
    }
  }
  return { code: 'mele', texte: 'Tendances mêlées entre les unités.' };
}

/**
 * Le tableau complet, à l'instant `aMs`.
 *
 * @param bougies1m bougies d'une minute, triées, d'un seul contrat
 * @param aMs       l'instant de la lecture ; défaut : après la dernière bougie
 */
export function tableauMultiUT(bougies1m, { aMs, unites = UNITES_MTF, fenetre = 5, seance = SEANCE, poids = POIDS } = {}) {
  const instant = aMs ?? (bougies1m.length ? bougies1m.at(-1).fermetureMs + 1 : 0);
  const passees = bougies1m.filter((b) => b.fermetureMs < instant);

  const lignes = unites.map((unite) => {
    // Seules les bougies de l'unité entièrement fermées avant l'instant.
    const serie = agregerSeance(passees, unite, seance).filter((b) => b.fermetureMs < instant);
    return ligneUnite(serie, unite, fenetre);
  });

  return { aMs: instant, lignes, biais: biaisPondere(lignes, poids), lecture: lecture(lignes) };
}
