import { describe, it, expect } from 'vitest';

import { quantile, excursions, jouerLePlan, distancesDuPlan, trancheDe } from './plan.js';

const bg = (o, h, l, c) => ({ ouverture: o, plusHaut: h, plusBas: l, cloture: c, volume: 1 });
const plat = (p) => bg(p, p, p, p);
// Ancre : clôture 100. Stop 2, objectif 3, seuil nul à 1. 1 R = 2 en prix.
const PLAN = { sens: 1, stop: 2, objectif: 3, be: 1, horizon: 5 };
const apres = (...b) => [plat(100), ...b, ...Array(6).fill(plat(100))];

describe('quantile', () => {
  it('interpole entre deux rangs', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 9);
    expect(quantile([0, 10], 0.75)).toBeCloseTo(7.5, 9);
  });

  it('tient les bords et les cas dégénérés', () => {
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('excursions', () => {
  it('mesure depuis la CLÔTURE, pas depuis l’ouverture', () => {
    // Ancre ouvre à 90 et clôture à 100 : la montée de la bougie elle-même
    // ne doit pas compter, seul ce qui suit sa clôture.
    const serie = [bg(90, 100, 90, 100), bg(100, 110, 95, 105), plat(105)];
    expect(excursions(serie, 0, 2)).toEqual({ montee: 0.1, baisse: 0.05 });
  });

  it('prend le maximum sur tout l’horizon, pas la dernière bougie', () => {
    const serie = [plat(100), bg(100, 104, 100, 100), bg(100, 100, 98, 100), plat(100)];
    const e = excursions(serie, 0, 3);
    expect(e.montee).toBeCloseTo(0.04, 9);
    expect(e.baisse).toBeCloseTo(0.02, 9);
  });

  it('refuse un horizon incomplet plutôt que de tronquer', () => {
    expect(excursions([plat(100), plat(101)], 0, 5)).toBeNull();
    expect(excursions([plat(0), plat(1)], 0, 1)).toBeNull();
  });
});

describe('jouerLePlan', () => {
  it('rend l’objectif au rapport gain/risque, pas à +1 R', () => {
    const r = jouerLePlan(apres(bg(100, 103.5, 100, 103)), 0, PLAN);
    expect(r.issue).toBe('objectif');
    expect(r.R).toBeCloseTo(1.5, 9);          // 3 ÷ 2
  });

  it('rend −1 R au stop', () => {
    expect(jouerLePlan(apres(bg(100, 100, 97.5, 98)), 0, PLAN)).toEqual({ issue: 'stop', R: -1 });
  });

  it('rend « ambigu » quand une bougie touche les deux — l’ordre est inconnu', () => {
    expect(jouerLePlan(apres(bg(100, 103.5, 97.5, 100)), 0, PLAN))
      .toEqual({ issue: 'ambigu', R: null });
  });

  it('ne fait PAS protéger le seuil nul à l’intérieur de la bougie qui le déclenche', () => {
    // Montée 1,5 (≥ be) puis retour à 99,5 dans la MÊME bougie. Si le seuil
    // nul agissait déjà, ce serait une sortie à zéro. On ne sait pas dans quel
    // ordre : il ne prend effet qu'à la bougie suivante.
    //
    // Le remplissage se tient à 100,5, au-dessus de l'entrée : à 100 pile, le
    // stop ramené à l'entrée se déclencherait pour de bon dès la bougie
    // suivante, et le test ne mesurerait plus ce qu'il croit mesurer.
    const suite = Array(4).fill(plat(100.5));
    const r = jouerLePlan([plat(100), bg(100, 101.5, 99.5, 100), ...suite], 0, PLAN);
    expect(r.issue).not.toBe('seuilNul');
    expect(r.issue).toBe('temps');
  });

  it('sort à zéro quand le prix revient à l’entrée APRÈS le déclenchement', () => {
    const r = jouerLePlan(apres(bg(100, 101.5, 100, 101), bg(101, 101, 99.9, 100)), 0, PLAN);
    expect(r).toEqual({ issue: 'seuilNul', R: 0 });
  });

  it('laisse courir tant que le seuil nul n’est pas déclenché', () => {
    // Retour à 99,9 sans montée préalable : ni stop (−0,1 < 2) ni seuil nul.
    const r = jouerLePlan(apres(bg(100, 100.2, 99.9, 100)), 0, PLAN);
    expect(r.issue).toBe('temps');
  });

  it('ferme au temps, en R, à la clôture de la dernière bougie', () => {
    const serie = [plat(100), plat(100.4), plat(100.4), plat(100.4), plat(100.4), plat(100.8)];
    const r = jouerLePlan(serie, 0, PLAN);
    expect(r.issue).toBe('temps');
    expect(r.R).toBeCloseTo(0.4, 9);          // 0,8 ÷ 2
  });

  it('rend un R négatif au temps quand la position est en perte sans avoir stoppé', () => {
    const serie = [plat(100), plat(99.5), plat(99.5), plat(99.5), plat(99.5), plat(99)];
    const r = jouerLePlan(serie, 0, PLAN);
    expect(r.issue).toBe('temps');
    expect(r.R).toBeCloseTo(-0.5, 9);         // −1 ÷ 2
  });

  it('traite une vente dans son propre sens', () => {
    const vente = { ...PLAN, sens: -1 };
    expect(jouerLePlan(apres(bg(100, 100, 96.5, 97)), 0, vente).issue).toBe('objectif');
    expect(jouerLePlan(apres(bg(100, 102.5, 100, 102)), 0, vente)).toEqual({ issue: 'stop', R: -1 });
  });

  it('refuse un horizon incomplet ou des distances absurdes', () => {
    expect(jouerLePlan([plat(100), plat(101)], 0, PLAN)).toBeNull();
    expect(jouerLePlan(apres(plat(100)), 0, { ...PLAN, stop: 0 })).toBeNull();
    expect(jouerLePlan(apres(plat(100)), 0, { ...PLAN, objectif: 0 })).toBeNull();
  });
});

describe('distancesDuPlan', () => {
  const h = (n, v) => Array.from({ length: n }, () => ({
    monteeH1: v, baisseH1: v, monteeH4: v, baisseH4: v,
  }));

  it('ne conclut pas sur un historique trop court — un q90 sur 40 cas ne décrit rien', () => {
    expect(distancesDuPlan(h(199, 0.002), 1, 4300)).toBeNull();
    expect(distancesDuPlan(h(200, 0.002), 1, 4300)).not.toBeNull();
  });

  it('convertit les fractions en distances de prix', () => {
    const d = distancesDuPlan(h(250, 0.002), 1, 4300);
    expect(d.stop).toBeCloseTo(8.6, 9);
    expect(d.objectif).toBeCloseTo(8.6, 9);
    expect(d.be).toBeCloseTo(8.6, 9);
    expect(d.n).toBe(250);
  });

  it('prend la baisse pour stop à l’achat, et la montée à la vente', () => {
    const hist = Array.from({ length: 300 }, () => ({
      monteeH1: 0.004, baisseH1: 0.001, monteeH4: 0.006, baisseH4: 0.002,
    }));
    const achat = distancesDuPlan(hist, 1, 1000);
    const vente = distancesDuPlan(hist, -1, 1000);
    expect(achat.stop).toBeCloseTo(1, 9);       // baisse 1 h
    expect(achat.objectif).toBeCloseTo(6, 9);   // montée 4 h
    expect(vente.stop).toBeCloseTo(4, 9);       // montée 1 h
    expect(vente.objectif).toBeCloseTo(2, 9);   // baisse 4 h
  });
});

describe('trancheDe', () => {
  it('range chaque rapport dans sa tranche', () => {
    expect(trancheDe(1)).toBe('1–1.5×');
    expect(trancheDe(1.49)).toBe('1–1.5×');
    expect(trancheDe(1.5)).toBe('1.5–2×');
    expect(trancheDe(3.99)).toBe('3–4×');
    expect(trancheDe(6)).toBe('6–10×');
    expect(trancheDe(10)).toBe('≥ 10×');
    expect(trancheDe(47)).toBe('≥ 10×');
  });

  it('écarte tout ce qui est sous la médiane locale', () => {
    expect(trancheDe(0.99)).toBeNull();
    expect(trancheDe(0)).toBeNull();
    expect(trancheDe(NaN)).toBeNull();
  });
});
