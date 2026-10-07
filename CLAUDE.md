# CLAUDE.md — trade-analyser

Contexte lu au démarrage de chaque session Claude Code sur ce dépôt.

## Ce qu'est ce projet

Une application locale qui lit une capture de graphique de trading, en extrait
un plan de trade via un modèle de vision, reprojette les niveaux sur l'image,
et journalise le tout pour mesurer si ces plans valent quelque chose.

**État honnête au 2026-10-05 :** la lecture de graphique fonctionne, par le
modèle de vision comme par la géométrie seule, et chacune a été vérifiée sur
une seule capture TradingView réelle. La **qualité des plans de trade**
produits n'est pas établie — un seul essai réel, qui a donné un ratio
risque/rendement de 0,87 et un raisonnement contredisant ses propres niveaux.
Le journal existe précisément pour trancher cette question, pas pour la
supposer résolue. Premier rejeu (DEC-036) : +0,110 R contre −0,138 R au
témoin, p = 0,049, soit un passage d'un millième, avec un modèle qui vend 99 fois
sur 100. Réplication pré-enregistrée (DEC-037), pas encore lancée.

Côté mesure, rien n'a encore payé ses frais : la règle des order blocks est
close (DEC-025, DEC-029), le volume prédit l'amplitude et jamais la direction
(DEC-031), et l'effet des métaux (HYP-001, HYP-002) rétrécit à chaque mesure
plus juste (DEC-033). La friction vaut 0,08 R par trade (DEC-034).

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
npm test                         # 1 266 tests (2026-10-07), dont le pont MT5 en Python
npm run build
node scripts/bench-vision.mjs    # classe les modèles Ollama installés

# Backtest — deux sources, une chaîne
node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01
node scripts/backtest.mjs --csv XAUUSD_M1_2025.csv --decalage-heures -5 --spread 0.25
node scripts/backtest.mjs --csv "OANDA_XAUUSD, 1.csv" --spread 0.25   # export TradingView

# Contrôle par permutation : la règle bat-elle le hasard sur ces données ?
node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01 --controle 100

# Résoudre UN plan — sur Binance, ou sur l'export TradingView du graphique analysé
node scripts/resoudre-plan.mjs --csv "OANDA_XAUUSD, 1.csv" --le 2026-09-22T18:48:55Z \
  --direction BUY --entree 2650 --stop 2645 --tp1 2655 --tp2 2660

# Windows : raccourcis bureau (analyseur, feuille de route) — à lancer une fois
powershell -ExecutionPolicy Bypass -File outils\creer-raccourcis.ps1

# Toutes les données locales vivent dans donnees/ (ignoré par git) — DEC-038
npm run mt5:export               # historique du compte MT5 (Axi) → donnees/mt5, en UTC
npm run mt5:export -- --bougies XAUUSD --depuis 2026-01-01   # + bougies M1
npm run journal                  # journal de performances depuis l'export MT5
npm run structure -- --csv donnees/GC_2025_2026.csv --a 2026-07-15T12:30:00Z   # tableau multi-UT
npm run rejeu:037                # réplication DEC-037 ; npm run temoin:037 ensuite
npm run mesure:mouvement         # OB : réussite par force du mouvement (1-3 ATR), face au témoin

# Rejeu pré-enregistré (DEC-036) : 100 jours de GC rejoués au modèle, puis le témoin, UNE fois.
# Ne jamais relancer dans un autre dossier pour obtenir un autre p.
node scripts/rejouer.mjs --csv GC_2023_2024.csv --symbole GC --sortie rejeu-gc
node scripts/temoin.mjs --journal rejeu-gc --symbole GC --csv GC_2023_2024.csv
# Réplication (DEC-037), sur des jours jamais montrés au modèle
node scripts/rejouer.mjs --csv GC_2025_2026.csv --symbole GC --sortie rejeu-gc-2025 --protocole DEC-037
node scripts/temoin.mjs --journal rejeu-gc-2025 --symbole GC --csv GC_2025_2026.csv

# Témoin des plans du journal : le modèle choisit-il mieux ses moments que le hasard ?
# Réglages figés par DEC-035 et DEC-036, aucune option pour les changer.
node scripts/temoin.mjs --journal <dossier du journal> --symbole XAUUSD --csv XAUUSD_M1.csv

# Croiser les qualificatifs avec l'issue, corrigé pour la recherche elle-même
node scripts/analyser-export.mjs cas.jsonl 200

# Confirmer UNE hypothèse pré-enregistrée, sur données jamais regardées
node scripts/tester-hypothese.mjs cas.jsonl zoneSurAtr 1.1915

# Contrats à terme (CSV Databento) — volume, résolution, fiche
node scripts/dimensionner.mjs --csv GC_2023_2024.csv --taille-contrat 100
node scripts/resolution.mjs --csv GC_2023_2024.csv
node scripts/plan.mjs --csv GC_2023_2024.csv

# Carnet de trades réels, en ajout seul — hors dépôt (*.jsonl)
node scripts/carnet.mjs --ouvrir --marche GC --tranche 2.4 --sens achat \
                        --entree 4320.5 --stop 14.6 --objectif 16.8
node scripts/carnet.mjs --fermer 7 --sortie 4305.9 --issue stop --frais 0.4
node scripts/carnet.mjs --bilan

npm run assets:ocr               # rapatrie les fichiers Tesseract (aussi en postinstall)
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

**La feuille de route se suit étape par étape** : `docs/FEUILLE-DE-ROUTE.md`
fixe l'ordre, les livrables et le critère de fin de chaque étape, et l'étape en
cours. Une idée qui n'y figure pas ne se code pas : elle s'y ajoute d'abord.
**`docs/JOURNAL-DE-BORD.md` reçoit une entrée par jour de travail** (fait,
mesuré, décidé, bloqué, prochaine action). Voir DEC-039.

Ce dépôt contient la **documentation du projet** : `docs/DECISIONS.md` pour
les choix d'architecture et leur motif — ainsi que les hypothèses gelées
(HYP-xxx) et les errata —, `docs/ETAT.md` pour ce qui est vérifié et ce qui ne
l'est pas, `docs/PISTES.md` pour ce qu'on a rencontré sans
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
  unités de temps et actifs. Un seul essai réel à ce jour, pour chacune des
  deux lectures.
- **Les appels réseau vers Claude et les fournisseurs compatibles OpenAI**
  (`src/lib/providers/`). Requêtes et réponses testées contre des formes
  construites d'après la documentation ; aucun appel réel depuis ici.
- **Le pont MT5 face au vrai terminal** (`pont-mt5/exporter.py`). Éprouvé
  contre un faux module ; l'heure du serveur Axi (New York + 7 h) est vérifiée
  à chaque export, mais n'a jamais été mesurée depuis l'environnement d'écriture.
- **L'export CSV de TradingView.** Reconnu d'après un fichier construit sur
  la description du format ; aucun export réel n'a encore été lu.
- **La justesse des bougies lues par la géométrie.** Le test sur capture
  réelle borne des distributions ; il ne compare pas chaque bougie aux prix
  vrais.

Voir `docs/ETAT.md` pour le détail.
