// Préférences de moteur.
//
// Le fournisseur, le modèle et l'URL locale sont des conforts : on les retient
// entre deux sessions. La clé API, non — un secret n'a rien à faire dans le
// stockage du navigateur, elle reste en mémoire le temps de la session.

import { DEFAULT_PROVIDER, PROVIDERS } from './providers/index.js';

const KEY = 'trade-analyser.engine';

export function defaultSettings() {
  const provider = PROVIDERS[DEFAULT_PROVIDER];
  return {
    provider: provider.id,
    model: provider.defaultModel,
    baseUrl: provider.defaultBaseUrl || '',
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();

    const parsed = JSON.parse(raw);
    // Un fournisseur retiré depuis le dernier passage ne doit pas casser
    // le démarrage : on retombe sur les valeurs par défaut.
    if (!parsed?.provider || !PROVIDERS[parsed.provider]) return defaultSettings();

    return {
      provider: parsed.provider,
      model: parsed.model || PROVIDERS[parsed.provider].defaultModel,
      baseUrl: parsed.baseUrl || PROVIDERS[parsed.provider].defaultBaseUrl || '',
    };
  } catch {
    // Navigation privée, stockage bloqué : on fonctionne sans mémoire.
    return defaultSettings();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Rien à faire : perdre la préférence n'empêche pas d'analyser.
  }
}
