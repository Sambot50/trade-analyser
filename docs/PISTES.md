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
