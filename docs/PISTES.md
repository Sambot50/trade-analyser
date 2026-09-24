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
| **Sortie partielle** : moitié à 1 R, stop au point mort | Écartée dans DEC-015 | MFE entre 1 et 2 R avec beaucoup de retours au stop |

**Coût annoncé pour l'invalidation sur clôture :** la perte cesse de valoir
exactement −1 R, puisqu'on sort au prix de clôture. Il faut calculer le R
réalisé trade par trade, comme il a fallu le faire pour le remplissage à la
clôture. Ce n'est pas une option d'une ligne.

---

## Ce qui ne coûte rien et n'a jamais été fait

| Piste | Pourquoi ça compte |
|---|---|
| **`--sans-filtre-biais`** | Le filtre jette 45 % de l'échantillon et personne n'a jamais vérifié qu'il sert. Une commande, zéro code. |
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
| Remplissage à la clôture | Un plancher de contrôle positif inexpliqué l'a désignée | DEC-016, DEC-017 — cause principale du biais |
| Traitement des issues ambiguës | Même enquête | DEC-017 — écartée, 0,023 R d'amplitude au maximum |
| Échelle de détection | Stop médian à 0,169 % du prix, soit le bruit d'une bougie | DEC-020 — le biais était une affaire d'échelle |
