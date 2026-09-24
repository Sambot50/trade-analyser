import { describe, it, expect } from 'vitest';
import { HAUSSIER, BAISSIER } from './structure.js';
import {
  qualifier, fvgDeLImpulsion, priseDeLiquidite, deplacement,
  significativiteDuNiveau, premiumDiscount, fraicheur, zoneSurAtr, definitionAlternative,
} from './qualificatifs.js';

const MINUTE = 60_000;
const DEBUT = Date.UTC(2025, 0, 6, 9, 0); // un lundi, 9 h UTC

/** [ouverture, plusHaut, plusBas, cloture] → bougie canonique. */
const serie = (lignes) =>
  lignes.map(([o, h, l, c], i) => ({
    ouvertureMs: DEBUT + i * MINUTE,
    fermetureMs: DEBUT + (i + 1) * MINUTE - 1,
    ouverture: o, plusHaut: h, plusBas: l, cloture: c,
    volume: 100, volumeAcheteur: 50, volumeVendeur: 50, delta: 0, nombreTrades: 10,
  }));

/**
 * Scénario haussier complet :
 *  0-4   range autour de 100, plus bas de référence à 99,0
 *  5-9   balayage : la bougie 7 perce à 98,4 et referme au-dessus
 * 10     pivot bas — origine de l'impulsion
 * 12     order block : bougie baissière, zone 99,0 – 100,0
 * 13-16  impulsion à corps pleins, FVG entre 13 et 15, cassure de 102 en 16
 */
const BOUGIES = serie([
  [100.0, 100.4, 99.6, 100.2], [100.2, 100.5, 99.8, 100.0], [100.0, 100.3, 99.5, 99.9],
  [99.9, 100.2, 99.0, 100.1], [100.1, 100.6, 99.9, 100.4],
  [100.4, 100.7, 100.0, 100.5], [100.5, 100.6, 99.7, 100.0],
  [100.0, 100.1, 98.4, 99.8],  // 7 : balayage sous 99,0, referme au-dessus
  [99.8, 100.2, 99.6, 100.1], [100.1, 100.4, 99.9, 100.3],
  [100.3, 100.4, 99.2, 99.5],  // 10 : pivot bas, origine
  [99.5, 100.0, 99.3, 99.9],
  [99.9, 100.0, 99.0, 99.2],   // 12 : ORDER BLOCK baissier, zone 99,0 – 100,0
  [99.2, 100.8, 99.1, 100.7],  // 13 : impulsion
  [100.7, 101.6, 100.6, 101.5],
  [101.5, 102.4, 101.2, 102.3], // 15 : plusBas 101,2 > plusHaut de 13 (100,8) → FVG
  [102.3, 103.0, 102.1, 102.9], // 16 : CASSURE de 102
  [102.9, 103.4, 102.5, 103.2], [103.2, 104.0, 103.0, 103.8], // après : interdit
]);

const OB = {
  index: 12, indexCassure: 16, indexOrigine: 10,
  sens: HAUSSIER, prixCasse: 102,
  zone: { bas: 99.0, haut: 100.0, hauteur: 1.0 },
};

describe('invariant — rien après la cassure', () => {
  it('rend le même résultat sur la série tronquée à la cassure', () => {
    // Le test qui compte. Un qualificatif qui lirait une bougie postérieure
    // prédirait l'issue au lieu de la décrire, et le backtest entier
    // deviendrait une lecture du futur — la faute déjà commise deux fois.
    const complet = qualifier(BOUGIES, OB);
    const tronque = qualifier(BOUGIES.slice(0, OB.indexCassure + 1), OB);
    expect(tronque).toEqual(complet);
  });

  it('reste insensible à ce qu’on ajoute après la cassure', () => {
    const prolongee = [...BOUGIES, ...serie([[200, 300, 199, 299], [299, 400, 298, 399]])];
    expect(qualifier(prolongee, OB)).toEqual(qualifier(BOUGIES, OB));
  });
});

describe('fvgDeLImpulsion', () => {
  it('trouve le déséquilibre laissé par l’impulsion', () => {
    const r = fvgDeLImpulsion(BOUGIES, OB);
    expect(r.presente).toBe(true);
    expect(r.tailleRelative).toBeGreaterThan(0);
  });

  it('ne rend rien quand l’impulsion ne laisse aucun vide', () => {
    const continues = serie([
      [99.9, 100.0, 99.0, 99.2], [99.2, 100.2, 99.1, 100.0],
      [100.0, 101.0, 99.9, 100.8], [100.8, 102.5, 100.1, 102.4],
    ]);
    const ob = { ...OB, index: 0, indexCassure: 3, indexOrigine: 0 };
    expect(fvgDeLImpulsion(continues, ob).presente).toBe(false);
  });

  it('cherche une FVG baissière pour un order block baissier', () => {
    const baissiere = serie([
      [100.0, 100.2, 99.9, 100.1], [100.1, 100.3, 99.0, 99.2],
      [99.2, 99.3, 98.0, 98.1], [98.1, 98.6, 97.0, 97.2],
    ]);
    const ob = {
      index: 0, indexCassure: 3, indexOrigine: 0, sens: BAISSIER, prixCasse: 98,
      zone: { bas: 99.9, haut: 100.2, hauteur: 0.3 },
    };
    expect(fvgDeLImpulsion(baissiere, ob).presente).toBe(true);
  });
});

describe('priseDeLiquidite', () => {
  it('repère un plus-bas balayé puis refermé au-dessus', () => {
    const r = priseDeLiquidite(BOUGIES, OB, 6);
    expect(r.presente).toBe(true);
    expect(r.profondeurRelative).toBeGreaterThan(0);
  });

  it('ne compte pas une cassure franche comme un balayage', () => {
    // Le prix passe sous le niveau et referme dessous : c'est une cassure,
    // pas une prise de liquidité.
    const cassante = serie([
      [100, 100.2, 99.5, 100], [100, 100.1, 99.4, 99.9], [99.9, 100, 99.5, 99.8],
      [99.8, 99.9, 98.0, 98.2], [98.2, 98.5, 97.9, 98.1],
    ]);
    const ob = { ...OB, index: 4, indexCassure: 4, indexOrigine: 0 };
    expect(priseDeLiquidite(cassante, ob, 2).presente).toBe(false);
  });
});

describe('deplacement', () => {
  it('mesure l’ampleur en hauteurs de zone et la plénitude des corps', () => {
    const r = deplacement(BOUGIES, OB);
    expect(r.nombreBougies).toBe(4);
    expect(r.ampleurEnZones).toBeGreaterThan(2);
    expect(r.corpsMoyen).toBeGreaterThan(0.5);
  });
});

describe('significativiteDuNiveau', () => {
  it('rend 1 quand rien n’était allé aussi haut', () => {
    expect(significativiteDuNiveau(BOUGIES, OB, 12)).toBe(1);
  });

  it('baisse quand le niveau avait déjà été dépassé avant l’order block', () => {
    const ob = { ...OB, prixCasse: 100.3 };
    expect(significativiteDuNiveau(BOUGIES, ob, 12)).toBeLessThan(1);
  });

  it('ignore l’impulsion, qui franchit le niveau par construction', () => {
    // La bougie 15 perce 102 d'une mèche avant la clôture qui acte la
    // cassure en 16. L'inclure ferait baisser la significativité des
    // mouvements les plus francs.
    expect(significativiteDuNiveau(BOUGIES, OB, 12)).toBe(1);
  });

  it('rend null sans niveau cassé connu', () => {
    expect(significativiteDuNiveau(BOUGIES, { ...OB, prixCasse: null })).toBeNull();
  });
});

describe('premiumDiscount', () => {
  it('place un order block haussier bas dans sa jambe', () => {
    const r = premiumDiscount(BOUGIES, OB);
    expect(r.position).toBeLessThan(0.5);
    expect(r.enZoneFavorable).toBe(true);
  });

  it('inverse le sens du favorable pour un order block baissier', () => {
    const r = premiumDiscount(BOUGIES, { ...OB, sens: BAISSIER });
    expect(r.enZoneFavorable).toBe(false);
  });
});

describe('fraicheur', () => {
  it('déclare intacte une zone que l’impulsion n’a pas retraversée', () => {
    expect(fraicheur(BOUGIES, OB)).toEqual({ intacte: true, bougiesDansLaZone: 0 });
  });

  it('compte un retour, une fois le prix sorti de la zone', () => {
    const allerRetour = serie([
      [99.9, 100.0, 99.0, 99.2],   // 0 : order block, zone 99,0 – 100,0
      [99.2, 101.0, 99.1, 100.9],  // 1 : démarre dans la zone, en sort
      [100.9, 101.5, 100.8, 101.4], // 2 : hors zone
      [101.4, 101.5, 99.5, 99.8],  // 3 : RETOUR dans la zone
      [99.8, 102.5, 99.7, 102.4],  // 4 : repart de la zone et casse
    ]);
    const ob = { ...OB, index: 0, indexCassure: 4, indexOrigine: 0 };
    // Deux bougies passent dans la zone après en être sorties : le retour en 3,
    // puis le départ de la nouvelle impulsion en 4.
    expect(fraicheur(allerRetour, ob)).toEqual({ intacte: false, bougiesDansLaZone: 2 });
  });
});

describe('zoneSurAtr', () => {
  it('rapporte la hauteur de zone à la volatilité ambiante', () => {
    const r = zoneSurAtr(BOUGIES, OB);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(5);
  });
});

describe('definitionAlternative', () => {
  it('désigne la bougie du plus bas de l’impulsion', () => {
    const r = definitionAlternative(BOUGIES, OB);
    expect(r.index).toBe(12); // 99,0 est le plus bas entre 10 et 15
    expect(r.identique).toBe(true);
    expect(r.ecartEnBougies).toBe(0);
  });

  it('signale l’écart quand les deux définitions divergent', () => {
    const r = definitionAlternative(BOUGIES, { ...OB, index: 11 });
    expect(r.identique).toBe(false);
    expect(r.ecartEnBougies).toBe(-1);
  });
});

describe('qualifier', () => {
  it('rend un objet plat, sans imbrication', () => {
    const q = qualifier(BOUGIES, OB);
    for (const valeur of Object.values(q)) {
      expect(typeof valeur === 'object' && valeur !== null).toBe(false);
    }
  });

  it('enregistre l’heure brute plutôt qu’une session nommée', () => {
    const q = qualifier(BOUGIES, OB);
    expect(q.heureUtc).toBe(9);
    expect(q.jourSemaine).toBe(1);
  });

  it('expose la longueur de la fenêtre de recherche', () => {
    // Quand elle vaut exactement 50, `indexOrigine` est la valeur de repli de
    // `cassures` et non un vrai pivot : l'écart entre définitions n'y veut
    // plus dire grand-chose.
    expect(qualifier(BOUGIES, OB).impulsionEnBougies).toBe(6);
  });
});
