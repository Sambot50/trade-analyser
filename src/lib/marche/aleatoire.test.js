import { describe, it, expect } from 'vitest';

import { gaussienne, serieAleatoire, enCsv, miroir, facteurInflation } from './aleatoire.js';
import { generateurAleatoire } from './controle.js';

const correlation = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

describe('gaussienne', () => {
  it('est centrée et d’écart-type un', () => {
    const alea = generateurAleatoire(42);
    const xs = Array.from({ length: 200_000 }, () => gaussienne(alea));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
    expect(Math.abs(m)).toBeLessThan(0.01);
    expect(Math.abs(sd - 1)).toBeLessThan(0.01);
  });
});

describe('serieAleatoire', () => {
  const serie = serieAleatoire({ graine: 7, minutes: 5000 });

  it('rejoue à l’identique à graine égale — un contrôle non rejouable ne prouve rien', () => {
    expect(serieAleatoire({ graine: 7, minutes: 50 }))
      .toEqual(serieAleatoire({ graine: 7, minutes: 50 }));
    expect(serieAleatoire({ graine: 8, minutes: 50 })[49].cloture)
      .not.toBe(serieAleatoire({ graine: 7, minutes: 50 })[49].cloture);
  });

  it('respecte les invariants d’une bougie', () => {
    for (const b of serie) {
      expect(b.plusHaut).toBeGreaterThanOrEqual(Math.max(b.ouverture, b.cloture));
      expect(b.plusBas).toBeLessThanOrEqual(Math.min(b.ouverture, b.cloture));
      expect(b.volume).toBeGreaterThan(0);
    }
  });

  it('ne cote qu’aux multiples du pas', () => {
    for (const b of serie.slice(0, 500)) {
      for (const p of [b.ouverture, b.plusHaut, b.plusBas, b.cloture]) {
        expect(Math.abs(p * 10 - Math.round(p * 10))).toBeLessThan(1e-6);
      }
    }
  });

  it('ne dérive pas — elle reste dans les bornes de l’aléa', () => {
    const attendu = 0.5 * Math.sqrt(serie.length);
    expect(Math.abs(serie.at(-1).cloture - 4300)).toBeLessThan(4 * attendu);
  });

  it('tire le volume INDÉPENDAMMENT du prix — c’est ce qui interdit tout avantage', () => {
    const vols = serie.map((b) => b.volume);
    const signe = serie.map((b) => b.cloture - b.ouverture);
    const ampleur = serie.map((b) => b.plusHaut - b.plusBas);
    expect(Math.abs(correlation(vols, signe))).toBeLessThan(0.05);
    expect(Math.abs(correlation(vols, ampleur))).toBeLessThan(0.05);
  });

  it('produit bien des rafales, sans quoi aucun détecteur de pic ne se déclenche', () => {
    const vols = serie.map((b) => b.volume).sort((a, b) => a - b);
    const mediane = vols[Math.floor(vols.length / 2)];
    expect(vols.at(-1) / mediane).toBeGreaterThan(4);
  });

  it('découpe en contrats et avance d’une minute par bougie', () => {
    const s = serieAleatoire({ graine: 3, minutes: 100, contrats: 3 });
    expect(s).toHaveLength(300);
    expect([...new Set(s.map((b) => b.contrat))]).toEqual([1000, 1001, 1002]);
    expect(s[1].ouvertureMs - s[0].ouvertureMs).toBe(60_000);
  });
});

describe('enCsv', () => {
  it('écrit un en-tête que le lecteur par nom reconnaît', () => {
    const lignes = enCsv(serieAleatoire({ graine: 1, minutes: 3 })).trim().split('\n');
    expect(lignes[0]).toBe('ts_event,open,high,low,close,volume,instrument_id');
    expect(lignes).toHaveLength(4);
    expect(lignes[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/);
  });
});

describe('miroir', () => {
  const serie = serieAleatoire({ graine: 11, minutes: 200 });
  const reflet = miroir(serie);

  it('échange le haut et le bas, et retourne le sens de chaque bougie', () => {
    for (let i = 0; i < serie.length; i++) {
      const a = 2 * serie[0].ouverture;
      expect(reflet[i].plusHaut).toBeCloseTo(a - serie[i].plusBas, 9);
      expect(reflet[i].plusBas).toBeCloseTo(a - serie[i].plusHaut, 9);
      // `+ 0` ramène -0 à +0 : une bougie plate reste plate, et `Object.is`
      // distingue les deux zéros là où le sens d'une bougie ne les distingue pas.
      expect(Math.sign(reflet[i].cloture - reflet[i].ouverture) + 0)
        .toBe(-Math.sign(serie[i].cloture - serie[i].ouverture) + 0);
    }
  });

  it('reste une bougie valide', () => {
    for (const b of reflet) {
      expect(b.plusHaut).toBeGreaterThanOrEqual(Math.max(b.ouverture, b.cloture));
      expect(b.plusBas).toBeLessThanOrEqual(Math.min(b.ouverture, b.cloture));
    }
  });

  it('appliqué deux fois, rend la série de départ', () => {
    const a = 2 * serie[0].ouverture;
    const retour = miroir(reflet, a);
    for (let i = 0; i < serie.length; i++) expect(retour[i].cloture).toBeCloseTo(serie[i].cloture, 9);
  });

  it('laisse le volume intact', () => {
    expect(reflet.map((b) => b.volume)).toEqual(serie.map((b) => b.volume));
  });

  it('ne bronche pas sur une série vide', () => {
    expect(miroir([])).toEqual([]);
  });
});

describe('facteurInflation', () => {
  it('rend 1 quand la dispersion observée vaut l’erreur type annoncée', () => {
    const obs = [-2, -1, 0, 1, 2];
    const r = facteurInflation(obs, obs.map(() => Math.sqrt(2.5)));
    expect(r.facteur).toBeCloseTo(1, 9);
    expect(r.moyenne).toBe(0);
    expect(r.n).toBe(5);
  });

  it('rend le rapport quand la dispersion réelle dépasse l’annoncée', () => {
    const obs = [-4, -2, 0, 2, 4];
    expect(facteurInflation(obs, obs.map(() => Math.sqrt(2.5))).facteur).toBeCloseTo(2, 9);
  });

  it('refuse de conclure sur moins de trois mesures, ou sur des tailles inégales', () => {
    expect(facteurInflation([1, 2], [1, 1])).toBeNull();
    expect(facteurInflation([1, 2, 3], [1, 1])).toBeNull();
    expect(facteurInflation([1, 2, 3], [0, 0, 0])).toBeNull();
  });
});
