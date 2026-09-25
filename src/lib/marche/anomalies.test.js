import { describe, it, expect } from 'vitest';
import { mediane, quantile, profilHoraire, scorerSegment, meilleurs, DETECTEURS } from './anomalies.js';

/** Bougie calme de référence : amplitude 10, volume 100. */
const calme = (i) => ({
  ouvertureMs: i * 300_000,
  fermetureMs: i * 300_000 + 299_999,
  ouverture: 2000, plusHaut: 2005, plusBas: 1995, cloture: 2001, volume: 100,
});

/** 80 bougies calmes, puis une bougie particulière à l'indice 80. */
const avecUneBougie = (speciale) => {
  const s = Array.from({ length: 81 }, (_, i) => calme(i));
  s[80] = { ...s[80], ...speciale };
  return s;
};
const scoreDe = (speciale, detecteur) => {
  const r = scorerSegment(avecUneBougie(speciale), { fenetre: 60 });
  return r.at(-1).scores[detecteur];
};

describe('quantiles', () => {
  it('rend la médiane sur un nombre pair et impair', () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 2, 3])).toBe(2.5);
  });

  it('interpole entre deux valeurs', () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
  });

  it('ne modifie pas le tableau reçu', () => {
    const v = [3, 1, 2];
    mediane(v);
    expect(v).toEqual([3, 1, 2]);
  });

  it('rend null sur un tableau vide', () => {
    expect(mediane([])).toBeNull();
  });
});

describe('absorption — gros volume, prix immobile', () => {
  it('se déclenche quand le volume monte et l’amplitude reste basse', () => {
    expect(scoreDe({ plusHaut: 2002, plusBas: 1998, volume: 600 }, 'absorption')).toBeGreaterThan(0);
  });

  /**
   * Le défaut trouvé à la première exécution : sans plancher d'amplitude, un
   * volume à 11× la médiane l'emportait sur une amplitude à 2×, et le
   * détecteur classait en tête des bougies LARGES — le contraire de son nom.
   */
  it('ne se déclenche pas sur une bougie large, si gros que soit le volume', () => {
    expect(scoreDe({ plusHaut: 2060, plusBas: 1940, volume: 5000 }, 'absorption')).toBe(0);
  });

  it('ignore une bougie étroite au volume ordinaire', () => {
    expect(scoreDe({ plusHaut: 2001, plusBas: 1999, volume: 110 }, 'absorption')).toBe(0);
  });
});

describe('déplacement — gros volume, grande amplitude, corps plein', () => {
  it('se déclenche sur une grande bougie pleine et volumineuse', () => {
    expect(scoreDe({ ouverture: 1960, plusHaut: 2062, plusBas: 1958, cloture: 2060, volume: 900 }, 'deplacement'))
      .toBeGreaterThan(10);
  });

  it('reste bas sur une grande bougie sans corps', () => {
    const plein = scoreDe({ ouverture: 1960, plusHaut: 2062, plusBas: 1958, cloture: 2060, volume: 900 }, 'deplacement');
    const creux = scoreDe({ ouverture: 2010, plusHaut: 2062, plusBas: 1958, cloture: 2011, volume: 900 }, 'deplacement');
    expect(creux).toBeLessThan(plein / 5);
  });
});

describe('rejet — grosse mèche', () => {
  it('se déclenche quand la mèche occupe la bougie', () => {
    expect(scoreDe({ ouverture: 2050, plusHaut: 2055, plusBas: 1950, cloture: 2048, volume: 800 }, 'rejet'))
      .toBeGreaterThan(0);
  });

  it('ne se déclenche pas sous le seuil de mèche', () => {
    expect(scoreDe({ ouverture: 1960, plusHaut: 2062, plusBas: 1958, cloture: 2060, volume: 900 }, 'rejet')).toBe(0);
  });
});

describe('garde-fous du scoring', () => {
  it('exige un volume au moins double de la médiane', () => {
    for (const d of ['absorption', 'deplacement', 'rejet']) {
      expect(scoreDe({ plusHaut: 2001, plusBas: 1999, volume: 150 }, d)).toBe(0);
    }
  });

  it('ne score pas les bougies sans assez de passé', () => {
    expect(scorerSegment(Array.from({ length: 40 }, (_, i) => calme(i)), { fenetre: 60 })).toHaveLength(0);
  });

  it('plafonne l’amplitude nulle plutôt que de rendre un score infini', () => {
    const s = scoreDe({ ouverture: 2000, plusHaut: 2000, plusBas: 2000, cloture: 2000, volume: 900 }, 'absorption');
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });
});

describe('profil horaire', () => {
  /**
   * « Sous la moyenne » qualifierait la moitié des heures de la journée.
   * On cherche les heures structurellement vides, donc le premier quartile.
   */
  it('ne retient que le quartile le plus creux', () => {
    const bougies = [];
    for (let h = 0; h < 24; h++) {
      for (let k = 0; k < 5; k++) {
        bougies.push({ ...calme(0), ouvertureMs: Date.UTC(2024, 0, 1, h, k * 5), volume: (h + 1) * 100 });
      }
    }
    const { seuilCreux, medianes } = profilHoraire(bougies);
    const creuses = [...medianes.values()].filter((v) => v < seuilCreux).length;
    expect(creuses).toBeGreaterThan(3);
    expect(creuses).toBeLessThan(9);
  });
});

describe('sélection des meilleurs', () => {
  const faux = (ms, score) => ({ ms, index: 0, mesures: {}, scores: Object.fromEntries(DETECTEURS.map((d) => [d, d === 'picVolume' ? score : 0])) });

  it('classe par score décroissant', () => {
    const r = meilleurs([faux(0, 3), faux(10 * 60_000_000, 9), faux(20 * 60_000_000, 6)], 'picVolume', { nombre: 3 });
    expect(r.map((x) => x.scores.picVolume)).toEqual([9, 6, 3]);
  });

  /**
   * Un pic s'étale sur plusieurs bougies : sans dédoublonnage, les vingt
   * premiers seraient deux évènements vus dix fois.
   */
  it('écarte un candidat trop proche d’un déjà retenu', () => {
    const r = meilleurs([faux(0, 9), faux(60_000, 8), faux(3 * 3_600_000, 7)], 'picVolume', {
      nombre: 10, ecartMinimalMs: 30 * 60_000,
    });
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.ms)).toEqual([0, 3 * 3_600_000]);
  });

  it('ignore les scores nuls', () => {
    expect(meilleurs([faux(0, 0)], 'picVolume', { nombre: 5 })).toHaveLength(0);
  });

  it('refuse un détecteur inconnu', () => {
    expect(() => meilleurs([], 'intuition', {})).toThrow(/Détecteur inconnu/);
  });
});
