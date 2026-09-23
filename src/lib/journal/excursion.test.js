import { describe, it, expect } from 'vitest';
import { calculerExcursions, enUnitesDeRisque } from './excursion.js';
import { construirePlan, parseArgs } from '../../../scripts/resoudre-plan.mjs';

const SHORT = { direction: 'SELL', prixEntree: 86523, prixStopLoss: 86780, prixTp1: 86300, prixTp2: 86100 };
const LONG = { direction: 'BUY', prixEntree: 100, prixStopLoss: 90, prixTp1: 120, prixTp2: 140 };
const b = (...paires) => paires.map(([h, l], i) => ({ ouvertureMs: i * 60000, plusHaut: h, plusBas: l }));

describe('calculerExcursions', () => {
  it('mesure les deux sens sur un short', () => {
    const e = calculerExcursions(SHORT, b([86600, 86400], [86550, 86310], [86700, 86500]));
    expect(e.faveurMax).toBeCloseTo(86523 - 86310, 2);
    expect(e.contreMax).toBeCloseTo(86700 - 86523, 2);
    expect(e.faveurMaxPrix).toBe(86310);
    expect(e.contreMaxPrix).toBe(86700);
  });

  it('mesure les deux sens sur un long', () => {
    const e = calculerExcursions(LONG, b([115, 95], [108, 88]));
    expect(e.faveurMax).toBe(15);
    expect(e.contreMax).toBe(12);
  });

  it('ne descend pas sous zéro quand le prix ne va jamais contre', () => {
    const e = calculerExcursions(LONG, b([110, 101], [120, 105]));
    expect(e.contreMax).toBe(0);
  });

  it('refuse une série vide', () => {
    expect(calculerExcursions(LONG, [])).toBeNull();
  });
});

describe('enUnitesDeRisque', () => {
  it('rapporte les amplitudes à la distance au stop', () => {
    // risque 10 ; faveur 15 -> 1,5 R ; contre 12 -> 1,2 R
    const r = enUnitesDeRisque(calculerExcursions(LONG, b([115, 95], [108, 88])), LONG);
    expect(r.faveurEnR).toBe(1.5);
    expect(r.contreEnR).toBe(1.2);
  });

  it('refuse un risque nul', () => {
    const plat = { ...LONG, prixStopLoss: 100 };
    expect(enUnitesDeRisque(calculerExcursions(plat, b([110, 99])), plat)).toBeNull();
  });
});

describe('construirePlan', () => {
  const valide = {
    symbole: 'BTCUSDT', le: '2026-09-22T18:48:55Z', direction: 'SELL',
    entree: '86523.27', stop: '86780', tp1: '86300', tp2: '86100',
  };

  it('accepte un plan complet et cohérent', () => {
    const r = construirePlan(valide);
    expect(r.erreurs).toBeUndefined();
    expect(r.plan.prixEntree).toBe(86523.27);
    expect(r.horizonHeures).toBe(24);
  });

  it('accepte la direction en minuscules', () => {
    expect(construirePlan({ ...valide, direction: 'sell' }).plan.direction).toBe('SELL');
  });

  it('liste tous les arguments manquants d’un coup', () => {
    const r = construirePlan({});
    expect(r.erreurs.length).toBeGreaterThanOrEqual(7);
  });

  it('refuse un symbole non résolvable', () => {
    expect(construirePlan({ ...valide, symbole: 'EURUSD' }).erreurs.join(' ')).toMatch(/pas une paire résolvable/);
  });

  it('refuse une date invalide', () => {
    expect(construirePlan({ ...valide, le: 'hier' }).erreurs.join(' ')).toMatch(/ISO 8601/);
  });

  it('refuse une date dans le futur', () => {
    expect(construirePlan({ ...valide, le: '2099-01-01T00:00:00Z' }).erreurs.join(' ')).toMatch(/futur/);
  });

  it('refuse un prix non numérique', () => {
    expect(construirePlan({ ...valide, entree: 'abc' }).erreurs.join(' ')).toMatch(/pas un prix valide/);
  });

  it('refuse un plan dont l’ordonnancement contredit la direction', () => {
    const r = construirePlan({ ...valide, stop: '86000' }); // stop sous l'entrée sur un SELL
    expect(r.erreurs.join(' ')).toMatch(/incohérent pour un SELL/);
  });

  it('refuse un horizon absurde', () => {
    expect(construirePlan({ ...valide, horizonHeures: '-3' }).erreurs.join(' ')).toMatch(/heures positif/);
  });
});

describe('parseArgs du script', () => {
  it('convertit --horizon-heures en camelCase', () => {
    expect(parseArgs(['--horizon-heures', '48'])).toEqual({ horizonHeures: '48' });
  });
});
