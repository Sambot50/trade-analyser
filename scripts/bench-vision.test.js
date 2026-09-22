import { describe, it, expect } from 'vitest';
import { parseArgs, computeDrift, isCoherent, TRUTH } from './bench-vision.mjs';

// Ce fichier existe parce que le parsing d'arguments a planté en production
// sur une zone morte temporelle : `camel` était une constante fléchée déclarée
// après son premier appel. Importer ce module suffit désormais à le détecter.

describe('parseArgs', () => {
  it('ne casse pas sans argument', () => {
    expect(parseArgs([])).toEqual({});
  });

  it('lit --image', () => {
    expect(parseArgs(['--image', 'public/samples/eurusd-h1.png']))
      .toEqual({ image: 'public/samples/eurusd-h1.png' });
  });

  it('convertit --base-url en camelCase', () => {
    expect(parseArgs(['--base-url', 'http://x:1'])).toEqual({ baseUrl: 'http://x:1' });
  });

  it('accepte plusieurs options', () => {
    expect(parseArgs(['--models', 'a:1,b:2', '--image', 'x.png']))
      .toEqual({ models: 'a:1,b:2', image: 'x.png' });
  });
});

describe('computeDrift', () => {
  const truth = TRUTH['btc-m15.png'];
  const EDGE = { priceTop: 65800, priceBottom: 63600, plotTopRatio: 0.057143, plotBottomRatio: 0.885714 };

  it('donne zéro sur le repère exact', () => {
    expect(computeDrift(EDGE, truth)).toBeCloseTo(0, 5);
  });

  it('donne zéro sur un repère calé sur les graduations', () => {
    // Même droite, deux points différents : la dérive doit rester nulle.
    const grid = { priceTop: 65600, priceBottom: 63600, plotTopRatio: 0.132429, plotBottomRatio: 0.885714 };
    expect(computeDrift(grid, truth)).toBeLessThan(0.5);
  });

  it('chiffre un repère légèrement décalé', () => {
    const off = { ...EDGE, priceTop: 65900, priceBottom: 63500 };
    expect(computeDrift(off, truth)).toBeGreaterThan(15);
    expect(computeDrift(off, truth)).toBeLessThan(25);
  });

  it('démasque un repère issu d’un autre actif', () => {
    // Des prix BTC renvoyés sur un graphique forex : la dérive explose.
    expect(computeDrift(EDGE, TRUTH['eurusd-h1.png'])).toBeGreaterThan(1000);
  });

  it('rejette un axe inversé', () => {
    expect(computeDrift({ ...EDGE, priceTop: 63000, priceBottom: 66000 }, truth)).toBeNull();
  });

  it('rejette un repère absent ou non numérique', () => {
    expect(computeDrift(null, truth)).toBeNull();
    expect(computeDrift({ ...EDGE, priceTop: 'haut' }, truth)).toBeNull();
  });
});

describe('isCoherent', () => {
  it('accepte un long ordonné', () => {
    expect(isCoherent({ direction: 'BUY', stopLoss: 1, entry: 2, tp1: 3, tp2: 4 })).toBe(true);
  });
  it('refuse un long dont le stop est au-dessus', () => {
    expect(isCoherent({ direction: 'BUY', stopLoss: 3, entry: 2, tp1: 4, tp2: 5 })).toBe(false);
  });
  it('accepte un short ordonné', () => {
    expect(isCoherent({ direction: 'SELL', stopLoss: 4, entry: 3, tp1: 2, tp2: 1 })).toBe(true);
  });
  it('refuse une direction inventée', () => {
    expect(isCoherent({ direction: 'LONG', stopLoss: 1, entry: 2, tp1: 3, tp2: 4 })).toBe(false);
  });
});
