import { describe, it, expect } from 'vitest';
import {
  mimeFromDataUrl, computeRR, validateAnalysis,
  validateScale, priceToY, buildOverlayLines, normalizeAnalysis, rrVerdict, breakEvenRate,
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

// Repère tel que les modèles le renvoient réellement : calé sur les graduations
// chiffrées extrêmes (65600 et 63600), qui sont À L'INTÉRIEUR du cadre — le bord
// haut réel étant à 65800, sans étiquette.
const GRID_SCALE = {
  priceTop: 65600, priceBottom: 63600,
  plotTopRatio: 0.132429, plotBottomRatio: 0.885714,
};

describe('priceToY avec un repère calé sur les graduations', () => {
  it('place les deux graduations de référence à leur hauteur', () => {
    expect(priceToY(65600, GRID_SCALE, 700)).toBeCloseTo(92.7, 1);
    expect(priceToY(63600, GRID_SCALE, 700)).toBeCloseTo(620.0, 1);
  });

  it('trace un prix situé AU-DESSUS de la graduation haute mais dans le cadre', () => {
    // 65700 dépasse priceTop : l'ancienne borne par prix le rejetait à tort.
    const y = priceToY(65700, GRID_SCALE, 700);
    expect(y).not.toBeNull();
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(92.7);
  });

  it('retrouve la même position que le repère bord-à-bord', () => {
    // Les deux repères décrivent la même image : ils doivent coïncider.
    const edgeScale = { priceTop: 65800, priceBottom: 63600, plotTopRatio: 0.057143, plotBottomRatio: 0.885714 };
    for (const price of [63850, 64200, 64900, 65600]) {
      expect(priceToY(price, GRID_SCALE, 700)).toBeCloseTo(priceToY(price, edgeScale, 700), 0);
    }
  });

  it('rejette ce qui tomberait au-dessus de l\u2019image', () => {
    expect(priceToY(70000, GRID_SCALE, 700)).toBeNull();
  });

  it('rejette ce qui tomberait sous l\u2019image', () => {
    expect(priceToY(60000, GRID_SCALE, 700)).toBeNull();
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
  it('refuse un prix qui tomberait hors de l\u2019image', () => {
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

describe('rrVerdict', () => {
  it('signale un ratio perdant', () => {
    expect(rrVerdict(0.87).tone).toBe('bad');
    expect(rrVerdict(0.87).label).toMatch(/défavorable/);
  });

  it('place la frontière à 1, pas ailleurs', () => {
    expect(rrVerdict(0.999).tone).toBe('bad');
    expect(rrVerdict(1).tone).toBe('weak');
  });

  it('distingue le modéré de la bonne asymétrie', () => {
    expect(rrVerdict(1.65).tone).toBe('weak');
    expect(rrVerdict(2).tone).toBe('good');
    expect(rrVerdict(3.7).tone).toBe('good');
  });

  it('gère un ratio incalculable', () => {
    expect(rrVerdict(null).tone).toBe('neutral');
  });
});

describe('breakEvenRate', () => {
  it('chiffre ce qu’exige un ratio défavorable', () => {
    // 1:0.87 -> il faut gagner plus d'un trade sur deux pour ne rien perdre.
    expect(breakEvenRate(0.87)).toBeCloseTo(0.5348, 3);
  });

  it('donne 50 % à l’équilibre exact', () => {
    expect(breakEvenRate(1)).toBeCloseTo(0.5, 5);
  });

  it('chute quand l’asymétrie est bonne', () => {
    expect(breakEvenRate(3)).toBeCloseTo(0.25, 5);
  });

  it('refuse un ratio absent', () => {
    expect(breakEvenRate(null)).toBeNull();
  });
});
