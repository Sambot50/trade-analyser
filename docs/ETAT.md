# État du projet

Mis à jour le 2026-09-23.

Ce fichier sépare ce qui est **mesuré** de ce qui est **supposé**. Il n'a
d'intérêt que s'il reste honnête : une ligne qui passe de « non vérifié » à
« vérifié » doit s'appuyer sur une exécution, pas sur une impression.

## Vérifié

| Quoi | Comment | Résultat |
|---|---|---|
| Logique pure | 293 tests unitaires | tous passent |
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

## L'échelle de détection change tout — BTCUSDT, 2026-01-01 → 09-23

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

1. **Le test hors échantillon de DEC-018.** Rien d'autre ne fait avancer la
   question de fond. La configuration est gelée, la règle de décision est
   écrite : `p < 0,05` ou on abandonne la piste.
2. **L'or**, une fois le point 1 tranché. L'import CSV est prêt
   (`docs/DONNEES.md`), et les coûts y sont vingt fois moindres qu'en crypto
   spot — c'est le seul terrain où une espérance de +0,08 R survivrait.
3. **Accumuler des analyses réelles** par le chemin vision. Vingt suffisent à
   savoir si le taux de réussite dépasse le seuil d'équilibre. Question
   distincte de celle du backtest : elle porte sur le modèle, pas sur la règle.
4. **Dimensionnement de position.** Des niveaux sans taille de position ne sont
   pas un plan de trade.
5. **Travailler l'invite** pour que les niveaux découlent du raisonnement —
   seulement une fois qu'il y aura une mesure de départ.

~~Intégration continue~~ — faite, Node 20 et 22 à chaque push.
