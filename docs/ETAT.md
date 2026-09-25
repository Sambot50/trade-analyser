# État du projet

Mis à jour le 2026-09-24.

Ce fichier sépare ce qui est **mesuré** de ce qui est **supposé**. Il n'a
d'intérêt que s'il reste honnête : une ligne qui passe de « non vérifié » à
« vérifié » doit s'appuyer sur une exécution, pas sur une impression.

## Vérifié

| Quoi | Comment | Résultat |
|---|---|---|
| Logique pure | 315 tests unitaires | tous passent |
| Build de production | `npm run build` | 221 kB JS (71 kB gzip) |
| Projection prix → pixel | lecture des pixels du canvas en navigateur | écart max **1,1 px** sur 4 niveaux |
| Lecture d'axe sur graphique synthétique | banc d'essai, échelle connue | `qwen3.8:27b` à **2,3 px** |
| Lecture d'axe sur capture TradingView réelle | comparaison manuelle des graduations | graduations extrêmes exactes, échelle juste à ~1,7 % (limite de mesure) |
| Discrimination du banc d'essai | modèle renvoyant les prix d'un autre actif | dérive à 4 chiffres, impossible à confondre |
| Rejet des plans incohérents | tests des deux sens de marché | rejeté avant affichage |
| Résolution des issues | jeux de bougies fabriqués, tous les cas | entrée jamais atteinte, stop avant objectif, objectif avant stop, bougie ambiguë dès le déclenchement, horizon dépassé |
| Journal en navigateur | parcours complet Playwright | enregistrement automatique, blobs concordants, saisie manuelle, statistiques, persistance au rechargement |
| Échec réseau du journal | API bloquée volontairement | annoncé, état non corrompu |

## Non vérifié

| Quoi | Pourquoi | Comment lever le doute |
|---|---|---|
| **Appel réseau à Binance** (`src/lib/journal/market.js`) | Les API de marché étaient inaccessibles depuis l'environnement d'écriture. L'algorithme qui exploite les bougies est testé ; la récupération ne l'est pas. | Lancer « Constater les issues » sur une analyse d'une paire crypto. L'échec est bruyant. |
| **Écriture sur disque** (File System Access API) | Non automatisable sans interaction utilisateur. | Connecter un dossier depuis l'onglet Journal et vérifier l'arborescence produite. |
| **Robustesse de la lecture d'axe** | Un seul essai réel, sur un graphique BTC 5 min sans indicateur. | Accumuler des analyses sur d'autres actifs, unités de temps et styles de graphique. Le journal est fait pour ça. |
| **L'import CSV sur un vrai fichier** | Éprouvé sur des fixtures et sur un fichier synthétique de 92 000 lignes. Aucun fichier HistData ou MetaTrader réel n'a été lu : ils ne se téléchargent pas depuis cet environnement. | Lancer `--csv` sur un export réel et vérifier les bornes de période et le taux de couverture annoncés. |
| **Le biais de mesure résiduel** | +0,074 à +0,167 R au lieu de 0 sur données sans structure, sur données réelles mélangées. Non expliqué. C'est le verrou actuel. | Mesurer séparément : entrée remplie à la clôture plutôt qu'à la mèche, puis issues ambiguës comptées en pertes. |
| **Le spread réellement payé chez Vantage** | La valeur passée à `--spread` est fournie par l'utilisateur, jamais mesurée. | Relever le spread affiché sur XAUUSD à plusieurs heures de la journée — il s'élargit à l'ouverture et à la clôture. |

## Le contre-essai qui change la lecture

**2026-09-23.** L'import CSV a permis un essai qu'on n'avait pas fait : lancer
la chaîne entière sur une **marche aléatoire** — un fichier de bougies générées
au hasard, sans aucune structure de marché.

| Série | Taux | Intervalle | Cas tranchés |
|---|---|---|---|
| BTCUSDT réel, 3 mois | 53,4 % | [45,7 – 60,9] | 163 |
| Marche aléatoire, 3 mois | 53,2 % | [43,9 – 62,3] | 109 |

**Les deux chiffres sont indiscernables.** Le résultat obtenu sur données
réelles est, en l'état, compatible avec l'absence totale d'avantage. Ce n'est
pas une preuve que la règle ne vaut rien : le générateur n'a ni la volatilité
ni les tendances du BTC, et les deux intervalles font plus de quinze points.
C'est une preuve que **l'échantillon actuel ne permet pas de conclure**, et que
le découpage en deux moitiés ne suffisait pas à le dire.

Ce que ça imposait avant toute mise en réel :

1. ~~un mode contrôle intégré~~ — **fait**, voir ci-dessous ;
2. une période d'au moins un an, pour ramener l'intervalle sous huit points.

## Ce que le contrôle a trouvé du premier coup, sur données réelles

**2026-09-23.** Premier lancement de `--controle 100` sur BTCUSDT réel
(2026-07-01 → 2026-09-23, 160 issues tranchées) :

| | Réel | Médiane des tirages |
|---|---|---|
| Taux de réussite | 53,8 % | 60,2 % |
| Espérance | +0,400 R | +0,563 R |

**p (espérance) = 0,970** — 97 tirages sur 100 faisaient *mieux* que le réel.

Mais le chiffre décisif n'était pas là : c'était le **+0,563 R des tirages**.
Des bougies en ordre aléatoire forment un martingale ; aucune règle de sortie
ne peut y dégager une espérance positive. +0,563 R sur du hasard pur voulait
dire que la mesure fabriquait du rendement.

C'était le cas. Voir DEC-015 : la convention de sortie créditait +1 R à un
trade passé par TP1 puis stoppé, tout en créditant +2 R s'il allait jusqu'à
TP2 — une option qu'aucun trade réel n'offre. Sur 200 000 marches aléatoires,
elle produisait **+0,330 R par trade à partir de rien**.

Après correctif, sur des données sans structure, la médiane des tirages tombe
de **+0,407 R à +0,055 R**, et le contrôle garde sa sensibilité : il détecte
toujours un avantage planté à p = 0,016.

**Ce que ça invalide :** tous les chiffres d'espérance produits avant le
2026-09-23 — +0,392 R, +0,400 R — mesuraient la convention, pas le marché.
La mesure sur BTCUSDT est à refaire.

## Le verdict final sur la règle mécanique — 2026-09-24

Test pré-enregistré par DEC-024, lancé sur BTCUSDT 2022-2023 sans rien modifier.

| | |
|---|---|
| Au-dessus du seuil | 46,8 % · n = 62 |
| En-dessous | 47,0 % · n = 232 |
| Écart | **−0,2 point** · z = −0,029 · p = 0,559 |

L'effet valait 21,8 points à l'exploration. Il vaut **zéro** sur données
fraîches. Abandon, et on ne rejoue nulle part (DEC-025).

### Cinq jeux, cinq refus

| Jeu | Résultat |
|---|---|
| BTCUSDT 2026, 15 min | rien |
| BTCUSDT 2026, 1 h | p = 0,129, un tirage sur six |
| BTCUSDT 2024-2025 | 50,0 % exactement, p corrigé 0,0547 |
| BTCUSDT 2022-2023 | qualificatif pré-enregistré réfuté |
| ETHUSDT 2026 | rien |

**La question posée le 2026-09-21 — « la règle des order blocks porte-t-elle un
avantage ? » — a reçu sa réponse, et c'est non.** Sur le crypto, avec tous les
qualificatifs qu'on sait calculer, rien ne se distingue du hasard.

### Ce que le protocole a coûté et rapporté

Deux jours, et il a tué une hypothèse qui affichait 66,3 % contre 44,5 % avec un
`z` de 3,02 — confirmée par la littérature SMC sur le volume.

Sans lui, ce filtre serait aujourd'hui dans le code, et on lui ferait confiance.

## L'exploration des qualificatifs — BTCUSDT 2024-2025, 2026-09-24

Premier export portant de vraies valeurs de volume. 436 order blocks,
318 issues tranchées, 25 variables croisées avec l'issue.

### Trois mesures, trois refus

| Question | Résultat | Règle |
|---|---|---|
| La règle globale gagne-t-elle ? | 50,0 % · 0,000 R sur 318 cas | — |
| Un qualificatif sépare-t-il ? | **p corrigé = 0,0547** | seuil 0,05 → échoue |
| Le filtre de biais sert-il ? | 48,4 % sans, 50,0 % avec | aucun apport |
| Le point d'entrée porte-t-il une information ? | MFE/MAE = 1,095 | sous le seuil de 1,15 |

### Le filtre de biais ne gagne rien — c'est tranché

Alignés 50,0 % sur 318 ; non alignés **46,6 %** sur 283, déduit des deux runs.
Écart de 3,4 points pour une erreur-type de 4,1 : du bruit.

**Le filtre écarte 45 % de l'échantillon sans contrepartie mesurable.** C'est
la première piste sortie du registre par la porte prévue — une commande
gratuite, jamais lancée en deux jours.

### La largeur de zone, et pourquoi elle n'est pas une découverte

```
zoneSurAtr                Q4 66,3 %   Q1 42,5 %   z = 3,02
volumeRapporteALaMoyenne  Q4 60,0 %   Q1 37,2 %   z = 2,94
```

Ce n'est pas deux trouvailles : au-dessus du seuil, le volume médian vaut
**1,58× la moyenne**. Une zone large est une grosse bougie, une grosse bougie a
un gros volume. Une seule chose, vue deux fois — et c'est ce que la littérature
SMC annonce sur le volume.

Trois réserves :

1. **La forme est mauvaise.** `zoneSurAtr` donne 42,5 · 46,8 · 44,3 · 66,3 :
   seul le dernier quartile décroche. `volumeRapporteALaMoyenne` zigzague —
   37,2 · 57,9 · 46,1 · 60,0. Un effet réel monte graduellement.
2. **Le rapport MFE/MAE est instable entre moitiés** : 1,02 puis 1,226.
3. **Le `p` corrigé échoue**, de 0,0047.

### Une explication proposée, mesurée, puis réfutée

Soupçon : le remplissage à la clôture pénalise les zones étroites, dont le
glissement d'entrée pèse plus lourd par rapport au risque.

**L'asymétrie existe** — inflation médiane du risque de **0,257** sur le
premier quartile contre **0,109** sur le dernier, un facteur 2,4.

**Elle n'explique pas l'écart de taux.** Sous `cloture`, l'objectif est
redérivé depuis le prix obtenu, à 1 R du risque réel : stop à −R', objectif à
+R'. Symétrique quelle que soit la valeur de R', donc 50 % sur une marche sans
dérive.

L'effet reste inexpliqué. C'est une raison de le tester (DEC-024), pas d'y
croire.

### Ce que le script de confirmation a révélé sur lui-même

Éprouvé sur une série **sans aucune structure**, au seuil de DEC-024, il a rendu
`p = 0,00998` — significatif. Seul le minimum de 40 cas l'a empêché de conclure.

Ce n'est pas un défaut : un test unique à `p < 0,05` se trompe **une fois sur
vingt**, par définition. La protection ne vient pas du `p`, elle vient de ce
que le test soit **unique** et sur des **données fraîches**.

D'où la clause de DEC-024 : en cas d'échec, on ne rejoue ni sur l'or, ni sur
ETH, ni sur une autre période. Chaque reprise est un nouveau tirage à 5 %.

## Le verdict — test hors échantillon, 2026-09-23

Configuration gelée par DEC-018, lancée sur deux jeux jamais examinés.

| Jeu | Issues tranchées | Réel | Contrôle médiane | p |
|---|---|---|---|---|
| BTCUSDT 2024-2025 | 318 | 50,0 % · **0,000 R** | 49,2 % · −0,017 R | 0,373 |
| ETHUSDT 2026 | 116 | 47,4 % · −0,052 R | 49,0 % · −0,021 R | 0,617 |

**Les deux `p` dépassent 0,05 : la règle est abandonnée** (DEC-019).

Le run BTCUSDT est un nul sans ambiguïté — 159 gagnants, 159 perdants,
espérance 0,000 R, intervalle [44,5 % – 55,5 %]. Le plus serré du projet. Ce
n'est pas « on ne sait pas », c'est « il n'y a rien ».

Le `p = 0,129` des neuf mois de 2026 était bien un tirage parmi six.

### Ce que ça établit sur l'appareil, et pas seulement sur la règle

Plancher de contrôle : **−0,017 R / 49,2 %** sur deux ans de BTCUSDT,
**−0,021 R / 49,0 %** sur ETHUSDT. Zéro et 50 %, sur deux jeux jamais vus.
L'étalonnage tient hors échantillon.

### Ce que ça ne dit pas

La lecture de graphique par modèle de vision n'est pas concernée : le backtest
teste une règle mécanique, pas le raisonnement d'un modèle sur une capture.
Cette question reste entière, et non mesurée.

### Le diagnostic qui n'a jamais été fait

Le taux vaut **exactement 50 % sur 318 cas** — la signature d'un point d'entrée
sans information directionnelle. La question n'est plus « la règle gagne-t-elle »
mais « une variable enregistrée sépare-t-elle les gagnants des perdants ».

`anomalieVolume` est calculée pour chaque order block depuis le premier jour et
**n'a jamais été regardée**. La consigne d'alors — « mesurer d'abord, filtrer
ensuite » — n'a jamais atteint son second temps. Le backtest agrège puis jette
les enregistrements individuels.

C'est la seule piste qui reste, et elle exige la même discipline : explorer sur
un jeu, pré-enregistrer, tester sur un autre.

## L'échelle de détection — BTCUSDT, 2026-01-01 → 09-23

**2026-09-23, mesure la plus récente.** Même règle, même code, trois échelles
de structure. Sortie ferme à 1 R, remplissage à la clôture, coûts à zéro,
100 tirages de contrôle.

| Détection | Stop médian | Issues tranchées | Réel | Contrôle médiane | p |
|---|---|---|---|---|---|
| 15 min | 0,169 % du prix | 161 | 42,9 % · −0,143 R | 45,2 % · −0,096 R | 0,703 |
| **1 h** | **0,438 %** | **111** | **54,0 % · +0,081 R** | **49,8 % · −0,004 R** | **0,129** |
| 4 h | 1,278 % | 17 | 47,1 % · −0,059 R | 45,9 % · −0,081 R | 0,495 |

Le run 4 h ne dit rien : 17 issues, intervalle de 43 points. À ignorer dans
les deux sens.

### Le biais de mesure était une affaire d'échelle

À la détection 1 h, la médiane des tirages vaut **−0,004 R pour 49,8 % de
réussite**. C'est zéro, et c'est 50 %. Le plancher positif qui a occupé toute
la journée du 2026-09-23 était **spécifique à la détection 15 minutes** : des
zones d'order block à 0,169 % du prix, c'est-à-dire l'amplitude d'une seule
bougie — un stop posé dans le bruit intrabar, où les hypothèses d'exécution
pèsent plus que la structure.

Le biais n'était donc pas un défaut générique de la chaîne mais une fonction
du rapport entre la distance du stop et le bruit de la bougie. À 0,438 % il a
disparu de lui-même. (Mesuré pour la sortie à 1 R seulement ; la sortie à 2 R
n'a pas été rejouée à cette échelle.)

### Le seul indice du projet, et pourquoi il ne prouve rien

À la détection 1 h, **p = 0,129** : douze tirages sur cent font aussi bien.
C'est la première fois que le réel passe au-dessus de son témoin.

Ce n'est pas une preuve, pour une raison qui n'a rien à voir avec le code :
**six configurations ont été essayées sur les mêmes données.** Sous
l'hypothèse nulle, la probabilité qu'au moins une affiche p ≤ 0,13 par hasard
est de l'ordre de **55 %**. Ordre de grandeur — les essais partagent leurs
données, ils ne sont pas indépendants — mais le mode d'échec est réel : à
force de chercher, on trouve.

Ni le découpage en deux moitiés ni le contrôle par permutation n'attrapent
celui-là. Seul un test hors échantillon le peut. Voir DEC-018, qui fige la
configuration et la règle de décision **avant** de regarder les données.

### Les coûts, à cette échelle

Espérance brute +0,081 R, stop médian 0,438 % du prix :

| Instrument | Coût en R | Espérance nette |
|---|---|---|
| BTC spot Binance (0,2 %) | 0,46 R | **−0,38 R** |
| BTCUSD CFD, spread 20 $ | 0,06 R | +0,02 R |
| Coûts type or CFD | 0,02 R | +0,06 R |

Même confirmé, l'indice serait **inexploitable en spot**.

## La mesure à la détection 15 minutes — BTCUSDT, 2026-07-01 → 09-23

**2026-09-23, après DEC-015.** 198 order blocks retenus, ~165 issues tranchées,
100 tirages de contrôle.

| Règle de sortie | Réel | Médiane des tirages | p | Verdict |
|---|---|---|---|---|
| Tenue jusqu'à 2 R | 36,4 % · +0,041 R | 37,5 % · +0,074 R | **0,624** | pas d'avantage |
| Sortie ferme à 1 R | 54,3 % · +0,036 R | 60,8 % · +0,167 R | **0,990** | sous le hasard |

**Le correctif est confirmé sur données réelles :** l'espérance du réel tombe de
+0,400 R à +0,041 R. Le rendement fabriqué a disparu.

**Et il ne reste rien.** Sous la tenue à 2 R, le réel est indiscernable de ses
propres bougies mélangées. Sous la sortie ferme à 1 R, il est *au plancher* de
la distribution de contrôle — le minimum des 100 tirages est 54,0 %, le réel
fait 54,3 %. Mélanger les bougies améliore la règle, 99 fois sur 100.

La règle des order blocks, telle que spécifiée ici, n'extrait rien de la
structure de BTCUSDT sur ces trois mois.

### Le biais de mesure résiduel, et ce qu'il a fallu comprendre

Les tirages de contrôle rendaient **+0,074 R (2 R) et +0,167 R (1 R)** sur des
données sans aucune structure, là où la théorie impose zéro.

Deux causes, l'une corrigée et l'autre comprise après coup :

- **L'hypothèse d'exécution à la mèche** (DEC-016, DEC-017), qui valait
  16 points de taux de réussite sortis de rien ;
- **l'échelle de détection**, comprise plus tard : à 15 minutes le stop est
  dans le bruit intrabar. À la détection 1 h, le plancher tombe à −0,004 R
  sans rien changer d'autre.

**Une précision sur la portée de ce plancher, écrite après coup.** Un test de
permutation compare le réel à SA PROPRE distribution nulle : le biais de
l'appareil frappe le réel et les cent tirages de la même façon, et s'annule
dans le `p`. Le plancher invalidait donc la lecture *absolue* — « +0,400 R
donc rentable » — mais jamais le `p`, qui a toujours été le bon chiffre.

Enquête close sur l'essentiel, sur une série à volatilité réaliste — 0,08 %
d'écart-type à la minute, mèches comparables aux corps. Médiane des tirages,
coûts à zéro, chiffre qui doit valoir 0 :

| Objectif | `meche` | `cloture` |
|---|---|---|
| Sortie ferme à 1 R | +0,245 R · 65,8 % | **−0,012 R · 49,2 %** |
| Tenue jusqu'à 2 R | +0,108 R · 35,6 % | −0,074 R · 27,1 % |

1. ~~**L'entrée supposée remplie au prix exact du bord de zone**~~ — **cause
   principale, établie.** Sous la sortie à 1 R, `--remplissage cloture` annule
   le biais : 49,2 % de réussite sur une marche aléatoire, là où la théorie
   exige 50 %.
2. ~~**L'exclusion des issues ambiguës**~~ — **écartée.** Les compter en pertes
   ou en gains fait bouger le plancher de 0,023 R au maximum, et l'exclusion
   tombe toujours entre les deux bornes (DEC-017).
3. ~~La censure par l'horizon~~ — **écartée** : zéro `horizon_depasse` sur la
   série réaliste, 1 sur 198 sur BTCUSDT.
4. **L'exclusion des `non_declenche`** (25 cas sur 198) — non éprouvé, mais
   sans objet tant que la configuration 1 R / clôture donne déjà zéro.

### Correction d'un chiffre publié la veille

DEC-016 annonçait que le remplissage expliquait « la moitié du biais ». **Le
chiffre était faux**, et la faute vient de l'instrument : il avait été mesuré
sur un fichier synthétique aux mèches de 0,017 % du prix, cent fois plus fines
que celles d'un marché réel — alors que l'hypothèse testée porte précisément
sur les mèches. Ce fichier ne produisait aucune issue ambiguë non plus, ce qui
a imposé d'en générer un second.

### Ce qui reste inexpliqué

Sous 2 R, la clôture surcorrige : **−0,074 R**, systématique sur 60 tirages.
Cause inconnue, et l'hypothèse de l'horizon est écartée par la mesure.

### La configuration utilisable

**`--objectif 1r --remplissage cloture`** est la seule dont le plancher soit
vérifié proche de zéro, donc la seule dans laquelle un résultat mesuré puisse
être cru. Les autres servent à comparer, pas à conclure.

Tous ces chiffres viennent de séries synthétiques ; la même comparaison sur
bougies BTCUSDT réelles reste à faire.

### Les coûts condamnent BTC à cette distance de stop, avantage ou pas

Le stop médian vaut **0,169 % du prix**. Rapporté à ce risque :

| Instrument | Coût aller-retour | Coût en R |
|---|---|---|
| BTC spot Binance (0,2 % tout compris) | 0,2 % du prix | **~1,2 R** |
| BTC spot, frais réduits (0,15 %) | 0,15 % | ~0,9 R |
| BTCUSD CFD, spread 20 $ | ~0,03 % | ~0,17 R |
| **XAUUSD CFD, spread 0,25 $** | ~0,010 % | **~0,06 R** |

Un coût supérieur à 0,17 % du prix mange plus d'une unité de risque entière.
**Sur BTC spot, aucun taux de réussite ne rattrape ça.** La constante 0,05 R
utilisée jusqu'ici sous-estimait le coût réel d'un facteur vingt.

L'or reste mesurable : même distance de stop relative, coût vingt fois moindre.

## Le contrôle par permutation, et sa propre validation

**2026-09-23.** `--controle N` rejoue les mêmes détecteurs sur les mêmes
bougies remises dans un ordre tiré au sort, et positionne le réel dans la
distribution obtenue (DEC-014).

Un contrôle qui répondrait toujours « pas d'avantage » ne vaudrait rien. Il a
donc été éprouvé dans les deux sens, sur 92 000 bougies 1 minute, 100 tirages :

| Série d'essai | Réel | Médiane des tirages | p | Verdict rendu |
|---|---|---|---|---|
| Marche aléatoire | +0,390 R | +0,407 R | 0,604 | pas d'avantage |
| Momentum planté | +1,605 R | +1,120 R | 0,010 (0/100) | avantage détecté |

Commandes exactes, rejouables :

```bash
node scripts/backtest.mjs --csv <marche_aleatoire>.csv --controle 100
node scripts/backtest.mjs --csv <momentum>.csv --controle 100
```

**Le chiffre le plus instructif de tout le projet :** sur du bruit pur, les
tirages de contrôle rendent une espérance médiane de **+0,407 R**. Un système
qui paraît rentable sur des données sans la moindre structure. Ça condamne la
lecture isolée de l'espérance — la nôtre comprise, jusqu'ici.

## Coûts : mesurés, et décisifs

`--spread` remplace la constante supposée. Sur l'essai synthétique ci-dessus,
à taux de réussite et ratio identiques :

| Spread | Coût mesuré | Seuil de rentabilité | Verdict |
|---|---|---|---|
| 0,25 $ (or, courtier CFD) | 0,098 R | 40,6 % | gagnant même au pire de l'intervalle |
| 2,00 $ (courtier cher) | 0,784 R | 65,9 % | perdant même au mieux de l'intervalle |

Le même système, les mêmes trades, deux conclusions opposées. C'est le
paramètre le plus lourd du modèle, et il était jusqu'ici deviné.

## Question ouverte, et c'est la principale

**Les plans de trade produits valent-ils quelque chose ?**

Le seul essai réel a donné :

- un ratio risque/rendement de **0,87** — risquer 257 pour viser 223, structurellement perdant ;
- un raisonnement qui **contredit ses propres niveaux** : le modèle désigne 86 300 comme déclencheur d'entrée puis place l'entrée à 86 523, avec le TP1 précisément à 86 300.

C'est le mode d'échec attendu d'un LLM sur ce type de tâche : la prose est
plausible, les nombres ne sont pas dérivés d'elle. Un échantillon ne dit pas si
c'est la règle ou l'exception.

**L'outil sait lire un graphique. Il ne sait pas encore raisonner dessus.** Ce
sont deux problèmes distincts, et seul le premier est résolu.

## Limites de l'environnement de développement

Constatées pendant l'écriture, utiles à connaître avant de les reproduire :

- **Les pushes de tags échouent depuis Claude Code web** — `send-pack:
  unexpected disconnect`, quatre tentatives, annoté comme léger, avec et sans
  `--no-thin`. Les pushes de branche passent. Les tags se posent depuis une
  machine locale.
- **Les API de marché sont bloquées** par la politique réseau de la session :
  Binance, Kraken, Bybit, Coinbase.
- **PowerShell n'est pas disponible** — un script prévu pour lui a été
  abandonné au profit de Node, faute de pouvoir l'exécuter.

## Prochaines étapes, par ordre

**Changement de cap acté le 2026-09-24 :** la règle mécanique est close
(DEC-025). Le projet revient à sa question d'origine, jamais mesurée.

### La question qui reste

**Un modèle de vision, à qui l'on montre une capture de graphique, produit-il
des plans qui valent mieux que le hasard ?**

Ce n'est pas la question qu'on vient de fermer. Le backtest testait une règle
mécanique — dernière bougie opposée, cassure, zone, stop à 10 % au-delà. Un
modèle ne suit pas cette règle : il lit une image, raisonne, et propose des
niveaux. Il peut se tromper là où la règle réussissait, ou l'inverse.

Rien de ce qui a été mesuré ne s'y applique.

### Ce qui est déjà construit pour y répondre

| Brique | État |
|---|---|
| Lecture de graphique par Ollama local | fonctionne, écart d'axe mesuré à 2,3 px |
| Rejet des plans incohérents | actif, jamais corrigé en silence |
| Journal, format v2 | écrit, avec la règle de sortie explicite |
| Résolution automatique des issues | le même code que le backtest |
| Excursions MFE/MAE | branché |

**La chaîne est complète. Ce qui manque, ce sont les analyses.**

### Ce qui n'est pas construit, et qui est le vrai problème

**Le témoin.** On ne peut pas mélanger le raisonnement d'un modèle comme on
mélange des bougies. Sans témoin, un taux de réussite de 55 % sur vingt
analyses ne voudra rien dire — on l'a appris assez cher.

Trois pistes de témoin, aucune éprouvée :

1. **Même géométrie, moment tiré au sort.** Prendre le plan du modèle — sens,
   distance au stop, distance à l'objectif — et le rejouer à un instant tiré au
   hasard sur la même période. Isole ce que le modèle apporte par son **choix du
   moment**, à géométrie constante.
2. **Même moment, sens inversé.** Isole ce qu'il apporte par son **choix de
   direction**.
3. **Même capture, modèle différent.** Compare les modèles entre eux, mais ne
   dit rien sur l'avantage absolu.

La première est la plus proche de ce qu'on veut savoir, et elle réutilise tout
le résolveur. **C'est elle qu'il faut construire avant d'accumuler quoi que ce
soit** — sinon on collectera vingt analyses qu'on ne saura pas lire.

### L'ordre

1. **Construire le témoin** — plan du modèle rejoué à un instant tiré au sort,
   n fois, comme le contrôle par permutation du backtest.
2. **Pré-enregistrer** le nombre d'analyses et le seuil, avant d'en produire
   une seule. Même protocole que DEC-018 : on ne regarde pas en accumulant.
3. **Accumuler les analyses** sur des captures réelles, jusqu'au nombre fixé.
4. **Lire le résultat**, une fois, et l'appliquer.

### Ce qui attend derrière

- **Dimensionnement de position.** Des niveaux sans taille ne sont pas un plan.
  Sans objet tant qu'aucune mesure n'est positive.
- **Travailler l'invite** pour que les niveaux découlent du raisonnement —
  seulement une fois qu'il y aura une mesure de départ.
- **L'or**, gardé au registre pour le jour où il y aura quelque chose à y
  préserver.

~~Intégration continue~~ — faite, Node 20 et 22 à chaque push.


---

## Le volume comme critère de détection — BTCUSDT 2024-2025, 2026-09-24

Première fois que le volume décide **quels order blocks existent**, au lieu
d'être mesuré après coup sur ceux qu'on avait déjà.

800 order blocks détectés, 319 issues tranchées, référence à 49,8 % et
espérance −0,003 R.

### La distribution, qui n'était pas celle attendue

```
min 0.15  ·  q1 0.55  ·  médiane 0.79  ·  q3 1.17  ·  max 11.99
```

**La bougie d'order block typique porte moins de volume que la moyenne des
vingt précédentes.** C'est le contraire de ce qu'annonce la littérature SMC —
« empreinte institutionnelle », « pic de volume qui valide l'order block ».

La raison est mécanique et sans mystère : notre order block est la dernière
bougie de **repli** avant l'impulsion. C'est une pause. Le volume est dans le
mouvement qui suit, pas dans la pause qu'on a désignée.

Mesuré aussi sur trois mois (90 candidats, médiane 0,75×) : même forme.

### Une marche, pas une pente

| Volume de la bougie | Taux | Cas |
|---|---|---|
| **< 1,1×** | **45,2 %** | 99/219 |
| 1,1 à 1,25× | 61,9 % | 13/21 |
| 1,25 à 1,5× | 57,1 % | 16/28 |
| ≥ 1,5× | 60,8 % | 31/51 |

Au-dessus de 1,1× le taux ne progresse plus. Le critère **jette les mauvais**
plutôt qu'il ne sélectionne des élus.

Contraste bande basse contre tout le reste : 14,8 points, erreur-type 5,9,
`z` = 2,49.

### Le contrôle ne passe pas

Au seuil 1,25×, 200 tirages :

```
                        réel     médiane   [min – max]
taux de réussite      59.5 %      48.3 %   [23.8 % – 64.4 %]
espérance            0.190 R    -0.035 R   [-0.524 R – 0.288 R]
p (espérance)          0.070
p (taux)               0.070
```

**`p` = 0,070.** Au-dessus du seuil de 0,05 écrit d'avance.

Le chiffre qui rend la chose concrète : le meilleur tirage de contrôle a atteint
**64,4 %** sur des bougies remises dans le désordre — mieux que notre 59,5 %.

### Ce qui reste malgré le refus

L'amplitude maximale **contre** tombe de 0,95 R à 0,74 R, et à 0,58 R sur la
seconde moitié. Ce n'est pas un comptage binaire sur 79 cas, c'est une médiane
sur toutes les transactions — le signal le plus robuste des quatre.

L'effet va dans le même sens sur quatre découpages indépendants : bandes de
volume, deux moitiés de période, amplitude contre, espérance.

### Statut

**Hypothèse, pas résultat.** Gelée par DEC-028, à tester sur COMEX.

Le seuil a été choisi après avoir vu ces données, qui sont désormais brûlées :
elles ne peuvent plus rien prouver. Le contrôle à 1,1× n'a pas été lancé
délibérément — corrigé pour deux tirages emboîtés, il ne pourrait pas sauver le
résultat, seulement en donner l'illusion.


---

## Le test de l'or — GC COMEX 2023-2024, 2026-09-24

Premier jeu de données du projet portant **un volume réel sur l'or**, depuis une
bourse centralisée, découpé contrat par contrat sans aucun recollage.

### Les vérifications, avant tout résultat

| | Attendu | Obtenu |
|---|---|---|
| Bougies 1 minute | ~700 000 | 697 994 |
| Couverture | ~66 % | 66,5 % |
| **Contrats distincts** | ~12 | **11** |
| Période | 2023-01 → 2024-12 | 2023-01-02 → 2024-12-31 |

Les bornes des segments reproduisent le calendrier réel du GC — février, avril,
juin, août, décembre — avec deux périodes de quatre mois là où aucune échéance
liquide ne s'intercale entre août et décembre. Le découpage ne fait pas que
fonctionner : il retrouve une structure qu'on ne lui a pas donnée.

Deux écarts annoncés **avant** la lecture des résultats : le fichier commence le
2023-01-02 à 23:00 UTC (Globex fermé pour le Nouvel An, 1,9 jour manquant), et
`2024-09-18` est marquée « degraded » par le fournisseur.

### La règle de base

```
atteint 1 R avant le stop   50,3 %  (90/179)
intervalle de confiance     [43,0 % – 57,5 %]
espérance par trade         +0,006 R
rapport faveur / contre     1,03
```

Le hasard, comme sur les cinq jeux crypto.

### L'hypothèse du volume — réfutée

```
au-dessus de 1,1×   50,0 %   n = 50
en-dessous          50,4 %   n = 129
écart               −0,4 pt   (z = −0,047)
p                   0,579     1158/2000 permutations font aussi bien
```

Prédiction de DEC-028 : ~45 % en dessous, ~60 % au-dessus, écart de ~15 points.
**Rien n'a répliqué.** Voir DEC-029.

### Le fait qui survit

| Échantillon | Médiane du volume de la bougie d'order block |
|---|---|
| BTCUSDT, 3 mois | 0,75× |
| BTCUSDT, 2 ans | 0,79× |
| **GC COMEX, 2 ans** | **0,64×** |

La bougie d'order block porte **moins** de volume que la moyenne des vingt
précédentes. Deux marchés, trois échantillons, une seule direction — et sur
l'or, le premier quartile tombe à 0,38×.

C'est mesuré, c'est reproductible, et c'est l'inverse de ce qu'annonce la
littérature SMC. Ce fait ne dépend d'aucune hypothèse réfutée.
