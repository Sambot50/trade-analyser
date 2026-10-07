// Les « cinq étoiles » d'un order block, rendues calculables.
//
// Méthode enseignée par le bootcamp (vidéo de Casper, transcrite le
// 2026-10-07). Chaque étoile est un critère ; la note n'est qu'un COMPTE de
// critères remplis. Ce qu'elle vaut ne se suppose pas : HYP-004 la mesurera,
// face au témoin, sur des données jamais utilisées pour les OB. Le « 70 à
// 80 % de réussite » annoncé n'est mesuré nulle part.
//
//   1. Imbalance   — un FVG part de la bougie de l'OB : pour un OB haussier,
//                    le plus haut de l'OB reste sous le plus bas de la 3e bougie.
//   2. Tendance    — l'OB naît d'une cassure DANS la tendance (BOS), pas d'un
//                    retournement (CHoCH).
//   3. Discount    — OB haussier sous le 0,5 de la jambe, baissier au-dessus.
//   4. Liquidité   — pas de plus bas égaux (OB haussier) ou de plus hauts égaux
//                    (OB baissier) non pris, juste devant l'OB : un piège.
//   5. Mitigation  — l'OB n'a pas été retouché entre sa création et la cassure.
//
// PARAMÈTRES FIGÉS LE 2026-10-07, AVANT TOUTE MESURE. Les changer après avoir
// vu un résultat fabriquerait le résultat (garde-fou 7). Ils ne s'ouvrent à
// aucune option.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ INVARIANT : rien n'est lu après `ob.indexCassure`, comme pour les        │
// │ qualificatifs. Seule exception, nommée : `mitigeDepuisLaCassure`, qui    │
// │ sert à l'AFFICHAGE en direct et lit jusqu'à l'instant de lecture `aMs`.  │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Remarque sur l'étoile 5. Dans le backtest, chaque trade est le PREMIER
// retour du prix dans l'OB après la cassure : il est donc non mitigé par
// construction. L'étoile 5 ne peut y discriminer que les retours AVANT la
// cassure. En direct, en revanche, un OB déjà retouché depuis la cassure doit
// être écarté : c'est `mitigeDepuisLaCassure`.

import { pivots, HAUSSIER } from './structure.js';
import { premiumDiscount, fraicheur } from './qualificatifs.js';

export const PARAMETRES_ETOILES = Object.freeze({
  periodeAtr: 14,
  // Pivots : même fenêtre que la structure.
  fenetrePivots: 5,
  // Deux pivots sont « égaux » à moins de 0,1 ATR l'un de l'autre.
  toleranceEgauxEnAtr: 0.1,
  // « Juste devant » : à moins de 2 ATR du bord distal de l'OB.
  porteeEnAtr: 2,
  // On cherche les pivots sur les 200 bougies qui précèdent la cassure.
  profondeur: 200,
});

/** ATR des `periode` bougies qui finissent sur `fin`, ou null. */
export function atrJusqua(bougies, fin, periode = PARAMETRES_ETOILES.periodeAtr) {
  const debut = Math.max(1, fin - periode + 1);
  let somme = 0;
  let n = 0;
  for (let i = debut; i <= fin; i++) {
    const b = bougies[i];
    const p = bougies[i - 1];
    somme += Math.max(b.plusHaut - b.plusBas, Math.abs(b.plusHaut - p.cloture), Math.abs(b.plusBas - p.cloture));
    n++;
  }
  const atr = n ? somme / n : 0;
  return atr > 0 ? atr : null;
}

/** Étoile 1 — le FVG part de la bougie de l'OB. */
export function imbalanceDepuisOB(bougies, ob) {
  const i = ob.index;
  if (i + 2 > ob.indexCassure) return false;
  const a = bougies[i];
  const c = bougies[i + 2];
  return ob.sens === HAUSSIER ? a.plusHaut < c.plusBas : a.plusBas > c.plusHaut;
}

/**
 * Étoile 4 (inversée) — la poche de liquidité devant l'OB, ou null.
 *
 * Pour un OB haussier : au moins deux pivots bas « égaux », sous la zone, à
 * moins de `porteeEnAtr` de son bas, et qu'aucune bougie n'a encore percés
 * jusqu'à la cassure. Le marché « va de poche de liquidité en poche de
 * liquidité » : il viendrait la chercher en traversant l'OB.
 */
export function liquiditeDevant(bougies, ob, p = PARAMETRES_ETOILES) {
  const visibles = bougies.slice(0, ob.indexCassure + 1);
  const atr = atrJusqua(visibles, ob.index, p.periodeAtr);
  if (atr === null) return null;

  const haussier = ob.sens === HAUSSIER;
  const debut = Math.max(0, ob.indexCassure - p.profondeur);
  const { hauts, bas } = pivots(visibles.slice(debut), p.fenetrePivots);
  const candidats = (haussier ? bas : hauts)
    .map((pv) => ({ ...pv, index: pv.index + debut }))
    .filter((pv) => (haussier
      ? pv.prix < ob.zone.bas && pv.prix >= ob.zone.bas - p.porteeEnAtr * atr
      : pv.prix > ob.zone.haut && pv.prix <= ob.zone.haut + p.porteeEnAtr * atr));

  const tolerance = p.toleranceEgauxEnAtr * atr;
  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      if (Math.abs(candidats[i].prix - candidats[j].prix) > tolerance) continue;
      // Le niveau de la poche : le plus extrême des deux, celui que les stops
      // protègent. Une poche déjà percée n'en est plus une.
      const niveau = haussier ? Math.min(candidats[i].prix, candidats[j].prix) : Math.max(candidats[i].prix, candidats[j].prix);
      const apres = Math.max(candidats[i].index, candidats[j].index) + 1;
      const prise = visibles.slice(apres).some((b) => (haussier ? b.plusBas < niveau : b.plusHaut > niveau));
      if (!prise) return { niveau, pivots: [candidats[i].index, candidats[j].index] };
    }
  }
  return null;
}

/** Les cinq étoiles d'un OB, à l'instant de sa cassure. */
export function etoiles(bougies, ob) {
  const visibles = bougies.slice(0, ob.indexCassure + 1);
  const zone = premiumDiscount(visibles, ob);
  const poche = liquiditeDevant(visibles, ob);

  const criteres = {
    imbalance: imbalanceDepuisOB(visibles, ob),
    tendance: ob.typeCassure === 'BOS',
    discount: zone?.enZoneFavorable === true,
    sansLiquiditeDevant: poche === null,
    nonMitige: fraicheur(visibles, ob).intacte,
  };
  return {
    ...criteres,
    nombre: Object.values(criteres).filter(Boolean).length,
    pocheDevant: poche,
  };
}

/**
 * Pour l'affichage en direct : l'OB a-t-il été retouché depuis la cassure,
 * jusqu'à l'instant `aMs` exclu ? Seules les bougies FERMÉES avant `aMs`
 * comptent. Ne sert jamais dans une mesure : voir la remarque en tête.
 */
export function mitigeDepuisLaCassure(bougies, ob, aMs) {
  const depuis = bougies[ob.indexCassure].fermetureMs;
  return bougies.some((b) => b.ouvertureMs > depuis && b.fermetureMs < aMs
    && b.plusBas <= ob.zone.haut && b.plusHaut >= ob.zone.bas);
}
