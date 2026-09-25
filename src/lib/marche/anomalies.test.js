import { describe, it, expect } from 'vitest';
import {
  mediane, quantile, profilHoraire, scorerSegment, meilleurs,
  echantillonStratifie, dansFenetreMacro, tendanceSur, SEUIL_TENDANCE, DETECTEURS,
} from './anomalies.js';

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

describe('seuils des détecteurs grossiers', () => {
  /**
   * Le défaut relevé après coup : `picVolume` se déclenchait sur 3190 bougies
   * sur 3190, `gap` sur 2688. Ce n'étaient pas des détecteurs mais des
   * mesures continues — ils notaient tout le monde sans rien sélectionner.
   */
  it('picVolume se tait sous quatre fois la médiane', () => {
    expect(scoreDe({ volume: 300 }, 'picVolume')).toBe(0);
    expect(scoreDe({ volume: 450 }, 'picVolume')).toBeGreaterThan(0);
  });

  it('gap se tait sous une amplitude médiane entière', () => {
    const s = avecUneBougie({});
    // Écart de 3 pour une amplitude médiane de 10 : ce n'est pas un gap.
    s[80] = { ...s[80], ouverture: 2004 };
    expect(scorerSegment(s, { fenetre: 60 }).at(-1).scores.gap).toBe(0);

    s[80] = { ...s[80], ouverture: 2016 };
    expect(scorerSegment(s, { fenetre: 60 }).at(-1).scores.gap).toBeGreaterThan(0);
  });
});

describe('fenêtres d’annonce américaines', () => {
  it('marque 8h30, 10h00 et 14h00 à New York, heure d’été comprise', () => {
    // 8h30 New York : 13h30 UTC en hiver, 12h30 en été.
    expect(dansFenetreMacro(Date.parse('2023-01-15T13:30:00Z'))).toBe(true);
    expect(dansFenetreMacro(Date.parse('2023-07-15T12:30:00Z'))).toBe(true);
    // 10h00 et 14h00 New York, en été.
    expect(dansFenetreMacro(Date.parse('2023-07-15T14:00:00Z'))).toBe(true);
    expect(dansFenetreMacro(Date.parse('2023-07-15T18:00:00Z'))).toBe(true);
  });

  it('ne marque pas une heure ordinaire', () => {
    expect(dansFenetreMacro(Date.parse('2023-07-15T09:00:00Z'))).toBe(false);
    expect(dansFenetreMacro(Date.parse('2023-07-15T16:00:00Z'))).toBe(false);
  });

  it('couvre quelques minutes avant et un quart d’heure après', () => {
    expect(dansFenetreMacro(Date.parse('2023-07-15T12:29:00Z'))).toBe(true);
    expect(dansFenetreMacro(Date.parse('2023-07-15T12:45:00Z'))).toBe(true);
    expect(dansFenetreMacro(Date.parse('2023-07-15T12:46:00Z'))).toBe(false);
  });

  it('accompagne chaque bougie scorée', () => {
    const r = scorerSegment(avecUneBougie({ volume: 900 }), { fenetre: 60 });
    expect(typeof r.at(-1).mesures.macro).toBe('boolean');
  });
});

describe('échantillonnage stratifié', () => {
  const faux = (ms, score) => ({
    ms, index: 0, mesures: {},
    scores: Object.fromEntries(DETECTEURS.map((d) => [d, d === 'picVolume' ? score : 0])),
  });
  // Cent candidats de scores 1 à 100, espacés d'une journée.
  const cent = Array.from({ length: 100 }, (_, i) => faux(i * 86_400_000, i + 1));

  it('puise dans les quatre bandes, pas seulement au sommet', () => {
    const r = echantillonStratifie(cent, 'picVolume', { nombre: 8 });
    expect(new Set(r.map((x) => x.bande))).toEqual(new Set(['sommet', 'haut', 'milieu', 'bas']));
  });

  it('dit d’où vient chaque candidat', () => {
    const r = echantillonStratifie(cent, 'picVolume', { nombre: 4 });
    const sommet = r.filter((x) => x.bande === 'sommet');
    const bas = r.filter((x) => x.bande === 'bas');
    expect(sommet[0].scores.picVolume).toBeGreaterThan(bas[0].scores.picVolume);
  });

  it('retient le maximum, qui n’appartiendrait sinon à aucune bande', () => {
    const r = echantillonStratifie(cent, 'picVolume', { nombre: 8 });
    expect(r.some((x) => x.scores.picVolume === 100)).toBe(true);
  });

  it('respecte l’écart minimal entre deux retenus', () => {
    const groupes = [faux(0, 100), faux(60_000, 99), faux(120_000, 98)];
    const r = echantillonStratifie(groupes, 'picVolume', { nombre: 8, ecartMinimalMs: 30 * 60_000 });
    expect(r).toHaveLength(1);
  });

  it('rend une liste vide quand rien ne se déclenche', () => {
    expect(echantillonStratifie([faux(0, 0)], 'picVolume', { nombre: 8 })).toHaveLength(0);
  });

  it('refuse un détecteur inconnu', () => {
    expect(() => echantillonStratifie([], 'intuition', {})).toThrow(/Détecteur inconnu/);
  });
});


describe('sens dominant, par proxy', () => {
  const sensDe = (speciale) => scorerSegment(avecUneBougie(speciale), { fenetre: 60 }).at(-1).mesures.sens;

  it('lit l’achat sur une clôture au-dessus de l’ouverture', () => {
    expect(sensDe({ ouverture: 1990, cloture: 2010, volume: 900 })).toBe('achat');
  });

  it('lit la vente sur une clôture en dessous', () => {
    expect(sensDe({ ouverture: 2010, cloture: 1990, volume: 900 })).toBe('vente');
  });

  /**
   * La bougie plate est le cas où le proxy n'a rien à dire. On le nomme au
   * lieu de trancher au hasard : `ohlcv-1m` ne porte pas le côté agresseur,
   * seul le schéma `trades` le donne.
   */
  it('ne tranche pas une clôture égale à l’ouverture', () => {
    expect(sensDe({ ouverture: 2000, cloture: 2000, volume: 900 })).toBe('neutre');
  });
});


describe('tendance à l’échelle du jour et de la semaine', () => {
  const JOUR = 24 * 3_600_000;
  const quartHeure = (i, cloture) => ({
    ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
    ouverture: cloture, plusHaut: cloture, plusBas: cloture, cloture, volume: 100,
  });
  // 800 quarts d'heure : huit jours et demi.
  const serieDe = (f) => Array.from({ length: 800 }, (_, i) => quartHeure(i, f(i)));

  it('lit la hausse et la baisse à chaque échelle', () => {
    const monte = serieDe((i) => 2000 + i * 0.5);
    const descend = serieDe((i) => 2000 - i * 0.5);
    expect(tendanceSur(monte, 799, JOUR)).toBe('haussiere');
    expect(tendanceSur(monte, 799, 7 * JOUR)).toBe('haussiere');
    expect(tendanceSur(descend, 799, 7 * JOUR)).toBe('baissiere');
  });

  /**
   * Un marché qui a bougé d'un dixième de pour cent n'est ni haussier ni
   * baissier. Lui coller une étiquette fabriquerait une moitié des cas au
   * hasard.
   */
  it('rend « plate » sous le seuil plutôt que de trancher au hasard', () => {
    const presquePlate = serieDe((i) => 2000 * (1 + (i / 799) * SEUIL_TENDANCE * 0.5));
    expect(tendanceSur(presquePlate, 799, 7 * JOUR)).toBe('plate');
  });

  it('franchit le seuil juste au-dessus', () => {
    const juste = serieDe((i) => 2000 * (1 + (i / 799) * SEUIL_TENDANCE * 2));
    expect(tendanceSur(juste, 799, 7 * JOUR)).toBe('haussiere');
  });

  /**
   * Sans historique suffisant, comparer à la première bougie disponible
   * donnerait une tendance sur deux heures en la nommant « semaine ».
   */
  it('rend « indetermine » quand l’historique manque', () => {
    const monte = serieDe((i) => 2000 + i * 0.5);
    expect(tendanceSur(monte, 50, 7 * JOUR)).toBe('indetermine');
    expect(tendanceSur(monte, 5, JOUR)).toBe('indetermine');
  });

  it('accompagne chaque bougie scorée', () => {
    const r = scorerSegment(avecUneBougie({ volume: 900 }), { fenetre: 60 });
    expect(['haussiere', 'baissiere', 'plate', 'indetermine']).toContain(r.at(-1).mesures.tendanceJour);
    expect(['haussiere', 'baissiere', 'plate', 'indetermine']).toContain(r.at(-1).mesures.tendanceSemaine);
  });
});
