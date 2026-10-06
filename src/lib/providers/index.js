// Point d'entrée unique des fournisseurs d'analyse — la brique « IA » (DEC-039).
//
// App.jsx ne connaît que `analyzeChart(dataUrl, config)` et la table
// PROVIDERS : ajouter un moteur ne touche pas l'interface. Un fournisseur est
// un objet qui décrit ce qu'il lui faut (clé, adresse, modèle) et une fonction
// `analyze(dataUrl, config)` qui rend l'objet d'ANALYSIS_SCHEMA. Rien d'autre.
//
// Tout ce qui sort d'un fournisseur repasse par validateAnalysis : cohérence
// des niveaux, ratio recalculé ici. Changer d'IA ne change aucun garde-fou.
//
//   keyPolicy  'aucune' | 'optionnelle' | 'requise'
//   endpoint   libellé du champ d'adresse, ou null si l'adresse est fixe

import * as ollama from './ollama.js';
import * as gemini from './gemini.js';
import * as anthropic from './anthropic.js';
import * as compatible from './compatible-openai.js';

export const PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    blurb: 'Modèle sur ta machine. Aucune clé, aucun compte, hors ligne.',
    needsApiKey: false,
    keyPolicy: 'aucune',
    configurableEndpoint: true,
    endpoint: 'Adresse du serveur Ollama',
    defaultModel: ollama.DEFAULT_MODEL,
    defaultBaseUrl: ollama.DEFAULT_BASE_URL,
    suggestedModels: ollama.SUGGESTED_MODELS,
    listModels: ollama.listInstalledModels,
    analyze: ollama.analyzeChart,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    blurb: 'Meilleure lecture de l’axe des prix. Nécessite une clé API.',
    needsApiKey: true,
    keyPolicy: 'requise',
    keyPlaceholder: 'AIza…',
    envKey: 'VITE_GEMINI_API_KEY',
    configurableEndpoint: false,
    endpoint: null,
    defaultModel: gemini.DEFAULT_MODEL,
    suggestedModels: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Rapide' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Plus lent, plus fin' },
    ],
    analyze: gemini.analyzeChart,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    blurb: 'Sortie structurée par outil imposé. Nécessite une clé API.',
    needsApiKey: true,
    keyPolicy: 'requise',
    keyPlaceholder: 'sk-ant-…',
    envKey: 'VITE_ANTHROPIC_API_KEY',
    configurableEndpoint: false,
    endpoint: null,
    defaultModel: anthropic.DEFAULT_MODEL,
    suggestedModels: [
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'Équilibre coût et finesse' },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', note: 'Le plus capable, le plus cher' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'Rapide et économique' },
    ],
    analyze: anthropic.analyzeChart,
  },
  compatible: {
    id: 'compatible',
    label: 'Compatible OpenAI',
    blurb: 'OpenAI, Mistral, Groq, OpenRouter, LM Studio… : une adresse et un modèle.',
    needsApiKey: false,
    keyPolicy: 'optionnelle',
    keyPlaceholder: 'sk-… (vide pour un serveur local)',
    envKey: 'VITE_COMPATIBLE_API_KEY',
    configurableEndpoint: true,
    endpoint: 'Adresse de l’API (se termine par /v1)',
    defaultModel: compatible.DEFAULT_MODEL,
    defaultBaseUrl: compatible.DEFAULT_BASE_URL,
    presets: compatible.PRESETS,
    modelRequired: true,
    suggestedModels: [],
    analyze: compatible.analyzeChart,
  },
};

export const DEFAULT_PROVIDER = 'ollama';

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Fournisseur inconnu : ${id}`);
  return provider;
}

/**
 * Renvoie la raison pour laquelle l'analyse ne peut pas être lancée,
 * ou null si elle le peut. L'interface s'en sert pour désactiver le bouton
 * plutôt que de laisser partir une requête vouée à échouer.
 */
export function blockingReason(id, config) {
  const provider = getProvider(id);
  if (provider.keyPolicy === 'requise' && !config.apiKey?.trim()) {
    return `${provider.label} exige une clé API.`;
  }
  // Un fournisseur générique n'a pas de modèle par défaut qui vaille partout.
  if (provider.modelRequired && !config.model?.trim()) return 'Indique le modèle à utiliser chez ce fournisseur.';
  return null;
}

export function analyzeChart(dataUrl, config) {
  return getProvider(config.provider).analyze(dataUrl, config);
}

export { listInstalledModels } from './ollama.js';
