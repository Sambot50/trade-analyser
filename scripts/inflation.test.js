import { describe, it, expect } from 'vitest';

import { tauxSurBarrieres, erreurTypeDeLaDifference, mesurerUneGraine } from './inflation.mjs';

const sorts = (atteint, perdu, horizon = 0) => [
  ...Array.from({ length: atteint }, () => ({ issue: 'atteint', R: 3 })),
  ...Array.from({ length: perdu }, () => ({ issue: 'perdu', R: -3 })),
  ...Array.from({ length: horizon }, () => ({ issue: 'horizon', R: 0.2 })),
];

describe('tauxSurBarrieres', () => {
  it('ne compte que les barrières, comme la mesure gelée', () => {
    // Les 900 sorties au marché ne doivent changer ni le taux ni l'erreur type.
    const r = tauxSurBarrieres(sorts(60, 40, 900));
    expect(r.taux).toBe(60);
    expect(r.n).toBe(100);
    expect(r.erreurType).toBeCloseTo(5, 9);
  });

  it('rend une erreur type qui décroît en racine de n', () => {
    const petit = tauxSurBarrieres(sorts(50, 50));
    const grand = tauxSurBarrieres(sorts(200, 200));
    expect(grand.erreurType).toBeCloseTo(petit.erreurType / 2, 9);
  });

  it('rend null quand aucune barrière n’est touchée', () => {
    expect(tauxSurBarrieres([])).toBeNull();
    expect(tauxSurBarrieres(sorts(0, 0, 50))).toBeNull();
    expect(tauxSurBarrieres([{ issue: 'ambigu', R: null }])).toBeNull();
  });
});

describe('erreurTypeDeLaDifference', () => {
  it('compose les deux erreurs types en quadrature', () => {
    const a = { erreurType: 3 };
    const b = { erreurType: 4 };
    expect(erreurTypeDeLaDifference(a, b)).toBeCloseTo(5, 9);
  });

  it('dépasse toujours la plus grande des deux — soustraire ajoute du bruit', () => {
    const d = erreurTypeDeLaDifference({ erreurType: 6 }, { erreurType: 1.5 });
    expect(d).toBeGreaterThan(6);
  });

  it('rend null si l’un des deux bras manque', () => {
    expect(erreurTypeDeLaDifference(null, { erreurType: 1 })).toBeNull();
    expect(erreurTypeDeLaDifference({ erreurType: 1 }, null)).toBeNull();
  });
});

describe('mesurerUneGraine', () => {
  it('rejoue la règle gelée sur une marche sans avantage et rend les deux bras', () => {
    const r = mesurerUneGraine(4242, { jours: 10, contrats: 1 });
    expect(r).toHaveProperty('detectees');
    expect(r).toHaveProperty('temoin');
    for (const bras of [r.detectees, r.temoin]) {
      if (bras === null) continue;
      expect(bras.n).toBeGreaterThan(0);
      expect(bras.taux).toBeGreaterThanOrEqual(0);
      expect(bras.taux).toBeLessThanOrEqual(100);
      expect(bras.erreurType).toBeGreaterThan(0);
    }
  });

  it('rejoue à l’identique à graine égale', () => {
    const o = { jours: 10, contrats: 1 };
    expect(mesurerUneGraine(77, o)).toEqual(mesurerUneGraine(77, o));
  });
});
