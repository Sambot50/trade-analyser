import { describe, expect, it } from 'vitest';
import { TRANCHES, excursions, nomTranche, trancheDe, validerOptions } from './dimensionner.mjs';

const bg = (ouverture, plusHaut, plusBas, cloture) => ({ ouverture, plusHaut, plusBas, cloture, volume: 1 });

describe('tranches de volume', () => {
  it('range chaque ratio dans sa tranche', () => {
    expect(nomTranche(trancheDe(0.5))).toBe('0–1×');
    expect(nomTranche(trancheDe(1.2))).toBe('1–1.5×');
    expect(nomTranche(trancheDe(3.9))).toBe('3–4×');
    expect(nomTranche(trancheDe(50))).toBe('≥ 10×');
  });

  it('met la borne dans la tranche du HAUT, sans ambiguïté', () => {
    // Un ratio de 2,0 exactement appartient à « 2–3× », pas à « 1.5–2× ».
    expect(nomTranche(trancheDe(2))).toBe('2–3×');
    expect(nomTranche(trancheDe(1.999))).toBe('1.5–2×');
  });

  it('couvre tout le domaine, sans trou ni recouvrement', () => {
    for (const r of [0, 0.01, 1, 1.5, 2, 3, 4, 6, 10, 1000]) {
      expect(trancheDe(r)).toBeGreaterThanOrEqual(0);
      expect(trancheDe(r)).toBeLessThan(TRANCHES.length);
    }
  });
});

describe('excursions', () => {
  // Bougie : 100 → 110, haut 112, bas 98. Hauteur 14, départ 110.
  const ancre = bg(100, 112, 98, 110);

  it('part de la CLÔTURE, le premier prix auquel on peut agir', () => {
    const r = excursions([ancre, bg(110, 121, 110, 120)], 0, 1);
    expect(r.monteePct).toBeCloseTo((11 / 110) * 100, 9);
  });

  it('donne les deux sens séparément', () => {
    const r = excursions([ancre, bg(110, 121, 99, 105)], 0, 1);
    expect(r.monteePct).toBeCloseTo((11 / 110) * 100, 9);
    expect(r.baissePct).toBeCloseTo((11 / 110) * 100, 9);
  });

  it('exprime aussi les excursions en hauteurs de bougie', () => {
    const r = excursions([ancre, bg(110, 124, 110, 120)], 0, 1);
    expect(r.monteeEnR).toBeCloseTo(14 / 14, 9);
  });

  it('prend le plus haut et le plus bas de TOUTE la fenêtre', () => {
    const r = excursions([ancre, bg(110, 115, 108, 112), bg(112, 130, 90, 100)], 0, 2);
    expect(r.monteePct).toBeCloseTo((20 / 110) * 100, 9);
    expect(r.baissePct).toBeCloseTo((20 / 110) * 100, 9);
  });

  it('rend null quand l’horizon dépasse la série', () => {
    expect(excursions([ancre, bg(110, 115, 105, 112)], 0, 10)).toBeNull();
  });

  it('rend null sur une bougie sans hauteur', () => {
    expect(excursions([bg(100, 100, 100, 100), bg(100, 110, 90, 105)], 0, 1)).toBeNull();
  });
});

describe('validerOptions', () => {
  it('exige une source', () => expect(validerOptions({}).erreurs).toBeTruthy());
  it('accepte un dossier', () => expect(validerOptions({ dossier: 'marches' }).ut).toBe('15m'));
  it('refuse une unité inconnue', () => expect(validerOptions({ csv: 'x', ut: '7m' }).erreurs).toBeTruthy());
});
