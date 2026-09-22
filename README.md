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

**3. Autoriser la page web à parler à Ollama**

Ollama refuse par défaut les requêtes venant d'un navigateur. Il faut déclarer
l'origine autorisée, une seule fois.

Windows (PowerShell) :

```powershell
setx OLLAMA_ORIGINS "http://localhost:5173"
```

macOS / Linux :

```bash
launchctl setenv OLLAMA_ORIGINS "http://localhost:5173"   # macOS
export OLLAMA_ORIGINS="http://localhost:5173"             # Linux
```

Puis **redémarre Ollama** — quitter l'icône de la barre des tâches et le
relancer suffit. Sans cette étape, l'interface affiche « Ollama ne répond
pas » alors que le serveur tourne : c'est le navigateur qui est bloqué, pas
Ollama.

L'écran de configuration sonde le serveur à l'ouverture et liste les modèles
réellement installés — un modèle absent est grisé.

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

## Calibrer ton moteur

Les graphiques de démonstration sont rasterisés en PNG au chargement, donc
analysables comme une vraie capture. Leur échelle exacte est connue
(`scripts/make-samples.mjs`), ce qui en fait un banc d'essai :

1. charge `BTC/USDT (M15)` — l'overlay affiché est le repère exact ;
2. clique sur **Lancer l'analyse** — le modèle relit l'image de zéro ;
3. compare. Un écart important sur `scale` signale un modèle inadapté à la
   lecture de l'axe, avant que tu ne t'appuies dessus sur un vrai graphique.

## Architecture

```
src/lib/analysis.js          validation, ratio, projection prix → pixel (pur)
src/lib/image.js             rasterisation en data-URI PNG
src/lib/settings.js          préférences de moteur (jamais la clé API)
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

40 tests sur la logique pure : cohérence, ratio, projection, exclusion des
niveaux hors cadre, conversion de schéma, tolérance du JSON renvoyé, règles
d'accès aux fournisseurs.

## Déploiement

Prévu pour un usage local. Vite inline les variables `VITE_*` dans le bundle :
un build contenant `VITE_GEMINI_API_KEY` expose la clé à quiconque lit le code
servi. Le moteur Ollama n'a pas ce défaut, puisqu'il n'utilise aucune clé.
