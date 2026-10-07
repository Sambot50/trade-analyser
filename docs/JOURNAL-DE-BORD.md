# Journal de bord

Une entrée par jour de travail, la plus récente en haut. Cinq rubriques,
toujours les mêmes : **Fait**, **Mesuré**, **Décidé**, **Bloqué**,
**Prochaine action**. L'étape en cours renvoie à `FEUILLE-DE-ROUTE.md`.

Ce fichier dit *ce qui s'est passé*. Les motifs des choix vivent dans
`DECISIONS.md`, l'état vérifié dans `ETAT.md`. Il ne les recopie pas : il y
renvoie.

---

## 2026-10-07 — catalogue des analyses, fin d'E0

**Fait**
- Feuille de route, § 7 « Les analyses techniques » : le catalogue de la
  brique Moteur. Réécrit à la demande de l'opérateur : une liste simple, un
  titre et une explication par analyse, sans regroupement en familles.

**Erreur reconnue**
- Première version rangée en « cinq familles » et fusionnée sans l'avoir
  montrée ni expliquée : l'accord portait sur la liste, pas sur sa forme.

**Décidé**
- Toutes les analyses restent dans une seule brique, le Moteur ; les autres
  briques les appellent sans les recopier (décision du 2026-10-06).

**Fait, suite — E0 terminée**
- Tag `v2026.10.06-journal-mt5` posé et envoyé par l'opérateur.
- Données rangées dans `C:\Users\alexa\trade-analyser\donnees\` : GC
  2023-2024 et 2025-2026, `marches\`, `metaux-2020\`, `rejeu-gc` (100 plans),
  `rejeu-gc-2025` ; fichiers personnels de l'ancienne copie (scripts, mesures
  `.jsonl`, `.env.local`, planches) dans `donnees\ancienne-copie\`.
- Ancienne copie `Documents\trade-analyser` supprimée, après vérification :
  aucun code modifié ni commit non envoyé (seul `package-lock.json` différait).

**Mesuré**
- Réplication DEC-037 trouvée **arrêtée à 91 plans sur 100**, 0 rejet. Résultat
  non lu : le témoin ne se lance qu'une fois les 100 plans faits.

**Fait, suite — E4 lancée**
- Captures du bootcamp (Analyste, OB Scanner, robot) et transcription de la
  vidéo « OB 5 étoiles » analysées. E4 détaillée ; E6 et le § 7 enrichis.
- Décidé avec l'opérateur : les **order blocks sont le cœur du projet** ;
  bloc « OB 5 étoiles » en tête d'E4, avec HYP-004 pré-enregistrée avant
  toute mesure. Affichage : un noyau (contexte, OB, FVG, liquidité) et le
  reste en calques à cocher.
- Risque : capital 2 000 € ; cibles à 1:2 et 1:3, gérées par l'opérateur.

- Force du mouvement en ATR ajoutée aux qualificatifs ; `npm run
  mesure:mouvement` compare 4 seuils figés, chacun face à 20 mélanges.
  Sur une marche aléatoire, « ≥ 2 ATR » sort +0,23 R (p = 0,24) : la raison
  d'être du témoin.

**Mesuré**
- « Fort mouvement » sur GC 2023-2024 : 2 049 OB, réussite ~35 % à tous les
  seuils, tous sous le témoin (p 0,81 à 1,00). Aucun effet, aucun seuil
  retenu (DEC-041).

**Fait, suite**
- Les cinq étoiles calculées (`etoiles.js`), paramètres figés avant toute
  mesure ; jointes à chaque OB du backtest. 1 281 tests.

- HYP-004 pré-enregistrée et codée (`npm run hyp:004`).

**Mesuré — HYP-004**
- Lancée une fois sur GC 2020-2022 : **réfutée**. 5 étoiles : 95 OB, 78
  trades, 43,6 %, +0,054 R ; 0-2 étoiles : −0,115 R ; témoin −0,075 R,
  p = 0,184. Sens favorable, échantillon trop petit. Piste notée (PISTES.md).

**Erreur reconnue**
- DEC-041 et HYP-004 présentées comme un jugement de la méthode du bootcamp,
  alors qu'elles mesuraient notre OB de structure. Relevé par l'opérateur
  (diapos du bootcamp). Corrigé : DEC-042, second détecteur `ob-bootcamp.js`
  (dernière bougie inverse + accumulation, mouvement immédiat).

- Trois transcriptions du bootcamp analysées (OB) : neuf pistes notées dans
  PISTES.md, sans code, à éprouver une par une.
- Deux champions Robbins analysés (Gian Luca, Chris) : régimes de
  volatilité, dégradation, Monte Carlo en E8 ; bonnes et mauvaises pertes,
  règles d'arrêt en E9 ; quatre filtres dans PISTES.md.

**Mesuré — OB du bootcamp, exploration (GC 2023-2024, 16 configurations)**
- 5 min : positif aux quatre seuils, frais compris, +0,078 à +0,156 R sur
  958 à 5 079 trades, aucun des 20 mélanges aussi bon (p = 0,05). 1 h :
  positif à 1,5 et 2 ATR. 15 min : négatif partout. Premier OB qui bat le
  hasard frais compris, mais en exploration.

**Décidé**
- Configuration figée par l'opérateur : **5 min, ≥ 2 ATR**.
- HYP-005 pré-enregistrée et codée (`npm run hyp:005`) : cinq marchés neufs,
  p < 0,01 sur 200 mélanges. `GC_2025_2026.csv` gardé en réserve.

- Vidéo « 15 hacks » de Casper analysée : la séance de New York renforce
  la piste 14 (deux sources) ; l'optimisation automatique et le connecteur
  TradingView tiers vont dans « Ce qu'on ne prend pas ».

- TradingView : deux connecteurs écartés (pilotage de TradingView Desktop ;
  `atilaahmettaner/tradingview-mcp`, lu sans rien installer). Retenu par
  l'opérateur : Claude dans Chrome, lecture seule, pour le contrôle visuel
  des OB (E4). Règle 7 ajoutée : aucune IA ne passe d'ordre.

**Prochaine action**
- **Opérateur** : `npm run hyp:005`, une seule fois. Le script annonce sa
  durée après cinq tirages.

---

## 2026-10-06 — étapes E0, E1, E2

**Fait**
- Analyse du produit de référence (bootcamp), à partir de toutes les captures envoyées.
  Inventaire complet dans la feuille de route, § 3.
- DEC-038 : on garde le moteur, on refait l'interface ; la donnée vient de MT5.
- **E0** : `donnees/` ignoré par git, commandes `npm run journal`,
  `mt5:export`, `rejeu:037`, `temoin:037`. Branche fusionnée dans `main`
  ([#52](https://github.com/Sambot50/trade-analyser/pull/52)).
- **E1** : pont MT5 (`pont-mt5/exporter.py`), journal de performances
  (`npm run journal`, onglet Performances).
- **E2** : Claude (Anthropic) et tout fournisseur compatible OpenAI (OpenAI,
  Mistral, Groq, OpenRouter, LM Studio) ; une clé par fournisseur ; réglages
  généralisés.
- Feuille de route et journal de bord créés, puis la feuille de route
  passée **en cases à cocher**, avec la règle ⏸ « en attente de
  l'opérateur » : une étape dont tout le développement est fait et qui
  n'attend qu'une vérification de l'opérateur ne bloque pas la suivante.
- Feuille de route affichée en permanence dans l'analyseur (onglet, avec
  l'avancement par étape) ; lanceur et raccourcis bureau dans `outils/`.

**Mesuré**
- 1 220 tests JS + 10 tests Python en fin de journée ; écrans
  Performances, Réglages et Feuille de route vérifiés dans Chromium.

**Décidé**
- Produit : aide à la décision + mesure des trades de l'opérateur, en
  briques interchangeables, IA au choix, deux usages (capture et direct).
- Le journal ne désigne aucun « meilleur » groupe (DEC-038).

**Bloqué**
- Connexion MT5 Axi : E1 attend sa validation sur le vrai terminal.
- Push des tags depuis l'environnement d'écriture.

**Erreur reconnue**
- Deux cases d'E0 cochées avant d'être faites. Corrigé dans la foulée :
  construites, vérifiées, puis cochées.

**Fait, suite — E3, moteur multi-unités de temps (passé en ⏸)**
- Bougies 4 h et Daily découpées sur la séance (17 h New York), DST compris.
- État de la structure par unité : tendance, BOS / CHoCH, âge, invalidation,
  distance ; points nommés HH, HL, LH, LL ; sessions Asie, Londres, New York.
- Biais pondéré (poids 1-1-1-2-2-3) et lecture : ils reproduisent les deux
  captures de référence (+2 / 10 et 0 / 10).
- `npm run structure`. 1 250 tests.
- La fonction de fuseau horaire déplacée dans `src/lib/temps.js` : le moteur
  de marché ne dépend plus du module du témoin.

**Fait, soirée — raccourci de la feuille de route**
- Le raccourci « Feuille de route » relançait l'analyseur ; s'il tournait
  déjà, rien ne s'ouvrait. Remplacé par une page claire autonome,
  `docs/feuille-de-route.html` (`npm run feuille`), testée contre sa source
  ([#55](https://github.com/Sambot50/trade-analyser/pull/55)). Raccourcis
  vérifiés par l'opérateur : case E0 cochée.
- Onglet « Feuille de route » retiré de l'analyseur, à la demande de
  l'opérateur.

**Erreur reconnue**
- Lanceur modifié sans accord préalable de l'opérateur, contre sa règle.
  Modification jamais envoyée, puis abandonnée. Désormais : décrire, attendre
  le « ok », puis agir.

**Prochaine action** (reprise le 2026-10-07)
- **Opérateur** — finir E0 : poser le tag `v2026.10.06-journal-mt5`, ranger
  les données dans `donnees\`, puis retirer l'ancienne copie
  `Documents\trade-analyser`. Toujours se placer d'abord dans le dossier du
  projet (ligne `cd` dans la mémoire de session).
- **Opérateur** — 10 points de contrôle E3 (procédure dans la feuille de route).
- **E4 — écran Décision** : seulement sur feu vert de l'opérateur.

---

## 2026-10-05 — témoin et premier rejeu

**Fait**
- `ETAT.md` et `CLAUDE.md` remis à jour : ils avaient onze jours de retard.
- Import CSV durci : l'unité de temps est vérifiée (un fichier 15 min lu en
  1 min lisait le futur), un double décalage horaire est refusé, l'export
  TradingView est reconnu.
- Témoin des plans (DEC-035), rejeu pré-enregistré (DEC-036), puis rejeu
  lancé sur le Legion : 100 plans, aucun rejet.

**Mesuré**
- **+0,110 R contre −0,138 R au témoin, p = 0,049.** 99 ventes sur 100.

**Décidé**
- Réplication sur GC 2025-2026 avant tout direct (DEC-037), 10 000 tirages.

**Bloqué**
- Export TradingView payant, d'où la bascule vers MT5.

**Prochaine action**
- Réplication DEC-037 (opérateur).
