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
    // Indices de l'impulsion, indispensables aux qualificatifs : tout ce qui
    // les calcule doit rester en deçà de `indexCassure`.
    indexCassure: cassure.index,
    indexOrigine: cassure.indexOrigine,
    prixCasse: cassure.prixCasse,
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

/**
 * Critère de volume : ce qui fait qu'une bougie d'origine mérite le nom
 * d'order block, plutôt que de le recevoir par sa seule position.
 *
 * Tous les seuils sont à `null` par défaut, c'est-à-dire inactifs. Un critère
 * qui s'activerait tout seul changerait en silence toutes les mesures déjà
 * prises, et on ne saurait plus lesquelles comparer.
 */
export const CRITERE_VOLUME = {
  /** Bougies de référence pour la moyenne et l'écart-type. */
  fenetre: 20,
  /** Volume exigé, en multiple de la moyenne des précédentes. `2` = le double. */
  rapportMinimum: null,
  /** Volume exigé, en écarts-types au-dessus de la moyenne. */
  ecartsTypesMinimum: null,
  /**
   * Absorption : déséquilibre acheteur/vendeur exigé DANS LE SENS de l'order
   * block, alors que la bougie est de couleur opposée.
   *
   * C'est la seule mesure qui distingue vraiment un order block d'une grosse
   * bougie : une bougie baissière sur laquelle les acheteurs dominent, c'est
   * de l'accumulation masquée. `0` exige le bon signe, `0.5` exige en plus que
   * le déséquilibre atteigne la moitié du déséquilibre moyen.
   *
   * Exige un volume ventilé acheteur/vendeur — Binance et COMEX l'ont, aucun
   * CFD ni fichier HistData ne l'aura jamais.
   */
  absorptionMinimum: null,
};

const critereActif = (c) => Boolean(c)
  && (c.rapportMinimum !== null && c.rapportMinimum !== undefined
    || c.ecartsTypesMinimum !== null && c.ecartsTypesMinimum !== undefined
    || c.absorptionMinimum !== null && c.absorptionMinimum !== undefined);

/**
 * La bougie d'indice `index` passe-t-elle le critère de volume ?
 *
 * Rend toujours la mesure à côté du verdict : un rejet sans le chiffre qui l'a
 * causé n'apprend rien et ne permet pas de régler le seuil.
 */
export function valideParLeVolume(bougies, index, critere = CRITERE_VOLUME, sens = null) {
  const c = { ...CRITERE_VOLUME, ...critere };
  const mesure = anomalieVolume(bougies, index, c.fenetre);

  if (!mesure) {
    return { valide: false, raison: 'volume non mesurable', mesure: null, mesurable: false };
  }

  if (c.rapportMinimum !== null && c.rapportMinimum !== undefined
    && mesure.volumeRapporteALaMoyenne < c.rapportMinimum) {
    return {
      valide: false, mesurable: true, mesure,
      raison: `volume ${mesure.volumeRapporteALaMoyenne}× la moyenne, seuil ${c.rapportMinimum}×`,
    };
  }

  if (c.ecartsTypesMinimum !== null && c.ecartsTypesMinimum !== undefined) {
    if (mesure.ecartsTypes === null) {
      return { valide: false, mesurable: true, mesure, raison: 'volume constant avant : écarts-types sans objet' };
    }
    if (mesure.ecartsTypes < c.ecartsTypesMinimum) {
      return {
        valide: false, mesurable: true, mesure,
        raison: `volume à ${mesure.ecartsTypes} écarts-types, seuil ${c.ecartsTypesMinimum}`,
      };
    }
  }

  if (c.absorptionMinimum !== null && c.absorptionMinimum !== undefined) {
    if (mesure.deltaRapporteAuMoyen === null) {
      return { valide: false, mesurable: true, mesure, raison: 'déséquilibre acheteur/vendeur indisponible' };
    }
    // Un order block haussier est posé sur une bougie BAISSIÈRE. L'absorption,
    // c'est un delta positif malgré cette bougie rouge — des acheteurs qui
    // prennent le papier pendant que le prix descend.
    const signe = sens === HAUSSIER ? 1 : -1;
    const absorption = arrondir(mesure.deltaRapporteAuMoyen * signe, 2);
    if (absorption < c.absorptionMinimum) {
      return {
        valide: false, mesurable: true, mesure: { ...mesure, absorption },
        raison: `absorption ${absorption}, seuil ${c.absorptionMinimum}`,
      };
    }
    return { valide: true, mesurable: true, mesure: { ...mesure, absorption } };
  }

  return { valide: true, mesurable: true, mesure };
}

/**
 * Tous les order blocks d'une série, un par cassure exploitable.
 *
 * Sans critère de volume, le comportement est celui d'avant : une cassure, un
 * order block. Avec critère, la bougie doit en plus porter l'empreinte de
 * volume qu'on lui demande.
 */
export function detecter(bougies, evenements, options = {}) {
  return detecterEnDetail(bougies, evenements, options).retenus;
}

/**
 * Comme `detecter`, mais rend aussi les candidats écartés et la raison.
 *
 * Un filtre dont on ne voit que ce qui passe n'est pas réglable : on ne sait
 * ni ce qu'on perd, ni de combien on a manqué le seuil.
 */
export function detecterEnDetail(bougies, evenements, { volume = null } = {}) {
  const retenus = [];
  const rejetes = [];
  const actif = critereActif(volume);
  let mesurables = 0;
  let candidats = 0;

  for (const cassure of evenements) {
    const ob = orderBlockDe(bougies, cassure);
    if (!ob) continue;

    // La mesure est faite même sans critère : c'est elle qui permet de choisir
    // un seuil. Un réglage posé sans voir la distribution est un réglage
    // deviné — et l'agrégation déplace cette distribution beaucoup plus que
    // l'intuition ne le suggère.
    if (!actif) {
      retenus.push({ ...ob, volumeMesure: anomalieVolume(bougies, ob.index, volume?.fenetre ?? CRITERE_VOLUME.fenetre) });
      continue;
    }

    candidats++;
    const verdict = valideParLeVolume(bougies, ob.index, volume, ob.sens);
    if (verdict.mesurable) mesurables++;

    if (verdict.valide) retenus.push({ ...ob, volumeMesure: verdict.mesure });
    else rejetes.push({ ms: ob.ms, index: ob.index, sens: ob.sens, raison: verdict.raison, mesure: verdict.mesure });
  }

  // Un critère de volume sur une série sans volume rejetterait tout en
  // silence, et la sortie ressemblerait à « aucun order block ne qualifie »
  // alors que la vraie phrase est « le fichier ne porte pas de volume ».
  if (actif && candidats > 0 && mesurables === 0) {
    throw new Error(
      "Critère de volume actif, mais aucun volume mesurable dans la série. "
      + "Les fichiers HistData donnent volume = 0 sur l'or et le forex ; "
      + 'il faut une source qui porte un volume réel, ou retirer le critère.',
    );
  }

  return { retenus, rejetes };
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
