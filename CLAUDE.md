# CLAUDE.md — trade-analyser

Contexte lu au démarrage de chaque session Claude Code sur ce dépôt.

## Ce qu'est ce projet

Une application locale qui lit une capture de graphique de trading, en extrait
un plan de trade via un modèle de vision, reprojette les niveaux sur l'image,
et journalise le tout pour mesurer si ces plans valent quelque chose.

**État honnête au 2026-09-22 :** la lecture de graphique fonctionne et a été
vérifiée sur une capture TradingView réelle. La **qualité des plans de trade**
produits n'est pas établie — un seul essai réel, qui a donné un ratio
risque/rendement de 0,87 et un raisonnement contredisant ses propres niveaux.
Le journal existe précisément pour trancher cette question, pas pour la
supposer résolue.

Ne jamais présenter cet outil comme validé. Il sait lire un axe de prix. Il ne
sait pas encore raisonner dessus.

## Les trois garde-fous — ne pas les retirer

Ils existent parce qu'un outil qui produit des signaux de trading ne doit
jamais faire passer une estimation pour une mesure.

1. **Cohérence.** Toute analyse dont l'ordonnancement contredit la direction
   (`BUY` avec un stop au-dessus de l'entrée, TP2 qui n'étend pas TP1) est
   rejetée avant affichage. Jamais corrigée en silence.
2. **Projection falsifiable.** Le modèle doit renvoyer un repère `scale`. Les
   lignes sont calculées depuis lui. Repère incohérent, ou trait hors de
   l'image, on ne trace pas et on le dit. Tracer à des hauteurs arbitraires
   produirait une image qui ressemble à une mesure sans en être une — c'était
   le défaut de la toute première version.
3. **Provenance.** Une analyse de démonstration porte un bandeau `SIMULATION`
   et préfixe l'export presse-papier. Sans moteur configuré, l'analyse d'une
   image importée est **refusée**, jamais remplacée par un exemple.

Corollaire : le ratio risque/rendement est recalculé en JavaScript, jamais lu
dans la réponse du modèle. Un LLM se trompe en arithmétique.

Deux invariants du socle de mesure relèvent du même principe :

4. **Aucune lecture du futur.** Un évènement est daté à l'instant où il
   devient connaissable — une cassure à la **fermeture** de sa bougie, jamais
   à son ouverture. D'où `fermetureMs` sur chaque bougie, quelle que soit sa
   source, et le refus de `creerCassure` d'en produire une sans. Ce bug a
   existé : corrigé, le taux mesuré est passé de 62 % à 45 %. Voir DEC-013.
5. **Ce qui manque reste absent.** Un CSV de CFD ne porte pas le détail
   acheteur/vendeur : `delta` y vaut `null` et l'analyse de volume ne rend
   rien. Le déduire du sens de la bougie fabriquerait un indicateur qui ne
   mesure que ce qu'on sait déjà.
6. **Une seule règle de sortie par plan, choisie avant d'ouvrir.**
   `resoudreIssue` exige `objectif` (`1r` ou `2r`) et refuse de trancher sans.
   Sous `2r`, un trade passé par TP1 puis stoppé est un stop à −1 R. Créditer
   les deux branches est une lecture du futur : ça produisait +0,330 R par
   trade sur des marches aléatoires. Voir DEC-015.
7. **Compter les essais.** Le contrôle par permutation compare une règle au
   hasard, une règle à la fois ; il ne sait pas combien de configurations ont
   été essayées avant. Six essais suffisent à produire un p de 0,13 par pur
   hasard une fois sur deux. Un indice trouvé après exploration se teste sur
   des données jamais regardées, avec la règle de décision écrite d'avance —
   voir DEC-018.
8. **Aucun résultat sans témoin.** Une espérance ne se lit que face à la
   distribution obtenue sur les mêmes bougies mélangées (`--controle`). Sur du
   bruit pur, la chaîne rend +0,407 R de médiane : un chiffre flatteur produit
   par rien du tout. Voir DEC-014.

## Commandes

```bash
npm ci
npm run dev                      # http://localhost:5173
npm test                         # 344 tests
npm run build
node scripts/bench-vision.mjs    # classe les modèles Ollama installés

# Backtest — deux sources, une chaîne
node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01
node scripts/backtest.mjs --csv XAUUSD_M1_2025.csv --decalage-heures -5 --spread 0.25

# Contrôle par permutation : la règle bat-elle le hasard sur ces données ?
node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01 --controle 100

# Croiser les qualificatifs avec l'issue, corrigé pour la recherche elle-même
node scripts/analyser-export.mjs cas.jsonl 200
npm run samples                  # régénère les graphiques de référence
```

## Conventions

- **Langue** : français, code comme documentation.
- **Dates** : `YYYY-MM-DD`, horodatages ISO 8601 UTC. Sans exception.
- **Rien n'est poussé sans avoir été exécuté.** Tests et build passent avant
  chaque push. Si une partie n'a pas pu être vérifiée, c'est écrit dans le
  code et dans le message de commit — voir `market.js`.
- **Branches** : `main` reste l'état qui marche, une branche par changement,
  un tag à chaque état stable. Le retour arrière est `git checkout <tag>`.
- **Commits** : expliquer le *pourquoi*, pas le *quoi*. Le diff dit déjà quoi.

## Mémoire et documentation

Ce dépôt contient la **documentation du projet** : `docs/DECISIONS.md` pour
les choix d'architecture et leur motif, `docs/ETAT.md` pour ce qui est vérifié
et ce qui ne l'est pas, `docs/PISTES.md` pour ce qu'on a rencontré sans
l'éprouver et `docs/DONNEES.md` pour les sources de bougies.

`PISTES.md` est une **file d'attente, pas un menu** : une piste en sort quand
une mesure la désigne, jamais parce qu'une mesure décevante donne envie
d'essayer autre chose. Voir DEC-022.

Il ne contient **aucun registre de mémoire agent**. Ceux-ci vivent dans
Notion, page « 🧠 Claude » → « 🧠 Memory Claude », différenciés par propriété
`Projet`. Ne jamais en recréer ici : une même information dans deux magasins
finit par diverger, et c'est documenté dans BLK-016.

## Ce qui n'est pas vérifié

- **L'appel réseau à Binance** (`src/lib/journal/market.js`). Les API de
  marché étaient inaccessibles depuis l'environnement d'écriture. L'algorithme
  qui exploite les bougies est testé exhaustivement ; la récupération ne l'est
  pas. Elle échoue bruyamment.
- **La robustesse de la lecture d'axe** sur d'autres styles de graphique,
  unités de temps et actifs. Un seul essai réel à ce jour.

Voir `docs/ETAT.md` pour le détail.
