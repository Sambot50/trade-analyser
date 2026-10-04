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

// ── Vérifier l'instrument avant de lui faire confiance ──────────────────────

import { facteurDeDispersion, parBlocs } from './ranges.mjs';

/** Un générateur reproductible, pour que l'assertion ne dépende pas du hasard. */
function groupesIndependants({ k, n, p, graine = 12345 }) {
  let g = graine;
  const alea = () => { g = (g * 1103515245 + 12345) % 2147483648; return g / 2147483648; };
  return Array.from({ length: k }, () => {
    let c = 0;
    for (let j = 0; j < n; j++) if (alea() < p) c++;
    return { tranches: n, continuation: c, retour: n - c, indecis: 0, tauxContinuation: c / n };
  });
}

describe('facteurDeDispersion — l’instrument, mesuré sur ce dont on connaît la réponse', () => {
  it('rend environ 1 sur des groupes VRAIMENT indépendants', () => {
    // C'est la vérification qui autorise à se servir du reste. Si l'instrument
    // rendait 3 sur des données indépendantes, un facteur de 3 sur des données
    // réelles ne prouverait rien du tout.
    //
    // Il rend 0,94 et non 1,00 : l'écart type d'un petit échantillon
    // sous-estime légèrement la vraie dispersion. C'est une propriété connue
    // de l'estimateur, pas un résultat.
    const f = [];
    for (let graine = 1; graine <= 20; graine++) {
      f.push(facteurDeDispersion(groupesIndependants({ k: 30, n: 150, p: 0.355, graine })).facteur);
    }
    const moyenne = f.reduce((a, b) => a + b, 0) / f.length;
    expect(moyenne).toBeGreaterThan(0.8);
    expect(moyenne).toBeLessThan(1.15);
  });

  it('DÉTECTE une dépendance quand on en fabrique une', () => {
    // Des groupes dont le taux est tiré autour d'une valeur qui bouge d'un
    // groupe à l'autre : c'est ce que produit un marché commun poussant toute
    // une grappe d'issues dans le même sens.
    let g = 999;
    const alea = () => { g = (g * 1103515245 + 12345) % 2147483648; return g / 2147483648; };
    const groupes = Array.from({ length: 30 }, () => {
      const p = 0.355 + (alea() - 0.5) * 0.4;    // le taux lui-même dérive
      let c = 0;
      for (let j = 0; j < 150; j++) if (alea() < p) c++;
      return { tranches: 150, continuation: c, tauxContinuation: c / 150 };
    });
    expect(facteurDeDispersion(groupes).facteur).toBeGreaterThan(2);
  });

  it('refuse de conclure sous trois groupes', () => {
    expect(facteurDeDispersion(groupesIndependants({ k: 2, n: 100, p: 0.4 }))).toBeNull();
    expect(facteurDeDispersion([])).toBeNull();
  });

  it('ignore les groupes où rien n’est tranché', () => {
    const avec = [...groupesIndependants({ k: 5, n: 100, p: 0.4 }),
      { tranches: 0, continuation: 0, tauxContinuation: null }];
    expect(facteurDeDispersion(avec).groupes).toBe(5);
  });
});

describe('parBlocs', () => {
  const bougies = serieAleatoire({ graine: 11, minutes: 30_000, sigma: 0.4 });

  it('découpe en blocs DISJOINTS, mesurés séparément', () => {
    // Des blocs qui se chevaucheraient reproduiraient le défaut qu'on cherche
    // à mesurer, et le facteur trouvé vaudrait 1 par construction.
    const r = parBlocs(bougies, {}, 6);
    expect(r.blocs).toHaveLength(6);
    expect(r.dispersion.groupes).toBeLessThanOrEqual(6);
  });

  it('refuse une série trop courte pour être découpée', () => {
    expect(parBlocs(bougies.slice(0, 200), {}, 8)).toBeNull();
  });
});
