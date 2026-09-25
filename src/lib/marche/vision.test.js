import { describe, it, expect } from 'vitest';
import { planDepuisAnalyse, geometrieDuPlan, planDepuisGeometrie } from './vision.js';

const achat = { direction: 'BUY', entry: 2000, stopLoss: 1980, tp1: 2020, tp2: 2040 };
const vente = { direction: 'SELL', entry: 2000, stopLoss: 2020, tp1: 1980, tp2: 1960 };

describe('traduction vers le plan résoluble', () => {
  it('renomme sans rien déformer', () => {
    const p = planDepuisAnalyse(achat);
    expect(p).toMatchObject({
      direction: 'BUY', prixEntree: 2000, prixStopLoss: 1980, prixTp1: 2020, prixTp2: 2040,
    });
    expect(p.risque).toBe(20);
  });

  it('donne un risque positif dans les deux sens', () => {
    expect(planDepuisAnalyse(vente).risque).toBe(20);
  });
});

describe('géométrie — ce que le contrôle rejouera', () => {
  it('se transpose à un autre niveau de prix sans distorsion', () => {
    const g = geometrieDuPlan(planDepuisAnalyse(achat), 2000);
    const rejoue = planDepuisGeometrie(g, 4000);

    // Mêmes proportions, prix doublés.
    expect(rejoue.prixEntree).toBeCloseTo(4000, 6);
    expect(rejoue.prixStopLoss).toBeCloseTo(3960, 6);
    expect(rejoue.prixTp1).toBeCloseTo(4040, 6);
    expect(rejoue.prixTp2).toBeCloseTo(4080, 6);
  });

  it('fait l’aller-retour à l’identique au même prix', () => {
    for (const analyse of [achat, vente]) {
      const plan = planDepuisAnalyse(analyse);
      const rejoue = planDepuisGeometrie(geometrieDuPlan(plan, 2000), 2000);
      for (const champ of ['prixEntree', 'prixStopLoss', 'prixTp1', 'prixTp2']) {
        expect(rejoue[champ]).toBeCloseTo(plan[champ], 6);
      }
    }
  });

  /**
   * Le contrôle doit conserver le sens : sans ça, un marché haussier se
   * ferait passer pour du talent de lecture.
   */
  it('conserve le sens du plan', () => {
    expect(planDepuisGeometrie(geometrieDuPlan(planDepuisAnalyse(vente), 2000), 3000).direction).toBe('SELL');
  });

  it('garde une entrée décalée du prix courant', () => {
    // Entrée posée 1 % sous le prix du moment : un retour attendu.
    const plan = planDepuisAnalyse({ ...achat, entry: 1980, stopLoss: 1960, tp1: 2000, tp2: 2020 });
    const g = geometrieDuPlan(plan, 2000);
    expect(g.ecartEntree).toBeCloseTo(-0.01, 6);
    expect(planDepuisGeometrie(g, 1000).prixEntree).toBeCloseTo(990, 6);
  });

  it('refuse un prix de référence absent ou nul', () => {
    expect(() => geometrieDuPlan(planDepuisAnalyse(achat), 0)).toThrow(/référence/);
    expect(() => planDepuisGeometrie({ direction: 'BUY' }, 0)).toThrow(/référence/);
  });
});
