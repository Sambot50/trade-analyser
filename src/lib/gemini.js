import { base64FromDataUrl, mimeFromDataUrl } from './analysis.js';

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Schéma imposé au modèle. Avec responseMimeType application/json, Gemini
// ne peut pas renvoyer de fences ni de champs surnuméraires : le nettoyage
// par expression régulière du code d'origine devient inutile.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    symbol: { type: 'STRING' },
    timeframe: { type: 'STRING' },
    bias: { type: 'STRING', enum: ['HAUSSIER', 'BAISSIER'] },
    direction: { type: 'STRING', enum: ['BUY', 'SELL'] },
    entry: { type: 'NUMBER' },
    stopLoss: { type: 'NUMBER' },
    tp1: { type: 'NUMBER' },
    tp2: { type: 'NUMBER' },
    confidence: { type: 'INTEGER' },
    reasoning: { type: 'ARRAY', items: { type: 'STRING' } },
    scale: {
      type: 'OBJECT',
      properties: {
        priceTop: { type: 'NUMBER' },
        priceBottom: { type: 'NUMBER' },
        plotTopRatio: { type: 'NUMBER' },
        plotBottomRatio: { type: 'NUMBER' },
      },
      required: ['priceTop', 'priceBottom', 'plotTopRatio', 'plotBottomRatio'],
    },
  },
  required: [
    'symbol', 'timeframe', 'bias', 'direction',
    'entry', 'stopLoss', 'tp1', 'tp2', 'confidence', 'reasoning', 'scale',
  ],
};

const PROMPT = `Tu es un analyste technique (Price Action et Smart Money Concepts).

Analyse la capture de graphique fournie et produis un plan de trade.

Le champ "scale" est le plus important et conditionne tout le reste. Il sert à
reprojeter les prix sur l'image, donc il doit décrire ce que tu vois, pas ce que
tu déduis :
- plotTopRatio / plotBottomRatio : la hauteur, en fraction de la hauteur totale
  de l'image (0 = tout en haut, 1 = tout en bas), des bords haut et bas de la
  zone de tracé des bougies. Exclus la barre d'outils supérieure et l'axe des
  dates inférieur.
- priceTop / priceBottom : les prix lus sur l'axe vertical à ces deux hauteurs
  exactes. Extrapole depuis les graduations chiffrées les plus proches.

Les niveaux entry, stopLoss, tp1 et tp2 doivent tous tomber entre priceBottom et
priceTop : ne propose pas d'objectif situé hors du cadre visible.

Contraintes de cohérence, sans exception :
- BUY  : stopLoss < entry < tp1 < tp2
- SELL : stopLoss > entry > tp1 > tp2

Le champ confidence (0-100) exprime ta propre certitude de lecture du graphique,
en particulier ta certitude sur l'axe des prix. Sois sévère : si les graduations
sont illisibles ou si l'image est rognée, descends sous 40.

reasoning : 2 à 4 phrases, chacune citant un élément réellement visible sur
l'image (mèche de rejet, gap non comblé, cassure de structure), jamais une
généralité de marché.`;

/**
 * Appelle Gemini Vision et renvoie l'objet brut, non validé.
 * La validation est faite par l'appelant via validateAnalysis/validateScale.
 */
export async function analyzeChart(dataUrl, apiKey, { signal } = {}) {
  const data = base64FromDataUrl(dataUrl);
  const mimeType = mimeFromDataUrl(dataUrl);

  if (!data || !mimeType) throw new Error('Image illisible : data-URI invalide.');
  if (!mimeType.startsWith('image/')) throw new Error(`Type de fichier non supporté : ${mimeType}.`);

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      // En en-tête plutôt qu'en paramètre d'URL : une clé dans une query string
      // se retrouve dans les journaux de tout intermédiaire réseau.
      'x-goog-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(await describeHttpError(response));
  }

  const payload = await response.json();

  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason) throw new Error(`Requête bloquée par Gemini (${blockReason}).`);

  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Réponse interrompue par Gemini (${candidate.finishReason}).`);
  }

  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Réponse vide de Gemini.');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini n’a pas renvoyé de JSON exploitable.');
  }
}

async function describeHttpError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
  } catch {
    // corps non-JSON : on garde le code seul
  }

  switch (response.status) {
    case 400: return `Requête refusée (400)${detail ? ' : ' + detail : '.'}`;
    case 401:
    case 403: return 'Clé API refusée (403). Vérifie la clé et ses restrictions.';
    case 429: return 'Quota Gemini dépassé (429). Réessaie dans un instant.';
    default:  return `Erreur Gemini (${response.status})${detail ? ' : ' + detail : '.'}`;
  }
}
