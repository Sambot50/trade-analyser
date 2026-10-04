import { describe, it, expect } from 'vitest';

import { mesurer, temoin, rendre } from './ranges.mjs';
import { serieAleatoire } from '../src/lib/marche/aleatoire.js';

describe('mesurer', () => {
  const bougies = serieAleatoire({ graine: 3, minutes: 6000, sigma: 0.4 });

  it('rend les ranges, ceux qui sont sortis, et leurs issues', () => {
    const m = mesurer(bougies);
    expect(m.bougies).toBe(bougies.length);
    expect(m.ranges).toBeGreaterThan(0);
    expect(m.sortis).toBeLessThanOrEqual(m.ranges);
    expect(m.issues).toHaveLength(m.sortis);
  });

  it('EXCLUT du taux les ranges encore ouverts', () => {
    // Un range qui n'est pas sorti n'a rien échoué : le compter ferait baisser
    // le taux à mesure qu'on détecte, exactement comme les zones en attente du
    // journal.
    const m = mesurer(bougies);
    expect(m.stats.tranches).toBeLessThanOrEqual(m.sortis);
  });

  it('serre quand on durcit le seuil de compression', () => {
    // Un seuil plus bas exige une compression plus franche : moins de ranges.
    const large = mesurer(bougies, { seuil: 0.8 });
    const serre = mesurer(bougies, { seuil: 0.35 });
    expect(serre.ranges).toBeLessThan(large.ranges);
  });
});

describe('temoin', () => {
  it('agrège plusieurs graines, pour ne pas conclure d’une seule', () => {
    // Une graine unique donnerait un chiffre, pas une référence. La dispersion
    // entre graines est précisément ce qu'on veut voir disparaître.
    const t = temoin({}, { graines: 3, minutes: 5000 });
    expect(t.stats.tranches).toBeGreaterThan(10);
    expect(t.stats.tauxContinuation).toBeGreaterThan(0);
    expect(t.stats.tauxContinuation).toBeLessThan(1);
  });
});

describe('rendre', () => {
  it('affiche l’intervalle, pas seulement le taux', () => {
    // Un taux sans intervalle invite à comparer deux chiffres qui se
    // recouvrent largement, et à y voir un écart.
    const ligne = rendre('réel', { tranches: 100, continuation: 40, retour: 60, indecis: 7, tauxContinuation: 0.4 }, 120);
    expect(ligne).toMatch(/40\.0 %/);
    expect(ligne).toMatch(/\[.*–.*\]/);
    expect(ligne).toMatch(/7 indécis/);
    expect(ligne).toMatch(/120 ranges/);
  });

  it('écrit un tiret plutôt qu’un faux zéro quand rien n’est tranché', () => {
    const ligne = rendre('vide', { tranches: 0, continuation: 0, retour: 0, indecis: 3, tauxContinuation: null });
    expect(ligne).toMatch(/—/);
    expect(ligne).not.toMatch(/0\.0 %/);
  });
});
