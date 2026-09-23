// Order blocks, et le plan de trade hypothétique qu'ils impliquent.
//
// Définition retenue, la plus répandue et la seule non ambiguë une fois la
// cassure définie : l'order block est la DERNIÈRE bougie de couleur opposée
// avant l'impulsion qui casse la structure.
//
// Tout le reste — zone, entrée, stop, objectifs — en découle par des règles
// fixes, écrites ici et nulle part ailleurs.

import { estHaussiere, estBaissiere } from './bougies.js';
import { HAUSSIER } from './structure.js';

/** Marge du stop au-delà de la zone, en fraction de sa hauteur. */
export const MARGE_STOP = 0.1;

/**
 * Order block associé à une cassure, ou null si aucune bougie opposée n'existe
 * dans l'impulsion — cas rare mais réel, qu'on ne comble pas par défaut.
 */
export function orderBlockDe(bougies, cassure) {
  const cherche = cassure.sens === HAUSSIER ? estBaissiere : estHaussiere;

  // Remonter depuis la bougie de cassure vers l'origine de l'impulsion.
  for (let i = cassure.index - 1; i >= cassure.indexOrigine; i--) {
    if (cherche(bougies[i])) {
      return construire(bougies, i, cassure);
    }
  }
  return null;
}

function construire(bougies, index, cassure) {
  const b = bougies[index];
  const haut = b.plusHaut;
  const bas = b.plusBas;
  const hauteur = haut - bas;
  if (hauteur <= 0) return null; // bougie plate : pas de zone exploitable

  const haussier = cassure.sens === HAUSSIER;

  // Entrée au bord proximal : celui que le prix touche en revenant.
  const prixEntree = haussier ? haut : bas;
  const prixStopLoss = haussier
    ? bas - hauteur * MARGE_STOP
    : haut + hauteur * MARGE_STOP;

  const risque = Math.abs(prixEntree - prixStopLoss);

  return {
    index,
    ms: b.ouvertureMs,
    sens: cassure.sens,
    typeCassure: cassure.type,
    zone: { bas, haut, hauteur },
    volume: b.volume,
    delta: b.delta,
    // L'order block n'est exploitable qu'une fois la cassure CONNUE, donc à
    // la fermeture de la bougie qui casse — pas à son ouverture. Sans quoi on
    // compterait comme déclenché un retour sur l'entrée survenu avant que le
    // signal existe.
    valideAPartirDeMs: cassure.ms,
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

/** Tous les order blocks d'une série, un par cassure exploitable. */
export function detecter(bougies, evenements) {
  const trouves = [];
  for (const cassure of evenements) {
    const ob = orderBlockDe(bougies, cassure);
    if (ob) trouves.push(ob);
  }
  return trouves;
}

/**
 * Anomalie de volume d'un order block, mesurée en écarts-types par rapport
 * aux `fenetre` bougies qui le précèdent.
 *
 * Un order block posé sur une bougie à +3 écarts-types et à delta fortement
 * opposé n'a pas la même valeur qu'un order block sur une bougie molle.
 * On mesure, on ne juge pas encore : c'est au backtest de dire si ce chiffre
 * sépare les gagnants des perdants.
 */
export function anomalieVolume(bougies, index, fenetre = 20) {
  const debut = Math.max(0, index - fenetre);
  const precedentes = bougies.slice(debut, index);
  if (precedentes.length < 5) return null;

  const volumes = precedentes.map((b) => b.volume);
  const moyenne = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  if (!moyenne) return null;

  const variance = volumes.reduce((a, v) => a + (v - moyenne) ** 2, 0) / volumes.length;
  const ecartType = Math.sqrt(variance);

  const b = bougies[index];

  // Un CSV de CFD ne porte pas le détail acheteur/vendeur : le déséquilibre
  // est absent, et doit le rester. Le déduire du sens de la bougie
  // fabriquerait un indicateur qui ne mesure que ce qu'on sait déjà.
  const deltaDisponible = typeof b.delta === 'number'
    && precedentes.every((p) => typeof p.delta === 'number');
  const deltaMoyen = deltaDisponible
    ? precedentes.reduce((a, p) => a + Math.abs(p.delta), 0) / precedentes.length
    : 0;

  return {
    // Un écart-type nul signifie un volume parfaitement constant avant : la
    // mesure en écarts-types perd son sens, mais le rapport à la moyenne
    // reste lisible. On rend ce qu'on sait, pas rien.
    ecartsTypes: ecartType ? arrondir((b.volume - moyenne) / ecartType, 2) : null,
    volumeRapporteALaMoyenne: arrondir(b.volume / moyenne, 2),
    // Négatif = vendeurs dominants sur cette bougie, positif = acheteurs.
    deltaRapporteAuMoyen: deltaDisponible && deltaMoyen ? arrondir(b.delta / deltaMoyen, 2) : null,
  };
}

function arrondir(n, decimales = 8) {
  return Number(n.toFixed(decimales));
}
