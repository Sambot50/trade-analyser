import { describe, it, expect } from 'vitest';
import { tracerGraphique, repereDePrix, GEOMETRIE } from './graphique.js';
import { priceToY, validateScale } from '../analysis.js';

const bougie = (i, { o = 2000, h = 2005, l = 1995, c = 2002, v = 100 } = {}) => ({
  ouvertureMs: i * 3_600_000,
  fermetureMs: i * 3_600_000 + 3_599_999,
  ouverture: o, plusHaut: h, plusBas: l, cloture: c, volume: v,
});
const serie = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => bougie(i, f(i)));

describe('repère de prix', () => {
  it('englobe toutes les bougies, avec une marge', () => {
    const e = repereDePrix(serie(10, (i) => ({ h: 2000 + i, l: 1900 - i })));
    expect(e.priceTop).toBeGreaterThan(2009);
    expect(e.priceBottom).toBeLessThan(1891);
  });

  it('est accepté par le validateur de l’application', () => {
    expect(validateScale(repereDePrix(serie(10))).ok).toBe(true);
  });

  /**
   * Le point qui justifie ce module. Le modèle ne lit plus l'axe : on lui donne
   * ce repère. Il doit donc projeter EXACTEMENT comme le reste de l'app, sinon
   * les niveaux qu'il rend tomberaient à côté.
   */
  it('projette comme `priceToY`, au pixel près, aux deux bornes', () => {
    const e = repereDePrix(serie(10));
    expect(priceToY(e.priceTop, e, GEOMETRIE.hauteur)).toBeCloseTo(GEOMETRIE.hautY, 6);
    expect(priceToY(e.priceBottom, e, GEOMETRIE.hauteur)).toBeCloseTo(GEOMETRIE.basSansVolume, 6);
  });

  it('réserve un panneau au volume quand il y en a un', () => {
    const avec = repereDePrix(serie(10), { avecVolume: true });
    expect(priceToY(avec.priceBottom, avec, GEOMETRIE.hauteur)).toBeCloseTo(GEOMETRIE.basAvecVolume, 6);
  });

  it('ne divise pas par zéro sur une série parfaitement plate', () => {
    const e = repereDePrix(serie(5, () => ({ h: 2000, l: 2000, o: 2000, c: 2000 })));
    expect(e.priceTop).toBeGreaterThan(e.priceBottom);
  });

  it('refuse une série vide plutôt que de tracer du vide', () => {
    expect(() => repereDePrix([])).toThrow(/Aucune bougie/);
  });
});

describe('tracé', () => {
  /**
   * L'invariant qui protège toute la mesure à venir : l'image ne montre QUE
   * les bougies fournies. Une seule bougie du futur, et le modèle lirait la
   * réponse au lieu de la prédire.
   */
  it('dessine exactement autant de corps que de bougies, jamais un de plus', () => {
    for (const n of [5, 40, 120]) {
      const { svg } = tracerGraphique(serie(n), { libelle: 'GC' });
      const corps = svg.match(/<rect x=/g) ?? [];
      // Un corps par bougie, plus une barre de volume par bougie.
      expect(corps).toHaveLength(2 * n);
    }
  });

  it('rend l’échelle exactement utilisée pour dessiner', () => {
    const r = tracerGraphique(serie(20), { libelle: 'GC' });
    expect(validateScale(r.echelle).ok).toBe(true);
    expect(r.nombreBougies).toBe(20);
  });

  it('est déterministe : mêmes bougies, même image', () => {
    const a = tracerGraphique(serie(30), { libelle: 'GC', unite: '1h' });
    const b = tracerGraphique(serie(30), { libelle: 'GC', unite: '1h' });
    expect(a.svg).toBe(b.svg);
  });

  it('trace le volume quand il existe, et s’en passe sinon', () => {
    expect(tracerGraphique(serie(10), { libelle: 'X' }).avecVolume).toBe(true);
    const sans = tracerGraphique(serie(10, () => ({ v: 0 })), { libelle: 'X' });
    expect(sans.avecVolume).toBe(false);
    expect(sans.svg).not.toContain('Volume');
  });

  it('garde chaque mèche dans la zone de tracé', () => {
    const bougies = serie(50, (i) => ({ h: 2000 + i * 3, l: 1900 - i * 2 }));
    const r = tracerGraphique(bougies, { libelle: 'GC' });
    for (const b of bougies) {
      for (const prix of [b.plusHaut, b.plusBas]) {
        const py = priceToY(prix, r.echelle, GEOMETRIE.hauteur);
        expect(py).not.toBeNull();
        expect(py).toBeGreaterThanOrEqual(GEOMETRIE.hautY);
        expect(py).toBeLessThanOrEqual(GEOMETRIE.basAvecVolume);
      }
    }
  });

  it('échappe le libellé plutôt que de laisser injecter du balisage', () => {
    const { svg } = tracerGraphique(serie(5), { libelle: '<script>x</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('refuse une série vide', () => {
    expect(() => tracerGraphique([], { libelle: 'X' })).toThrow(/Aucune bougie/);
  });
});
