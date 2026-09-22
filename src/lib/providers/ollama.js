import { base64FromDataUrl, mimeFromDataUrl } from '../analysis.js';
import { ANALYSIS_SCHEMA, ANALYSIS_PROMPT, parseAnalysisJson } from './schema.js';

export const DEFAULT_BASE_URL = 'http://localhost:11434';
export const DEFAULT_MODEL = 'qwen2.5vl:7b';

// Modèles de vision courants, par capacité décroissante de lecture de texte
// fin — c'est le critère qui compte ici, l'axe des prix étant en petits
// caractères. Qwen2.5-VL est nettement devant sur cette tâche précise.
export const SUGGESTED_MODELS = [
  { id: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B', note: 'Meilleure lecture de texte fin' },
  { id: 'qwen2.5vl:3b', label: 'Qwen2.5-VL 3B', note: 'Plus léger, moins précis' },
  { id: 'llama3.2-vision:11b', label: 'Llama 3.2 Vision 11B', note: 'Alternative plus lourde' },
  { id: 'minicpm-v', label: 'MiniCPM-V', note: 'Compact' },
];

/**
 * Analyse via un modèle local servi par Ollama.
 *
 * Aucune clé, aucun compte : la requête ne quitte pas la machine.
 */
export async function analyzeChart(dataUrl, { model, baseUrl, signal } = {}) {
  const data = base64FromDataUrl(dataUrl);
  const mimeType = mimeFromDataUrl(dataUrl);

  if (!data || !mimeType) throw new Error('Image illisible : data-URI invalide.');
  if (!mimeType.startsWith('image/')) throw new Error(`Type de fichier non supporté : ${mimeType}.`);

  const root = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

  let response;
  try {
    response = await fetch(`${root}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        stream: false,
        // Ollama accepte un JSON Schema complet et contraint le décodage.
        format: ANALYSIS_SCHEMA,
        options: { temperature: 0.2 },
        messages: [
          {
            role: 'user',
            content: ANALYSIS_PROMPT,
            // Ollama attend du base64 nu, sans le préfixe data:.
            images: [data],
          },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Un fetch qui échoue sans réponse : serveur éteint, ou CORS refusé.
    throw new Error(
      `Ollama injoignable sur ${root}. Vérifie qu'il tourne (ollama serve) et ` +
      "que OLLAMA_ORIGINS autorise cette page — voir le README."
    );
  }

  if (!response.ok) throw new Error(await describeError(response, model || DEFAULT_MODEL));

  const payload = await response.json();
  return parseAnalysisJson(payload?.message?.content);
}

async function describeError(response, model) {
  let detail = '';
  try {
    detail = (await response.json())?.error || '';
  } catch {
    // corps non-JSON
  }

  if (response.status === 404) {
    return `Modèle "${model}" absent. Installe-le : ollama pull ${model}`;
  }
  return `Erreur Ollama (${response.status})${detail ? ' : ' + detail : '.'}`;
}

/** Liste les modèles réellement installés, pour éviter de proposer l'absent. */
export async function listInstalledModels(baseUrl) {
  const root = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const response = await fetch(`${root}/api/tags`);
  if (!response.ok) throw new Error(`Ollama a répondu ${response.status}.`);

  const payload = await response.json();
  return (payload?.models || []).map((m) => m.name);
}
