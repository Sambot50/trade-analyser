// Génère les graphiques de démonstration comme fichiers .svg autonomes.
//
// Ils ne sont PAS inline dans le bundle : ce sont des ressources statiques,
// cacheables et rechargeables séparément.
//
// Leur intérêt est de valider la chaîne de projection prix -> pixel de bout en
// bout, puisqu'on connaît ici l'échelle exacte utilisée pour les dessiner.
// Ils ne valident pas la lecture vision d'une vraie capture : un SVG généré
// n'a ni bruit, ni anticrénelage, ni typographie d'écran.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'public', 'samples');

const W = 1200, H = 700;
const PLOT_TOP = 40, PLOT_BOTTOM = 620, PLOT_LEFT = 20, PLOT_RIGHT = 1100;

// Générateur déterministe : les échantillons doivent être reproductibles.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCandles({ seed, count, start, volatility, drift }) {
  const rand = mulberry32(seed);
  const candles = [];
  let price = start;

  for (let i = 0; i < count; i++) {
    const open = price;
    const move = (rand() - 0.5) * volatility + drift;
    const close = open + move;
    const wick = volatility * (0.3 + rand() * 0.7);
    candles.push({
      open,
      close,
      high: Math.max(open, close) + wick * rand(),
      low: Math.min(open, close) - wick * rand(),
    });
    price = close;
  }
  return candles;
}

function render({ candles, priceTop, priceBottom, decimals, gridStep, label, timeframe }) {
  const y = (p) => PLOT_TOP + ((priceTop - p) / (priceTop - priceBottom)) * (PLOT_BOTTOM - PLOT_TOP);
  const slot = (PLOT_RIGHT - PLOT_LEFT) / candles.length;
  const body = slot * 0.62;

  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#0B1120"/>`);

  // Graduations de l'axe des prix — ce sont elles que le modèle doit lire.
  for (let p = Math.ceil(priceBottom / gridStep) * gridStep; p <= priceTop; p += gridStep) {
    const py = y(p).toFixed(1);
    parts.push(`<line x1="${PLOT_LEFT}" y1="${py}" x2="${PLOT_RIGHT}" y2="${py}" stroke="#1E293B" stroke-width="1"/>`);
    parts.push(
      `<text x="${PLOT_RIGHT + 12}" y="${(Number(py) + 4).toFixed(1)}" fill="#94A3B8" ` +
      `font-family="monospace" font-size="15">${p.toFixed(decimals)}</text>`
    );
  }

  candles.forEach((c, i) => {
    const cx = PLOT_LEFT + slot * i + slot / 2;
    const up = c.close >= c.open;
    const color = up ? '#10B981' : '#EF4444';
    const top = y(Math.max(c.open, c.close));
    const bottom = y(Math.min(c.open, c.close));

    parts.push(`<line x1="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="${color}" stroke-width="1.5"/>`);
    parts.push(
      `<rect x="${(cx - body / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${body.toFixed(1)}" ` +
      `height="${Math.max(1, bottom - top).toFixed(1)}" fill="${color}"/>`
    );
  });

  parts.push(`<line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" stroke="#334155" stroke-width="1"/>`);
  parts.push(`<text x="${PLOT_LEFT + 8}" y="26" fill="#E2E8F0" font-family="sans-serif" font-size="18" font-weight="bold">${label} · ${timeframe}</text>`);
  parts.push(`<text x="${PLOT_LEFT + 8}" y="${H - 24}" fill="#475569" font-family="sans-serif" font-size="14">Graphique synthétique — données non réelles</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

const SPECS = [
  {
    file: 'btc-m15.svg', label: 'BTC/USDT', timeframe: 'M15',
    priceTop: 65800, priceBottom: 63600, decimals: 0, gridStep: 400,
    candles: { seed: 7, count: 90, start: 64050, volatility: 220, drift: 9 },
  },
  {
    file: 'eurusd-h1.svg', label: 'EUR/USD', timeframe: 'H1',
    priceTop: 1.0920, priceBottom: 1.0690, decimals: 4, gridStep: 0.004,
    candles: { seed: 21, count: 90, start: 1.0872, volatility: 0.0024, drift: -0.00009 },
  },
];

mkdirSync(OUT, { recursive: true });

for (const spec of SPECS) {
  const svg = render({ ...spec, candles: buildCandles(spec.candles) });
  writeFileSync(resolve(OUT, spec.file), svg);
  console.log(`${spec.file}  ${(svg.length / 1024).toFixed(1)} Ko`);
}

// Le repère exact ayant servi au tracé, à recopier dans src/samples.js.
console.log('\nplotTopRatio =', (PLOT_TOP / H).toFixed(6), ' plotBottomRatio =', (PLOT_BOTTOM / H).toFixed(6));
