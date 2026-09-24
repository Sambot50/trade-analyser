import { describe, it, expect } from 'vitest';
import { decouperParContrat, minimumPourResoudre } from './contrats.js';

const b = (i, symbole) => ({
  ouvertureMs: i * 60_000,
  fermetureMs: i * 60_000 + 59_999,
  ouverture: 100, plusHaut: 101, plusBas: 99, cloture: 100, volume: 10,
  symbole,
});
const serie = (...paires) => paires.flatMap(([symbole, n], bloc) =>
  Array.from({ length: n }, (_, k) => b(bloc * 1000 + k, symbole)));

describe('découpage par contrat', () => {
  it('coupe là où le contrat change, et nulle part ailleurs', () => {
    const { segments } = decouperParContrat(serie(['GCG4', 3], ['GCJ4', 2], ['GCM4', 4]));
    expect(segments.map((s) => [s.symbole, s.nombre])).toEqual([['GCG4', 3], ['GCJ4', 2], ['GCM4', 4]]);
  });

  it('rend un segment unique, de contrat null, sur une série qui n’en nomme aucun', () => {
    const { segments } = decouperParContrat(serie([null, 5]));
    expect(segments).toHaveLength(1);
    expect(segments[0].symbole).toBeNull();
    expect(segments[0].nombre).toBe(5);
  });

  it('borne chaque segment sur ses propres bougies', () => {
    const { segments } = decouperParContrat(serie(['A', 2], ['B', 2]));
    expect(segments[0].debutMs).toBe(segments[0].bougies[0].ouvertureMs);
    expect(segments[0].finMs).toBe(segments[0].bougies.at(-1).fermetureMs);
    expect(segments[1].debutMs).toBeGreaterThan(segments[0].finMs);
  });

  /**
   * Un roulement au volume peut osciller entre deux contrats sur quelques
   * bougies. Ces miettes ne peuvent héberger aucun order block résoluble.
   */
  it('écarte les segments trop courts, et dit lesquels', () => {
    const { segments, ecartes } = decouperParContrat(
      serie(['A', 50], ['B', 2], ['A', 50]),
      { minimumBougies: 10 },
    );
    expect(segments.map((s) => s.nombre)).toEqual([50, 50]);
    expect(ecartes).toHaveLength(1);
    expect(ecartes[0].symbole).toBe('B');
    expect(ecartes[0].nombre).toBe(2);
  });

  it('ne recolle jamais deux passages du même contrat', () => {
    const { segments } = decouperParContrat(serie(['A', 3], ['B', 3], ['A', 3]));
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.symbole)).toEqual(['A', 'B', 'A']);
  });

  it('refuse une série partiellement étiquetée plutôt que de couper au hasard', () => {
    expect(() => decouperParContrat(serie(['A', 2], [null, 2])))
      .toThrow(/partiellement étiquetée/);
  });

  it('refuse une série désordonnée', () => {
    const s = serie(['A', 3]);
    expect(() => decouperParContrat([s[2], s[0], s[1]])).toThrow(/non chronologique/);
  });

  it('rend des listes vides sur une série vide', () => {
    expect(decouperParContrat([])).toEqual({ segments: [], ecartes: [] });
  });
});

describe('minimumPourResoudre', () => {
  it('compte la fenêtre de détection ET tout l’horizon', () => {
    // 12 bougies 1 h pour le pivot et la cassure, plus 48 h d'horizon,
    // soit 60 h, soit 3600 bougies 1 minute.
    expect(minimumPourResoudre({
      fenetre: 5, dureeDetectionMs: 3_600_000, horizonHeures: 48, dureeFineMs: 60_000,
    })).toBe(3600);
  });

  it('refuse une durée fine nulle', () => {
    expect(() => minimumPourResoudre({
      fenetre: 5, dureeDetectionMs: 3_600_000, horizonHeures: 48, dureeFineMs: 0,
    })).toThrow(/strictement positive/);
  });
});
