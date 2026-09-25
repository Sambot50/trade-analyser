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
 * L'invite quand l'échelle est DONNÉE au lieu d'être lue.
 *
 * `ANALYSIS_PROMPT` fait relever l'axe au modèle : c'est le bon contrat quand
 * l'image vient d'une capture d'écran dont on ignore tout. Mais pour mesurer,
 * c'est une impasse — le banc d'essai chiffre la dérive de lecture d'axe à
 * ~1,7 %, alors que le stop médian mesuré sur l'or vaut 0,188 % du prix.
 * L'erreur d'OCR serait neuf fois plus grande que ce qu'on veut mesurer.
 *
 * Quand c'est nous qui traçons le graphique, nous connaissons l'échelle
 * exacte. On la lui donne, et la mesure porte alors sur sa lecture de la
 * STRUCTURE — la seule chose qu'on cherche à éprouver.
 */
export function promptAvecEchelle(echelle) {
  const { priceTop, priceBottom, plotTopRatio, plotBottomRatio } = echelle;

  return `Tu es un analyste technique (Price Action et Smart Money Concepts).

L'ÉCHELLE DE PRIX T'EST DONNÉE. Ne la lis pas sur l'image, ne la devine pas :

  prix en haut de la zone de tracé : ${priceTop}
  prix en bas de la zone de tracé  : ${priceBottom}

Cette zone occupe la fraction ${plotTopRatio} à ${plotBottomRatio} de la hauteur
de l'image. En dessous, un panneau montre le volume échangé de chaque bougie.

La dernière bougie à droite est la plus récente. Il n'y a rien après elle : tu
ne vois que le passé, et c'est sur ce passé seul que ton plan doit reposer.

Produis un plan de trade. Les niveaux entry, stopLoss, tp1 et tp2 sont des PRIX
dans cette échelle, et doivent rester entre ${priceBottom} et ${priceTop}.

Contraintes de cohérence, sans exception :
- BUY  : stopLoss < entry < tp1 < tp2
- SELL : stopLoss > entry > tp1 > tp2

Recopie l'échelle ci-dessus dans le champ "scale". Ici ce n'est pas une mesure,
seulement une formalité du schéma — il ne sera pas lu.

confidence (0-100) : ta certitude sur ta LECTURE DE STRUCTURE, pas sur l'axe,
qui t'est donné. Sois sévère : sous 40 si le graphique ne présente aucune
configuration nette.

reasoning : 2 à 4 phrases, chacune citant un élément réellement visible sur
l'image — mèche de rejet, gap non comblé, cassure de structure, pic de volume.
Jamais une généralité de marché.

Réponds uniquement par un objet JSON conforme au schéma, sans texte autour.`;
}

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
