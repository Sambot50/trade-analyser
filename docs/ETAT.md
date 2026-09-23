# État du projet

Mis à jour le 2026-09-23.

Ce fichier sépare ce qui est **mesuré** de ce qui est **supposé**. Il n'a
d'intérêt que s'il reste honnête : une ligne qui passe de « non vérifié » à
« vérifié » doit s'appuyer sur une exécution, pas sur une impression.

## Vérifié

| Quoi | Comment | Résultat |
|---|---|---|
| Logique pure | 273 tests unitaires | tous passent |
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
| **La mesure sur BTCUSDT après correctif de la règle de sortie** | Le seul chiffre réel dont on dispose (p = 0,970) a été produit AVANT le correctif DEC-015. Les API de marché sont bloquées depuis cet environnement. | `node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-07-01 --controle 100`, avec `--objectif 1r` puis `2r`. |
| **Le résidu d'espérance sur données sans structure** | +0,035 à +0,055 R au lieu de 0. Suspects : exclusion des ambiguës, censure par l'horizon. Non expliqué. | Mesurer séparément l'effet de chaque exclusion sur une marche aléatoire. |
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

1. **Accumuler des analyses réelles.** Vingt suffisent à savoir si le taux de
   réussite dépasse le seuil d'équilibre imposé par le ratio médian. Tant que
   ce chiffre n'existe pas, tout le reste est de l'optimisation à l'aveugle.
2. **Vérifier la résolution automatique** sur une paire crypto.
3. **Dimensionnement de position.** Des niveaux sans taille de position ne sont
   pas un plan de trade. Capital, risque par trade, distance au stop : du
   calcul pur.
4. **Intégration continue.** Les 112 tests existent, rien ne les exécute au
   push.
5. **Travailler l'invite** pour que les niveaux découlent du raisonnement —
   mais seulement une fois qu'il y aura une mesure de départ.
