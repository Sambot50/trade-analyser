// Tout fournisseur qui parle le protocole « chat completions » d'OpenAI.
//
// C'est le format de fait du marché : OpenAI, Mistral, Groq, OpenRouter (qui
// donne accès à des dizaines de modèles), DeepSeek, xAI, et les serveurs
// locaux LM Studio ou vLLM. Un seul connecteur, une adresse et un modèle à
// renseigner : c'est la brique qui permet de brancher « n'importe quelle IA ».
//
// Les noms de modèles proposés sont des exemples : chaque fournisseur publie
// les siens, et ils changent. Celui qui est saisi est envoyé tel quel.
//
// NON VÉRIFIÉ depuis l'environnement d'écriture : les appels réseau. La forme
// de la requête et la lecture de la réponse sont testées.

import { mimeFromDataUrl } from '../analysis.js';
import { ANALYSIS_SCHEMA, ANALYSIS_PROMPT, parseAnalysisJson } from './schema.js';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o';

/** Adresses connues. Un clic remplit l'adresse ; le modèle reste à choisir. */
export const PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modele: 'gpt-4o' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', modele: 'pixtral-large-latest' },
  // Pas de modèle imposé : le catalogue change trop, il se choisit chez eux.
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modele: '', aide: 'voir openrouter.ai/models' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', modele: '', aide: 'voir console.groq.com' },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', modele: '', aide: 'le modèle chargé dans LM Studio' },
];

// Le schéma voyage dans le texte : `json_object` garantit un JSON valide, pas
// sa forme. La validation de cohérence en aval fait le reste.
const CONSIGNE = `${ANALYSIS_PROMPT}

Schéma JSON exact à respecter :
${JSON.stringify(ANALYSIS_SCHEMA)}`;

export function construireRequete(dataUrl, { apiKey, model, baseUrl } = {}, { formatJson = true } = {}) {
  const mimeType = mimeFromDataUrl(dataUrl);
  if (!mimeType) throw new Error('Image illisible : data-URI invalide.');
  if (!mimeType.startsWith('image/')) throw new Error(`Type de fichier non supporté : ${mimeType}.`);
  if (!model?.trim()) throw new Error('Indique le nom du modèle chez ce fournisseur.');

  const racine = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  // Un serveur local n'a souvent pas de clé : on n'envoie l'en-tête que s'il y en a une.
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  return {
    url: `${racine}/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.trim(),
        temperature: 0.2,
        ...(formatJson ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: CONSIGNE },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyse ce graphique et réponds par l’objet JSON demandé.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    },
  };
}

export function lireReponse(payload) {
  const choix = payload?.choices?.[0];
  if (!choix) throw new Error('Réponse vide du fournisseur.');
  if (choix.finish_reason === 'length') throw new Error('Réponse tronquée par le fournisseur (longueur maximale).');
  const contenu = choix.message?.content;
  const texte = Array.isArray(contenu) ? contenu.map((p) => p.text ?? '').join('') : contenu;
  return parseAnalysisJson(texte);
}

export async function analyzeChart(dataUrl, config = {}) {
  let { url, init } = construireRequete(dataUrl, config);
  let response = await appeler(url, init, config);

  // Certains serveurs (locaux surtout) refusent `response_format`. Une seule
  // nouvelle tentative sans lui, plutôt qu'un échec définitif.
  if (response.status === 400) {
    const detail = await response.clone().text().catch(() => '');
    if (/response_format|json_object/i.test(detail)) {
      ({ url, init } = construireRequete(dataUrl, config, { formatJson: false }));
      response = await appeler(url, init, config);
    }
  }

  if (!response.ok) throw new Error(await decrireErreur(response, config));
  return lireReponse(await response.json());
}

async function appeler(url, init, config) {
  try {
    return await fetch(url, { ...init, signal: config.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Fournisseur injoignable sur ${url}. Vérifie l’adresse (et, pour un serveur local, qu’il tourne et autorise cette page).`);
  }
}

async function decrireErreur(response, { model }) {
  let detail = '';
  try { const j = await response.json(); detail = j?.error?.message || j?.message || ''; } catch { /* corps non JSON */ }
  switch (response.status) {
    case 401: return 'Clé API refusée (401).';
    case 404: return `Modèle « ${model} » ou adresse inconnus (404)${detail ? ' : ' + detail : '.'}`;
    case 429: return 'Quota atteint (429) : réessaie plus tard.';
    default: return `Erreur du fournisseur (${response.status})${detail ? ' : ' + detail : '.'}`;
  }
}
