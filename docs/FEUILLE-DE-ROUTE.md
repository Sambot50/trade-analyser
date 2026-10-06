# Feuille de route

Créée le 2026-10-06. **Elle se suit étape par étape.** Une étape n'est
commencée que quand la précédente a passé son critère de fin. Une idée qui
n'est pas ici ne se code pas : elle s'ajoute d'abord à la feuille de route, à
sa place. L'avancement du jour s'écrit dans `JOURNAL-DE-BORD.md`.

---

## 1. Le produit

**Un outil d'aide à la décision qui mesure les trades de son opérateur.** Ce
n'est pas un robot qui trade à sa place.

Deux usages :

1. **Analyse d'une capture** : l'opérateur dépose un graphique et reçoit un
   rapport (structure, liquidité, zones, scénario, plan avec stop), calculé
   par le moteur et rédigé par une IA au choix.
2. **Surveillance en direct** : le moteur lit les marchés en continu (via MT5,
   compte Axi) et envoie les opportunités détectées (Telegram), chacune avec
   ses statistiques mesurées.

Quatre principes, non négociables :

| Principe | Ce qu'il veut dire dans le code |
|---|---|
| **Lego** | Chaque brique a un contrat et se remplace sans toucher aux autres (§ 4). |
| **N'importe quelle IA** | Ollama, Gemini, Claude, ou tout fournisseur compatible OpenAI (OpenAI, Mistral, Groq, OpenRouter, LM Studio…). Changer d'IA ne change aucun garde-fou. |
| **Calculé, pas deviné** | Les niveaux (structure, zones, invalidation) viennent du moteur. L'IA rédige ; elle n'invente aucun chiffre. |
| **Mesuré, pas promis** | Aucune note, étoile ou probabilité affichée sans mesure derrière. Chaque signal porte ses chiffres réels, ou la mention qu'ils manquent. |

---

## 2. Retour d'expérience, du 2026-09-22 au 2026-10-06

### Ce qu'on a construit, dans l'ordre

| Période | Ce qui a été fait | Ce qu'on en a appris |
|---|---|---|
| 2026-09-22 | **Premier analyseur** : capture → IA de vision → plan tracé sur l'image | Les lignes étaient tracées à des hauteurs arbitraires : l'image *ressemblait* à une mesure. → La projection doit être ancrée sur l'axe lu (DEC-002, DEC-003). |
| 2026-09-22 | Premier essai réel | Ratio de 0,87 et raisonnement qui contredisait ses propres niveaux. → Rejet de toute analyse incohérente ; ratio recalculé en JS, jamais lu dans la réponse (garde-fou 1). |
| 2026-09-22 | Choix du modèle local par banc d'essai | Le modèle réputé (`qwen2.5vl:7b`) échouait ; `qwen3.8:27b` lit l'axe à 2,3 px. → Choisir par la mesure (DEC-005). |
| 2026-09-23 | Journal et résolution automatique des issues | Le journal ne résolvait que la crypto (Binance). → Le verrou « donnée en direct sur l'or » date d'ici. |
| 2026-09-23 | Backtest de la règle des order blocks | **Trois défauts de mesure trouvés** : une cassure datée à l'ouverture de sa bougie, soit une lecture du futur (62 % → 45 %, DEC-013) ; deux issues créditées pour un même trade (+0,33 R fabriqués, DEC-015) ; sur du bruit pur, +0,407 R (DEC-014). → **Aucun chiffre sans témoin.** |
| 2026-09-24 | Tests pré-enregistrés de la règle OB | Six configurations essayées suffisent à fabriquer un p de 0,13 (DEC-018). Sur cinq jeux de données, la règle **ne bat pas le hasard** (DEC-025, DEC-029). |
| 2026-09-25 → 30 | Le volume sur les contrats à terme | Le volume prédit **l'amplitude, jamais la direction** (DEC-031). Erreur type fausse d'un facteur 3,7 (DEC-032). Dénominateur creux d'un seul côté (DEC-033). **Frais : 0,08 R par trade** (DEC-034). Stop annoncé ≠ stop mesuré (ERRATUM-001). |
| 2026-10-03 | Lecture géométrique d'une capture, sans IA | L'OCR n'avait jamais tourné malgré des tests verts (moteur simulé). → **Tester sur une vraie capture.** Les dessins de l'utilisateur étaient lus comme des bougies. |
| 2026-10-05 | Témoin des plans, rejeu pré-enregistré | Le modèle a fait +0,110 R contre −0,138 R au témoin : **p = 0,049**, un passage d'un millième. Il a **vendu 99 fois sur 100**. Un TP2 était crédité 2 R quelle que soit sa distance : corrigé avant toute lecture. |
| 2026-10-06 | Référence du bootcamp, puis pont MT5 et journal de performances | Leur ergonomie est bonne ; leurs performances affichées ne sont pas mesurées (profit factor 56, Sharpe 74 sur 31 trades, « exécution idéale »). → On reprend la forme, pas les chiffres (DEC-038). |

### Les leçons, en une ligne chacune

1. **Un test vert sur un moteur simulé ne prouve rien du vrai.** L'OCR, Binance et le pont MT5 en sont l'illustration.
2. **Toute mesure flatteuse cache d'abord un défaut de mesure** : lecture du futur, double crédit, dénominateur creux, TP mal crédité. On les cherche avant de croire le chiffre.
3. **Un chiffre ne se lit que face à son témoin.** Du bruit pur rend +0,407 R.
4. **On décide d'avance, on ne regarde qu'une fois.** Pré-enregistrer l'effectif, le seuil et la règle de décision.
5. **Un effet qui rétrécit à chaque mesure tend vers zéro.**
6. **L'IA écrit bien et calcule mal.** Les niveaux doivent venir du moteur.
7. **Les frais décident avant la direction.** 0,08 R par trade suffit à tuer un petit avantage.
8. **La donnée est le verrou**, pas l'algorithme. D'où le pont MT5.
9. **Se disperser coûte des jours.** TradingView payant, emplacement des données, deux copies du projet, détours : d'où cette feuille de route.
10. **Le temps de l'opérateur est rare.** Une commande courte par action (`npm run …`).

---

## 3. Les fonctionnalités de la référence, et où elles vont

Inventaire complet des captures du bootcamp (2026-10-06). **Statut** :
✅ existe · 🟡 partiel · ⬜ à faire · 🔁 repris sous une forme mesurée.

| Fonctionnalité vue | Brique | Étape | Statut |
|---|---|---|---|
| **Analyste** : dépôt d'une capture + notes facultatives | Décision | E4 | 🟡 dépôt ✅, notes ⬜ |
| Checklist « bonne capture » (unité de temps visible, échelle lisible, 50-100 bougies, pas d'indicateurs superflus, volumes si possible) | Décision | E4 | ⬜ |
| Rapport : vue d'ensemble, biais, phase, dernier évènement, pattern structurel | Moteur + IA | E3, E4 | 🟡 calcul ✅ sur une unité de temps |
| Points structurels (HH, LH, LL…) avec dates et prix | Moteur | E3 | 🟡 pivots ✅, libellés ⬜ |
| Liquidité acheteuse / vendeuse (BSL / SSL), balayage récent | Moteur | E3 | 🟡 prise de liquidité ✅ |
| Zones d'offre et de demande, avec « force » | Moteur + Labo | E3, E8 | 🔁 force = statistique mesurée, pas étoiles |
| FVG, breaker blocks | Moteur | E3 | 🟡 FVG ✅, breaker ⬜ |
| Scénario principal / alternatif, déclencheur, cibles, invalidation | Décision | E4 | ⬜ (avec **stop obligatoire**) |
| « Probabilité estimée 65 % / 35 % » | Labo | E8 | 🔁 remplacée par le taux mesuré du signal |
| Niveaux à surveiller, conclusion, confiance | Décision + IA | E4 | ⬜ |
| **Coach** (onglet) | Journal + IA | E9 | ⬜ (retour sur TES trades mesurés) |
| **KTA MTF** : tableau 5m → Daily, structure, BOS/CHoCH, âge, invalidation, distance, biais pondéré, lecture | Multi-UT | E3 | ⬜ |
| OB « 5 étoiles », Imbalance, Swing Points, session asiatique, supports/résistances | Moteur | E3, E5 | 🟡 OB ✅ FVG ✅ swings ✅, sessions ⬜, S/R ⬜ |
| Analyse **par capture** | Décision | E4 | 🟡 |
| Analyse **en direct**, multi-marchés | Source + Scanner | E5, E6 | ⬜ (attend MT5) |
| **OB Scanner** : scanner, OB touchés, réaction, achat / vente, « dans la zone », « prix à x % » | Scanner | E6 | ⬜ |
| **Alertes Telegram** par catégorie (Nasdaq, matières premières, crypto, Forex) | Notificateur | E7 | ⬜ |
| **Journal** : entrées / sorties, gains, durée, taux, gain moyen, profit factor, Sharpe, P&L, heures, jours, setup | Journal | E1 | ✅ (sans désigner de « meilleur ») |
| **Robot OrderBlock IA** (tendance H4, score, rejet confirmé, ratio 2, fenêtre horaire, gestion du lot, break-even) | Exécution | E10 | ⬜ semi-automatique, validé par l'opérateur, et seulement pour un signal qui a passé le Labo |
| Backtests MT5 (Strategy Tester) | Labo | E8 | 🔁 notre labo : témoin, pré-enregistrement, frais réels |
| Claude relié au broker par MCP | Source + Exécution | E5, E10 | ⬜ lecture d'abord, ordres jamais sans validation |
| **IA au choix** | IA | E2 | ✅ |

---

## 4. L'architecture en briques

Chaque brique a un **contrat** : ce qu'elle reçoit, ce qu'elle rend. Une
brique se remplace par une autre qui respecte le même contrat.

| Brique | Contrat | Implémentations | Dossier |
|---|---|---|---|
| **Source** | `bougies({ symbole, unite, depuisMs, jusquaMs })` → bougies avec `fermetureMs`, en UTC | CSV ✅ · Binance ✅ · capture (géométrie) ✅ · MT5 fichiers ✅ · MT5 direct ⬜ | `src/lib/sources/` (E5) |
| **Moteur** | `(bougies, options)` → trouvailles typées (registre `TYPES`) | structure, OB, FVG, liquidité, qualificatifs ✅ · sessions, S/R, breaker ⬜ | `src/lib/marche/` |
| **Multi-UT** | `tableauMultiUT(bougies1m, { aMs, unites, fenetre, seance })` → une ligne par unité (tendance, BOS/CHoCH, âge, invalidation, distance, points nommés) + biais pondéré + lecture. Bougies 1 min d'**un seul contrat** ; rien après `aMs` | ✅ | `src/lib/marche/multiut.js` |
| **IA** | `analyze(image, config)` → objet d'`ANALYSIS_SCHEMA` · plus tard `rediger(contexte)` → texte | Ollama ✅ · Gemini ✅ · Claude ✅ · compatible OpenAI ✅ | `src/lib/providers/` |
| **Décision** | trouvailles + IA → rapport + plan (stop obligatoire, R, taille) | ⬜ | `src/` (E4) |
| **Scanner** | source + moteur, sur une liste d'actifs → opportunités | ⬜ | (E6) |
| **Notificateur** | `envoyer(opportunite)` | console ⬜ · Telegram ⬜ | (E7) |
| **Journal** | export MT5 → positions → performances | ✅ | `src/lib/journal/` |
| **Labo** | backtest, témoin, rejeu, pré-enregistrement | ✅ | `scripts/`, `src/lib/journal/temoin.js` |
| **Exécution** | ordre préparé → validé par l'opérateur → envoyé | ⬜ | (E10) |

Les garde-fous de `CLAUDE.md` s'appliquent à toutes les briques, quelle que
soit l'implémentation branchée.

---

## 5. Les étapes, en cases à cocher

**Légende.** `[x]` fait et vérifié · `[ ]` reste à faire · 🔵 étape en cours ·
⏸ en attente de l'opérateur (tout le développement est fait, il ne reste
qu'une vérification de son côté) · ⬜ pas commencée.

Une case ne se coche que quand le travail est **vérifié** (tests, build, ou
essai réel quand la case le dit). Une case cochée à tort se décoche, et
l'erreur s'écrit au journal.

### Où on en est

| Étape | Statut | Reste |
|---|---|---|
| E0 Remise à plat | ⏸ | tag à poser, ancienne copie à retirer (opérateur) |
| E1 Pont MT5 + journal | ⏸ | validation sur le vrai terminal Axi (connexion à rétablir) |
| E2 IA interchangeables | ⏸ | un essai réel avec deux IA différentes |
| E3 Moteur multi-unités de temps | ⏸ | 10 points de contrôle relevés sur TradingView (opérateur) |
| **E4 Écran Décision** | ⬜ prochaine | tout |
| E5 → E10 | ⬜ | — |

---

### E0 — Remise à plat ⏸

- [x] Branche de travail fusionnée dans `main` (#52)
- [x] `donnees/` ignoré par git ; il ne quitte jamais la machine
- [x] Commandes courtes : `npm run journal`, `mt5:export`, `rejeu:037`, `temoin:037`
- [x] Feuille de route et journal de bord créés (DEC-039)
- [x] Feuille de route affichée dans l'analyseur (onglet « Feuille de route »)
- [x] Lanceur et script de raccourcis écrits (`outils/`) — Windows : non exécutables d'ici
- [ ] **Opérateur** — lancer `outils/creer-raccourcis.ps1` et vérifier les deux raccourcis
- [ ] **Opérateur** — poser le tag `v2026.10.06-journal-mt5` (le push de tags échoue d'ici)
- [ ] **Opérateur** — retirer l'ancienne copie `Documents\trade-analyser` une fois les données déplacées

### E1 — Pont MT5 + journal de performances ⏸

- [x] Pont `pont-mt5/exporter.py` : transactions, ordres, compte, bougies
- [x] Heure du serveur Axi convertie en UTC (New York + 7 h), vérifiée à chaque export
- [x] Positions reconstituées depuis les transactions, R sur le stop d'ouverture
- [x] Métriques : réussite et intervalle, profit factor, P&L, frais, gain et perte moyens, creux, durée, Sharpe
- [x] Ventilations par heure, jour, setup, symbole, sens — sans « meilleur » désigné
- [x] Commande `npm run journal` et onglet « Performances »
- [x] Tests : 10 Python (faux terminal), JS de bout en bout
- [ ] **Opérateur** — `pip install MetaTrader5`, MT5 ouvert, `npm run mt5:export`
- [ ] **Opérateur** — la ligne « Heure du serveur » dit « confirmée » (marché ouvert)
- [ ] **Opérateur** — trois trades du journal comparés à l'historique MT5 : identiques
- [ ] Ajuster ce que le vrai terminal révèle (s'il révèle quelque chose)

### E2 — IA interchangeables ⏸

- [x] Contrat commun des fournisseurs (politique de clé, adresse, modèle)
- [x] Claude (Anthropic) : sortie imposée par outil
- [x] Compatible OpenAI : OpenAI, Mistral, Groq, OpenRouter, LM Studio
- [x] Une clé par fournisseur, en mémoire seulement
- [x] Réglages généralisés, vérifiés dans Chromium
- [x] Toute réponse repasse par `validateAnalysis`, quelle que soit l'IA
- [ ] **Opérateur** — une capture analysée avec deux IA différentes (ex. Ollama et Claude)
- [ ] Corriger ce que les vrais appels révèlent (s'ils révèlent quelque chose)

### E3 — Moteur multi-unités de temps ⏸

- [x] État final de la structure par unité de temps : tendance, dernier évènement (BOS / CHoCH), âge, niveau d'invalidation, distance
- [x] Bougies 4 h et journalières découpées sur la **séance** (17 h New York), comme TradingView pour l'or et le Forex, et non sur minuit UTC
- [x] Tableau 5 min → Daily, calculé sur des bougies 1 min, **sans lecture du futur**
- [x] Biais pondéré sur 10, poids déclarés et visibles (ils reproduisent les deux captures de référence : +2 et 0)
- [x] Lecture en une phrase (alignement, repli dans la tendance de fond, conflit)
- [x] Points structurels nommés : HH, HL, LH, LL, datés de leur confirmation
- [x] Sessions : Asie, Londres, New York (plus hauts, plus bas, balayages)
- [x] Commande `npm run structure` sur un fichier de `donnees/`, contrat par contrat
- [x] Tests : chaque cas du tableau, et l'absence de lecture du futur
- [x] Contrat de la brique Multi-UT écrit au § 4, et respecté
- [ ] **Opérateur** — 10 points de contrôle : à 10 instants, le tableau KTA MTF de TradingView (mode Replay, `GC1!`) comparé à `npm run structure -- --csv donnees/GC_2025_2026.csv --a <instant>`
- [ ] **Opérateur** — bornes des sessions confirmées (Asie : 19 h → 4 h New York, ou autre ?)
- [ ] Ajuster ce que les points de contrôle révèlent (fenêtre des pivots, alignement des séances)

### E4 — Écran Décision ⬜

- [ ] Dépôt d'une capture + notes facultatives
- [ ] Checklist « bonne capture » vérifiée automatiquement (unité, échelle, nombre de bougies)
- [ ] Rapport : vue d'ensemble, structure, liquidité, zones, FVG, scénarios, niveaux, conclusion
- [ ] Tous les niveaux viennent du moteur ; l'IA ne fait que rédiger
- [ ] Plan avec **stop obligatoire**, R, taille de position, coût en R
- [ ] Bouton « Je prends » relié au journal
- [ ] Le même écran fonctionne avec chacune des IA branchées

### E5 — Sources interchangeables + direct MT5 ⬜

- [ ] Contrat Source : `bougies({ symbole, unite, depuisMs, jusquaMs })`
- [ ] Sources fichier, Binance, MT5 (fichiers) derrière ce contrat
- [ ] Source MT5 en continu (pont local)
- [ ] Les mêmes analyses rendent les mêmes résultats sur fichier et en direct

### E6 — Scanner multi-marchés ⬜

- [ ] Liste d'actifs (Forex, métaux, indices, crypto) configurable
- [ ] Détections : OB touché, réaction, entrée dans une zone, distance au prix
- [ ] Opportunité détectée en moins d'une minute

### E7 — Alertes Telegram ⬜

- [ ] Contrat Notificateur : `envoyer(opportunite)`
- [ ] Notificateurs console et Telegram, catégories par marché
- [ ] Lien vers l'écran Décision dans chaque message
- [ ] Message reçu en moins d'une minute

### E8 — Labo par signal ⬜

- [ ] Statistiques mesurées par type de signal, avec témoin et frais réels
- [ ] Les « étoiles » et les probabilités remplacées par ces chiffres
- [ ] Plus aucune note non mesurée à l'écran

### E9 — Coach ⬜

- [ ] Écarts entre le plan pris et l'exécution réelle
- [ ] Erreurs récurrentes, établies sur le journal mesuré seulement

### E10 — Exécution assistée ⬜

- [ ] Ordre préparé depuis l'écran Décision
- [ ] Validation obligatoire par l'opérateur avant envoi
- [ ] Réservée aux signaux qui ont passé le Labo

### En parallèle, côté opérateur

- [ ] Réplication DEC-037 : `npm run rejeu:037`, puis `npm run temoin:037`
- [ ] Connexion MT5 Axi rétablie

---

## 6. Règles de conduite

1. **Une étape à la fois, dans l'ordre. On ne quitte jamais une étape dont il
   reste du développement.** Seule exception : une étape dont tout le
   développement est fait et qui n'attend qu'une vérification de l'opérateur
   passe en ⏸, et ses cases restantes restent visibles jusqu'à leur
   validation.
2. **Ne rien précipiter.** Une case se coche quand elle est vérifiée, pas
   quand elle est écrite.
3. **Une idée nouvelle va ici d'abord**, à sa place dans les cases, avant
   toute ligne de code.
4. **Lego.** Chaque brique respecte son contrat (§ 4). Remplacer une
   implémentation ne touche aucune autre brique ; si c'est impossible, le
   contrat change, et ce changement s'écrit dans `DECISIONS.md`.
5. **Le journal de bord est tenu chaque jour de travail.**
6. **Aucun chiffre affiché sans mesure, aucun ordre envoyé sans validation.**
