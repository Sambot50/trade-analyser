import { describe, it, expect } from 'vitest';
import { coutEnRDuPlan, distributionDesStops, seuilDeRentabilite } from './couts.js';

const plan = (prixEntree, prixStopLoss) => ({ prixEntree, prixStopLoss });

describe('coutEnRDuPlan', () => {
  it('rapporte le coût au risque, pas au prix', () => {
    // Or : stop à 6 $, spread à 0,30 $ → 5 % du risque.
    expect(coutEnRDuPlan(plan(2400, 2394), { spread: 0.3 })).toBe(0.05);
  });

  it('additionne spread et commission', () => {
    expect(coutEnRDuPlan(plan(2400, 2394), { spread: 0.3, commission: 0.3 })).toBe(0.1);
  });

  it('fait payer plus cher un stop serré', () => {
    const large = coutEnRDuPlan(plan(2400, 2390), { spread: 0.3 });
    const serre = coutEnRDuPlan(plan(2400, 2399), { spread: 0.3 });
    expect(serre).toBeGreaterThan(large);
    expect(serre).toBeCloseTo(0.3, 4);
  });

  it('vaut le même chiffre à la vente qu’à l’achat', () => {
    expect(coutEnRDuPlan(plan(2400, 2406), { spread: 0.3 }))
      .toBe(coutEnRDuPlan(plan(2400, 2394), { spread: 0.3 }));
  });

  it('confirme l’écart d’un facteur vingt entre BTC spot et l’or', () => {
    // Le chiffre qui a motivé ce module : mêmes règles, coûts incomparables.
    const or = coutEnRDuPlan(plan(2400, 2394), { spread: 0.3 });
    const btcSpot = coutEnRDuPlan(plan(60000, 59850), { spread: 60 }); // 0,1 % aller-retour
    expect(btcSpot / or).toBeGreaterThan(5);
  });

  it('rend null plutôt que l’infini sur un plan sans risque', () => {
    expect(coutEnRDuPlan(plan(2400, 2400), { spread: 0.3 })).toBeNull();
    expect(coutEnRDuPlan(plan(2400, NaN), { spread: 0.3 })).toBeNull();
  });

  it('vaut zéro sans spread ni commission', () => {
    expect(coutEnRDuPlan(plan(2400, 2394))).toBe(0);
  });
});

describe('distributionDesStops', () => {
  it('rend la médiane et les quartiles en relatif', () => {
    const plans = [plan(100, 99), plan(100, 98), plan(100, 97), plan(100, 96), plan(100, 95)];
    const d = distributionDesStops(plans);
    expect(d.nombre).toBe(5);
    expect(d.medianePrix).toBe(3);
    expect(d.medianeRelative).toBe(0.03);
    expect(d.premierQuartileRelative).toBe(0.02);
    expect(d.dernierQuartileRelative).toBe(0.04);
  });

  it('écarte les plans sans risque au lieu de les compter comme nuls', () => {
    const d = distributionDesStops([plan(100, 99), plan(100, 100), plan(100, 97)]);
    expect(d.nombre).toBe(2);
  });

  it('rend null quand rien n’est exploitable', () => {
    expect(distributionDesStops([])).toBeNull();
    expect(distributionDesStops([plan(100, 100)])).toBeNull();
  });
});

describe('seuilDeRentabilite', () => {
  it('retrouve le seuil sans coûts', () => {
    expect(seuilDeRentabilite(1)).toBe(0.5);
    expect(seuilDeRentabilite(2)).toBeCloseTo(1 / 3, 4);
  });

  it('relève le seuil à mesure que les coûts montent', () => {
    // Ratio 1,70 : 37 % sans coûts, 39 % à 0,05 R, 65 % à 0,80 R.
    expect(seuilDeRentabilite(1.7, 0)).toBeCloseTo(0.3704, 4);
    expect(seuilDeRentabilite(1.7, 0.05)).toBeCloseTo(0.3889, 4);
    expect(seuilDeRentabilite(1.7, 0.8)).toBeCloseTo(0.6667, 4);
  });

  it('rend null quand aucun taux de réussite ne suffit', () => {
    // Coûts supérieurs au gain d'un trade gagnant : la règle est perdante à
    // 100 % de réussite. Mieux vaut le dire que d'afficher « 105 % ».
    expect(seuilDeRentabilite(1, 1.5)).toBeNull();
    expect(seuilDeRentabilite(0)).toBeNull();
  });
});
