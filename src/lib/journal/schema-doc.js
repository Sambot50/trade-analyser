// Documentation du format, écrite dans le dossier du journal.
//
// Un agent à qui l'on donne ce dossier doit pouvoir lire la structure AVANT
// les données. Générer ce fichier depuis le code garantit qu'il ne dérive pas
// du format réel, contrairement à une documentation tenue à la main.

import { SCHEMA_VERSION, SEUILS_RATIO, HORIZON_RESOLUTION_MINUTES, OBJECTIF_JOURNAL } from './schema.js';
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
| \`stop\` | Stop touché avant l'objectif | **oui**, −1 R |
| \`tp1\` | TP1 atteint | **oui**, +1 R — seulement sous la sortie ferme à 1 R |
| \`tp2\` | TP2 atteint | **oui**, +2 R — seulement sous la tenue jusqu'à 2 R |
| \`ambigu\` | Une même bougie touche le stop et l'objectif | non |
| \`horizon_depasse\` | Déclenché, mais ni stop ni objectif dans l'horizon | non |
| \`en_cours\` | Pas encore résolu, sera retenté | non |

### La règle de sortie, et pourquoi elle est inscrite dans chaque plan

\`plan.objectifDeSortie\` vaut \`${OBJECTIF_JOURNAL}\`. **Un seul objectif compte
par enregistrement**, choisi avant d'ouvrir : sous la tenue jusqu'à 2 R, un
trade passé par TP1 puis stoppé est un \`stop\` à −1 R, pas un gain.

Le schéma v1 faisait l'inverse : il créditait +1 R à ce trade tout en
créditant +2 R s'il allait jusqu'à TP2. C'est une option gratuite — à
l'instant où le prix touche 1 R il faut choisir, et on ne peut pas savoir
laquelle était la bonne sans regarder la suite. Mesuré sur 200 000 marches
aléatoires, où toute espérance doit être nulle : **+0,330 R** avec cette
convention, −0,001 R avec une sortie ferme à 1 R.

**Les enregistrements v1 ne se comparent donc pas aux v2.**

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

## Deux types d'enregistrement

Un dossier contient soit une **analyse**, soit une **mesure**. La ligne d'index
porte \`type\`, absent sur une analyse et valant \`"mesure"\` sur l'autre ; le
dossier d'une mesure est suffixé \`-mesure\` et contient \`mesure.json\` au lieu
de \`analyse.json\`.

Ils ne répondent pas à la même question.

| | analyse | mesure |
|---|---|---|
| produite par | un modèle de vision | la géométrie de l'image |
| contient | un plan : entrée, stop, objectifs | une série de bougies et une structure |
| a une issue | oui, constatée plus tard | **non** — rien à résoudre |
| compte dans le taux de réussite | oui | **non** |

Une mesure n'a ni entrée ni stop : elle ne peut ni gagner ni perdre. La compter
avec les analyses gonflerait le total et la ferait figurer indéfiniment parmi
les plans « en cours », ce qui est précisément la conclusion fausse que
\`RAPPORT.md\` doit empêcher. Les statistiques les excluent, le rapport les
compte à part.

## mesure.json

\`\`\`
mesure.nombreDeBougies        combien de bougies ont été reconstruites
mesure.conventionDecimale     « point » ou « virgule » — voir le commentaire embarqué
mesure.echelleDesPrix         prix en haut et en bas du tracé, et la hauteur en pixels
mesure.bornesDuTrace          la zone de tracé dans l'image, panneau de volume compris
mesure.bandeau                symbole et unité lus sur le titre, ou null
mesure.structure.cassures     index, sens et prix de chaque cassure de structure
mesure.structure.orderBlocks  index de bougie, sens, bornes de zone, qualificatifs
mesure.bougies                la série complète : ouverture, clôture, plus haut, plus bas
\`\`\`

La série est conservée en entier, et c'est délibéré : c'est la seule donnée du
journal qui soit irremplaçable. La capture se relit toujours, mais elle ne se
re-mesure pas à l'identique si le code d'extraction change entre-temps.

Les prix viennent des pixels, pas d'une source de marché. Ils ne portent pas
plus de précision que le quadrillage de l'image — compter deux pixels
d'incertitude. Ne pas les comparer à des cours de référence sans tenir compte
de ça.

## Les order blocks, et leur jugement

Chaque order block détecté reçoit **sa propre ligne** dans \`index.jsonl\`,
\`type: "order_block"\`, en plus de la ligne de la mesure. C'est ce qui permet à
l'index de rester le seul fichier à lire : la file d'attente, les vues et un
backtest s'en servent sans ouvrir un seul \`mesure.json\`.

\`\`\`
id                 <id de la mesure>#ob<rang de la bougie>
idEnregistrement   la mesure dont il vient
indexBougie        son rang dans la série mesurée
sens               haussier ou baissier
prixHautDeZone     bornes de la zone, en prix
prixBasDeZone
qualificatifs      ce que l'analyse a relevé : prise de liquidité, FVG, OTE...
etat               en_attente | valide | invalide
\`\`\`

### Trois états, et le troisième n'est pas un oubli

Une zone détectée aujourd'hui ne se juge pas aujourd'hui : il faut que le prix
revienne, ce qui prend des heures sur une unité courte et des semaines sur une
grande.

| état | sens |
|---|---|
| \`en_attente\` | détectée, le prix n'y est pas encore revenu |
| \`valide\` | le prix est revenu et la zone a tenu |
| \`invalide\` | traversée, elle n'a rien retenu |

\`en_attente\` est l'état NORMAL d'une zone récente, pas une saisie manquante.

### Le jugement est un évènement, pas une correction

Il s'ajoute à l'index sous la forme d'une ligne ne portant que ce qui change :

\`\`\`json
{"type":"order_block","id":"...#ob71","maj":"2026-10-05T08:00:00Z","etat":"valide","note":"rejet net"}
\`\`\`

L'enregistrement d'origine **ne bouge pas**. Il dit ce qui a été détecté ce
jour-là ; le réécrire effacerait la seule trace de ce qu'on savait au moment de
la détection. La réduction de l'index fusionne les deux lignes par identifiant.

### Le taux de validation exclut l'attente

Une zone que le prix n'a pas encore atteinte n'a rien échoué. La compter
perdante ferait baisser le taux à mesure qu'on détecte, ce qui n'aurait aucun
sens. Le dénominateur est donc \`valide + invalide\`, et vaut \`null\` tant que
rien n'est tranché — \`null\` dit « on ne sait pas », zéro dirait « ça ne marche
pas ».

## vues/ — le catalogue

Un arbre de dossiers ne donne qu'UNE hiérarchie : ranger par symbole interdit de
parcourir par mois. Les dossiers datés restent donc le rangement, et \`vues/\`
est le catalogue.

| | |
|---|---|
| \`vues/par-validite/<etat>/<date>.md\` | ton jugement d'abord, la date ensuite |
| \`vues/par-validite/<etat>/TOUT.md\` | l'ensemble d'un état, sans ouvrir chaque jour |
| \`vues/par-symbole/<SYMBOLE>.md\` | tout ce qui concerne un instrument |
| \`vues/par-mois/<AAAA-MM>.md\` | la vue chronologique |

**Rien d'unique n'y vit.** Chaque fiche se recalcule depuis \`index.jsonl\` à
chaque écriture ; supprimer \`vues/\` ne perd rien. Pour traiter le journal par
programme, lire \`index.jsonl\` — les vues sont pour l'œil.

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
