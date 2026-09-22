// Logique pure : validation, calculs, projection prix -> pixel.
// Aucun accès DOM, aucun appel réseau — testable directement.

/**
 * Extrait le type MIME d'une data-URI.
 * Le code d'origine forçait 'image/jpeg', alors qu'une capture collée
 * depuis TradingView est un PNG.
 */
export function mimeFromDataUrl(dataUrl) {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl || '');
  return match ? match[1] : null;
}

export function base64FromDataUrl(dataUrl) {
  const comma = (dataUrl || '').indexOf(',');
  return comma === -1 ? null : dataUrl.slice(comma + 1);
}

/**
 * Ratio risque/rendement, calculé ici et jamais lu dans la réponse du modèle.
 * Un LLM se trompe en arithmétique de façon routinière.
 */
export function computeRR(entry, stopLoss, takeProfit) {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk === 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

const NUMERIC_FIELDS = ['entry', 'stopLoss', 'tp1', 'tp2'];

/**
 * Vérifie qu'une analyse est cohérente avec elle-même.
 * Un modèle vision produit régulièrement un BUY dont le stop est au-dessus
 * de l'entrée. On refuse plutôt que d'afficher.
 *
 * @returns {{ok: true} | {ok: false, errors: string[]}}
 */
export function validateAnalysis(a) {
  const errors = [];

  if (!a || typeof a !== 'object') {
    return { ok: false, errors: ['Réponse vide ou non exploitable.'] };
  }

  if (a.direction !== 'BUY' && a.direction !== 'SELL') {
    errors.push(`Direction invalide : "${a.direction}".`);
  }

  for (const field of NUMERIC_FIELDS) {
    if (typeof a[field] !== 'number' || !Number.isFinite(a[field]) || a[field] <= 0) {
      errors.push(`Niveau "${field}" absent ou non numérique.`);
    }
  }

  // Inutile de tester l'ordonnancement si les nombres sont déjà invalides.
  if (errors.length === 0) {
    const { direction, entry, stopLoss, tp1, tp2 } = a;

    if (direction === 'BUY') {
      if (stopLoss >= entry) errors.push('BUY : le stop loss doit être sous l’entrée.');
      if (tp1 <= entry) errors.push('BUY : le TP1 doit être au-dessus de l’entrée.');
      if (tp2 <= tp1) errors.push('BUY : le TP2 doit être au-dessus du TP1.');
    } else if (direction === 'SELL') {
      if (stopLoss <= entry) errors.push('SELL : le stop loss doit être au-dessus de l’entrée.');
      if (tp1 >= entry) errors.push('SELL : le TP1 doit être sous l’entrée.');
      if (tp2 >= tp1) errors.push('SELL : le TP2 doit être sous le TP1.');
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Normalise une analyse validée : RR recalculé, confiance bornée,
 * provenance explicite.
 */
export function normalizeAnalysis(raw, source) {
  return {
    ...raw,
    rr: computeRR(raw.entry, raw.stopLoss, raw.tp1),
    rrTp2: computeRR(raw.entry, raw.stopLoss, raw.tp2),
    confidence: clamp(Number(raw.confidence) || 0, 0, 100),
    reasoning: Array.isArray(raw.reasoning) ? raw.reasoning : [],
    source, // 'api' | 'demo'
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Couple de référence définissant la projection prix -> pixel.
 *
 * priceTop / priceBottom sont deux prix lus sur l'axe, plotTopRatio /
 * plotBottomRatio les hauteurs auxquelles ils se trouvent dans l'image.
 *
 * Ce couple ne délimite PAS le visible : les modèles s'ancrent naturellement
 * sur les graduations chiffrées extrêmes, qui sont à l'intérieur du cadre.
 * Un prix au-delà de la référence reste donc souvent affichable — c'est
 * l'ordonnée calculée, et elle seule, qui décide.
 */
export function validateScale(scale) {
  if (!scale || typeof scale !== 'object') return { ok: false, errors: ['Repère de prix absent.'] };

  const { priceTop, priceBottom, plotTopRatio, plotBottomRatio } = scale;
  const errors = [];

  for (const [name, v] of Object.entries({ priceTop, priceBottom, plotTopRatio, plotBottomRatio })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`Repère "${name}" non numérique.`);
  }
  if (errors.length) return { ok: false, errors };

  if (priceTop <= priceBottom) errors.push('Repère incohérent : le prix haut n’est pas supérieur au prix bas.');
  if (plotTopRatio < 0 || plotBottomRatio > 1 || plotTopRatio >= plotBottomRatio) {
    errors.push('Zone de tracé incohérente dans l’image.');
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Convertit un prix en ordonnée pixel.
 *
 * Renvoie null si le trait tomberait hors de l'image — c'est le seul critère
 * de rejet. Borner sur le couple de référence écarterait des niveaux
 * pourtant visibles, la référence étant généralement calée sur les
 * graduations chiffrées, à l'intérieur du cadre.
 */
export function priceToY(price, scale, imageHeight) {
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;

  const { priceTop, priceBottom, plotTopRatio, plotBottomRatio } = scale;

  const priceRatio = (priceTop - price) / (priceTop - priceBottom);
  const y = (plotTopRatio + priceRatio * (plotBottomRatio - plotTopRatio)) * imageHeight;

  if (!Number.isFinite(y) || y < 0 || y > imageHeight) return null;
  return y;
}

/**
 * Prépare les lignes traçables. Toute ligne hors fenêtre est écartée et
 * signalée, pour que l'interface puisse le dire au lieu de le masquer.
 */
export function buildOverlayLines(analysis, scale, imageHeight, visible) {
  const spec = [
    { key: 'entry', label: 'ENTRÉE', color: '#3B82F6', price: analysis.entry },
    { key: 'sl', label: 'STOP LOSS', color: '#EF4444', price: analysis.stopLoss },
    { key: 'tp1', label: 'TP 1', color: '#10B981', price: analysis.tp1 },
    { key: 'tp2', label: 'TP 2', color: '#059669', price: analysis.tp2 },
  ];

  const lines = [];
  const offScreen = [];

  for (const item of spec) {
    if (visible && visible[item.key] === false) continue;
    const y = priceToY(item.price, scale, imageHeight);
    if (y === null) offScreen.push(item.label);
    else lines.push({ ...item, y });
  }

  return { lines, offScreen };
}

/**
 * Qualifie un ratio risque/rendement.
 *
 * Le seuil qui compte est 1 : en dessous, le trade perd de l'argent à taux de
 * réussite égal, quelle que soit la qualité de l'analyse. Confondre ce cas
 * avec un ratio simplement médiocre, sous une étiquette unique, revient à
 * présenter une proposition perdante comme acceptable.
 */
export function rrVerdict(rr) {
  if (typeof rr !== 'number' || !Number.isFinite(rr)) {
    return { tone: 'neutral', label: 'Ratio indisponible' };
  }
  if (rr < 1) return { tone: 'bad', label: 'Ratio défavorable' };
  if (rr < 2) return { tone: 'weak', label: 'Ratio modéré' };
  return { tone: 'good', label: 'Bonne asymétrie' };
}

/**
 * Taux de réussite minimal pour être à l'équilibre avec ce ratio.
 * Rend concret ce qu'un ratio inférieur à 1 exige réellement.
 */
export function breakEvenRate(rr) {
  if (typeof rr !== 'number' || !Number.isFinite(rr) || rr <= 0) return null;
  return 1 / (1 + rr);
}
