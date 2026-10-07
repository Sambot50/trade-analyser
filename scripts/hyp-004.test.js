import { describe, it, expect } from 'vitest';
import { GEL, verdict, CINQ, BASSES } from './hyp-004.mjs';

const g = (tranchees, esperance) => ({ tranchees, esperance });

describe('HYP-004 — gel', () => {
  it('fige fichier, frais, objectif, tirages et seuils', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(GEL).toMatchObject({ fichier: 'GC_2020_2022.csv', spread: 0.4, objectif: '2r', tirages: 200, minimumCinqEtoiles: 30, seuilP: 0.05 });
    expect(GEL.parametresEtoiles).toEqual({ periodeAtr: 14, fenetrePivots: 5, toleranceEgauxEnAtr: 0.1, porteeEnAtr: 2, profondeur: 200 });
  });
  it('compare 5 étoiles à 0-2 étoiles', () => {
    expect([0, 1, 2, 3, 4, 5].filter(CINQ)).toEqual([5]);
    expect([0, 1, 2, 3, 4, 5].filter(BASSES)).toEqual([0, 1, 2]);
  });
});

describe('HYP-004 — règle de décision', () => {
  it('confirme si les trois conditions tiennent', () => {
    expect(verdict({ cinq: g(40, 0.2), basses: g(300, -0.1), p: 0.01 }).code).toBe('confirmee');
  });
  it('ne conclut pas sous 30 trades à 5 étoiles, même brillants', () => {
    expect(verdict({ cinq: g(29, 1.5), basses: g(300, -0.1), p: 0.001 }).code).toBe('non_concluant');
  });
  it('réfute si le hasard fait aussi bien', () => {
    expect(verdict({ cinq: g(40, 0.2), basses: g(300, -0.1), p: 0.05 }).code).toBe('refutee');
  });
  it('réfute si les 0-2 étoiles font aussi bien', () => {
    const v = verdict({ cinq: g(40, 0.2), basses: g(300, 0.2), p: 0.01 });
    expect(v.code).toBe('refutee');
    expect(v.texte).toContain('0-2 étoiles');
  });
});
