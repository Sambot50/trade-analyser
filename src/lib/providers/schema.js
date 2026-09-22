// Contrat unique imposé à tous les fournisseurs.
//
// Le schéma est écrit une fois en JSON Schema standard — la forme qu'attend
// Ollama. Gemini utilise un dialecte proche mais distinct (types en
// majuscules, pas de `additionalProperties`) : `toGeminiSchema` fait la
// conversion, plutôt que d'entretenir deux copies qui divergeront.

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    symbol: { type: 'string' },
    timeframe: { type: 'string' },
    bias: { type: 'string', enum: ['HAUSSIER', 'BAISSIER'] },
    direction: { type: 'string', enum: ['BUY', 'SELL'] },
    entry: { type: 'number' },
    stopLoss: { type: 'number' },
    tp1: { type: 'number' },
    tp2: { type: 'number' },
    confidence: { type: 'integer' },
    reasoning: { type: 'array', items: { type: 'string' } },
    scale: {
      type: 'object',
      properties: {
        priceTop: { type: 'number' },
        priceBottom: { type: 'number' },
        plotTopRatio: { type: 'number' },
        plotBottomRatio: { type: 'number' },
      },
      required: ['priceTop', 'priceBottom', 'plotTopRatio', 'plotBottomRatio'],
    },
  },
  required: [
    'symbol', 'timeframe', 'bias', 'direction',
    'entry', 'stopLoss', 'tp1', 'tp2', 'confidence', 'reasoning', 'scale',
  ],
};

/** Traduit le schéma canonique vers le dialecte attendu par Gemini. */
export function toGeminiSchema(node) {
  if (node.type === 'object') {
    const properties = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = toGeminiSchema(value);
    }
    return { type: 'OBJECT', properties, required: node.required };
  }

  if (node.type === 'array') {
    return { type: 'ARRAY', items: toGeminiSchema(node.items) };
  }

  const converted = { type: node.type.toUpperCase() };
  if (node.enum) converted.enum = node.enum;
  return converted;
}

export const ANALYSIS_PROMPT = `Tu es un analyste technique (Price Action et Smart Money Concepts).

Analyse la capture de graphique fournie et produis un plan de trade.

Le champ "scale" est le plus important et conditionne tout le reste. Il sert à
reprojeter les prix sur l'image. Ne déduis rien, relève :

- priceTop : le prix de la graduation chiffrée la plus HAUTE de l'axe vertical.
- plotTopRatio : la hauteur de CETTE graduation dans l'image, en fraction de la
  hauteur totale (0 = tout en haut, 1 = tout en bas).
- priceBottom : le prix de la graduation chiffrée la plus BASSE.
- plotBottomRatio : la hauteur de CETTE graduation, même convention.

Ces deux graduations doivent être aussi éloignées que possible l'une de
l'autre : c'est ce qui rend la projection précise. Recopie les chiffres tels
qu'ils sont imprimés, sans arrondir ni extrapoler entre deux graduations.

Les niveaux entry, stopLoss, tp1 et tp2 doivent rester dans le cadre visible du
graphique.

Contraintes de cohérence, sans exception :
- BUY  : stopLoss < entry < tp1 < tp2
- SELL : stopLoss > entry > tp1 > tp2

Le champ confidence (0-100) exprime ta propre certitude de lecture du graphique,
en particulier ta certitude sur l'axe des prix. Sois sévère : si les graduations
sont illisibles ou si l'image est rognée, descends sous 40.

reasoning : 2 à 4 phrases, chacune citant un élément réellement visible sur
l'image (mèche de rejet, gap non comblé, cassure de structure), jamais une
généralité de marché.

Réponds uniquement par un objet JSON conforme au schéma, sans texte autour.`;

/**
 * Extrait l'objet JSON d'une réponse texte.
 *
 * Les sorties structurées rendent ce nettoyage inutile chez Gemini, mais les
 * modèles locaux encadrent encore parfois leur réponse de ``` malgré la
 * contrainte de format. On tolère, on ne devine pas.
 */
export function parseAnalysisJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Réponse vide du modèle.');
  }

  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Dernier recours : le premier objet complet trouvé dans le texte.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // on tombe dans l'erreur commune ci-dessous
      }
    }
    throw new Error("Le modèle n'a pas renvoyé de JSON exploitable.");
  }
}
