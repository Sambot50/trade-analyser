import { base64FromDataUrl, mimeFromDataUrl } from '../analysis.js';
import { ANALYSIS_SCHEMA, ANALYSIS_PROMPT, toGeminiSchema, parseAnalysisJson } from './schema.js';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function analyzeChart(dataUrl, { apiKey, model, signal } = {}) {
  const data = base64FromDataUrl(dataUrl);
  const mimeType = mimeFromDataUrl(dataUrl);

  if (!data || !mimeType) throw new Error('Image illisible : data-URI invalide.');
  if (!mimeType.startsWith('image/')) throw new Error(`Type de fichier non supporté : ${mimeType}.`);
  if (!apiKey?.trim()) throw new Error('Clé API Gemini absente.');

  const response = await fetch(ENDPOINT(model || DEFAULT_MODEL), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      // En en-tête plutôt qu'en paramètre d'URL : une clé dans une query
      // string se retrouve dans les journaux de tout intermédiaire réseau.
      'x-goog-api-key': apiKey.trim(),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: ANALYSIS_PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(ANALYSIS_SCHEMA),
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) throw new Error(await describeError(response));

  const payload = await response.json();

  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason) throw new Error(`Requête bloquée par Gemini (${blockReason}).`);

  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Réponse interrompue par Gemini (${candidate.finishReason}).`);
  }

  return parseAnalysisJson(candidate?.content?.parts?.[0]?.text);
}

async function describeError(response) {
  let detail = '';
  try {
    detail = (await response.json())?.error?.message || '';
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
