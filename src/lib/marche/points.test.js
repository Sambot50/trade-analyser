import { describe, it, expect } from 'vitest';
import { pointsStructurels } from './structure.js';

const T0 = Date.UTC(2026, 0, 5);
const serie = (prix) => prix.map((c, i) => ({
  ouvertureMs: T0 + i * 60_000, fermetureMs: T0 + (i + 1) * 60_000 - 1,
  ouverture: c, plusHaut: c, plusBas: c, cloture: c,
}));

describe('pointsStructurels', () => {
  it('nomme H, L puis HH, HL, LH, LL', () => {
    // sommet 5, creux 2, sommet 7 (HH), creux 4 (HL), sommet 6 (LH), creux 1 (LL)
    const prix = [3, 5, 3, 2, 3, 7, 5, 4, 5, 6, 3, 1, 3, 3];
    const points = pointsStructurels(serie(prix), 1);
    expect(points.map((p) => `${p.type}@${p.prix}`)).toEqual(['H@5', 'L@2', 'HH@7', 'HL@4', 'LH@6', 'LL@1']);
  });

  it('date chaque point de sa confirmation, jamais de son sommet', () => {
    const [premier] = pointsStructurels(serie([3, 5, 3, 2, 3]), 1);
    expect(premier.ms).toBe(T0 + 60_000);
    expect(premier.confirmeMs).toBe(T0 + 3 * 60_000 - 1);
  });
});
