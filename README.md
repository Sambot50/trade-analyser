# AI Trade Analyser

Lecture assistée de captures de graphiques : on importe une capture d'écran, un
modèle de vision en extrait un plan de trade, et les niveaux sont reprojetés sur
l'image.

Deux moteurs au choix, sélectionnables dans l'interface :

| Moteur | Coût | Compte | Lecture de l'axe |
|---|---|---|---|
| **Ollama** (local, par défaut) | gratuit | aucun | correcte, variable selon le modèle |
| **Gemini** (Google) | palier gratuit | clé API | meilleure |

## Démarrer

```bash
npm ci
npm run dev
```

Les graphiques de démonstration fonctionnent immédiatement, sans moteur
configuré. Ils sont signalés `SIMULATION` et ne déclenchent aucun appel.

## Moteur local — Ollama

C'est le mode par défaut : aucune clé, aucun compte, aucun quota, et
**aucun secret ne transite par le navigateur**.

**1. Installer Ollama** — https://ollama.com/download

**2. Récupérer un modèle de vision**

```bash
ollama pull qwen2.5vl:7b
```

Qwen2.5-VL est recommandé : c'est le plus solide des modèles compacts sur la
lecture de texte fin, et l'axe des prix est précisément du texte fin.
`qwen2.5vl:3b` suffit sur une machine modeste, au prix de la précision.

**3. Vérifier — il n'y a normalement rien à autoriser**

Ollama accepte les requêtes navigateur depuis n'importe quel port local par
défaut. Sa liste d'origines inclut `http://localhost:*`, ce qui couvre le
serveur de développement. Lance simplement :

```bash
ollama serve
```

L'écran de configuration de l'application sonde le serveur à l'ouverture et
liste les modèles réellement installés — un modèle absent est grisé. S'il
affiche « Ollama répond », tout est en place.

**Seulement si la sonde échoue** alors qu'`ollama serve` tourne, c'est que la
liste d'origines a été restreinte sur cette machine. Vérifie-la dans les logs
de démarrage (ligne `server config`, champ `OLLAMA_ORIGINS`), et rétablis un
réglage permissif plutôt que d'y mettre une seule URL :

```powershell
# Windows — supprime une restriction posée precedemment
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", $null, "User")
```

Définir `OLLAMA_ORIGINS` **remplace** la liste par défaut au lieu de s'y
ajouter : y mettre la seule URL de cette application couperait l'accès aux
autres clients Ollama de la machine.

## Moteur distant — Gemini

Copie `.env.example` vers `.env.local` et renseigne `VITE_GEMINI_API_KEY`, ou
saisis la clé dans l'interface. La clé reste en mémoire le temps de la session :
elle n'est écrite ni sur disque, ni dans le navigateur.

Le palier gratuit de l'API Gemini ne demande pas de carte bancaire. Il s'obtient
depuis Google AI Studio, pas depuis la console de facturation.

## Ce que l'outil ne fait pas

**Les niveaux ne sont pas mesurés, ils sont estimés par un modèle de vision.**
La lecture de l'axe des prix depuis une image est la faiblesse connue de ces
modèles : l'OCR des graduations passe, la projection d'une bougie vers un prix
dérive. Recoupe systématiquement sur ta plateforme avant toute exécution.

Trois garde-fous rendent cette dérive visible plutôt que silencieuse :

1. **Cohérence.** Toute analyse dont l'ordonnancement contredit la direction
   (`BUY` avec un stop au-dessus de l'entrée, TP2 qui n'étend pas TP1) est
   rejetée, jamais affichée.
2. **Projection falsifiable.** Le modèle doit renvoyer un repère `scale`
   — les prix lus en haut et en bas de la zone de tracé, et les bornes de cette
   zone dans l'image. Les lignes sont calculées depuis ce repère. Si le repère
   est incohérent, aucun overlay n'est tracé et l'interface le dit.
3. **Provenance.** Une analyse de démonstration porte un bandeau `SIMULATION`
   et l'export presse-papier est préfixé en conséquence.

Ces garde-fous comptent double avec un modèle local : un modèle plus faible
sera rejeté plus souvent, au lieu d'afficher des niveaux inventés.

Le ratio risque/rendement est recalculé en JavaScript et jamais lu dans la
réponse du modèle.

## Choisir ton modele — banc d'essai

Avant de faire confiance a un modele, mesure-le :

```bash
node scripts/bench-vision.mjs
```

Le script detecte tes modeles de vision installes, leur envoie un graphique de
reference dont l'echelle exacte est connue, et classe le resultat par
**derive** : de combien de pixels une ligne de niveau serait mal placee si tu
faisais confiance a ce modele.

```
< 10 px    utilisable
10-40 px   approximatif
> 40 px    inexploitable
```

Options utiles :

```bash
node scripts/bench-vision.mjs --models qwen2.5vl:7b,llava:13b
node scripts/bench-vision.mjs --image public/samples/eurusd-h1.png
```

Un modele qui renvoie un repere incoherent ou du texte au lieu de JSON apparait
en echec — c'est une information, pas un bug : ce modele ne convient pas.

## Calibrer dans l'interface

Les graphiques de démonstration sont servis en PNG et convertis en data-URI au
chargement, donc analysables comme une vraie capture. Leur échelle exacte est connue
(`scripts/make-samples.mjs`), ce qui en fait un banc d'essai :

1. charge `BTC/USDT (M15)` — l'overlay affiché est le repère exact ;
2. clique sur **Lancer l'analyse** — le modèle relit l'image de zéro ;
3. compare. Un écart important sur `scale` signale un modèle inadapté à la
   lecture de l'axe, avant que tu ne t'appuies dessus sur un vrai graphique.

## Journal

Chaque analyse réelle est enregistrée automatiquement, sans bouton à cliquer :
un journal qu'on alimente à la main se remplit trois fois puis s'arrête.

### Où vont les données

Le stockage du navigateur sert de **tampon**, jamais de mémoire — il s'efface
avec les données de site. La mémoire, ce sont des fichiers dans un dossier que
tu désignes, depuis l'onglet **Journal** → *Connecter un dossier*.

L'interface indique en permanence combien d'analyses n'ont pas encore atteint
le disque.

```
journal/
├─ RAPPORT.md      tableau de toutes les analyses + statistiques
├─ SCHEMA.md       documentation du format, générée depuis le code
├─ index.jsonl     un évènement par ligne
└─ 2026-09-22/184855-BTCUSDT-5m/
   ├─ capture.png  l'image soumise au modèle, octet pour octet
   ├─ overlay.png  le rendu affiché, niveaux tracés
   └─ analyse.json le détail
```

`index.jsonl` est un journal d'évènements, pas une table : constater une issue
**ajoute** une ligne pour le même `id`, le fichier n'est jamais réécrit. Pour
l'état courant, regrouper par `id` et garder la dernière ligne.

### Constater les issues

À l'ouverture de l'application, les analyses sans issue sont retentées
automatiquement sur les bougies d'une minute de Binance, sur un horizon de
24 heures. Tu ouvres l'outil le lendemain, le journal s'est mis à jour seul.

| | Résolution |
|---|---|
| Paires crypto cotées sur Binance | automatique |
| Forex, indices, actions | manuelle, dans l'onglet Journal |

Quand une même bougie touche le stop **et** un objectif, l'OHLC ne dit pas
lequel a été atteint en premier. Ces cas sont marqués `ambigu` et **exclus des
statistiques** : trancher au hasard biaiserait le taux de réussite.

### Pourquoi ce format

Un enregistrement doit être interprétable seul, par un humain comme par un
agent, sans lire le code qui l'a produit — d'où les noms complets, la devise
explicite, les seuils embarqués et le résumé en langue naturelle.

`RAPPORT.md` est le point d'entrée : quelques milliers de tokens pour cent
analyses, au lieu d'ouvrir cent fichiers JSON. Il répond à la seule question
qui compte — le taux de réussite dépasse-t-il le seuil d'équilibre qu'impose
le ratio médian, et la confiance déclarée par le modèle prédit-elle quoi que
ce soit.

## Architecture

```
src/lib/analysis.js          validation, ratio, projection prix → pixel (pur)
src/lib/image.js             conversion en data-URI PNG
scripts/bench-vision.mjs     banc d'essai des modèles de vision
src/lib/settings.js          préférences de moteur (jamais la clé API)
src/lib/journal/
  schema.js                  format d'enregistrement, index, réduction
  resolve.js                 issue d'un plan à partir de bougies (pur)
  market.js                  bougies publiques Binance
  report.js                  RAPPORT.md et statistiques
  schema-doc.js              SCHEMA.md, généré depuis le code
  store.js                   tampon IndexedDB et écriture disque
  index.js                   orchestration
src/JournalView.jsx          liste, issues, connexion du dossier
src/lib/providers/
  schema.js                  schéma et invite partagés, conversion Gemini
  ollama.js                  moteur local
  gemini.js                  moteur distant
  index.js                   registre et point d'entrée unique
```

`App.jsx` ne connaît que `analyzeChart(dataUrl, config)` et la table
`PROVIDERS` : ajouter un moteur ne touche pas l'interface.

## Tests

```bash
npm test
```

112 tests sur la logique pure : cohérence des plans, ratio, projection,
exclusion des niveaux hors cadre, conversion de schéma, tolérance du JSON
renvoyé, règles d'accès aux fournisseurs, format d'enregistrement, réduction
du journal d'évènements, statistiques, et résolution des issues — entrée
jamais atteinte, stop avant objectif, objectif avant stop, bougie ambiguë,
horizon dépassé, dans les deux sens de marché.

L'appel réseau à Binance n'est pas couvert : les API de marché étaient
inaccessibles depuis l'environnement où ce code a été écrit. L'algorithme qui
exploite les bougies, lui, est testé exhaustivement contre des jeux
fabriqués, et toute défaillance réseau est annoncée sans être masquée.

## Déploiement

Prévu pour un usage local. Vite inline les variables `VITE_*` dans le bundle :
un build contenant `VITE_GEMINI_API_KEY` expose la clé à quiconque lit le code
servi. Le moteur Ollama n'a pas ce défaut, puisqu'il n'utilise aucune clé.
