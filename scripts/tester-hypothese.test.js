import { describe, it, expect } from 'vitest';
import { separer, pDeLHypothese, verdict, MINIMUM_AU_DESSUS } from './tester-hypothese.mjs';

/** n cas dont `gagnants` gagnent, tous à la valeur `v`. */
const groupe = (n, gagnants, v) =>
  Array.from({ length: n }, (_, i) => ({ gagne: i < gagnants, zoneSurAtr: v }));

describe('separer', () => {
  it('coupe au seuil, borne incluse en haut', () => {
    const cas = [...groupe(10, 5, 1.0), ...groupe(10, 5, 1.5), ...groupe(10, 5, 1.1915)];
    const r = separer(cas, 'zoneSurAtr', 1.1915);
    expect(r.auDessus).toHaveLength(20);
    expect(r.enDessous).toHaveLength(10);
  });

  it('écarte les cas où la variable est absente', () => {
    const cas = [...groupe(10, 5, 2), ...Array.from({ length: 5 }, () => ({ gagne: true, zoneSurAtr: null }))];
    expect(separer(cas, 'zoneSurAtr', 1).utilisables).toHaveLength(10);
  });
});

describe('pDeLHypothese', () => {
  it('rend un p élevé quand la variable ne sépare rien', () => {
    // Issues indépendantes de la variable : une seule hypothèse testée, donc
    // pas de correction familiale — mais le p doit quand même dire non.
    const cas = Array.from({ length: 300 }, (_, i) => ({ gagne: i % 2 === 0, zoneSurAtr: (i * 7) % 100 / 50 }));
    const r = pDeLHypothese(cas, 'zoneSurAtr', 1, 0.5, 200, 3);
    expect(r.p).toBeGreaterThan(0.1);
  });

  it('rend un p au plancher quand la séparation est franche', () => {
    const cas = [...groupe(150, 120, 2.0), ...groupe(150, 30, 0.5)];
    const r = pDeLHypothese(cas, 'zoneSurAtr', 1, 10, 100, 1);
    expect(r.p).toBeCloseTo(1 / 101, 4);
  });

  it('ne descend jamais à zéro', () => {
    const cas = [...groupe(60, 60, 2.0), ...groupe(60, 0, 0.5)];
    expect(pDeLHypothese(cas, 'zoneSurAtr', 1, 99, 50, 1).p).toBeCloseTo(1 / 51, 4);
  });
});

describe('verdict — la règle de DEC-024, sans négociation', () => {
  const comparaison = (ecart) => ({ ecart });

  it('laisse survivre un écart positif et significatif', () => {
    expect(verdict({ comparaison: comparaison(0.2), p: 0.01, nAuDessus: 80 }).issue).toBe('survit');
  });

  it('abandonne dès que p atteint 0,05', () => {
    expect(verdict({ comparaison: comparaison(0.2), p: 0.05, nAuDessus: 80 }).issue).toBe('abandon');
    expect(verdict({ comparaison: comparaison(0.2), p: 0.0547, nAuDessus: 80 }).issue).toBe('abandon');
  });

  it('abandonne aussi sur un écart inversé, même très significatif', () => {
    // Un effet de signe opposé n'est pas une confirmation, et c'est
    // précisément le moment où l'on serait tenté de réécrire l'hypothèse.
    expect(verdict({ comparaison: comparaison(-0.3), p: 0.0001, nAuDessus: 80 }).issue).toBe('abandon');
  });

  it('ne conclut pas sous le minimum de cas', () => {
    const v = verdict({ comparaison: comparaison(0.3), p: 0.001, nAuDessus: MINIMUM_AU_DESSUS - 1 });
    expect(v.issue).toBe('non_concluant');
  });

  it('exige au moins 40 cas au-dessus du seuil', () => {
    expect(MINIMUM_AU_DESSUS).toBe(40);
  });
});
