import { describe, it, expect } from 'vitest';
import {
  mimeFromDataUrl, computeRR, validateAnalysis,
  validateScale, priceToY, buildOverlayLines, normalizeAnalysis,
} from './analysis.js';

const SCALE = { priceTop: 65000, priceBottom: 63000, plotTopRatio: 0.05, plotBottomRatio: 0.9 };

const BUY = {
  symbol: 'BTC/USDT', timeframe: 'M15', bias: 'HAUSSIER', direction: 'BUY',
  entry: 64200, stopLoss: 63850, tp1: 64900, tp2: 65600, confidence: 91, reasoning: ['a'],
};

describe('mimeFromDataUrl', () => {
  it('lit le PNG d’une capture collée', () => {
    expect(mimeFromDataUrl('data:image/png;base64,AAA')).toBe('image/png');
  });
  it('gère une data-URI sans base64', () => {
    expect(mimeFromDataUrl('data:image/svg+xml;utf8,<svg/>')).toBe('image/svg+xml');
  });
  it('renvoie null hors data-URI', () => {
    expect(mimeFromDataUrl('https://example.com/a.png')).toBeNull();
  });
});

describe('computeRR', () => {
  it('calcule le ratio sur un long', () => {
    expect(computeRR(64200, 63850, 64900)).toBe(2);
  });
  it('calcule le ratio sur un short', () => {
    expect(computeRR(1.085, 1.0885, 1.079)).toBe(1.71);
  });
  it('refuse un risque nul', () => {
    expect(computeRR(100, 100, 120)).toBeNull();
  });
});

describe('validateAnalysis', () => {
  it('accepte un long cohérent', () => {
    expect(validateAnalysis(BUY).ok).toBe(true);
  });

  it('rejette un BUY dont le stop est au-dessus de l’entrée', () => {
    const r = validateAnalysis({ ...BUY, stopLoss: 64500 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/stop loss doit être sous/);
  });

  it('rejette un SELL dont le TP1 est au-dessus de l’entrée', () => {
    const r = validateAnalysis({
      ...BUY, direction: 'SELL', entry: 1.085, stopLoss: 1.0885, tp1: 1.09, tp2: 1.072,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/TP1 doit être sous/);
  });

  it('rejette un TP2 qui n’étend pas le TP1', () => {
    expect(validateAnalysis({ ...BUY, tp2: 64500 }).ok).toBe(false);
  });

  it('rejette une direction inventée', () => {
    expect(validateAnalysis({ ...BUY, direction: 'LONG' }).ok).toBe(false);
  });

  it('rejette un niveau non numérique', () => {
    expect(validateAnalysis({ ...BUY, entry: '64200' }).ok).toBe(false);
  });

  it('rejette une réponse vide', () => {
    expect(validateAnalysis(null).ok).toBe(false);
  });
});

describe('normalizeAnalysis', () => {
  it('recalcule le RR et ignore celui du modèle', () => {
    const n = normalizeAnalysis({ ...BUY, rr: 99 }, 'api');
    expect(n.rr).toBe(2);
    expect(n.source).toBe('api');
  });
  it('borne une confiance aberrante', () => {
    expect(normalizeAnalysis({ ...BUY, confidence: 250 }, 'api').confidence).toBe(100);
  });
});

describe('validateScale', () => {
  it('accepte un repère cohérent', () => {
    expect(validateScale(SCALE).ok).toBe(true);
  });
  it('rejette un axe inversé', () => {
    expect(validateScale({ ...SCALE, priceTop: 62000 }).ok).toBe(false);
  });
  it('rejette une zone de tracé hors image', () => {
    expect(validateScale({ ...SCALE, plotBottomRatio: 1.4 }).ok).toBe(false);
  });
});

describe('priceToY', () => {
  it('place le prix haut sur le bord supérieur de la zone', () => {
    expect(priceToY(65000, SCALE, 1000)).toBeCloseTo(50);
  });
  it('place le prix bas sur le bord inférieur de la zone', () => {
    expect(priceToY(63000, SCALE, 1000)).toBeCloseTo(900);
  });
  it('place le milieu au milieu', () => {
    expect(priceToY(64000, SCALE, 1000)).toBeCloseTo(475);
  });
  it('refuse un prix hors de la fenêtre visible', () => {
    expect(priceToY(70000, SCALE, 1000)).toBeNull();
    expect(priceToY(60000, SCALE, 1000)).toBeNull();
  });
});

describe('buildOverlayLines', () => {
  const visible = { entry: true, sl: true, tp1: true, tp2: true };

  it('trace les niveaux contenus dans la fenêtre', () => {
    const { lines, offScreen } = buildOverlayLines(BUY, SCALE, 1000, visible);
    expect(lines.map(l => l.key)).toEqual(['entry', 'sl', 'tp1']);
    expect(offScreen).toEqual(['TP 2']); // 65600 dépasse priceTop 65000
  });

  it('respecte les calques masqués', () => {
    const { lines } = buildOverlayLines(BUY, SCALE, 1000, { ...visible, sl: false });
    expect(lines.map(l => l.key)).not.toContain('sl');
  });

  it('ordonne un long correctement : TP au-dessus, SL en dessous', () => {
    const { lines } = buildOverlayLines(BUY, SCALE, 1000, visible);
    const y = Object.fromEntries(lines.map(l => [l.key, l.y]));
    expect(y.tp1).toBeLessThan(y.entry);
    expect(y.entry).toBeLessThan(y.sl);
  });
});
