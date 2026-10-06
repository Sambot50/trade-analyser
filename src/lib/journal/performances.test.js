import { describe, it, expect } from 'vitest';
import { statistiques, ventiler, performances, heureEtJour } from './performances.js';

const pos = (net, x = {}) => ({
  statut: 'fermee', net, commission: -1, swap: 0, frais: 0, dureeMin: 60, rNet: null,
  ouverture: '2026-07-15T12:30:00Z', symbole: 'XAUUSD', setup: null, sens: 'achat', ...x,
});

describe('statistiques', () => {
  const ps = [pos(100), pos(-50), pos(200), pos(-50), pos(0)];
  const s = statistiques(ps);

  it('compte les gagnants, les perdants et les nuls, avec l’intervalle du taux', () => {
    expect(s).toMatchObject({ n: 5, gagnants: 2, perdants: 2, nuls: 1, suffisant: false });
    expect(s.taux.proportion).toBeCloseTo(0.4);
    expect(s.taux.bas).toBeLessThan(0.15);
    expect(s.taux.haut).toBeGreaterThan(0.75);
  });

  it('calcule gain et perte moyens, profit factor, espérance, P&L et frais', () => {
    expect(s.gainMoyen).toBe(150);
    expect(s.perteMoyenne).toBe(50);
    expect(s.profitFactor).toBe(3);
    expect(s.esperance).toBe(40);
    expect(s.pnl).toBe(200);
    expect(s.frais).toBe(-5);
  });

  it('mesure le creux maximal de la courbe cumulée', () => {
    expect(statistiques([pos(100), pos(-30), pos(-40), pos(50), pos(-90)]).drawdownMax).toBe(110);
  });

  it('ne calcule pas de Sharpe sous l’effectif minimal', () => {
    expect(s.sharpeParTrade).toBeNull();
    const trente = Array.from({ length: 30 }, (_, i) => pos(i % 3 ? 10 : -12));
    expect(statistiques(trente).sharpeParTrade).toBeGreaterThan(0);
  });

  it('rend un profit factor nul plutôt qu’infini quand il n’y a aucune perte', () => {
    expect(statistiques([pos(10), pos(20)]).profitFactor).toBeNull();
  });

  it('dit combien de trades n’ont pas de R, faute de stop posé', () => {
    expect(statistiques([pos(10, { rNet: 1.5 }), pos(-5)]).r).toEqual({ n: 1, moyen: 1.5, sansStop: 1 });
  });
});

describe('ventilations', () => {
  it('lit l’heure et le jour dans le fuseau de Paris', () => {
    expect(heureEtJour('2026-07-15T12:30:00Z')).toEqual({ heure: 14, jour: 3 });
    expect(heureEtJour('2026-01-15T12:30:00Z')).toEqual({ heure: 13, jour: 4 });
  });

  it('rend les groupes dans l’ordre naturel, jamais triés par résultat', () => {
    const g = ventiler([pos(-10, { setup: 'b' }), pos(500, { setup: 'a' }), pos(1, { setup: null })], (p) => p.setup);
    expect(g.map((x) => x.groupe)).toEqual(['a', 'b', null]);
    expect(g.every((x) => x.suffisant === false)).toBe(true);
  });

  it('assemble le rapport, sans compter les positions ouvertes', () => {
    const r = performances([pos(10), pos(-5, { ouverture: '2026-07-16T07:00:00Z' }), { ...pos(0), statut: 'ouverte' }]);
    expect(r.global.n).toBe(2);
    expect(r.ouvertes).toBe(1);
    expect(r.parHeure.map((g) => g.groupe)).toEqual([9, 14]);
    expect(r.parJour.map((g) => g.libelle)).toEqual(['mercredi', 'jeudi']);
  });
});
