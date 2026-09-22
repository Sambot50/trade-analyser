// Documentation du format, écrite dans le dossier du journal.
//
// Un agent à qui l'on donne ce dossier doit pouvoir lire la structure AVANT
// les données. Générer ce fichier depuis le code garantit qu'il ne dérive pas
// du format réel, contrairement à une documentation tenue à la main.

import { SCHEMA_VERSION, SEUILS_RATIO, HORIZON_RESOLUTION_MINUTES } from './schema.js';
import { STATUTS } from './resolve.js';
import { INTERVALLE_RESOLUTION } from './market.js';

export function genererSchemaDoc() {
  return `# Format du journal — schéma v${SCHEMA_VERSION}

Ce dossier contient une analyse de graphique par sous-dossier, plus trois
fichiers à la racine. Il est conçu pour être lu par un humain, un script ou un
agent, sans accès au code qui l'a produit.

## Par où commencer

| Fichier | Contenu | Pour quoi faire |
|---|---|---|
| \`RAPPORT.md\` | Tableau de toutes les analyses et statistiques agrégées | Point d'entrée. Répond à « est-ce que cet outil a raison ? » |
| \`index.jsonl\` | Un objet JSON par ligne, une ligne par évènement | Traitement programmatique, chargement dans pandas ou Excel |
| \`SCHEMA.md\` | Ce fichier | Comprendre les champs avant de lire les données |
| \`AAAA-MM-JJ/HHMMSS-SYMBOLE-UT/\` | Le détail d'une analyse | Creuser un cas précis |

## index.jsonl est un journal, pas une table

Chaque ligne est un fait daté. Quand l'issue d'un trade est constatée, une
**nouvelle ligne** est ajoutée pour le même \`id\` — le fichier n'est jamais
réécrit, ce qui le rend insensible à une écriture interrompue.

Pour obtenir l'état courant, regrouper par \`id\` et garder la dernière ligne :

\`\`\`python
import json, pandas as pd
lignes = [json.loads(l) for l in open("index.jsonl") if l.strip()]
df = pd.DataFrame(lignes).groupby("id").last().reset_index()
\`\`\`

L'historique des corrections reste visible dans les lignes antérieures.

## Contenu d'un dossier d'analyse

| Fichier | Description |
|---|---|
| \`capture.png\` | L'image soumise au modèle, octet pour octet. PNG sans perte : rejouer une analyse exige la même entrée exactement. |
| \`overlay.png\` | Le rendu affiché à l'écran, niveaux tracés. Ce que l'utilisateur avait sous les yeux. |
| \`analyse.json\` | Tout le reste. Structure ci-dessous. |

## analyse.json

Les prix sont exprimés dans \`marche.devise\`. Les champs inconnus valent
\`null\` explicitement : une clé n'est jamais absente, pour qu'« inconnu » ne se
confonde pas avec « non applicable ».

| Champ | Signification |
|---|---|
| \`schemaVersion\` | Version du format. Vérifier avant toute lecture automatisée. |
| \`resume\` | Une phrase en langue naturelle. Suffit à trier sans ouvrir le reste. |
| \`horodatage\` | ISO 8601 UTC, à la seconde. Instant de l'analyse. |
| \`moteur.fournisseur\` / \`moteur.modele\` | Qui a produit l'analyse. \`ollama\` en local, \`gemini\` à distance. |
| \`moteur.dureeMs\` | Durée de l'inférence. |
| \`marche.symbole\` / \`uniteTemps\` | **Tels que lus par le modèle sur l'image**, pas saisis par l'utilisateur. Peuvent être erronés. |
| \`marche.devise\` | Devise de cotation, déduite du symbole. \`null\` si indéterminable. |
| \`lecture.confianceDeclareeParLeModele\` | 0 à 100, produite par le modèle. **Ce n'est pas une probabilité** et rien ne garantit qu'elle prédise quoi que ce soit — \`RAPPORT.md\` mesure justement si elle sépare gagnantes et perdantes. |
| \`lecture.repereAxeDesPrix\` | Les deux graduations relevées sur l'axe et leur hauteur dans l'image (0 en haut, 1 en bas). Ces deux points définissent la projection prix vers pixel. C'est le champ le plus critique : s'il est faux, les niveaux tracés le sont aussi. |
| \`plan.*\` | Direction et niveaux. \`distanceRisque\`, \`distanceGainTp1\` et les ratios sont **recalculés** côté client, jamais repris de la réponse du modèle. |
| \`plan.tauxReussiteEquilibre\` | Proportion de trades gagnants nécessaire pour ne rien perdre avec ce ratio. |
| \`plan.verdictRatio\` | \`defavorable\` sous ${SEUILS_RATIO.defavorableEnDessousDe}, \`bonne_asymetrie\` à partir de ${SEUILS_RATIO.bonneAsymetrieAPartirDe}, \`modere\` entre les deux. |
| \`raisonnement\` | Les arguments du modèle, en clair. À confronter aux niveaux : ils se contredisent parfois. |
| \`controles\` | Ce que le logiciel a vérifié avant d'enregistrer. Une analyse dont l'ordonnancement contredit la direction est rejetée : le journal ne contient que des plans cohérents. |
| \`resultat\` | \`null\` tant que l'issue n'est pas constatée. |

## resultat

\`\`\`json
{
  "statut": "tp1",
  "source": "automatique",
  "constateLe": "2026-09-23T10:30:00Z",
  "detail": { "declencheLe": 1758566935000, "bougiesExaminees": 412 },
  "note": ""
}
\`\`\`

| Statut | Signification | Compté dans le taux de réussite |
|---|---|---|
| \`non_declenche\` | Le prix n'a jamais atteint l'entrée dans l'horizon | non |
| \`stop\` | Stop touché avant tout objectif | **oui** |
| \`tp1\` | TP1 atteint | **oui** |
| \`tp2\` | TP2 atteint | **oui** |
| \`ambigu\` | Une même bougie touche le stop et un objectif | non |
| \`horizon_depasse\` | Déclenché, mais ni stop ni objectif dans l'horizon | non |
| \`en_cours\` | Pas encore résolu, sera retenté | non |

Statuts possibles, exhaustivement : ${STATUTS.map((s) => `\`${s}\``).join(', ')}.

### Pourquoi \`ambigu\` existe

Une bougie ne donne que quatre prix : ouverture, plus haut, plus bas, clôture.
Si elle touche à la fois le stop et un objectif, **rien n'indique lequel a été
atteint en premier**. Trancher au hasard biaiserait le taux de réussite dans un
sens ou dans l'autre. Ces cas sont donc isolés et exclus des statistiques.

La résolution se fait sur des bougies de \`${INTERVALLE_RESOLUTION}\`, quelle que
soit l'unité de temps de l'analyse : plus la bougie est fine, plus le cas
ambigu est rare.

### Horizon

${HORIZON_RESOLUTION_MINUTES / 60} heures après l'analyse. Au-delà, un trade
déclenché mais non résolu est marqué \`horizon_depasse\` plutôt que laissé
ouvert indéfiniment.

### Source

\`automatique\` — constatée sur les bougies publiques. Disponible pour les
paires crypto cotées sur Binance uniquement.

\`manuelle\` — saisie par l'utilisateur. C'est le cas du forex, des indices et
des actions, faute de source publique gratuite et fiable.

## Ce que ce journal ne dit pas

- **Aucun de ces trades n'a été exécuté.** Ce sont des plans produits par un
  modèle, pas des positions réelles.
- La taille de position n'est pas enregistrée : le taux de réussite ne se
  traduit donc pas directement en rentabilité.
- Les niveaux sont estimés par lecture d'image. Une erreur de lecture de l'axe
  déplace tous les niveaux sans que rien ne le signale, sauf à comparer
  \`lecture.repereAxeDesPrix\` aux graduations visibles sur \`capture.png\`.
`;
}
