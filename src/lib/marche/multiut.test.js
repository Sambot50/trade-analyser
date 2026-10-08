import { describe, it, expect } from 'vitest';
import { tableauMultiUT, ligneUnite, biaisPondere, lecture, POIDS, UNITES_MTF } from './multiut.js';
import { serieAleatoire } from './aleatoire.js';

const l = (unite, tendance) => ({ unite, tendance });
const H = 'haussier';
const B = 'baissier';

describe('biais pondéré et lecture — les deux captures de référence', () => {
  it('capture 1 : 5m ▲, 15m ▼, 30m ▼, 1H ▼, 4H ▲, Daily ▲ → +2 / 10, repli dans la tendance haussière', () => {
    const lignes = [l('5m', H), l('15m', B), l('30m', B), l('1h', B), l('4h', H), l('1d', H)];
    expect(biaisPondere(lignes)).toMatchObject({ score: 2, sur: 10 });
    const lu = lecture(lignes);
    expect(lu.code).toBe('repli');
    expect(lu.texte).toMatch(/attendre un CHoCH ▲/);
  });

  it('capture 2 : 5m ▼, 15m ▲, 30m ▲, 1H ▼, 4H ▼, Daily ▲ → 0 / 10, 4 h et Daily en conflit', () => {
    const lignes = [l('5m', B), l('15m', H), l('30m', H), l('1h', B), l('4h', B), l('1d', H)];
    expect(biaisPondere(lignes).score).toBe(0);
    expect(lecture(lignes).code).toBe('conflit');
  });

  it('reconnaît l’alignement, les tendances mêlées et l’indéterminé', () => {
    expect(lecture(UNITES_MTF.map((u) => l(u, B))).texte).toMatch(/Alignement baissier/);
    expect(lecture([l('5m', H), l('15m', B), l('30m', H), l('1h', B), l('4h', H), l('1d', H)]).code).toBe('mele');
    expect(lecture(UNITES_MTF.map((u) => l(u, 'indetermine'))).code).toBe('indetermine');
  });

  it('déclare des poids qui totalisent 10, du plus court au plus long', () => {
    expect(Object.values(POIDS).reduce((a, x) => a + x, 0)).toBe(10);
    expect(Object.isFrozen(POIDS)).toBe(true);
  });
});

describe('ligneUnite', () => {
  // Un creux, un sommet, un creux plus haut, puis la cassure du sommet en clôture.
  const prix = [10, 9, 8, 7, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 9, 10, 11, 12, 13, 14, 13.5];
  const T0 = Date.UTC(2026, 0, 5);
  const bougies = prix.map((c, i) => ({
    ouvertureMs: T0 + i * 3_600_000, fermetureMs: T0 + (i + 1) * 3_600_000 - 1,
    ouverture: c - 0.2, plusHaut: c + 0.3, plusBas: c - 0.3, cloture: c,
  }));

  it('rend tendance, dernier évènement, âge, invalidation et distance', () => {
    const ligne = ligneUnite(bougies, '1h', 2);
    expect(ligne.tendance).toBe('haussier');
    expect(ligne.evenement).toMatchObject({ sens: 'haussier' });
    // L'invalidation d'une structure haussière est le dernier creux confirmé.
    expect(ligne.invalidation).toBeCloseTo(7.7);
    expect(ligne.distance).toBeCloseTo((13.5 - 7.7) / 13.5);
    expect(ligne.ageBougies).toBeGreaterThanOrEqual(0);
    expect(ligne.nombre).toBe(prix.length);
  });

  it('rend une ligne vide plutôt qu’une erreur sans bougie', () => {
    expect(ligneUnite([], '1d', 5)).toMatchObject({ tendance: 'indetermine', nombre: 0, invalidation: null });
  });
});

describe('tableauMultiUT', () => {
  const bougies = serieAleatoire({ graine: 3, minutes: 30 * 24 * 60 });
  const aMs = bougies[20 * 24 * 60 + 37].ouvertureMs; // au milieu d'une bougie de 4 h

  it('rend une ligne par unité, de 5 min au Daily', () => {
    const t = tableauMultiUT(bougies, { aMs });
    expect(t.lignes.map((x) => x.unite)).toEqual(UNITES_MTF);
    expect(t.lignes.every((x) => x.nombre > 0)).toBe(true);
    expect(t.biais.sur).toBe(10);
    expect(typeof t.lecture.texte).toBe('string');
  });

  it('ne lit pas le futur : changer tout ce qui suit l’instant ne change rien', () => {
    const avant = tableauMultiUT(bougies, { aMs });
    const falsifiees = bougies.map((b) => (b.ouvertureMs >= aMs ? { ...b, plusHaut: b.plusHaut * 2, cloture: b.cloture * 2 } : b));
    expect(tableauMultiUT(falsifiees, { aMs })).toEqual(avant);
  });

  it('écarte la bougie de chaque unité encore en cours à l’instant', () => {
    const t = tableauMultiUT(bougies, { aMs });
    const quatre = t.lignes.find((x) => x.unite === '4h');
    const tous = tableauMultiUT(bougies, { aMs: aMs + 4 * 3_600_000 }).lignes.find((x) => x.unite === '4h');
    expect(tous.nombre).toBe(quatre.nombre + 1);
  });
});

describe('ligneUnite — points structurels', () => {
  it('porte les quatre derniers points nommés de l’unité', () => {
    const t = tableauMultiUT(serieAleatoire({ graine: 5, minutes: 10 * 24 * 60 }));
    const cinq = t.lignes.find((x) => x.unite === '5m');
    expect(cinq.points).toHaveLength(4);
    for (const p of cinq.points) expect(['H', 'L', 'HH', 'HL', 'LH', 'LL']).toContain(p.type);
  });
});
