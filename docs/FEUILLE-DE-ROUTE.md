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
| 2026-10-08 | Ranges mesurés, et quatre jours de travail mené en parallèle de la feuille de route | La compression ne rend rien d'établi : 32,0 % contre 28,3 % au témoin corrigé, p = 0,080 (DEC-044). Un témoin en 1 min face à du réel en 15 min **inversait le signe** du résultat. Et un même numéro, DEC-035, écrit deux fois le même jour par deux travaux qui s'ignoraient. → Une branche qui ne figure pas dans la feuille de route finit par la contredire (§ 5, « Travaux ouverts »). |
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
| Points structurels (HH, LH, LL…) avec dates et prix | Moteur | E3 | ✅ |
| Liquidité acheteuse / vendeuse (BSL / SSL), balayage récent | Moteur | E3 | 🟡 prise de liquidité ✅ |
| Zones d'offre et de demande, avec « force » | Moteur + Labo | E3, E8 | 🔁 force = statistique mesurée, pas étoiles |
| FVG, breaker blocks | Moteur | E3 | 🟡 FVG ✅, breaker ⬜ |
| Scénario principal / alternatif, déclencheur, cibles, invalidation | Décision | E4 | ⬜ (avec **stop obligatoire**) |
| « Probabilité estimée 65 % / 35 % » | Labo | E8 | 🔁 remplacée par le taux mesuré du signal |
| Niveaux à surveiller, conclusion, confiance | Décision + IA | E4 | ⬜ |
| **Coach** (onglet) | Journal + IA | E9 | ⬜ (retour sur TES trades mesurés) |
| **KTA MTF** : tableau 5m → Daily, structure, BOS/CHoCH, âge, invalidation, distance, biais pondéré, lecture | Multi-UT | E3 | ✅ (⏸ 10 points de contrôle) |
| OB « 5 étoiles », Imbalance, Swing Points, session asiatique, supports/résistances | Moteur | E3, E5 | 🟡 OB ✅ FVG ✅ swings ✅, sessions ✅, S/R ⬜ |
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
| E0 Remise à plat | ✅ | — (terminée le 2026-10-07) |
| E1 Pont MT5 + journal | ⏸ | validation sur le vrai terminal Axi (connexion à rétablir) |
| E2 IA interchangeables | ⏸ | un essai réel avec deux IA différentes |
| E3 Moteur multi-unités de temps | ⏸ | 10 points de contrôle relevés sur TradingView (opérateur) |
| **E4 Écran Décision** | 🔵 en cours | tout (cases ci-dessous) |
| E5 → E10 | ⬜ | — |
| **Travaux ouverts** | ⏸ | 4 demandes de fusion et 2 branches à placer ou à clore (ci-dessous) |

---

### Travaux ouverts, hors étapes

Écrit le 2026-10-08. Du travail a été mené en parallèle de cette feuille de
route, sur des branches qu'elle ne mentionnait pas. La règle 3 du § 6 dit
l'inverse : une idée vient ici d'abord. Ces branches sont donc **placées ici
avant d'être fusionnées**, chacune à l'étape dont elle relève, ou closes.
Aucune ne se fusionne sans que sa case existe.

| Branche | Ce qu'elle apporte | Étape | Décision attendue |
|---|---|---|---|
| `analyse/ranges` (#50) | Détection des ranges sans lecture du futur, rééchantillonnage par blocs, DEC-044 | E8 | fusionner pour garder la mesure et sa leçon ; le détecteur reste non branché |
| `outil/liberer-port` (#51) | `predev` qui libère le port au lieu d'échouer dessus | E0 | fusionner |
| `corr/placeholder-instrument` (#79) | Un champ vide ne ressemble plus à un champ rempli | E4 | fusionner |
| `marche/rapprochement` (#45) | Prix lus confrontés aux prix réels, par un export TradingView | E4 | à revoir ensemble |
| `analyse/figures-bougies` | Marteau, doji, englobante, inside bar ; non branchée dans l'analyse | E4 | à revoir ensemble (opérateur, 2026-10-07 : « attends que l'on check ensemble ») |
| `vision/montrer-la-bande` | Aperçu de la bande d'axe lue, pour voir ce que l'OCR voit | E4 | à essayer sur la capture or avant de fusionner |

Cinq branches déjà fusionnées restent à supprimer, côté opérateur :
`analyse/contrat-trouvailles`, `fixtures/capture-reelle`,
`journal/jugement-order-blocks`, `vision/dessins-utilisateur`,
`vision/souder-par-recouvrement`.

---

### E0 — Remise à plat ✅

- [x] Branche de travail fusionnée dans `main` (#52)
- [x] `donnees/` ignoré par git ; il ne quitte jamais la machine
- [x] Commandes courtes : `npm run journal`, `mt5:export`, `rejeu:037`, `temoin:037`
- [x] Feuille de route et journal de bord créés (DEC-039)
- [x] Feuille de route affichée dans l'analyseur — onglet retiré le 2026-10-06 à la demande de l'opérateur : sa place est la page autonome
- [x] Lanceur et script de raccourcis écrits (`outils/`) — Windows : non exécutables d'ici
- [x] Feuille de route en page claire autonome (`docs/feuille-de-route.html`, `npm run feuille`), ouverte par le raccourci du bureau sans lancer l'analyseur
- [x] **Opérateur** — lancer `outils/creer-raccourcis.ps1` et vérifier les deux raccourcis (2026-10-06)
- [x] **Opérateur** — poser le tag `v2026.10.06-journal-mt5` (2026-10-07)
- [x] **Opérateur** — retirer l'ancienne copie `Documents\trade-analyser` une fois les données déplacées (2026-10-07 : CSV et rejeux dans `donnees\`, fichiers personnels dans `donnees\ancienne-copie\`)
- [ ] `npm run dev` ne doit plus échouer sur un port déjà pris : `predev` libère le port avant de démarrer (`outil/liberer-port`, #51) — attend la fusion

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

### E4 — Écran Décision 🔵

Cible : l'écran « Analyste » du bootcamp (captures du 2026-10-07), avec nos
garde-fous. **Les order blocks sont le cœur du projet** (opérateur,
2026-10-07) : leur bloc passe en premier. Critère de fin : le rapport complet
sort sur des captures réelles et sur les données MT5, puis l'opérateur le
vérifie.

*Order blocks « 5 étoiles » — d'après la méthode du bootcamp (vidéo de Casper), rendue calculable*
- [x] Force du mouvement mesurée en ATR pour chaque OB (`mouvementEnAtr`) et commande `npm run mesure:mouvement` : 4 seuils figés (1 ; 1,5 ; 2 ; 3 ATR), chacun face à 20 mélanges témoins
- [x] « Fort mouvement » mesuré sur GC 2023-2024 (2 049 OB) : **aucun effet**, réussite ~35 % à tous les seuils, tous sous le témoin. Aucun seuil retenu (DEC-041)
- [x] Étoile 1, imbalance : un FVG part de la bougie de l'OB (le plus haut de l'OB reste sous le plus bas de la 3e bougie, et inversement) — `etoiles.js`
- [x] Étoile 2, tendance : l'OB naît d'une cassure dans la tendance (BOS), pas d'un retournement (CHoCH)
- [x] Étoile 3, premium / discount : OB haussier sous le 0,5 de Fibonacci de la jambe, OB baissier au-dessus
- [x] Étoile 4, liquidité : pas de plus hauts ou plus bas égaux non pris à moins de 2 ATR devant l'OB (égaux à 0,1 ATR près) — paramètres figés le 2026-10-07
- [x] Étoile 5, mitigation : pas de retour dans l'OB avant la cassure ; en direct, pas de retour depuis la cassure jusqu'à l'instant de lecture
- [x] Chaque OB affiche ses étoiles et la liste des critères remplis ou manquants — lecture de capture (`etoilesEnDirect`) : l'étoile 5 tombe aussi si l'OB a été retouché depuis la cassure ; la note est présentée comme un compte, jamais comme une réussite (HYP-004). Vérifié dans Chromium sur `fixtures/tradingview-clair.png` (2026-10-08)
- [ ] Confirmation d'entrée : bougie englobante en 1 min, dans l'OB, dans le bon sens (analyse nouvelle). Les figures de bougies sont écrites et testées sur `analyse/figures-bougies` (marteau, marteau inversé, doji, englobante, inside bar) mais **non branchées dans l'analyse** : l'opérateur a demandé le 2026-10-07 qu'on les regarde ensemble avant. Une figure n'entre dans l'analyse qu'avec sa mesure face au témoin (garde-fou 8)
- [ ] Stop sous l'OB, ou sous les OB empilés
- [x] HYP-004 pré-enregistrée (DECISIONS.md) : 5 étoiles contre 0-2 étoiles, GC 2020-2022 jamais utilisé pour les OB, 200 mélanges témoins, règle de décision écrite ; `npm run hyp:004`, qui refuse de tourner deux fois
- [x] HYP-004 lancée une fois (2026-10-07) : **réfutée** pour l'or en 15 min, **OB de structure seulement** (DEC-042) — 5 étoiles 43,6 %, +0,054 R sur 78 trades, contre −0,115 R aux 0-2 étoiles, mais p = 0,184 face au témoin

*OB tel que l'enseigne le bootcamp (DEC-042)*
- [x] Détecteur `ob-bootcamp.js` : dernière bougie inverse + accumulation, mouvement fort immédiat, sans cassure exigée ; FVG mesuré depuis le haut de la zone
- [x] Toujours en tendance : un OB contre la tendance n'est pas détecté ; étoile 3 lue à l'entrée, Fibonacci du bas de la structure au plus haut depuis (DEC-042)
- [x] Mesure `npm run mesure:ob-bootcamp` : 4 seuils de « fort mouvement » (1 ; 1,5 ; 2 ; 3 ATR) × 4 unités (5 min, 15 min, 1 h, 4 h), chacun face à 20 mélanges ; 1 min, jour et semaine déclarés non mesurables sur ces données, avec la raison
- [ ] Jour et semaine mesurés sur la série continue de MT5 (E5) : les contrats GC changent tous les deux mois
- [x] **Opérateur** — `npm run mesure:ob-bootcamp` lancé sur GC 2023-2024 (2026-10-07) : 5 min positif aux 4 seuils (+0,08 à +0,16 R, p = 0,05), 1 h positif à 1,5-2 ATR, 15 min négatif ; **figé : 5 min, ≥ 2 ATR** (HYP-005)
- [x] Balayage de liquidité avant l'OB calculé pour chaque OB (`balayageAvant`), hors des cinq étoiles : condition d'entrée chez deux formateurs, à inclure dans HYP-005
- [x] HYP-005 pré-enregistrée (DECISIONS.md) : OB bootcamp 5 min ≥ 2 ATR sur SI, PL, HG, CL, ES, jamais utilisés pour les OB ; frais 4 ticks ; 200 mélanges ; confirmée si ≥ 300 trades, espérance > 0 et p < 0,01 ; 5 étoiles, balayage, achats/ventes et marchés en lectures secondaires ; `npm run hyp:005`, qui refuse de tourner deux fois
- [x] **Opérateur** — `npm run hyp:005` lancé une fois (2026-10-07) : **réfutée** — 21 275 trades, 37,8 %, −0,096 R, témoin −0,104 R, p = 0,443
- [x] Erratum DEC-043 : frais supposés (0,05 R) mêlés aux frais mesurés ; bougie sans corps prise pour une bougie inverse. Corrigé ; le verdict de HYP-005 tient, l'exploration sur GC est fausse sur ses frais
- [ ] **Opérateur** — relancer `npm run mesure:ob-bootcamp` sur GC 2023-2024, avec les frais réels (colonne « Frais » affichée)

*Affichage*
- [ ] Noyau toujours affiché : contexte multi-unités, OB, FVG, liquidité ; par unité, seulement les plus proches du prix
- [ ] Onglet « Analyses » : le reste en cases à cocher, éteintes par défaut, choix mémorisé ; l'IA ne reçoit que ce qui est affiché

*Entrée*
- [ ] Dépôt d'une capture + notes facultatives (actif, unité, contexte)
- [ ] Checklist « bonne capture » vérifiée automatiquement : unité de temps lue, axe lisible (au moins 3 graduations), 50 à 100 bougies, symbole reconnu ; chaque point manquant dit quoi corriger
- [ ] Axe lu même en petits chiffres (cas BTC du 2026-10-07 : une seule graduation lue sur un axe pourtant lisible). La capture or échoue encore sur « Aucune graduation lue ». L'aperçu de la bande effectivement lue est écrit sur `vision/montrer-la-bande` — il n'a jamais tourné sur le `main` actuel ni sur cette capture : à essayer avant d'écrire une cause
- [ ] OB anormalement haut signalé (cas BTC : une zone de 1 600 points)
- [ ] Prix lus confrontés aux prix réels, sur un export TradingView de la même fenêtre (`marche/rapprochement`, #45) : l'écart de lecture est mesuré, pas supposé — à revoir ensemble avant fusion
- [ ] TradingView en direct via **Claude dans Chrome** (extension officielle, lecture seule, aucun ordre — règle 7) : l'opérateur et Claude regardent le même graphique
- [ ] Contrôle visuel des OB : les OB détectés par le moteur sur les bougies MT5 sont comparés à ceux que l'opérateur voit sur TradingView, au même instant ; chaque écart est noté. C'est un **contrôle de détection**, jamais une mesure de rendement : celle-ci se fait sur les bougies, face au témoin — procédure écrite ci-dessous (« Procédure — contrôle visuel des OB »)
- [x] Prérequis de la procédure : `npm run ob -- --csv <bougies 1 min> --a <instant>` liste les OB du moteur à un instant, sans rien lire après lui (dernière bougie, sens, haut, bas, accumulation, heure de validation, retouché ou non) et donne l'ATR de la tolérance ; réglages figés, sans option. Les étoiles n'y figurent pas : le contrôle porte sur la détection, et l'étoile 3 du bootcamp se lit à l'entrée, qui n'existe pas à l'instant. Testé sur données construites (2026-10-08) ; jamais lancé sur l'export MT5 réel

*Rapport — tous les niveaux viennent du moteur*
- [ ] Vue d'ensemble : tendance, dernier BOS / CHoCH, points HH, HL, LH, LL
- [ ] Liquidité BSL / SSL et balayages ; zones OB et FVG, bornes arrondies au pas de cotation
- [ ] Niveaux à surveiller : niveau, type, importance selon des critères affichés
- [ ] Scénario principal et alternatif : chaîne d'étapes, déclencheur, cibles 1 à 3, condition nécessaire, invalidation ; « probabilité » affichée **non mesurée** jusqu'à E8
- [ ] Conclusion rédigée par l'IA à partir des seuls niveaux du moteur ; un prix cité qui ne vient pas du moteur fait rejeter le texte
- [ ] Confiance sur 10 = lisibilité de la capture, avec sa justification ; jamais une promesse de gain

*Plan et suite*
- [ ] Plan avec **stop obligatoire**, cibles à 1:2 et 1:3 (l'opérateur choisit et gère), taille de position, coût en R
- [ ] Bouton « Je prends » relié au journal
- [ ] Le même écran fonctionne avec chacune des IA ; sans IA, le rapport du moteur s'affiche quand même, sans texte rédigé

#### Procédure — contrôle visuel des OB

Écrite le 2026-10-08, **avant** tout relevé. Elle se suit telle quelle ; une
modification se fait avant le premier relevé, jamais après en avoir vu un.

**Ce qu'on contrôle, et ce qu'on ne contrôle pas.** La question est : le
moteur voit-il les OB que l'opérateur voit, et seulement ceux-là ? C'est un
contrôle de **détection**. Il ne dit rien de ce que rapporte un OB : le
rendement se mesure sur les bougies, face au témoin (garde-fou 8). Un
contrôle réussi ne réhabilite pas HYP-005.

**Détecteur contrôlé.** L'OB du bootcamp (`ob-bootcamp.js`) dans la
configuration figée par l'opérateur : **5 min, mouvement ≥ 2 ATR, toujours en
tendance**, paramètres `PARAMETRES_OB_BOOTCAMP`. L'OB de structure
(`orderblocks.js`) n'est pas contrôlé ici.

**Même donnée des deux côtés.** Le moteur lit les bougies M1 de MT5 (Axi,
`XAUUSD`), regroupées en 5 min. Sur TradingView, afficher le même flux si
Axi y est proposé ; sinon un flux spot `XAUUSD`, et l'écrire sur la fiche.
**Jamais `GC1!`** : le contrat à terme cote avec un écart sur le spot, et ses
bougies ne sont pas les mêmes. Un écart dû au flux est un écart de donnée,
pas de détection.

**Les 10 instants, fixés d'avance.** Dix jours ouvrés consécutifs, du
2026-09-14 au 2026-09-25, à **14:00 UTC** (séance de New York ouverte). On
ne choisit pas les instants en regardant le graphique : on choisirait ceux où
les OB sont nets. Un jour sans donnée MT5 est noté « absent » et n'est pas
remplacé.

**Fenêtre.** Les **100 dernières bougies 5 min** fermées avant l'instant
(environ 8 h 20). Un OB compte s'il est validé dans cette fenêtre.

**Déroulé, pour chaque instant.**
1. **TradingView, en mode Replay**, arrêté à l'instant : rien d'après n'est
   visible. Unité 5 min.
2. **L'opérateur relève ses OB d'abord, à l'aveugle** : sans avoir vu la
   sortie du moteur. Sinon, on ne contrôle plus rien, on recopie. Pour chacun :
   heure d'ouverture de la dernière bougie de l'OB (UTC), sens, haut, bas.
3. Claude regarde le même écran via l'extension Chrome, **en lecture seule**
   (règle 7 : aucun ordre, aucun réglage modifié), et note ce qu'il lit à
   l'écran pour vérifier le relevé. Il ne propose pas d'OB.
4. **Ensuite seulement**, la commande du moteur à cet instant.
5. Chaque OB est classé, sans discussion préalable :
   - **identique** : même dernière bougie, même sens, bornes à moins de
     **0,1 ATR** (ATR 14 en 5 min, celui que rend le moteur) ;
   - **bornes différentes** : même bougie, même sens, bornes au-delà de
     0,1 ATR ;
   - **manqué** : vu par l'opérateur, absent du moteur ;
   - **en trop** : rendu par le moteur, non vu par l'opérateur.
6. Pour chaque écart, une cause, et une seule : **donnée** (le flux diffère),
   **définition** (la règle écrite ne dit pas ce que fait l'œil), **défaut**
   (le code ne fait pas ce que dit la règle), ou **inconnue**.

**Fiche.** Un fichier par séance de relevé,
`donnees/controle-ob/AAAA-MM-JJ.md` (hors dépôt), une ligne par OB :
instant · source TradingView · heure de la bougie · sens · haut · bas
(opérateur) · haut · bas (moteur) · classement · cause. Le bilan (nombres par
classement et par cause) va au journal de bord.

**Ce qu'on fait des écarts.**
- **Défaut** : se corrige, avec un test qui le reproduit, sans autre forme.
- **Définition** : ne se corrige **pas** sur place. Changer la règle après
  l'avoir vue échouer, c'est ajuster le détecteur aux instants contrôlés
  (garde-fou 7). L'écart s'écrit dans `PISTES.md` ; un changement de règle
  passe par une DEC, et le détecteur modifié est un **nouveau** détecteur, à
  remesurer face au témoin sur des données jamais regardées. Le verdict de
  HYP-005 ne s'applique qu'au détecteur d'origine.
- **Donnée** : noter, ne rien corriger.

**Fin du contrôle.** Les 10 instants relevés, classés et causés. Pas de seuil
de réussite fixé : le résultat est la liste des écarts et leurs causes. C'est
elle qui dit si le moteur détecte ce que l'opérateur appelle un OB.

### E5 — Sources interchangeables + direct MT5 ⬜

- [ ] Contrat Source : `bougies({ symbole, unite, depuisMs, jusquaMs })`
- [ ] Sources fichier, Binance, MT5 (fichiers) derrière ce contrat
- [ ] Source MT5 en continu (pont local)
- [ ] Les mêmes analyses rendent les mêmes résultats sur fichier et en direct

### E6 — Scanner multi-marchés ⬜

Cible : l'« OB Scanner » du bootcamp (captures du 2026-10-07), avec le taux
mesuré en plus.

- [ ] Liste d'actifs configurable ; classes NQ100, Métaux, Énergie, Forex, Crypto ; recherche par symbole
- [ ] Unités 4 h, Daily, Weekly
- [ ] Tri : proximité d'une zone, nombre d'OB, plus récent ; vue grille ou liste
- [ ] Une carte par marché : mini-graphique avec zones d'achat et de vente, état « dans la zone » / « prix à x % »
- [ ] Onglets : toutes les zones, OB touchés, réactions (comptées sur **toutes** les zones touchées, pas seulement celles qui ont réagi)
- [ ] Vue détail : sens, bornes arrondies, lien TradingView
- [ ] Sur chaque carte, le taux mesuré du type de zone (E8), ou « non mesuré »
- [ ] Opportunité détectée en moins d'une minute

### E7 — Alertes Telegram ⬜

- [ ] Contrat Notificateur : `envoyer(opportunite)`
- [ ] Notificateurs console et Telegram, catégories par marché
- [ ] Lien vers l'écran Décision dans chaque message
- [ ] Message reçu en moins d'une minute

### E8 — Labo par signal ⬜

- [ ] Statistiques mesurées par type de signal, avec témoin et frais réels
- [x] Ranges : compression `hauteur / (amplitude moyenne × √fenêtre)`, bornes figées à l'ouverture, sortie lue à la clôture, aucune bougie future (`src/lib/marche/range.js`, `node scripts/ranges.mjs --csv <bougies> --ut 15m` — branche `analyse/ranges`)
- [x] Témoin par blocs : la série de l'opérateur rééchantillonnée par blocs de bougies consécutives, forme et grappes de volatilité conservées, ordre détruit (`bootstrap.js`) ; facteur de dispersion mesuré (×1,03), jamais supposé
- [x] Ranges mesurés sur l'or en 15 min : **rien d'établi** — 32,0 % contre 28,3 % au témoin corrigé, +3,70 points, p = 0,029 brut / 0,080 corrigé, intervalles qui se recouvrent (DEC-044). Le détecteur reste **non branché** dans l'analyse
- [x] Leçon DEC-044 : **un témoin partage l'unité de temps du réel**. En 1 min face à du réel en 15 min, le même écart passait de +3,70 à −4,70 points — signe inversé, et significatif des deux côtés
- [ ] Les « étoiles » et les probabilités remplacées par ces chiffres
- [ ] Plus aucune note non mesurée à l'écran
- [ ] Régimes de volatilité (Gian Luca, champion Robbins 2025-2026) : rang de l'ATR(14) sur 200 bougies → faible 0-25, moyen 26-50, élevé 51-75, extrême 76-100 ; chaque résultat ventilé par régime, régime du jour affiché
- [ ] Dégradation surveillée : espérance et Sharpe sur les 60 derniers trades face à l'ensemble ; alerte au-delà de −30 %, avantage déclaré non solide au-delà de −50 %
- [ ] Monte Carlo : 10 000 réordonnancements des trades → pire creux, risque de ruine
- [ ] Taille de position modulée (série de gains, score, fraction de Kelly) : **seulement** pour un signal qui a passé le Labo — moduler un avantage non prouvé amplifie du bruit

### E9 — Coach ⬜

- [ ] Écarts entre le plan pris et l'exécution réelle
- [ ] Erreurs récurrentes, établies sur le journal mesuré seulement
- [ ] Chaque perte qualifiée : « bonne » (plan respecté) ou « mauvaise » (entrée anticipée, poursuite, règle contournée) — Chris, champion Robbins 2026 : la constance vient de la suppression des mauvaises pertes
- [ ] Règles d'arrêt personnelles, mesurées sur tes trades : pertes consécutives et heure au-delà desquelles tes résultats se dégradent, puis alerte

### E10 — Exécution assistée ⬜

- [ ] Ordre préparé depuis l'écran Décision
- [ ] Validation obligatoire par l'opérateur avant envoi
- [ ] Réservée aux signaux qui ont passé le Labo

### En parallèle, côté opérateur

- [ ] Réplication DEC-037 : `npm run rejeu:037` (arrêtée à 91 / 100 plans, la commande reprend au 92e), puis `npm run temoin:037` une seule fois
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
7. **Aucune IA ne passe d'ordre.** Elle lit, analyse, propose ; l'opérateur
   seul décide et exécute. Vaut aussi pour Claude dans Chrome sur TradingView.

---

## 7. Les analyses techniques

Le catalogue de la brique **Moteur**. Toutes les analyses vivent au même
endroit, `src/lib/marche/` ; les autres briques les appellent sans les
recopier. Une analyse nouvelle s'inscrit ici **avant** d'être codée.
Statut : ✅ existe · 🟡 partiel · ⬜ à faire · 🔁 remplacée par une version mesurée.

**Aucune de ces analyses n'a encore prouvé qu'elle gagne.**

**Points pivots (swings)** — Les plus hauts et plus bas marquants du prix. Un
pivot n'est compté qu'une fois confirmé par les bougies qui suivent, jamais
avant. → `structure.js` · E3 · ✅

**BOS (Break of Structure)** — Le prix casse le dernier pivot dans le sens de
la tendance : la tendance continue. Daté à la fermeture de la bougie qui
casse. → `structure.js` · E3 · ✅ · datation corrigée, 62 % → 45 % (DEC-013)

**CHoCH (Change of Character)** — Le prix casse le dernier pivot contre la
tendance : premier signe de retournement. → `structure.js` · E3 · ✅

**Tendance et invalidation** — Le sens actuel (haussier, baissier ou
indéterminé) et le prix qui le remettrait en cause : le dernier pivot opposé.
La distance du prix à ce niveau dit la marge restante. → `structure.js` · E3 · ✅

**Points nommés HH, HL, LH, LL** — Chaque pivot nommé par rapport au
précédent : plus haut plus haut (HH), plus bas plus haut (HL), plus haut plus
bas (LH), plus bas plus bas (LL). Avec son prix et sa date.
→ `structure.js` · E3 · ✅

**Séance de marché** — Les bougies 4 h et Daily démarrent à 17 h heure de New
York, comme sur la plateforme, heure d'été comprise. Sans ça, les plus hauts,
les plus bas et donc la structure seraient différents de l'écran.
→ `seance.js` · E3 · ✅ · à contrôler face à TradingView

**Tableau multi-unités de temps (« KTA MTF »)** — Une ligne par unité, de
5 min à Daily : tendance, dernier BOS ou CHoCH, son âge, le niveau
d'invalidation et la distance. → `multiut.js` · E3 · ✅ · 10 points de contrôle à faire

**Biais pondéré** — Un score sur 10 qui additionne le sens de chaque unité,
les longues pesant plus (poids 1-1-1-2-2-3). Un résumé du tableau, pas un
signal : rien ne dit encore qu'il prédit. → `multiut.js` · E3 · ✅

**Lecture du tableau** — Le tableau en une phrase : alignement, repli dans la
tendance de fond, conflit entre 4 h et Daily, ou tendances mêlées.
→ `multiut.js` · E3 · ✅

### Synthèse order block — mise à jour à chaque mesure (2026-10-07, après HYP-005)

Le cœur du projet. Ce bloc résume les lignes OB qui suivent ; il se corrige
après chaque mesure, jamais avant.

**Deux définitions, côte à côte (DEC-042)**
- **OB de structure** → `orderblocks.js` : dernière bougie opposée avant une
  cassure de structure (BOS ou CHoCH). **Fermé** : ne bat pas le hasard
  (DEC-025, DEC-029, DEC-041).
- **OB du bootcamp** → `ob-bootcamp.js` : dernière bougie inverse au
  mouvement, avec l'accumulation qui la précède ; mouvement fort immédiat
  (≥ 2 ATR, figé) ; toujours en tendance ; pas de cassure exigée. **Réfuté
  en 5 min sur cinq marchés neufs** (HYP-005, p = 0,443).

**Le plan, le même pour les deux** — entrée au bord proche de la zone, stop
au-delà avec 10 % de marge, objectif 2 R (l'opérateur vise 1:2 ou 1:3 et
manage ; la mesure tient une seule règle), frais 4 ticks aller-retour.

**Les 5 étoiles** → `etoiles.js`, figées avant toute mesure : imbalance depuis
le haut de la zone ; tendance ; discount lu à l'entrée ; pas de liquidité
devant ; jamais retouché. À part : le **balayage de liquidité avant l'OB**,
condition d'entrée chez deux formateurs.

**Ce qui est mesuré**

| Mesure | Résultat |
|---|---|
| OB de structure × force du mouvement (GC 15 min) | ≈ 35 % à tous les seuils, sous le témoin : aucun effet (DEC-041) |
| HYP-004 : 5 étoiles, OB de structure (GC 2020-2022) | +0,054 R sur 78 trades, p = 0,184 : réfutée ; sens favorable |
| OB du bootcamp, exploration (GC 2023-2024, 16 essais) | bat le témoin en 5 min ; **frais faux** (0,05 R supposés, DEC-043) : à relancer |
| **HYP-005** : 5 min ≥ 2 ATR, SI, PL, HG, CL, ES | **réfutée** : 21 275 trades, −0,096 R, témoin −0,104 R, p = 0,443 |

**Ce qui n'est pas établi** — aucun OB n'est prouvé, et l'OB du bootcamp en
5 min est réfuté hors de l'or (HYP-005). Le « 70 à 80 % » du bootcamp n'est
mesuré nulle part ; nos réussites vont de 35 à 42 %.
L'entrée à la mèche est l'hypothèse la plus favorable. 1 min, jour et
semaine attendent la série MT5.

**En file, une par une** (PISTES.md, ordre à décider après la relance corrigée sur GC) — balayage avant l'OB
(la plus solide), séance de New York (deux sources), confirmation par
englobante en 1 min, stop sous des OB empilés, emboîtement d'unités, zone
OTE 0,62-0,786, plus haut et plus bas de la veille, deux CHoCH = pas de
trade, jours fériés et d'annonces, plancher de volume.

**Order blocks (OB)** — La dernière bougie opposée avant une impulsion qui
casse la structure : une zone où le prix pourrait réagir à son retour. Stop
posé au-delà de la zone. → `orderblocks.js` · E3 · ✅ · ne bat pas le
hasard (DEC-025, DEC-029)

**OB « bootcamp »** — La dernière bougie inverse d'un fort mouvement, avec
l'accumulation de bougies inverses qui la précède ; le mouvement doit partir
immédiatement. Pas de cassure de structure exigée, contrairement à l'OB de
`orderblocks.js`. → `ob-bootcamp.js` · E4 · ✅ calcul · ✅ seuil figé (5 min, 2 ATR) · **réfuté** sur 5 marchés (HYP-005) · DEC-043

**OB « 5 étoiles »** — La note d'un OB selon cinq critères (méthode du
bootcamp) : imbalance, tendance, premium / discount, pas de liquidité
devant, jamais retouché. La note n'est qu'un compte de critères ; ce qu'elle
vaut se mesure (HYP-004). Le « 70 à 80 % » annoncé par le bootcamp n'est
mesuré nulle part. → `etoiles.js` · E4, E8 · ✅ calcul · **réfutée** sur l'or 15 min (HYP-004 : 43,6 %, +0,054 R, p = 0,184)

**Force du mouvement (en ATR)** — L'ampleur de l'impulsion qui suit l'OB,
du bord de la zone à la clôture de la cassure, divisée par l'ATR des 14
bougies qui précèdent. Chiffre le « fort mouvement » du bootcamp.
→ `qualificatifs.js` · E4 · ✅ · **aucun effet** sur GC 15 min, aucun seuil retenu (DEC-041)

**Plus hauts et plus bas égaux (EQH / EQL)** — Deux sommets ou deux creux au
même prix, à une tolérance près : un réservoir d'ordres stop que le marché
vient chercher. Devant un OB, c'est un piège (étoile 4). → `etoiles.js` · E4 · ✅

**Mitigation jusqu'à l'instant** — L'OB a-t-il été retouché entre sa création
et maintenant ? Différent de la fraîcheur, qui s'arrête à la cassure.
→ `etoiles.js` · E4 · ✅

**Confirmation par bougie englobante** — Dans l'OB, en 1 min, une bougie qui
englobe la précédente dans le sens du trade : le signal d'entrée du
bootcamp. → E4 · ⬜

**Stop sous des OB empilés** — Deux OB proches l'un de l'autre : le stop
passe sous les deux, pour que seul un scénario invalidé le déclenche.
→ E4 · ⬜

**Qualificatifs d'un OB** — Dix critères qui décrivent un OB : FVG laissé par
l'impulsion, prise de liquidité avant, force du déplacement, importance du
niveau, zone premium ou discount, fraîcheur, niveau vierge, taille par rapport
à l'ATR, définition alternative, volume. Ils servent à chercher quels OB
marchent mieux que les autres. → `qualificatifs.js` · E3, E8 · ✅

**Force d'une zone** — Les « étoiles » du bootcamp, remplacées par le taux de
réussite réellement mesuré de ce type de zone. → E8 · 🔁

**Imbalance / FVG (Fair Value Gap)** — Un trou entre trois bougies laissé par
un mouvement trop rapide ; le prix revient souvent le combler. Aujourd'hui
cherché seulement dans l'impulsion d'un OB. → `qualificatifs.js` · E3 · 🟡

**Breaker block** — Un OB que le prix a cassé, et qui sert ensuite de niveau
dans l'autre sens. → E3 · ⬜

**Zones d'offre et de demande** — Les zones d'où sont partis les grands
mouvements de hausse (demande) ou de baisse (offre). → E3 · ⬜

**Supports et résistances** — Les prix touchés plusieurs fois sans être
franchis. → E3, E5 · ⬜

**Liquidité BSL / SSL** — Les ordres stop accumulés au-dessus des plus hauts
(BSL, acheteuse) et sous les plus bas (SSL, vendeuse), et s'ils viennent
d'être balayés. → `qualificatifs.js`, `sessions.js` · E3 · 🟡

**Sessions Asie, Londres, New York** — Le plus haut et le plus bas de chaque
session, et s'ils ont été balayés depuis. → `sessions.js` · E3 · ✅ · bornes
de l'Asie à confirmer (« 1900-0001 »)

**Premium / discount** — Le prix est-il dans la moitié haute (chère) ou basse
(bon marché) du range ? On achète plutôt en discount, on vend plutôt en
premium. → `qualificatifs.js` · E3 · ✅

**Anomalies de volume** — Six détecteurs sur les contrats à terme :
absorption, déplacement, rejet, activité hors séance, gap, pic de volume.
→ `anomalies.js` · ✅ · prédit l'amplitude, jamais la direction (DEC-031)

**Profil horaire et annonces** — Le volume habituel heure par heure, et les
fenêtres des annonces économiques de New York (8 h 30, 10 h, 14 h).
→ `anomalies.js` · ✅

**Après une anomalie** — Ce que le prix fait ensuite, mesuré sur tous les cas
: jusqu'où il va dans chaque sens, pour placer stop et objectif.
→ `apres.js`, `plan.js` · ✅ · stop annoncé ≠ stop mesuré (ERRATUM-001)

**Volume acheteur / vendeur (delta)** — Ce qui a été acheté et vendu,
séparément, calculé depuis les transactions. Absent d'un fichier CFD :
jamais deviné d'après la couleur des bougies. → `transactions.js` · ✅

**Cohérence du plan** — Un plan dont le stop ou les cibles contredisent le
sens (achat avec stop au-dessus) est rejeté, jamais corrigé en silence.
→ `src/lib/analysis.js` · ✅

**Ratio risque / rendement (R)** — Calculé par le programme, jamais lu dans
la réponse de l'IA, qui se trompe en calcul. → `src/lib/analysis.js` · ✅

**Coûts en R** — Spread et commission ramenés au risque du trade.
→ `couts.js` · ✅ · 0,08 R par trade sur l'or (DEC-034)

**Taille de position** — Combien de lots ou de contrats pour risquer le
montant choisi. → `scripts/dimensionner.mjs` · E4 · 🟡

**Scénarios et plan complet** — Scénario principal et alternatif,
déclencheur, cibles, invalidation, niveaux à surveiller, stop obligatoire.
Les « 65 % / 35 % » du bootcamp seront remplacés par un taux mesuré. → E4 · ⬜

**Lecture d'une capture par l'IA** — L'IA de vision lit le graphique et
l'axe des prix ; les lignes ne sont tracées que si l'axe lu est cohérent.
→ `src/lib/providers/` · ✅ · un seul essai réel

**Lecture géométrique d'une capture** — Sans IA : l'axe est lu par
reconnaissance de texte, les bougies sont reconstruites depuis l'image.
→ `src/lib/vision/` · ✅ · un seul essai réel ; gênée par les bandeaux et
boutons d'ordre

**Réaction à une zone** — La zone est touchée, puis le prix est rejeté. Le
taux se compte sur toutes les zones touchées, jamais sur les seules qui ont
réagi : ne montrer que les réussites, c'est le biais des ✓ du bootcamp.
→ E6, E8 · ⬜

**Entrée Fibonacci dans la zone (OTE)** — Une fois le prix dans l'OB, entrer
sur un retracement de 0,5 à 0,786 de l'impulsion plutôt qu'au bord de la
zone. Vu sur le robot du bootcamp ; à mesurer contre l'entrée simple.
→ E8 · ⬜

**Pistes OB du bootcamp, à éprouver une par une** — Fort mouvement = bougie
≥ 2 fois la précédente ; OB d'une seule bougie ; stop sous le plus bas protégé
et objectif sur le dernier plus haut ; sortie partielle à 1 R ; deux CHoCH
d'affilée = pas de trade ; confirmation par englobante ou doji ; balayage de
liquidité avant l'OB (la plus solide : posée par deux formateurs) ; emboîtement
d'unités ; liquidité de trendline ; plus haut et plus bas de la veille ; pas de
trade les jours fériés. Détail et
source dans `PISTES.md`. → E8 · ⬜

**Checklist « bonne capture »** — Ce qu'une capture doit montrer pour être
lisible : unité de temps visible, échelle lisible, 50 à 100 bougies, pas
d'indicateurs superflus. → E4 · ⬜

Ces analyses sont jugées par le **Labo**, qui n'en est pas une : backtest,
témoin, rejeu pré-enregistré. Voir `CLAUDE.md`, garde-fous 4 à 8.
