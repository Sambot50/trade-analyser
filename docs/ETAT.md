# État du projet

Mis à jour le 2026-09-22.

Ce fichier sépare ce qui est **mesuré** de ce qui est **supposé**. Il n'a
d'intérêt que s'il reste honnête : une ligne qui passe de « non vérifié » à
« vérifié » doit s'appuyer sur une exécution, pas sur une impression.

## Vérifié

| Quoi | Comment | Résultat |
|---|---|---|
| Logique pure | 112 tests unitaires | tous passent |
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
