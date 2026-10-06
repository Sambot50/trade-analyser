// Les performances d'un compte, calculées sur ses positions fermées.
//
// Les métriques d'un journal de trading classique — taux de réussite, gain
// moyen, profit factor, P&L, Sharpe, meilleure heure, meilleur jour, meilleur
// setup — avec deux différences, et ce sont elles qui comptent.
//
// 1. CHAQUE CHIFFRE PORTE SON EFFECTIF. 3 trades gagnants sur 4 font 75 %, et
//    l'intervalle va de 30 à 95 %. Un taux sans effectif est une illusion de
//    précision.
//
// 2. AUCUN GROUPE N'EST DÉSIGNÉ « MEILLEUR ». Comparer 24 heures entre elles,
//    c'est garantir qu'une sortira gagnante par pur hasard (garde-fou 7). Les
//    tableaux sont rendus dans l'ordre naturel — heures, jours de la semaine —
//    jamais triés par résultat, et marquent les groupes trop petits pour dire
//    quoi que ce soit.

import { intervalleWilson } from '../marche/statistiques.js';

/** En dessous, un groupe ne dit rien : même seuil que le carnet. */
export const MINIMUM = 30;

/** Fuseau d'affichage des heures et des jours : celui de l'opérateur. */
export const FUSEAU = 'Europe/Paris';

// Rangés du lundi (0) au dimanche (6) : la semaine de l'opérateur, pas celle de JavaScript.
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const somme = (xs) => xs.reduce((a, x) => a + x, 0);
const moyenne = (xs) => (xs.length ? somme(xs) / xs.length : null);

function mediane(xs) {
  if (!xs.length) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

function ecartType(xs) {
  if (xs.length < 2) return null;
  const m = moyenne(xs);
  return Math.sqrt(somme(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Heure (0-23) et jour de la semaine d'un instant UTC, dans le fuseau de l'opérateur. */
export function heureEtJour(iso, fuseau = FUSEAU) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau, hourCycle: 'h23', hour: '2-digit', weekday: 'short',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const jours = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { heure: Number(parts.hour), jour: jours[parts.weekday] };
}

/** Les chiffres d'un ensemble de positions fermées. */
export function statistiques(positions, { minimum = MINIMUM } = {}) {
  const nets = positions.map((p) => p.net);
  const gains = nets.filter((x) => x > 0);
  const pertes = nets.filter((x) => x < 0);
  const n = positions.length;

  const sommeGains = somme(gains);
  const sommePertes = -somme(pertes);

  // Le creux le plus profond de la courbe des gains cumulés.
  let cumul = 0;
  let sommet = 0;
  let creux = 0;
  for (const x of nets) {
    cumul += x;
    sommet = Math.max(sommet, cumul);
    creux = Math.max(creux, sommet - cumul);
  }

  const rs = positions.map((p) => p.rNet).filter((x) => typeof x === 'number' && Number.isFinite(x));
  const sd = ecartType(nets);

  return {
    n,
    suffisant: n >= minimum,
    gagnants: gains.length,
    perdants: pertes.length,
    nuls: n - gains.length - pertes.length,
    taux: intervalleWilson(gains.length, n),
    gainMoyen: moyenne(gains),
    perteMoyenne: pertes.length ? -moyenne(pertes) : null,
    // Sans aucune perte, le profit factor est infini : on rend null et on le dit.
    profitFactor: sommePertes > 0 ? sommeGains / sommePertes : null,
    esperance: moyenne(nets),
    pnl: somme(nets),
    frais: somme(positions.map((p) => p.commission + p.swap + p.frais)),
    dureeMoyenneMin: moyenne(positions.map((p) => p.dureeMin).filter((x) => x !== null)),
    dureeMedianeMin: mediane(positions.map((p) => p.dureeMin).filter((x) => x !== null)),
    drawdownMax: creux,
    r: { n: rs.length, moyen: moyenne(rs), sansStop: n - rs.length },
    // Sharpe par trade : espérance sur écart type. Sous l'effectif minimal, il
    // ne mesure que le bruit — on ne le calcule pas.
    sharpeParTrade: n >= minimum && sd > 0 ? moyenne(nets) / sd : null,
  };
}

/**
 * Les mêmes chiffres, par groupe. Ordre naturel des clés, jamais trié par
 * résultat : voir l'en-tête.
 */
export function ventiler(positions, cle, options) {
  const groupes = new Map();
  for (const p of positions) {
    const k = cle(p);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(p);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map(([k, ps]) => ({ groupe: k, ...statistiques(ps, options) }));
}

/** Le rapport complet d'un compte. */
export function performances(positions, { fuseau = FUSEAU, minimum = MINIMUM } = {}) {
  const fermees = positions.filter((p) => p.statut === 'fermee');
  const options = { minimum };
  return {
    global: statistiques(fermees, options),
    ouvertes: positions.length - fermees.length,
    parHeure: ventiler(fermees, (p) => heureEtJour(p.ouverture, fuseau).heure, options),
    parJour: ventiler(fermees, (p) => (heureEtJour(p.ouverture, fuseau).jour + 6) % 7, options)
      .map((g) => ({ ...g, libelle: JOURS[g.groupe] })),
    parSymbole: ventiler(fermees, (p) => p.symbole, options),
    parSetup: ventiler(fermees, (p) => p.setup, options),
    parSens: ventiler(fermees, (p) => p.sens, options),
    fuseau,
    minimum,
  };
}
