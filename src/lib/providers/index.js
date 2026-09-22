// Point d'entrée unique des fournisseurs d'analyse.
//
// App.jsx ne connaît que `analyzeChart(dataUrl, config)` et la table
// PROVIDERS : ajouter un moteur ne touche pas l'interface.

import * as ollama from './ollama.js';
import * as gemini from './gemini.js';

export const PROVIDERS = {
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    blurb: 'Modèle sur ta machine. Aucune clé, aucun compte, hors ligne.',
    needsApiKey: false,
    configurableEndpoint: true,
    defaultModel: ollama.DEFAULT_MODEL,
    defaultBaseUrl: ollama.DEFAULT_BASE_URL,
    suggestedModels: ollama.SUGGESTED_MODELS,
    analyze: ollama.analyzeChart,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    blurb: 'Meilleure lecture de l’axe des prix. Nécessite une clé API.',
    needsApiKey: true,
    configurableEndpoint: false,
    defaultModel: gemini.DEFAULT_MODEL,
    suggestedModels: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Rapide' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Plus lent, plus fin' },
    ],
    analyze: gemini.analyzeChart,
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
  if (provider.needsApiKey && !config.apiKey?.trim()) {
    return `${provider.label} exige une clé API.`;
  }
  return null;
}

export function analyzeChart(dataUrl, config) {
  return getProvider(config.provider).analyze(dataUrl, config);
}

export { listInstalledModels } from './ollama.js';
