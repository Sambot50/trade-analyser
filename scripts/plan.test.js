import { describe, it, expect } from 'vitest';

import { rapportDeVolume, parcourir, resumerSeau } from './plan.mjs';

const OPTIONS = { h1: 4, h4: 16, fenetre: 60, taille: 2000, minimum: 150, pas: 0.1 };

/** Série déterministe : prix oscillant, volume à rafales, sans aléa. */
function serieDeTest(n) {
  const s = [];
  let prix = 4300;
  for (let i = 0; i < n; i++) {
    // Somme de sinus incommensurables : ni périodique ni prévisible pour la règle.
    prix += 1.7 * Math.sin(i / 11) + 1.1 * Math.sin(i / 3.7) + 0.6 * Math.sin(i / 29);
    const amplitude = 1 + 2 * Math.abs(Math.sin(i / 5.3));
    s.push({
      ouvertureMs: i * 900_000,
      ouverture: prix - 0.2,
      plusHaut: prix + amplitude,
      plusBas: prix - amplitude,
      cloture: prix,
      volume: Math.round(100 * (1 + 3 * Math.abs(Math.sin(i / 7.1)) ** 4)),
    });
  }
  return s;
}

describe('rapportDeVolume', () => {
  const s = (...volumes) => volumes.map((volume) => ({ volume }));

  it('divise par la médiane des bougies PRÉCÉDENTES, la courante exclue', () => {
    // Fenêtre 4 : volumes 10, 20, 30, 40 → médiane 25. Bougie à 50 → 2×.
    expect(rapportDeVolume(s(10, 20, 30, 40, 50), 4, 4)).toBeCloseTo(2, 9);
  });

  it('prend bien la médiane, pas la moyenne', () => {
    // 1, 1, 1, 1, 996 : moyenne 200, médiane 1. La bougie à 5 vaut 5×, pas 0,025×.
    expect(rapportDeVolume(s(1, 1, 1, 996, 1, 5), 5, 5)).toBeCloseTo(5, 9);
  });

  it('interpole la médiane sur une fenêtre paire', () => {
    expect(rapportDeVolume(s(10, 20, 30, 40, 60), 4, 4)).toBeCloseTo(60 / 25, 9);
  });

  it('refuse de conclure sans fenêtre complète', () => {
    expect(rapportDeVolume(s(10, 20, 30), 2, 60)).toBeNull();
    expect(rapportDeVolume(s(0, 0, 0, 0, 5), 4, 4)).toBeNull();     // médiane nulle
  });
});

describe('parcourir — aucune lecture du futur', () => {
  // LE test de cette branche. Les quantiles qui fixent stop et objectif ne
  // doivent dépendre que du passé. S'ils touchaient une seule bougie à venir,
  // la mesure s'ajusterait sur ce qu'elle prétend mesurer, et le chiffre
  // sortirait flatteur et faux.
  //
  // Vérification : rejouer une série TRONQUÉE. Si la règle ne lit que le
  // passé, chaque trade de la série courte doit se retrouver, identique et
  // dans le même ordre, au début de la série longue.
  const longue = serieDeTest(3000);
  const courte = longue.slice(0, 1800);

  const jouer = (serie) => { const m = new Map(); parcourir(serie, m, OPTIONS); return m; };
  const seauxLongs = jouer(longue);
  const seauxCourts = jouer(courte);

  it('produit des trades — sans quoi le test ne prouverait rien', () => {
    const total = [...seauxCourts.values()].reduce((a, s) => a + s.R.length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it('rend exactement les mêmes trades au début de la série longue', () => {
    for (const [cle, court] of seauxCourts) {
      const long = seauxLongs.get(cle);
      expect(long, `tranche ${cle} absente de la série longue`).toBeDefined();
      expect(long.R.length).toBeGreaterThanOrEqual(court.R.length);
      expect(long.R.slice(0, court.R.length)).toEqual(court.R);
      expect(long.stops.slice(0, court.stops.length)).toEqual(court.stops);
      expect(long.objectifs.slice(0, court.objectifs.length)).toEqual(court.objectifs);
    }
  });

  it('résiste à un futur saccagé — le passé déjà joué ne bouge pas', () => {
    const saccagee = [...longue];
    for (let i = 1800; i < saccagee.length; i++) {
      const p = 99_999;
      saccagee[i] = { ...saccagee[i], ouverture: p, plusHaut: p + 500, plusBas: p - 500, cloture: p, volume: 9_000_000 };
    }
    const seaux = jouer(saccagee);
    for (const [cle, court] of seauxCourts) {
      const abime = seaux.get(cle);
      expect(abime.R.slice(0, court.R.length)).toEqual(court.R);
    }
  });
});

describe('parcourir — comptage', () => {
  const seaux = new Map();
  parcourir(serieDeTest(3000), seaux, OPTIONS);

  it('joue les deux sens sur chaque bougie retenue', () => {
    const achats = [...seaux].filter(([c]) => c.endsWith('|1'));
    const ventes = [...seaux].filter(([c]) => c.endsWith('|-1'));
    expect(achats.length).toBeGreaterThan(0);
    expect(achats.length).toBe(ventes.length);
  });

  it('range chaque position dans une issue et une seule', () => {
    for (const [, s] of seaux) {
      expect(s.objectif + s.stop + s.seuilNul + s.temps + s.ambigu).toBe(s.n);
      expect(s.R.length).toBe(s.n - s.ambigu);
      expect(s.couts.length).toBe(s.R.length);
    }
  });

  it('ne donne jamais un R au-dessous de −1 : le stop est le plancher', () => {
    for (const [, s] of seaux) for (const R of s.R) expect(R).toBeGreaterThanOrEqual(-1);
  });
});

describe('resumerSeau', () => {
  const seau = {
    n: 10, objectif: 4, stop: 3, seuilNul: 1, temps: 1, ambigu: 1,
    R: [1.5, 1.5, 1.5, 1.5, -1, -1, -1, 0, 0.2],
    couts: Array(9).fill(0.05), stops: Array(9).fill(0.3), objectifs: Array(9).fill(0.45),
  };

  it('sépare l’espérance brute de la nette', () => {
    const r = resumerSeau(seau);
    expect(r.ev).toBeCloseTo(3.2 / 9, 9);
    expect(r.cout).toBeCloseTo(0.05, 9);
    expect(r.evNette).toBeCloseTo(3.2 / 9 - 0.05, 9);
  });

  it('compte les parts sur TOUTES les positions, ambigus compris', () => {
    const r = resumerSeau(seau);
    expect(r.partObjectif).toBeCloseTo(40, 9);
    expect(r.partAmbigu).toBeCloseTo(10, 9);
    expect(r.resolus).toBe(9);
    expect(r.n).toBe(10);
  });

  it('rend null sur un seau sans position résolue', () => {
    expect(resumerSeau(null)).toBeNull();
    expect(resumerSeau({ ...seau, R: [] })).toBeNull();
  });
});
