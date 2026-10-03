import { describe, it, expect } from 'vitest';

import {
  prixSelonLeModele, ecartDesAxes, niveauxDansLesZones, confronter, ECART_PREOCCUPANT,
} from './confrontation.js';

// Tracé de 0 à 500 dans une image de 1000 : prix 4400 en haut, 4300 en bas.
const zone = { y0: 0, y1: 500 };
const echelle = { prixDeY: (y) => 4400 - (y / 500) * 100, yDePrix: (p) => (4400 - p) * 5 };
const repereJuste = { priceTop: 4400, priceBottom: 4300, plotTopRatio: 0, plotBottomRatio: 0.5 };

describe('prixSelonLeModele', () => {
  it('rend le prix qu’annonce le repère du modèle', () => {
    expect(prixSelonLeModele(repereJuste, 0, 1000)).toBeCloseTo(4400, 6);
    expect(prixSelonLeModele(repereJuste, 250, 1000)).toBeCloseTo(4350, 6);
    expect(prixSelonLeModele(repereJuste, 500, 1000)).toBeCloseTo(4300, 6);
  });

  it('refuse un repère incomplet plutôt que d’inventer', () => {
    expect(prixSelonLeModele({ priceTop: 1 }, 0, 1000)).toBeNull();
    expect(prixSelonLeModele(null, 0, 1000)).toBeNull();
    expect(prixSelonLeModele(repereJuste, 0, 0)).toBeNull();
  });
});

describe('ecartDesAxes', () => {
  it('ne trouve rien à redire quand les deux axes coïncident', () => {
    const e = ecartDesAxes(repereJuste, echelle, zone, 1000);
    expect(e.moyen).toBeLessThan(1e-9);
    expect(e.pire).toBeLessThan(1e-9);
    expect(e.etendue).toBeCloseTo(100, 6);
  });

  it('chiffre un décalage de niveau', () => {
    // Le modèle lit tout 2 unités trop haut, sur une étendue de 100.
    const decale = { ...repereJuste, priceTop: 4402, priceBottom: 4302 };
    const e = ecartDesAxes(decale, echelle, zone, 1000);
    expect(e.moyen).toBeCloseTo(0.02, 6);
    expect(e.pire).toBeCloseTo(0.02, 6);
  });

  it('attrape une erreur d’AMPLITUDE, nulle au centre et forte aux bords', () => {
    // C'est pour cela qu'on échantillonne : un seul point au milieu ne verrait
    // rien, alors que les extrémités sont fausses de cinq pour cent.
    const etire = { ...repereJuste, priceTop: 4405, priceBottom: 4295 };
    const e = ecartDesAxes(etire, echelle, zone, 1000);
    expect(e.pire).toBeCloseTo(0.05, 6);
    expect(e.moyen).toBeLessThan(e.pire);
  });

  it('rend null sans repère ou sans échelle mesurée', () => {
    expect(ecartDesAxes(null, echelle, zone, 1000)).toBeNull();
    expect(ecartDesAxes(repereJuste, {}, zone, 1000)).toBeNull();
  });
});

describe('niveauxDansLesZones', () => {
  const obs = [
    { index: 10, sens: 'haussier', zone: { bas: 4340, haut: 4360 } },
    { index: 30, sens: 'baissier', zone: { bas: 4310, haut: 4315 } },
  ];

  it('dit quels niveaux tombent DANS une zone mesurée', () => {
    const n = niveauxDansLesZones({ entry: 4350, stopLoss: 4330, tp1: 4312 }, obs, 100);
    expect(n.find((x) => x.cle === 'entry')).toMatchObject({ dansUneZone: true, index: 10, distance: 0 });
    expect(n.find((x) => x.cle === 'tp1')).toMatchObject({ dansUneZone: true, index: 30 });
  });

  it('chiffre la distance quand le niveau ne tombe dans aucune', () => {
    const n = niveauxDansLesZones({ stopLoss: 4330 }, obs, 100);
    expect(n[0].dansUneZone).toBe(false);
    expect(n[0].distance).toBeCloseTo(0.10, 6);   // 4340 − 4330, sur 100
    expect(n[0].index).toBe(10);
  });

  it('ignore les niveaux absents au lieu de les compter à zéro', () => {
    expect(niveauxDansLesZones({ entry: 4350, tp2: null }, obs, 100).map((n) => n.cle))
      .toEqual(['entry']);
  });

  it('ne rend rien sans zone ni étendue exploitable', () => {
    expect(niveauxDansLesZones({ entry: 1 }, [], 100)).toEqual([
      { cle: 'entry', libelle: 'Entrée', prix: 1, dansUneZone: false, index: null, sens: null, distance: null },
    ]);
    expect(niveauxDansLesZones({ entry: 1 }, obs, 0)).toEqual([]);
    expect(niveauxDansLesZones(null, obs, 100)).toEqual([]);
  });
});

describe('confronter', () => {
  const lecture = {
    ok: true, echelle, zone,
    analyses: { orderBlocks: [{ index: 10, sens: 'haussier', zone: { bas: 4340, haut: 4360 } }] },
  };

  it('compte les niveaux appuyés sur une zone mesurée', () => {
    const c = confronter({ scale: repereJuste, entry: 4350, stopLoss: 4320 }, lecture, 1000);
    expect(c.appuyes).toBe(1);
    expect(c.total).toBe(2);
    expect(c.axeDouteux).toBe(false);
  });

  it('signale un axe douteux au-delà du seuil', () => {
    const faux = { ...repereJuste, priceTop: 4420, priceBottom: 4320 };
    const c = confronter({ scale: faux, entry: 4350 }, lecture, 1000);
    expect(c.axes.pire).toBeGreaterThan(ECART_PREOCCUPANT);
    expect(c.axeDouteux).toBe(true);
  });

  it('ne confronte rien sans les deux lectures', () => {
    expect(confronter(null, lecture, 1000)).toBeNull();
    expect(confronter({ scale: repereJuste }, { ok: false }, 1000)).toBeNull();
  });
});
