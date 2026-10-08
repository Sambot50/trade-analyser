// L'order block tel que l'enseigne le bootcamp (vidéo de Casper, diapos du
// 2026-10-07) : « la dernière bougie inverse d'un fort mouvement ».
//
// Ce n'est PAS l'order block de `orderblocks.js`. Celui-là naît d'une
// cassure de structure (BOS ou CHoCH) et remonte à la dernière bougie opposée
// avant elle, quelle que soit la longueur de l'impulsion. Celui-ci n'exige
// aucune cassure : il exige un mouvement fort IMMÉDIAT après la bougie.
// DEC-041 et HYP-004 ont mesuré le premier ; ils ne disent rien du second.
//
// Définition, haussière (la baissière en est le miroir) :
//
//   - l'OB se termine sur une bougie baissière, la dernière avant le
//     mouvement ;
//   - il englobe l'ACCUMULATION : les bougies baissières consécutives qui la
//     précèdent (au plus `accumulationMax`), précision de l'opérateur au
//     bootcamp, le 2026-10-07 ;
//   - la zone va du plus bas au plus haut de ces bougies, mèches comprises ;
//   - les bougies qui suivent IMMÉDIATEMENT sont haussières, sans
//     interruption : c'est le mouvement ;
//   - il est « fort » dès que la clôture d'une de ces bougies dépasse le haut
//     de la zone d'au moins `seuilAtr` ATR (ATR des 14 bougies finissant sur
//     la dernière bougie de l'OB).
//
// AUCUNE LECTURE DU FUTUR. L'OB n'existe qu'à la fermeture de la bougie qui
// rend le mouvement fort, et jamais avant la 3e bougie (celle qui dit s'il y a
// une imbalance) : `indexCassure` désigne cette bougie de validation, pour
// que les qualificatifs et les étoiles, qui s'arrêtent à `indexCassure`, ne
// lisent rien d'inconnu.
//
// Pour les étoiles :
//   - la tendance est celle de la structure de la même unité au moment de la
//     validation ; un OB contre elle est ÉCARTÉ (« toujours en tendance »),
//     l'étoile 2 est donc toujours remplie ;
//   - le Fibonacci de l'étoile 3 se lit à l'entrée, du bas de la structure au
//     plus haut depuis : `discountALEntree` (etoiles.js), appelée par le
//     backtest une fois l'entrée connue.

import { pivots, cassures, tendanceAuFilDuTemps, tendanceA, HAUSSIER, BAISSIER } from './structure.js';
import { atrJusqua } from './etoiles.js';
import { MARGE_STOP } from './orderblocks.js';

// Une bougie « inverse » a un CORPS. `estHaussiere` de bougies.js compte la
// bougie sans corps (clôture = ouverture) comme haussière : une bougie plate
// d'heure creuse devenait à elle seule un OB baissier de hauteur nulle, au
// risque nul et aux frais incalculables (DEC-043). Ici, les deux sens sont
// stricts, et une bougie sans corps n'appartient ni à l'OB ni au mouvement.
const corpsHaussier = (b) => b.cloture > b.ouverture;
const corpsBaissier = (b) => b.cloture < b.ouverture;

export const PARAMETRES_OB_BOOTCAMP = Object.freeze({ periodeAtr: 14, fenetrePivots: 5, accumulationMax: 10 });

const arrondir = (n) => Number(n.toFixed(6));

function construire(bougies, debut, i, validation, sens, origine, dansLaTendance) {
  const b = bougies[i];
  const accumulation = bougies.slice(debut, i + 1);
  const haut = Math.max(...accumulation.map((x) => x.plusHaut));
  const bas = Math.min(...accumulation.map((x) => x.plusBas));
  const hauteur = haut - bas;
  const haussier = sens === HAUSSIER;
  const prixEntree = haussier ? haut : bas;
  const prixStopLoss = haussier ? bas - hauteur * MARGE_STOP : haut + hauteur * MARGE_STOP;
  const risque = Math.abs(prixEntree - prixStopLoss);
  return {
    index: i,
    indexDebut: debut,
    bougiesAccumulation: i - debut + 1,
    ms: bougies[debut].ouvertureMs,
    sens,
    definition: 'bootcamp',
    typeCassure: null,
    dansLaTendance,
    indexCassure: validation,
    indexOrigine: origine,
    zone: { bas, haut, hauteur },
    volume: b.volume,
    delta: b.delta,
    valideAPartirDeMs: bougies[validation].fermetureMs,
    plan: {
      direction: haussier ? 'BUY' : 'SELL',
      prixEntree: arrondir(prixEntree),
      prixStopLoss: arrondir(prixStopLoss),
      prixTp1: arrondir(haussier ? prixEntree + risque : prixEntree - risque),
      prixTp2: arrondir(haussier ? prixEntree + 2 * risque : prixEntree - 2 * risque),
      risque: arrondir(risque),
    },
  };
}

/**
 * Tous les OB « bootcamp » d'une série, dans l'ordre de leur validation.
 *
 * @param seuilAtr  force minimale du mouvement, en ATR — à régler par la
 *                  mesure, puis à figer (feuille de route, E4)
 * @param seulementEnTendance  vrai par défaut : la méthode ne prend jamais
 *                  un OB contre la tendance de son unité
 */
export function detecterBootcamp(bougies, { seuilAtr, seulementEnTendance = true, p = PARAMETRES_OB_BOOTCAMP } = {}) {
  if (!(seuilAtr > 0)) throw new Error('seuilAtr doit être un nombre positif.');
  const serieTendance = tendanceAuFilDuTemps(cassures(bougies, p.fenetrePivots));
  const { hauts, bas } = pivots(bougies, p.fenetrePivots);
  const resultats = [];

  for (let i = 1; i < bougies.length - 1; i++) {
    const b = bougies[i];
    const haussier = corpsBaissier(b);
    if (!haussier && !corpsHaussier(b)) continue;
    const sens = haussier ? HAUSSIER : BAISSIER;
    const dansLeSens = haussier ? corpsHaussier : corpsBaissier;
    if (!dansLeSens(bougies[i + 1])) continue;

    const atr = atrJusqua(bougies, i, p.periodeAtr);
    if (atr === null) continue;
    const memeCouleur = haussier ? corpsBaissier : corpsHaussier;
    let debut = i;
    while (debut - 1 >= 1 && i - debut + 1 < p.accumulationMax && memeCouleur(bougies[debut - 1])) debut--;
    const accumulation = bougies.slice(debut, i + 1);
    const bord = haussier ? Math.max(...accumulation.map((x) => x.plusHaut)) : Math.min(...accumulation.map((x) => x.plusBas));

    let fort = null;
    for (let j = i + 1; j < bougies.length && dansLeSens(bougies[j]); j++) {
      const avance = haussier ? bougies[j].cloture - bord : bord - bougies[j].cloture;
      if (avance >= seuilAtr * atr) { fort = j; break; }
    }
    if (fort === null) continue;
    const validation = Math.max(fort, i + 2);
    if (validation >= bougies.length) continue;

    // Dernier pivot opposé CONFIRMÉ avant l'accumulation : un pivot n'est connu que
    // `fenetrePivots` bougies après lui.
    const opposes = haussier ? hauts : bas;
    let origine = Math.max(0, i - 50);
    for (let k = opposes.length - 1; k >= 0; k--) {
      if (opposes[k].index + p.fenetrePivots <= debut) { origine = opposes[k].index; break; }
    }

    const tendance = tendanceA(serieTendance, bougies[validation].fermetureMs);
    // « L'order block doit TOUJOURS être en tendance » (opérateur, bootcamp,
    // 2026-10-07) : un OB contre la tendance n'est pas un OB de la méthode.
    if (seulementEnTendance && tendance !== sens) continue;
    resultats.push(construire(bougies, debut, i, validation, sens, origine, tendance === sens));
  }

  return resultats.sort((a, b) => a.valideAPartirDeMs - b.valideAPartirDeMs);
}
