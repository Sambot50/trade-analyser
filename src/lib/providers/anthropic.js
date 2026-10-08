// Claude (Anthropic), par l'API Messages.
//
// La sortie structurée passe par un OUTIL imposé : Claude ne peut répondre
// qu'en remplissant `plan_de_trade`, dont le schéma est ANALYSIS_SCHEMA. C'est
// le mécanisme le plus sûr qu'offre l'API pour obtenir un JSON conforme, plus
// fiable qu'une consigne « réponds en JSON » dans le texte.
//
// L'appel part du navigateur, avec la clé saisie dans l'application. L'en-tête
// `anthropic-dangerous-direct-browser-access` le permet ; le risque qu'il
// désigne — une clé exposée à la page — est le même que pour Gemini : la clé
// reste en mémoire, jamais écrite, et l'application est locale.
//
// NON VÉRIFIÉ depuis l'environnement d'écriture : l'appel réseau. La forme de
// la requête et la lecture de la réponse sont testées contre des réponses
// construites d'après la documentation de l'API.

import { base64FromDataUrl, mimeFromDataUrl } from '../analysis.js';
import { ANALYSIS_SCHEMA, ANALYSIS_PROMPT, parseAnalysisJson } from './schema.js';

export const ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const OUTIL = 'plan_de_trade';

export function construireRequete(dataUrl, { apiKey, model } = {}) {
  const data = base64FromDataUrl(dataUrl);
  const mimeType = mimeFromDataUrl(dataUrl);
  if (!data || !mimeType) throw new Error('Image illisible : data-URI invalide.');
  if (!mimeType.startsWith('image/')) throw new Error(`Type de fichier non supporté : ${mimeType}.`);
  if (!apiKey?.trim()) throw new Error('Clé API Anthropic absente.');

  return {
    url: ENDPOINT,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        max_tokens: 2048,
        tools: [{
          name: OUTIL,
          description: 'Enregistre le plan de trade et le repère de prix relevés sur la capture.',
          input_schema: ANALYSIS_SCHEMA,
        }],
        tool_choice: { type: 'tool', name: OUTIL },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data } },
            { type: 'text', text: ANALYSIS_PROMPT },
          ],
        }],
      }),
    },
  };
}

/** Le plan, lu dans l'appel d'outil ; à défaut, dans un texte JSON. */
export function lireReponse(payload) {
  if (payload?.stop_reason === 'max_tokens') throw new Error('Réponse de Claude tronquée (max_tokens).');
  if (payload?.stop_reason === 'refusal') throw new Error('Claude a refusé l’analyse.');
  const blocs = Array.isArray(payload?.content) ? payload.content : [];
  const outil = blocs.find((b) => b.type === 'tool_use' && b.name === OUTIL);
  if (outil?.input && typeof outil.input === 'object') return outil.input;
  const texte = blocs.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return parseAnalysisJson(texte);
}

export async function analyzeChart(dataUrl, config = {}) {
  const { url, init } = construireRequete(dataUrl, config);
  const response = await fetch(url, { ...init, signal: config.signal });
  if (!response.ok) throw new Error(await decrireErreur(response, config.model || DEFAULT_MODEL));
  return lireReponse(await response.json());
}

async function decrireErreur(response, model) {
  let detail = '';
  try { detail = (await response.json())?.error?.message || ''; } catch { /* corps non JSON */ }
  switch (response.status) {
    case 401: return 'Clé API Anthropic refusée (401).';
    case 403: return `Accès refusé par Anthropic (403)${detail ? ' : ' + detail : '.'}`;
    case 404: return `Modèle « ${model} » inconnu chez Anthropic (404).`;
    case 429: return 'Quota Anthropic atteint (429) : réessaie plus tard.';
    case 529: return 'API Anthropic surchargée (529) : réessaie dans un instant.';
    default: return `Erreur Anthropic (${response.status})${detail ? ' : ' + detail : '.'}`;
  }
}
