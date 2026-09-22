# AI Trade Analyser

Lecture assistée de captures de graphiques : on importe une capture d'écran, un
modèle de vision (Gemini 2.5 Flash) en extrait un plan de trade, et les niveaux
sont reprojetés sur l'image.

## Démarrer

```bash
npm install
npm run samples   # génère les graphiques de démonstration
npm run dev
```

Sans clé API, seuls les graphiques de démonstration sont exploitables. Ils sont
signalés comme tels et ne déclenchent aucun appel réseau.

Pour l'analyse réelle, copie `.env.example` vers `.env.local` et renseigne
`VITE_GEMINI_API_KEY`, ou saisis la clé dans l'interface.

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

Le ratio risque/rendement est recalculé en JavaScript et jamais lu dans la
réponse du modèle.

## Tests

```bash
npm test
```

Les tests couvrent la logique pure : validation de cohérence, calcul du ratio,
projection prix → pixel et exclusion des niveaux hors cadre.

## Graphiques de démonstration

`scripts/make-samples.mjs` génère deux SVG déterministes dans `public/samples/`.
Leur échelle exacte est connue, ce qui en fait un test de bout en bout de la
projection — l'overlay de la démo est juste au pixel près.

Ils ne valident **pas** la lecture vision : un SVG généré n'a ni bruit, ni
anticrénelage, ni typographie d'écran. Pour éprouver ce chemin, il faut de
vraies captures TradingView.

## Déploiement

Prévu pour un usage local. Vite inline les variables `VITE_*` dans le bundle :
un build contenant `VITE_GEMINI_API_KEY` expose la clé à quiconque lit le code
servi. Ne pas déployer tel quel sur un hébergement public.
