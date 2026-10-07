# Pistes en attente

Ce fichier garde ce qu'on a rencontré sans l'éprouver. Il existe pour deux
raisons opposées : ne pas perdre une bonne idée, et ne pas céder à la tentation
de toutes les essayer.

## La règle, avant la liste

**C'est une file d'attente, pas un menu.**

Une piste en sort quand **une mesure la désigne**, jamais parce qu'on a envie
d'essayer quelque chose après un résultat décevant. Elle passe ensuite par le
protocole de DEC-018 : configuration gelée, données jamais regardées, règle de
décision écrite d'avance.

Le mode d'échec que ce fichier pourrait créer est connu et documenté : vingt
pistes essayées, ce sont vingt tirages, et une significativité garantie par le
hasard. Une étude publique sur SPY, QQQ, DIA et IWM a testé 648 variantes de
concepts ICT — aucune n'a battu l'achat-conservation. C'est ce qui arrive quand
on pioche dans un registre comme celui-ci sans discipline.

---

## Ce qui attend une mesure qu'on va bientôt avoir

Le MFE/MAE de l'export BTCUSDT décide de ces quatre-là.

| Piste | Origine | Se déclenche si |
|---|---|---|
| **Invalidation sur clôture** au lieu de mèche | Littérature ICT | MAE médian proche de 1,0 R — on sort d'un cheveu |
| **Entrée à 50 % de la zone** (mean threshold) | Littérature ICT | MFE > MAE avec beaucoup de `non_declenche` |
| **Objectifs structurels** (pool de liquidité, FVG non comblée) au lieu de 1 R / 2 R | Littérature ICT | MFE médian nettement > 1 R |
| **Entrée au mean threshold, variante « corps »** : milieu de `(ouverture + clôture) / 2` | Littérature ICT | Beaucoup de `non_declenche` dans l'export |
| **Entrée au mean threshold, variante « range »** : milieu de `(plusBas + plusHaut) / 2` | Littérature ICT | Idem — les deux se mesurent ensemble ou pas du tout |
| **Sortie partielle** : moitié à 1 R, stop au point mort | Écartée dans DEC-015 | MFE entre 1 et 2 R avec beaucoup de retours au stop |

**Coût annoncé pour l'invalidation sur clôture :** la perte cesse de valoir
exactement −1 R, puisqu'on sort au prix de clôture. Il faut calculer le R
réalisé trade par trade, comme il a fallu le faire pour le remplissage à la
clôture. Ce n'est pas une option d'une ligne.

### L'entrée à 50 % et les objectifs structurels sont une seule piste

Les sources présentent l'entrée au mean threshold comme un gain de ratio :
« cela réduit le stop et augmente le rapport gain/risque ». **La première
moitié est vraie, la seconde est fausse dans notre cadre.**

Nos objectifs sont posés à 1 R et 2 R **depuis l'entrée**. Si le risque
diminue, les objectifs se rapprochent d'autant : le ratio reste exactement
1:1 et 2:1, par construction. Entrer à mi-bloc ne change alors qu'une chose —
**le taux de déclenchement**, puisque le prix doit pénétrer plus profond.

Le gain de ratio n'existe que si l'objectif est fixé **en prix** et non en
multiple du risque. Donc : adopter l'entrée à 50 % sans les objectifs
structurels ne gagne rien, et les deux pistes se testent ensemble ou pas du
tout.

C'est le genre de chose qu'une source de trading ne dit jamais, faute de
définir son cadre de mesure.

---

## Ce qui ne coûte rien et n'a jamais été fait

| Piste | Pourquoi ça compte |
|---|---|
| ~~**`--sans-filtre-biais`**~~ | **Fait le 2026-09-24 : le filtre ne gagne rien.** Alignés 50,0 %, non alignés 46,6 %, pour une erreur-type de 4,1 points. Il écarte 45 % de l'échantillon sans contrepartie. |
| **Traitement des `non_declenche`** | 103 cas sur 436 écartés. Les ambiguës ont été éprouvées (DEC-017), ceux-là jamais. |
| **Le dépassement sous 2 R / clôture** | −0,074 R systématique sur 60 tirages, inexpliqué. Une anomalie non résolue finit par mordre. |

---

## Concepts ICT non implémentés

| Piste | Ce qu'il faudrait |
|---|---|
| **Breaker block** — order block qui échoue puis s'inverse | Suivre la vie de l'order block après notre entrée |
| **Mitigation block** — order block échoué dont l'origine n'avait pas balayé de liquidité | Idem, plus le croisement avec `liquiditePrise` |
| **Affinage en unité inférieure** — micro-CHoCH en 1 min dans la zone avant d'entrer | Seconde passe sur des bougies fines |
| **Pools de liquidité explicites** — sommets/creux égaux, liquidité de ligne de tendance | Détecteur de niveaux groupés (la référence utilise 1 % du range) |
| **Niveaux journaliers et hebdomadaires précédents** | Trivial à calculer, jamais croisé avec l'issue |

---

## Ce que l'implémentation de référence fait autrement

`joshyattridge/smart-money-concepts`, lue le 2026-09-24.

| Piste | L'écart |
|---|---|
| **Fenêtre de pivot à 50** au lieu de 5 | Dix fois la nôtre. Nos structures sont peut-être du bruit. Enregistré via `significativiteNiveau`, jamais testé comme paramètre. |
| **Définition par le plus-bas** de l'impulsion au lieu de la dernière bougie opposée | Enregistré via `definitionAlternativeEcart`, jamais testé comme définition principale. |
| **`OBVolume`** = bougie de l'order block + les deux suivantes | Notre anomalie de volume porte sur la seule bougie. |

---

## Sources de données à acquérir

Celles-ci coûtent de l'argent, donc elles demandent une décision et pas
seulement du temps.

### COMEX — le flux d'ordres réel sur l'or

> **Sortie de ce registre le 2026-09-24, par décision et non par son
> déclencheur — voir DEC-027.** Le déclencheur écrit ci-dessous ne s'est jamais
> produit : il s'est éteint avec DEC-025, le volume étant le jumeau de
> `zoneSurAtr`, réfuté sur données fraîches. La section est conservée telle
> quelle, déclencheur compris, pour que la barre reste visible.

**Se déclenchait si** le volume ressortait discriminant sur BTCUSDT, là où la
donnée est réelle, gratuite et abondante.

Le problème qu'elle résout : sur XAUUSD chez un courtier CFD, **le volume
n'existe pas**. Le forex est décentralisé, il n'y a pas de bourse centrale donc
pas de volume total, et aucune ventilation acheteur/vendeur. Ce que MT5 affiche
est le *tick volume* — un comptage de changements de prix, sans information
directionnelle. Les CSV HistData portent volume = 0.

COMEX est la division métaux du CME, une bourse **centralisée** : le volume y
existe vraiment. Contrat **GC**, 100 onces troy, tick à 0,10 $/once soit 10 $
par contrat ; micro **MGC** à 10 onces. XAUUSD spot et GC sont arbitrés en
permanence, corrélation proche de 0,99 — le volume COMEX est donc un proxy
légitime de l'activité sur l'or, même si l'exécution se fait sur le CFD.

| Finesse | Source | Coût |
|---|---|---|
| Volume journalier | Yahoo Finance, `GC=F` | gratuit |
| Volume intraday (1 min, 5 min) | Databento, IQFeed, Rithmic, CQG | abonnement mensuel |
| Ventilation acheteur/vendeur | données tick avec drapeau d'agresseur | le palier le plus cher |

Les montants ne sont pas notés ici : les tarifs CME bougent, et un chiffre
périmé dans un document vaut moins que pas de chiffre. À vérifier chez les
fournisseurs, en prêtant attention au statut « non-professionnel » qui change
la facture du tout au tout.

**Deux pièges techniques**, dont les sources de trading ne parlent jamais :

1. **Le roll.** Les contrats expirent ; les mois actifs sur GC sont pairs —
   février, avril, juin, août, décembre. Une série continue sur deux ans
   demande de recoller les contrats, et chaque raccord crée un artefact de
   prix. Mal fait, ça fabrique de faux signaux exactement là où on en cherche.
2. **Ce n'est pas l'instrument tradé.** Même si COMEX montre un flux
   institutionnel, l'exécution reste sur le CFD avec son spread. La donnée est
   **informative**, une entrée de filtre, jamais l'instrument.

**Séquence, si le déclencheur se produit :** d'abord `GC=F` en journalier chez
Yahoo, gratuit, une heure de travail — si un signal de volume existe, il se
verra même à cette échelle grossière. L'intraday payant seulement ensuite, avec
un seuil déjà pré-enregistré.

**Écarté :** le tick volume de MT5 comme substitut. Il est corrélé à l'activité
réelle, mais il ne portera jamais l'information directionnelle qu'on cherche —
il ne permettra jamais de dire « les acheteurs dominaient ».

---

## La détection mécanique est close

**DEC-029, le 2026-09-24.** Six jeux de données, six refus : cinq en crypto,
un sur l'or COMEX. Deux marchés, deux structures temporelles, avec et sans
volume réel, avec et sans bourse centrale.

Aucune piste de ce fichier portant sur la **détection mécanique d'order blocks**
ne sortira plus : ni un autre seuil, ni un autre marché, ni une autre période,
ni une variante de définition. Il n'y a plus de mesure à faire, donc plus rien
qui puisse désigner une piste.

Les entrées correspondantes restent écrites, pour que la barre reste visible.

---

## Questions entières, jamais ouvertes

- **L'or et les instruments à faible spread.** Permis par DEC-018 puisque c'est
  un autre marché. Pronostic mauvais : la règle a échoué sur trois jeux crypto
  avec des intervalles serrés, et des coûts faibles ne créent pas un avantage,
  ils en préservent un.
- **Le chemin vision** — la lecture de graphique par modèle. Zéro mesure à ce
  jour, alors que c'est le point de départ du projet. Question distincte de
  celle du backtest : elle porte sur le raisonnement d'un modèle, pas sur une
  règle mécanique.
- **Le dimensionnement de position.** Des niveaux sans taille ne sont pas un
  plan de trade. Capital, risque par trade, distance au stop : du calcul pur,
  mais sans objet tant qu'aucune règle n'a d'espérance positive.

---

## Ce qui est sorti de ce registre, et comment

Pour mémoire, afin que la barre reste visible.

| Piste | Sortie | Résultat |
|---|---|---|
| Virginité du niveau | Un quatrième critère de validation SMC que `fraicheur` ne couvrait pas | DEC-023 — ajoutée aux qualificatifs |
| Remplissage à la clôture | Un plancher de contrôle positif inexpliqué l'a désignée | DEC-016, DEC-017 — cause principale du biais |
| Traitement des issues ambiguës | Même enquête | DEC-017 — écartée, 0,023 R d'amplitude au maximum |
| Échelle de détection | Stop médian à 0,169 % du prix, soit le bruit d'une bougie | DEC-020 — le biais était une affaire d'échelle |
| Filtre de biais | Une commande gratuite jamais lancée | 2026-09-24 — il ne gagne rien, 3,4 points pour 4,1 d'erreur-type |
| Largeur de zone et volume | Sortis en tête de l'exploration, `p` corrigé à 0,0547 | DEC-024 puis **DEC-025 — réfutés** : −0,2 point sur données fraîches |
| COMEX | **Par décision, pas par son déclencheur** — celui-ci s'était éteint avec DEC-025 | DEC-027 — devient la source du dernier test de la règle mécanique |
| Volume comme critère de détection | Exploration BTC, puis pré-enregistrement | DEC-028 puis **DEC-029 — réfutée** : −0,4 point sur l'or, p = 0,579 |
| **Volume de l'impulsion** (`OBVolume`) | Nommée d'avance dans les excuses écartées de DEC-028 | **Close sans test** — c'est la variante que la clause de clôture interdit de repêcher |

## OB 5 étoiles : le sens observé par HYP-004 (2026-10-07)

**Rencontré, pas éprouvé.** Sur GC 2020-2022 en 15 min, les OB à 5 étoiles
font 43,6 % et +0,054 R (78 trades) contre 36,9 % et −0,115 R aux 0-2 étoiles ;
p = 0,184 face au témoin, donc réfutée. Le sens est favorable, la taille de
l'échantillon insuffisante : 5 étoiles = 3,1 % des OB.

**Ce qui la ferait sortir de la file :** un test pré-enregistré sur des données
jamais utilisées pour les OB, avec assez de trades à 5 étoiles pour qu'un écart
de cette taille se voie — plusieurs marchés réunis, ou les données MT5 à venir.

## Order blocks : ce que les vidéos du bootcamp ajoutent (2026-10-07)

**Rencontré, pas éprouvé.** Relevé dans trois vidéos de Casper (bootcamp),
transcrites par l'opérateur. Chaque piste se teste **seule**, pré-enregistrée,
sur des données jamais regardées pour les OB — jamais toutes ensemble, ce qui
multiplierait les essais (garde-fou 7). Aucun chiffre n'y est mesuré : « 30 000 €
par mois », « 80 % du temps », « 6 % en risquant 1 % » sont des affirmations.

1. **Fort mouvement = bougie ≥ 2 fois la précédente.** Définition chiffrée
   donnée par Casper pour l'imbalance. Alternative au seuil en ATR de
   `mesure:ob-bootcamp` : **candidate n° 1** si cette mesure ne désigne pas de
   seuil net.
2. **OB d'une seule bougie.** La vidéo « SMC » trace l'OB sur la seule
   dernière bougie inverse ; la diapo retenue par l'opérateur prend
   l'accumulation. Autre candidate si l'accumulation déçoit.
3. **Stop sous le plus bas protégé, objectif sur le dernier plus haut.**
   « Entrer dans la liquidité interne, viser la liquidité externe. » Règle de
   sortie distincte du 2 R fixe : une seule règle de sortie par plan
   (garde-fou 6).
4. **Sortie partielle à 1 R, puis objectif final sur la liquidité.** Même
   remarque : une règle de sortie à part entière, à pré-enregistrer comme telle.
5. **Deux CHoCH d'affilée = range, pas de trade.** Filtre d'indécision ; le
   moteur détecte déjà les CHoCH.
6. **Confirmation d'entrée par une bougie** : englobante (vidéo « 5 étoiles »)
   ou doji (vidéo « SMC ») sur l'OB, en petite unité.
7. **Balayage de liquidité AVANT l'OB** (la manipulation : plus bas égaux
   balayés par une mèche, puis le dernier sell avant le buy). Bon signe, à ne
   pas confondre avec l'étoile 4 (liquidité non prise DEVANT l'OB, piège).
   Mesurable : `priseDeLiquidite`.
   **Renforcée le 2026-10-07** : chez Interquity (vidéo sur l'or), c'est une
   condition d'entrée — « pas de liquidity block, pas d'entrée » : une zone
   ne se trade que si un plus bas a été balayé avant la poussée qui l'a créée,
   et que des vendeurs ont été piégés (« inducement »). Deux formateurs
   distincts la posent : **la piste la plus solide à éprouver après HYP-005.**
8. **Emboîtement d'unités.** OB repéré en 4 h, affiné en 1 h, 30 min, 15 min,
   5 min : un OB de petite unité à l'intérieur d'un OB de grande unité ; entrée
   sur le petit, stop sous le grand.
9. **Liquidité de trendline** (trois touches), en plus des plus hauts et plus
   bas égaux de l'étoile 4.
10. **Zone OTE 0,62–0,786** comme zone d'entrée (vidéo « SMC »), là où la
    vidéo « 5 étoiles » prend le 0,5. Déjà au catalogue (§ 7, entrée OTE).
11. **Plus haut et plus bas de la veille** (Interquity ; le trader « price
    action » marque aussi ceux du jour). Une source de liquidité de plus : le
    plus haut de la veille balayé, viser son plus bas. Calculable comme les
    sessions (`sessions.js`).
12. **Pas de trade les jours fériés** (Interquity). Filtre de calendrier ; à
    mesurer comme les autres avant de l'imposer.
13. **Pas de trade les jours d'annonces fortes** (NFP, CPI — Gian Luca : sa
    stratégie y perd). Rejoint la piste 12 ; les fenêtres d'annonces existent
    déjà (`anomalies.js`).
14. **Session de New York contre Londres** (Gian Luca : New York meilleure
    pour lui). À ventiler sur nos mesures avant d'en faire un filtre.
    **Renforcée le 2026-10-07** : la checklist de Casper (vidéo « 15 hacks »)
    est « en tendance, 15 min, **session américaine**, retour sur l'OB ». Deux
    sources. À éprouver **après HYP-005**, sur des données qu'elle n'a pas
    touchées (`GC_2025_2026.csv` ou la série MT5) : OB du bootcamp limités à la
    séance de New York, contre les autres heures. À noter : son 15 min est
    l'unité qui sort **négative** dans `mesure:ob-bootcamp` ; le filtre de
    séance est peut-être ce qui la sépare de notre mesure, ou ne l'est pas.
15. **Participation minimale** (Chris : un plancher de volume par bougie de
    5 min, en dessous il ne trade pas). Possible sur les contrats à terme, qui
    portent le volume ; pas sur un CSV de CFD.
16. **La « bougie valide »** (Gian Luca) : corps plus grand que la plus longue
    mèche ; le bas de structure est la bougie valide la plus proche de la
    cassure. Définition sans interprétation, à comparer à nos pivots.

### Ce qu'on ne prend pas (2026-10-07)

- **Les rendements de compétition** (104 % en un trimestre, 254 %, 100 % en
  un mois) : tailles de compétition, et le gagnant parmi des milliers est aussi
  celui qui a pris le plus de risque.
- **Le gamma des options et le carnet d'ordres** (Chris) : données d'options
  payantes, transactions absentes des CFD. Une autre stratégie que la nôtre.
- **L'optimisation automatique de stratégie** (skill « autoresearch », vidéo
  « 15 hacks » de Casper : « si ce n'est pas rentable, il l'optimise ») :
  essayer jusqu'à ce que ça passe, c'est fabriquer le résultat (garde-fou 7,
  DEC-018). Sur les données passées, ça finit toujours par passer.
- **Le connecteur TradingView d'un dépôt GitHub tiers** (même vidéo) : aucune
  API officielle, et du code inconnu avec accès aux fichiers et à l'écran.

