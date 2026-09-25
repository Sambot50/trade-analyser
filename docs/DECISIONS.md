# Décisions d'architecture

Une entrée par choix structurant, avec son motif. Ce qui compte ici n'est pas
la décision — le code la montre — mais **pourquoi** elle a été prise, et
quelles alternatives ont été écartées.

Format : `DEC-nnn`, jamais renumérotées. Une décision annulée est marquée
*Remplacée*, pas supprimée.

---

## DEC-001 — Dépôt séparé plutôt que sous-dossier

**2026-09-22 · Retenue**

Le projet est né comme un composant React collé dans une conversation. Il
aurait pu atterrir dans un sous-dossier d'`assistant-personnel`.

**Motif retenu :** cycles de vie disjoints. `assistant-personnel` est un dépôt
d'infrastructure dont la vocation était en cours de redéfinition ; y déposer
une application React aurait tranché cette question par accident. Un
`package.json` et ses dépendances front n'ont rien à y faire.

**Motif explicitement écarté :** le retour arrière. Il avait été avancé comme
raison principale — à tort. `git revert`, les tags et l'historique complet
fonctionnent identiquement dans un sous-dossier. Séparer n'apporte rien sur ce
plan.

---

## DEC-002 — Projection ancrée sur un couple de référence, jamais sur des hauteurs fixes

**2026-09-22 · Retenue**

La version initiale traçait les niveaux à des fractions de hauteur codées en
dur : `0.55` pour l'entrée, `0.75` pour le stop. Les traits n'avaient aucun
rapport avec la position réelle du prix sur le graphique.

**Motif :** un overlay faux est plus dangereux que pas d'overlay. Il produit un
objet qui ressemble exactement à une analyse mesurée — pointillés propres,
étiquettes de prix — alors que la position est arbitraire. L'utilisateur finit
par lire la position du trait plutôt que le chiffre.

Le modèle renvoie désormais un repère `scale` : deux prix lus sur l'axe et
leur hauteur dans l'image. La projection en découle, et devient falsifiable —
si le repère est incohérent, rien n'est tracé et l'interface le dit.

---

## DEC-003 — Le repère est un couple de points, pas les bornes du visible

**2026-09-22 · Retenue**

Mesuré sur modèles réels : tous ancrent leur repère sur les **graduations
chiffrées extrêmes** de l'axe, jamais sur les bords de la zone de tracé, que
rien n'étiquette. Sur le graphique de référence, ils lisent `65600 / 63600`
au lieu de `65800 / 63600` — et renvoient la hauteur de ces graduations-là,
donc leur projection reste juste.

**Conséquence sur le code :** `priceToY` bornait le tracé sur
`[priceBottom, priceTop]`. Un niveau au-dessus de la graduation la plus haute
mais parfaitement visible dans le cadre était donc écarté comme « hors cadre ».
Le seul critère de rejet valable est l'ordonnée calculée : hors de l'image on
ne trace pas, dans l'image on trace.

**Conséquence sur l'invite :** demander deux graduations chiffrées, ce que les
modèles savent relever, plutôt que deux bords qu'ils doivent extrapoler.

---

## DEC-004 — Moteur local par défaut

**2026-09-22 · Retenue**

Le code était soudé à l'API Gemini. L'application est devenue inutilisable dès
que la création d'une clé a été refusée par Google.

**Motif :** un outil personnel ne doit pas dépendre d'un compte tiers
révocable. Ollama en local supprime la clé, le quota et le compte — et, effet
de bord notable, **supprime aussi le secret côté navigateur**, qui était le
défaut de sécurité reconnu de la version initiale.

**Contrepartie assumée :** la lecture d'axe est moins sûre qu'avec un modèle
distant de premier plan. Les garde-fous la rendent visible plutôt que
silencieuse : un modèle plus faible se fait rejeter plus souvent, il ne
produit pas des niveaux inventés.

`analyzeChart(dataUrl, config)` passe derrière un registre de fournisseurs :
ajouter un moteur ne touche pas l'interface.

---

## DEC-005 — Choisir un modèle par la mesure, pas par la réputation

**2026-09-22 · Retenue**

`qwen2.5vl:7b` avait été recommandé sur sa réputation en lecture de texte fin.
Mesuré, il échoue à produire un repère valide — deux fois, sur deux graphiques
et deux formulations d'invite. `qwen3.8:27b` passe à 2,3 px de dérive.

**Motif :** la seule question qui compte est « ce modèle lit-il correctement un
axe de prix », et elle se mesure. `scripts/bench-vision.mjs` est versionné pour
que la réponse soit reproductible sur n'importe quelle machine, avec les
modèles qui y sont installés.

L'indicateur est la **dérive** : de combien de pixels une ligne serait mal
placée si l'on faisait confiance à ce modèle. En dessous de 10 px, utilisable.

---

## DEC-006 — Le disque est la mémoire, le navigateur un tampon

**2026-09-22 · Retenue**

Trois options pour le journal : `localStorage` (~5 Mo, éliminé — une capture
pèse 300 Ko), IndexedDB seul, ou des fichiers sur disque.

**Motif :** IndexedDB tiendrait la capacité, mais les données restent
enfermées dans le profil du navigateur — ni inspectables, ni sauvegardables, et
effacées sans avertissement par un nettoyage de données de site. Pour un
journal censé servir de mesure sur plusieurs semaines, c'est disqualifiant.

IndexedDB reste comme **tampon** : il garantit qu'une analyse n'est jamais
perdue entre sa production et son écriture disque. L'interface affiche en
permanence combien d'analyses n'ont pas atteint le disque, pour qu'on ne le
prenne jamais pour une sauvegarde.

---

## DEC-007 — L'index est un journal d'évènements, pas une table

**2026-09-22 · Retenue**

`index.jsonl` est en ajout seul. Constater l'issue d'un trade **ajoute** une
ligne pour le même `id` ; le fichier n'est jamais réécrit.

**Motif :** une écriture interrompue ne peut pas corrompre l'historique. Effet
de bord utile : l'historique des corrections reste visible si l'on change
d'avis sur une issue. La lecture regroupe par `id` et garde la dernière ligne.

---

## DEC-008 — Les issues ambiguës sont exclues, pas arbitrées

**2026-09-22 · Retenue**

Quand une même bougie touche le stop **et** un objectif, son OHLC ne dit pas
lequel a été atteint en premier.

**Motif :** trancher au hasard biaiserait le taux de réussite dans un sens ou
dans l'autre — typiquement dans le sens le plus flatteur. Ces cas sont marqués
`ambigu` et retirés des statistiques, ce que `RAPPORT.md` énonce explicitement.

La résolution se fait sur des bougies d'une minute quelle que soit l'unité de
temps de l'analyse : plus la bougie est fine, plus le cas est rare. Il ne
disparaît pas pour autant.

---

## DEC-009 — Un enregistrement doit être interprétable seul

**2026-09-22 · Retenue**

Le format du journal porte une version de schéma, des noms de champs complets,
la devise de cotation explicite, et les seuils qui justifient chaque verdict.

**Motif :** un agent qui lit des enregistrements écrits sur six mois doit
pouvoir les interpréter sans accès au code qui les a produits. Écrire
`verdictRatio: "defavorable"` sans dire que le seuil est 1 rend le verdict
ininterprétable. Le surcoût en octets est sans commune mesure avec le coût
d'un contresens.

`SCHEMA.md` est généré depuis le code, donc il ne peut pas dériver du format
réel — contrairement à une documentation tenue à la main.

---

## DEC-010 — Enregistrement automatique, suppression impossible depuis l'application

**2026-09-22 · Retenue**

**Motif :** un journal qu'on alimente à la main se remplit trois fois puis
s'arrête. Et un journal de mesure qu'on peut nettoyer d'un clic ne mesure plus
grand-chose — on efface les cas gênants sans s'en rendre compte.

Supprimer une entrée reste possible : en supprimant son dossier. Le geste est
délibéré.

---

## DEC-011 — Un fichier CSV comme seconde source, pas comme second système

**2026-09-23 · Retenue**

Le backtest accepte `--csv`. Les bougies d'un fichier traversent exactement les
mêmes détecteurs que celles de Binance ; rien dans `structure.js`,
`orderblocks.js` ou `resolve.js` ne sait d'où elles viennent.

**Motif :** Binance ne cote ni l'or, ni le forex, ni les indices — c'est-à-dire
l'essentiel de ce qui est réellement tradé ici. Sans seconde source, le projet
mesurait un marché qui n'était pas le sien.

**Écarté :** un connecteur par courtier. Chaque API impose son compte, ses
quotas et sa forme ; le CSV est le seul format que tous exportent. Un fichier
se rejoue à l'identique dans six mois, ce qu'aucune API ne garantit.

**Écarté :** trois fichiers, un par unité de temps. Un seul fichier 1 minute
porte tout, et l'agrégation est exacte. Trois fichiers exposent à trois
périodes qui ne se recouvrent pas — un décalage qu'aucune erreur ne signale.

**Conséquence assumée :** un CSV de CFD ne porte pas le détail acheteur/vendeur.
`delta` y vaut `null`, et l'analyse de volume ne produit rien plutôt que de
déduire le déséquilibre du sens de la bougie — ce qui ne mesurerait que ce
qu'on sait déjà. L'étude de volume reste donc réservée au crypto.

---

## DEC-012 — Les coûts se mesurent, ils ne se supposent pas

**2026-09-23 · Retenue**

`--spread` et `--commission` s'expriment en unités de prix. Le coût en R est
calculé plan par plan : `(spread + commission) / distance du stop`. La constante
`--cout-en-r` ne sert plus que de repli, et l'affichage dit laquelle des deux
a servi.

**Motif :** la constante précédente valait 0,05 R, posée faute de mieux. Mesurée,
elle vaut **0,10 R** sur l'or à 0,25 $ de spread et **0,78 R** sur du BTC spot
à 0,1 %. Entre les deux, la conclusion s'inverse : même taux de réussite, même
ratio, espérance +0,34 R d'un côté et −0,34 R de l'autre.

Le seuil de rentabilité est désormais affiché face à l'intervalle de confiance,
avec trois verdicts possibles : gagnant même au pire de l'intervalle, perdant
même au mieux, ou indécidable. C'est le seul chiffre qui dise si une règle
gagne de l'argent — un taux de réussite ne le dit pas.

**Écarté :** un coût en pourcentage du prix. Ce qui décide n'est pas le rapport
du coût au prix mais son rapport au risque. Deux plans au même prix et aux stops
différents ne paient pas le même coût en R ; seule la division par la distance
du stop le montre.


---

## DEC-013 — Un évènement est daté quand il devient connaissable

**2026-09-23 · Retenue, rétroactive**

Consignée après coup : la règle s'appliquait déjà, le code ne la respectait
pas. Elle est écrite ici pour qu'on ne la reperde pas.

Une cassure de structure est datée à la **fermeture** de la bougie qui casse,
jamais à son ouverture. D'où `fermetureMs` sur chaque bougie — colonne 6 des
klines Binance, calculée depuis l'unité de temps pour un CSV — et le refus de
`creerCassure` d'en produire une sans.

**Motif :** `creerCassure` estampillait `ouvertureMs` alors que la cassure se
constate sur clôture. La résolution démarrait jusqu'à quinze minutes trop tôt
et le filtre de biais 1 heure lisait jusqu'à soixante minutes dans le futur.

**L'effet mesuré, sur données identiques :** 62,2 % → 45,1 %. Espérance de la
seconde moitié : +0,607 R → −0,014 R. Tout l'avantage apparent venait de là.

**Ce qui n'a pas marché :** le découpage en deux moitiés n'a rien vu — les deux
moitiés trichaient également. Un test anti-lecture-du-futur existait déjà, mais
il ne vérifiait que le délai de confirmation des pivots, pas l'horodatage. Ce
qui a trouvé le bug, c'est d'avoir refusé de croire un bon résultat.

**Conséquence sur les tests :** un test parcourt désormais **tous** les
évènements produits et vérifie `c.ms === bougies[c.index].fermetureMs`. Un
invariant vérifié sur un cas choisi ne vaut rien.


---

## DEC-014 — Le hasard comme témoin, sur les mêmes données

**2026-09-23 · Retenue**

`--controle N` rejoue les mêmes détecteurs sur les mêmes bougies, remises dans
un ordre tiré au sort, N fois. Le résultat réel est positionné dans la
distribution obtenue, et le script rapporte la proportion de tirages qui font
aussi bien — le p unilatéral d'un test de permutation.

**Motif :** le découpage en deux moitiés attrape un réglage sur-ajusté, pas une
règle qui n'a jamais rien eu à exploiter. Si l'avantage est nul, il est nul
dans les deux moitiés et rien ne le signale. C'est exactement ce qui s'est
produit : 53,4 % sur du BTCUSDT réel, 53,2 % sur une marche aléatoire.

**Le mélange conserve chaque bougie et ne détruit que la suite.** Chaque bougie
est décomposée en rendements logarithmiques relatifs à son ouverture, plus
l'écart avec la clôture précédente ; les tuples sont permutés, la série est
reconstruite. Un marteau reste un marteau, une bougie de +2 % reste une bougie
de +2 %. Les horodatages ne bougent pas — sinon les week-ends du forex
atterriraient en milieu de semaine.

**Écarté :** mélanger les prix eux-mêmes. Ça produirait des séries qu'aucun
marché ne peut engendrer, et le témoin ne témoignerait de rien.

**Écarté :** un générateur de marche aléatoire séparé. Il n'a ni la volatilité
ni la distribution des bougies du marché étudié ; la comparaison porterait
autant sur le générateur que sur la règle. Le seul témoin honnête est fait des
données elles-mêmes.

**Le p ne descend jamais à zéro.** `(k+1)/(N+1)` plutôt que `k/N` : sans ça,
cent tirages tous battus afficheraient « p = 0 », c'est-à-dire une
impossibilité, alors qu'on a seulement manqué de tirages. Le plancher est
annoncé quand il est atteint.

### Ce que le contrôle a montré en se validant lui-même

Éprouvé dans les deux sens, sur 92 000 bougies 1 minute et 100 tirages :

| Série d'essai | Réel | Médiane des tirages | p |
|---|---|---|---|
| Marche aléatoire | +0,390 R | +0,407 R | **0,604** |
| Momentum planté (`r = 0,35·r₋₁ + bruit`) | +1,605 R | +1,120 R | **0,010** (0/100) |

Un contrôle qui répondrait toujours « pas d'avantage » serait inutile. Celui-ci
détecte un avantage planté et ignore le bruit.

**Et il montre au passage ce qui rendait les chiffres précédents illisibles :**
sur du bruit pur, les tirages de contrôle rendent une espérance médiane de
**+0,407 R**. Un système qui paraît rentable sur des données sans aucune
structure. L'espérance seule ne veut rien dire ; elle ne se lit que face à son
témoin.

---

## DEC-015 — Une seule règle de sortie, choisie avant d'ouvrir

**2026-09-23 · Retenue**

`resoudreIssue` exige désormais un `objectif` explicite, `1r` ou `2r`, et
refuse de résoudre sans. Sous `2r`, un trade passé par TP1 puis stoppé est un
**stop à −1 R**. Sous `1r`, TP2 n'existe pas.

**Motif :** la version précédente créditait +1 R à ce trade — « un objectif
déjà atteint n'est pas effacé par un stop ultérieur » — tout en créditant
+2 R s'il allait jusqu'à TP2. C'est une option gratuite. À l'instant où le
prix touche 1 R il faut choisir, encaisser ou tenir, et on ne peut pas savoir
laquelle était la bonne sans regarder la suite. **Une lecture du futur, dans
la règle de sortie.**

Même classe d'erreur que DEC-013, à un autre endroit de la chaîne, et trouvée
par le même réflexe : refuser de croire un bon chiffre.

### Mesuré sur 200 000 marches aléatoires

Sur un martingale, toute règle de sortie doit rendre une espérance nulle.

| Règle de sortie | Espérance | Attendu |
|---|---|---|
| Convention v1 (TP1 non effacé) | **+0,330 R** | 0 |
| Sortie ferme à 1 R | −0,001 R | 0 ✓ |
| Tenue jusqu'à 2 R | −0,007 R | 0 ✓ |

Elle fabriquait un tiers d'unité de risque par trade à partir de rien.

### Ce que le correctif change sur les mesures

Contrôle par permutation sur un fichier sans aucune structure, médiane des
tirages :

| | Avant | Après |
|---|---|---|
| Espérance des tirages de contrôle | +0,407 R | **+0,055 R** (`2r`), +0,035 R (`1r`) |

Le contrôle garde sa sensibilité : sur la série à momentum planté, il détecte
toujours l'avantage à p = 0,016 (0/60) sous les deux règles.

**Résidu assumé :** +0,035 à +0,055 R au lieu de 0 exactement. Il vient
probablement de l'exclusion des issues ambiguës et de la censure par
l'horizon, toutes deux non symétriques. À surveiller, pas encore expliqué.

**Écarté pour l'instant :** la sortie partielle — moitié à 1 R, stop ramené au
point mort, reste jusqu'à 2 R. C'est la règle la plus réaliste, mais elle
demande un stop mobile, donc une troisième chose à se tromper. Elle viendra
quand les deux premières seront mesurées.

**Conséquence sur le journal :** `SCHEMA_VERSION` passe de 1 à 2, et chaque
plan porte `objectifDeSortie`. Les enregistrements v1 restent lisibles mais ne
se comparent pas aux v2 — ils ont été résolus sous l'autre convention.


---

## DEC-016 — L'hypothèse de remplissage devient un paramètre, et elle explique la moitié du biais

**2026-09-23 · Retenue, résultat partiel**

`--remplissage meche|cloture`. Sous `cloture`, l'entrée est supposée obtenue à
la clôture de la bougie qui a touché la zone, et la résolution ne commence
qu'à la bougie **suivante**. Le stop reste où le plan l'a posé — c'est un
niveau structurel — et les objectifs sont redérivés à 1 R et 2 R du prix
réellement obtenu, si bien qu'un remplissage défavorable éloigne l'objectif
autant qu'il rapproche le stop.

**Motif :** le contrôle par permutation rendait une espérance positive sur des
données sans aucune structure, là où la théorie impose zéro (DEC-015, résidu
non expliqué). Soupçon principal : `meche` suppose une exécution au prix exact
du plan dès qu'une mèche le touche, sans glissement ni file d'attente. Or une
bougie dont la mèche vient chercher un niveau referme généralement au-dessus —
on entre à l'extrême favorable, et le mouvement favorable de la bougie de
déclenchement est compté pour nous.

### Mesuré — médiane des tirages de contrôle, coûts mis à zéro

Ce chiffre doit valoir 0. Tout écart est du biais de mesure.

| Règle de sortie | `meche` | `cloture` | Réduction |
|---|---|---|---|
| Sortie ferme à 1 R | +0,093 R | **+0,043 R** | −54 % |
| Tenue jusqu'à 2 R | +0,108 R | **+0,088 R** | −19 % |

**Le soupçon était fondé, et insuffisant.** Sous 1 R, l'hypothèse de
remplissage portait la moitié du biais ; sous 2 R, presque rien. Il reste
donc au moins une autre cause, non identifiée.

La sensibilité est intacte : sur la série à momentum planté, l'avantage est
toujours détecté à p = 0,016 (0/60) sous les deux règles.

**Ce qui reste à éprouver**, par ordre de plausibilité : le traitement des
issues ambiguës (exclues aujourd'hui), puis celui des `non_declenche`. La
méthode est la même — faire varier une exclusion à la fois et regarder si le
plancher bouge.

**`meche` reste le défaut**, pour que les mesures antérieures restent
comparables. C'est pourtant l'hypothèse la plus favorable qui existe : le jour
où le biais sera expliqué, `cloture` devrait prendre sa place.

**Écarté :** modéliser un glissement en points. Ça ajouterait un paramètre
inventé là où `cloture` n'ajoute qu'une hypothèse vérifiable.


---

## DEC-017 — Les issues ambiguës sont innocentes ; le remplissage portait tout

**2026-09-23 · Enquête close sur un point, ouverte sur un autre**

`--ambigu exclu|perdant|gagnant`. Le résolveur continue de marquer `ambigu`
sans jamais deviner l'ordre — c'est un fait, il ne peut pas le savoir. C'est
le **comptage** qui varie, dans l'agrégation : exclure, compter en perte, ou
compter en gain. Les deux derniers encadrent la vérité ; l'écart entre eux
mesure ce que l'exclusion cache.

### Le résultat : elle ne cache rien

Médiane des tirages de contrôle sur données sans structure, coûts à zéro —
chiffre qui doit valoir 0 :

| Objectif | Remplissage | `perdant` | `exclu` | `gagnant` | Amplitude |
|---|---|---|---|---|---|
| 1 R | mèche | +0,231 R | +0,245 R | +0,254 R | 0,023 R |
| 1 R | clôture | −0,018 R | −0,012 R | +0,000 R | 0,018 R |
| 2 R | mèche | +0,106 R | +0,108 R | +0,118 R | 0,012 R |
| 2 R | clôture | −0,076 R | −0,074 R | −0,072 R | 0,004 R |

**L'exclusion tombe systématiquement entre les deux bornes**, et l'amplitude
ne dépasse jamais 0,023 R. Les issues ambiguës ne peuvent pas expliquer un
biais de +0,245 R. Suspect écarté.

### Et une correction : le remplissage portait tout, pas la moitié

DEC-016 concluait que l'hypothèse de remplissage expliquait « la moitié du
biais sous 1 R et presque rien sous 2 R ». **C'était faux, et la faute vient
de l'instrument.** Ces chiffres avaient été mesurés sur un fichier synthétique
dont les mèches valaient 0,017 % du prix — cent fois plus fines que celles
d'un marché réel. Or c'est précisément sur les mèches que porte l'hypothèse.
Ce fichier ne produisait d'ailleurs **aucune issue ambiguë**, ce qui rendait
l'expérience ci-dessus impossible et a imposé d'en générer un autre.

Sur une série à volatilité réaliste — 0,08 % d'écart-type à la minute, sauts
occasionnels, mèches comparables aux corps :

| Objectif | `meche` | `cloture` |
|---|---|---|
| Sortie ferme à 1 R | +0,245 R · 65,8 % | **−0,012 R · 49,2 %** |
| Tenue jusqu'à 2 R | +0,108 R · 35,6 % | −0,074 R · 27,1 % |

Sous 1 R, le remplissage à la clôture **annule le biais** : 49,2 % de réussite
sur une marche aléatoire, là où la théorie exige 50 %. Le biais entier venait
de l'hypothèse d'exécution à la mèche.

### Ce qui reste inexpliqué

Sous 2 R, la clôture **surcorrige** : −0,074 R, systématique sur 60 tirages.
L'hypothèse d'une censure par l'horizon est **écartée par la mesure** — zéro
`horizon_depasse` dans les deux modes. Cause inconnue.

### Conséquence pratique

**`--objectif 1r --remplissage cloture` est la seule configuration dont le
plancher soit vérifié proche de zéro.** C'est donc la seule dans laquelle un
résultat mesuré puisse être cru. Les autres restent utiles pour comparer, pas
pour conclure.

**Écarté :** deviner l'ordre d'une bougie ambiguë d'après sa couleur. Le vrai
remède est une unité de résolution plus fine — une bougie de 5 minutes qui
touche les deux niveaux se décompose en bougies d'une minute qui, elles,
disent l'ordre.

---

## DEC-018 — Pré-enregistrement : un seul test, décidé avant de le lancer

**2026-09-23 · Retenue, écrite avant les données**

À la détection 1 h, le backtest rend **p = 0,129** sur BTCUSDT — le premier
indice du projet. Ce document fixe ce qui sera testé et comment le résultat
sera lu, **avant** que les données servant à le trancher soient examinées.

### La configuration, gelée

```
--ut-biais 4h  --ut-detection 1h  --ut-resolution 5m
--objectif 1r  --remplissage cloture  --fenetre 5  --horizon-heures 48
--controle 200
```

Aucun paramètre ne bouge. Pas de variante, pas de réglage, pas de « et si on
essayait aussi ». Toute modification annule le test et en ouvre un autre.

### Les données, jamais regardées

1. `BTCUSDT --depuis 2024-01-01 --jusqua 2025-12-31` — deux ans antérieurs.
2. `ETHUSDT --depuis 2026-01-01` — autre actif, même période.

### La règle de décision

| Résultat | Conséquence |
|---|---|
| `p < 0,05` sur les deux jeux | La piste vaut la peine d'être poursuivie : mesurer sur l'or, puis dimensionner. |
| `p < 0,05` sur un seul | Indice persistant, pas de conclusion. Étendre l'historique, ne rien engager. |
| `p ≥ 0,05` sur les deux | **Abandon de cette configuration.** Pas de nouvelle variante sur les mêmes données. |

### Motif

**Six configurations ont été essayées sur la même période de BTCUSDT.** Sous
l'hypothèse nulle, la probabilité qu'au moins une affiche p ≤ 0,13 par hasard
est de l'ordre de 55 % — les essais partagent leurs données, donc ce chiffre
n'est qu'un ordre de grandeur, mais le mode d'échec est réel : à force de
chercher, on trouve.

Ni le découpage en deux moitiés ni le contrôle par permutation n'attrapent ce
biais-là. Le premier compare deux moitiés des mêmes données ; le second
compare une règle au hasard, une règle à la fois. Aucun des deux ne sait
combien de règles ont été essayées avant.

Le seul remède est d'écrire la décision avant de voir le résultat. C'est ce
que fait ce document, et c'est pourquoi il est daté.

### Ce qui plaide malgré tout pour cette configuration

Elle n'a pas été pêchée parmi dix. Elle a été proposée pour un motif mécanique
énoncé **avant** la mesure : à la détection 15 minutes, le stop médian valait
0,169 % du prix, soit l'amplitude d'une seule bougie — un stop posé dans le
bruit. Le passage à 1 h portait ce stop à 0,438 %.

Ce motif a d'ailleurs été confirmé par un effet qui n'était pas recherché : à
la détection 1 h, le plancher de contrôle tombe à **−0,004 R pour 49,8 % de
réussite**, c'est-à-dire exactement zéro, alors qu'il était biaisé à toutes
les mesures précédentes.

Ça rend l'hypothèse moins arbitraire. Ça ne la rend pas vraie.

### Écarté

**Poursuivre en ajustant la configuration jusqu'à obtenir p < 0,05.** C'est
exactement le geste que ce document existe pour interdire.

---

## DEC-019 — Abandon de la configuration pré-enregistrée

**2026-09-23 · Application de DEC-018**

Le test hors échantillon a été lancé sur les deux jeux nommés, avec la
configuration gelée, sans rien modifier.

| Jeu | Issues tranchées | Réel | Contrôle médiane | p |
|---|---|---|---|---|
| BTCUSDT 2024-2025 | 318 | 50,0 % · **0,000 R** | 49,2 % · −0,017 R | 0,373 |
| ETHUSDT 2026 | 116 | 47,4 % · −0,052 R | 49,0 % · −0,021 R | 0,617 |

Les deux `p` dépassent 0,05. **La troisième ligne du tableau de décision
s'applique : abandon, sans nouvelle variante sur les mêmes données.**

Le run BTCUSDT est un nul sans ambiguïté : 159 gagnants, 159 perdants,
espérance 0,000 R sur 318 cas, intervalle [44,5 % – 55,5 %]. Ce n'est pas
« on ne sait pas », c'est « il n'y a rien ». Le `p = 0,129` obtenu sur les
neuf mois de 2026 était bien ce que DEC-018 annonçait : un tirage parmi six.

### Ce qui est acquis au passage

Le plancher de contrôle vaut **−0,017 R / 49,2 %** sur deux ans de BTCUSDT et
**−0,021 R / 49,0 %** sur ETHUSDT. L'appareil est propre à la détection 1 h
sur deux jeux qu'il n'avait jamais vus — la conclusion de DEC-017 sur l'échelle
se confirme hors échantillon.

### Portée exacte de l'abandon

Est abandonnée **la règle mécanique telle que spécifiée** : dernière bougie
opposée avant l'impulsion, entrée au bord proximal, stop à `MARGE_STOP` au-delà
de la zone, filtre de biais sur l'unité supérieure.

N'est **pas** concernée la question de la lecture de graphique par modèle de
vision, qui porte sur le raisonnement d'un modèle et non sur une règle
mécanique. Elle reste non mesurée.

### Ce que l'abandon interdit, et ce qu'il n'interdit pas

**Interdit :** réessayer une variante de réglage sur ces mêmes données —
`--fenetre 7`, `MARGE_STOP` à 0,2, une autre unité de temps. C'est le geste que
DEC-018 existe pour empêcher, et le plus tentant après un échec.

**Permis :** diagnostiquer *pourquoi* la règle ne porte rien. Un diagnostic
n'est pas un réglage : il cherche à savoir si une variable enregistrée sépare
les gagnants des perdants, question à laquelle personne n'a encore regardé
alors que la donnée existe. Toute règle qui en sortirait devra être
pré-enregistrée et testée hors échantillon comme celle-ci.
## DEC-020 — Qualifier les order blocks plutôt que les régler

**2026-09-24 · Retenue**

DEC-019 a abandonné la règle mécanique : 50,0 % sur 318 cas, un tirage à pile
ou face. Reste une question que personne n'avait posée — **la population est-elle
homogène ?** Le détecteur prend tous les order blocks indistinctement ; la
moyenne à 50 % peut masquer des sous-populations qui n'ont rien à voir.

`src/lib/marche/qualificatifs.js` calcule douze qualificatifs par order block.
`--export <fichier>` écrit un JSONL, une ligne par cas, qualificatifs et issue
compris. **On ne décide pas lesquels comptent : on les enregistre, et la mesure
tranchera.**

### La liste, et d'où elle vient

Établie en lisant l'implémentation Python la plus utilisée
(`joshyattridge/smart-money-concepts`) et la littérature des praticiens, avant
d'écrire une ligne de code.

| Qualificatif | Définition retenue |
|---|---|
| FVG de l'impulsion | Motif 3 bougies, née entre l'order block et la cassure |
| Prise de liquidité | Extrême antérieur percé puis refermé du bon côté |
| Déplacement | Ampleur en hauteurs de zone, plénitude des corps, durée |
| Significativité du niveau | Part des bougies antérieures restées en deçà |
| Premium / discount, OTE | Position dans la jambe ; retracement 62–79 % |
| Fraîcheur | Retour dans la zone après en être sorti |
| Zone / ATR | Hauteur rapportée à la volatilité ambiante |
| Définition alternative | Bougie du plus bas de l'impulsion, et son écart au nôtre |
| Heure et jour UTC | Bruts, jamais une session nommée |
| MFE / MAE | `excursion.js`, écrit depuis le premier jour, jamais appelé |

### Deux découvertes faites en lisant l'implémentation de référence

**Notre définition n'est pas la sienne.** Elle prend la bougie du plus bas de
l'impulsion ; nous prenons la dernière bougie de couleur opposée. Les deux
divergent souvent — d'où `definitionAlternativeEcart`, enregistré plutôt que
tranché.

**Sa fenêtre de pivot vaut 50, la nôtre 5.** Nos « structures » sont peut-être
des micro-pivots. Changer `fenetre` serait la variante interdite par DEC-019 ;
on enregistre donc `significativiteNiveau`, et l'analyse dira si les grosses
cassures se comportent autrement. **La question est répondue sans rien régler.**

### Le diagnostic qui passe avant tout le reste

MFE / MAE médians, en unités de risque, rapportés au prix réellement obtenu :

| Lecture | Conclusion |
|---|---|
| Faveur ≈ contre | Le point d'entrée ne porte rien. Il n'y a pas de géométrie à corriger. |
| Faveur > contre | L'information existe, le plan la détruit — et la distribution dit où poser stop et objectif. |

Étalonné : sur une marche aléatoire, faveur 1,01 R contre 1,01 R, rapport 1,00.

### Ce que dit la littérature, et qu'il faut avoir en tête

Aucune preuve publique rigoureuse que le cadre SMC porte un avantage. Une étude
sur SPY, QQQ, DIA et IWM : **0 variante sur 648** n'a battu l'achat-conservation.
Les taux mécaniques bruts rapportés sur les majeures tiennent entre 38 et 45 %.

Ce qui a un appui académique réel, c'est le regroupement des ordres stop à des
niveaux visibles — la brique « liquidité », pas la narration. **Si un
qualificatif doit sortir du lot, c'est celui-là**, et on va le mesurer au lieu
de le croire.

« 648 variantes testées » est exactement le piège que DEC-018 nous fait éviter.

### Contrainte maintenue

Aucun qualificatif n'est adopté sur les données d'exploration. On explore sur un
jeu, on pré-enregistre le meilleur candidat, on le teste sur un autre. Avec
douze qualificatifs et 318 cas, **l'un paraîtra significatif par pur hasard** —
c'est arithmétique, pas pessimiste.

**Écarté :** nommer les sessions (Londres, New York). Leurs bornes varient d'une
source à l'autre, et un découpage inventé ici se retrouverait dans les
conclusions. On enregistre l'heure UTC brute.


---

## DEC-021 — L'analyse se corrige elle-même de sa propre recherche

**2026-09-24 · Retenue**

`scripts/analyser-export.mjs` lit le JSONL du backtest et croise chaque
qualificatif avec l'issue. Il teste une vingtaine de variables d'un coup — et
**sous l'hypothèse nulle, la meilleure paraîtra toujours significative.**

D'où la correction par permutation : on mélange les **issues**, on relance
l'analyse entière, on retient le meilleur écart. Répété deux cents fois, ça
donne ce que le hasard produit de mieux **quand on cherche partout à la fois**.
C'est la seule comparaison honnête pour un écart trouvé en cherchant.

Un p corrigé de 0,30 signifie que trois recherches sur dix trouvent aussi bien
dans du bruit pur.

### Le classement se fait sur z, pas sur l'écart brut

Première version : tri par écart de taux de réussite. Elle a placé en tête, sur
une **marche aléatoire**, un écart de 57 points — et rendu p = 0,016.

Deux défauts, trouvés en la lançant sur des données sans structure :

1. **Quartiles dégénérés.** `bougiesDansLaZone` valait 0 pour 188 cas sur 191 ;
   ses « quartiles » comparaient 3 cas à 188. `quartiles()` rend désormais
   `null` quand les bornes se confondent.
2. **Le tri par écart brut trie par petitesse d'échantillon.** Un groupe de 14
   a deux fois l'erreur-type d'un groupe de 48, donc des écarts fortuits deux
   fois plus gros. Le classement se fait maintenant sur `z`, l'écart rapporté à
   son erreur-type, et un minimum de 20 cas par groupe est exigé.

### Éprouvé dans les deux sens

| Jeu | p corrigé |
|---|---|
| Marche aléatoire, graine 31337 | 0,84 |
| Marche aléatoire, graine 777 | 0,62 |
| Marche aléatoire, graine 4242 | 0,27 |
| Relation implantée sur la largeur de zone | **0,0099** (0/100) |

Aucun faux positif systématique, et l'effet planté est retrouvé.

**Caveat relevé au passage :** sur le jeu à effet planté, la variable arrivée
en tête n'est pas celle qu'on avait manipulée mais une variable corrélée. Le
classement désigne un faisceau, jamais une cause.

### MFE et MAE sont exclus des prédicteurs

Ils se mesurent **après** l'entrée : un trade gagnant a forcément une excursion
favorable élevée. Les traiter comme prédicteurs reviendrait à prédire l'issue
par elle-même. Ils sont rapportés à part, comme diagnostic.

**Écarté :** comparer les intervalles de Wilson des deux groupes pour juger de
la significativité. Des bornes qui se chevauchent ne constituent pas un test, et
la correction par permutation s'en charge proprement.

---

## DEC-022 — Un registre des pistes, tenu comme une file d'attente

**2026-09-24 · Retenue**

`docs/PISTES.md` garde ce qu'on a rencontré sans l'éprouver : concepts ICT non
implémentés, écarts avec l'implémentation de référence, questions jamais
ouvertes, et les commandes qui n'ont rien coûté et n'ont jamais été lancées.

**Motif :** une idée rencontrée puis perdue est un coût pur. Mais un registre
sans règle est pire : le jour d'une mesure décevante, on y pioche jusqu'à ce que
quelque chose marche.

D'où la règle écrite en tête du fichier : **une piste en sort quand une mesure
la désigne**, jamais parce qu'on a envie d'essayer. Elle passe ensuite par
DEC-018 comme les autres.

Chaque entrée porte sa **condition de déclenchement** — ce qu'il faudrait
mesurer pour qu'elle vaille le coup. C'est ce champ qui fait la différence entre
une file d'attente et une liste de souhaits.

Le fichier garde aussi trace de ce qui **est sorti** du registre et par quelle
mesure, pour que la barre reste visible.

---

## DEC-023 — La virginité du niveau, quatrième critère qu'on croyait couvert

**2026-09-24 · Retenue**

Le vocabulaire SMC pose quatre critères de validation : displacement, FVG,
cassure de structure, et **virginité du bloc** — « le niveau ne doit pas avoir
déjà été testé et mitigé par le passé ».

Les trois premiers étaient dans `qualificatifs.js` depuis DEC-020. **Le
quatrième ne l'était pas, et je croyais le contraire.**

### La confusion

`fraicheur` regarde si le prix est revenu dans la zone **entre l'order block et
la cassure** — une fenêtre de quelques bougies, pendant l'impulsion. Elle
portait un nom qui laissait croire que le critère SMC était couvert.

La virginité est une autre question, sur une fenêtre disjointe : **ce niveau de
prix avait-il déjà été travaillé avant que l'order block se forme ?** Une zone
posée sur un palier traversé vingt fois en deux mois n'a rien à voir avec une
zone sur un niveau jamais visité.

Les champs exportés portent désormais des noms qui les distinguent :
`aucunRetourPendantImpulsion` et `bougiesRevenuesPendantImpulsion` d'un côté,
`niveauVierge`, `visitesAnterieures` et `bougiesDepuisDerniereVisite` de
l'autre.

### Le même piège, à l'autre bout

Les bougies qui précèdent immédiatement l'order block chevauchent la zone par
continuité — le prix est bien arrivé là. Cette approche finale est **sautée**
avant tout décompte, faute de quoi chaque zone paraîtrait visitée au moins une
fois et le qualificatif ne séparerait rien.

C'est exactement la faute déjà corrigée sur `fraicheur`, qui comptait la bougie
suivant l'order block — laquelle part de la zone par construction.

### Mesuré sur la série d'essai

| | |
|---|---|
| Niveaux vierges | 9 sur 209 |
| Visites antérieures, médiane | 6 |
| Visites antérieures, maximum | 18 |

**`niveauVierge` sera probablement inutilisable comme binaire** : 9 cas
n'atteignent pas le minimum de 20 par groupe qu'impose l'analyse (DEC-021).
C'est `visitesAnterieures`, en continu, qui portera l'information.

**Écarté :** compter les bougies dans la zone plutôt que les épisodes
distincts. Une visite de dix bougies et dix visites d'une bougie ne racontent
pas la même chose, et c'est la seconde forme que le vocabulaire SMC décrit. Les
deux sont enregistrées, l'épisode sert de mesure principale.

---

## DEC-024 — Pré-enregistrement : la largeur de zone, un seul test

**2026-09-24 · Retenue, écrite avant les données**

L'exploration du 2026-09-24 sur BTCUSDT 2024-2025 a fait ressortir une
variable, `zoneSurAtr` — la hauteur de l'order block rapportée à la volatilité
ambiante. Ce document fixe ce qui sera testé et comment le résultat sera lu,
**avant** que les données servant à trancher soient examinées.

### D'où ça vient, et pourquoi ce n'est pas une preuve

| | |
|---|---|
| Seuil (3ᵉ quartile de l'exploration) | **1,1915** |
| Au-dessus | 80 cas · **66,3 %** |
| En-dessous | 238 cas · 44,5 % |
| `p` corrigé pour la recherche | **0,0547** |

**Le `p` échoue le seuil de 0,05.** Dix recherches sur deux cents dans du bruit
pur trouvent aussi bien. Ce n'est pas rien, et ce n'est pas assez — c'est
exactement la zone grise qu'un seuil écrit d'avance existe pour trancher.

`volumeRapporteALaMoyenne` arrive deuxième avec un z presque identique (2,94
contre 3,02). Ce n'est pas une seconde découverte : au-dessus du seuil, le
volume médian vaut **1,58× la moyenne**. Une zone large EST une grosse bougie,
et une grosse bougie a un gros volume. Une seule trouvaille, vue deux fois.

### Une explication mécanique proposée, puis réfutée

Soupçon initial : sous `--remplissage cloture`, le glissement d'entrée vaut à
peu près une bougie 5 minutes quelle que soit la largeur de zone, donc il
pénalise les zones étroites bien davantage.

**Mesuré, et l'asymétrie existe** : inflation médiane du risque de **0,257**
sur le premier quartile contre **0,109** sur le dernier, un facteur 2,4.

**Mais elle n'explique pas l'écart de taux.** Sous `cloture`, l'objectif est
redérivé depuis le prix réellement obtenu, à 1 R du risque réel : stop à −R',
objectif à +R'. La géométrie reste symétrique quelle que soit la valeur de R',
et une géométrie symétrique donne 50 % sur une marche sans dérive.

L'effet reste donc **inexpliqué**. C'est une raison de le tester, pas d'y
croire.

### La règle, gelée

```
--ut-biais 4h  --ut-detection 1h  --ut-resolution 5m
--objectif 1r  --remplissage cloture  --fenetre 5  --horizon-heures 48
--cout-en-r 0

Filtre : ne retenir que les order blocks dont zoneSurAtr >= 1.1915
```

Aucun paramètre ne bouge. Le seuil est celui de l'exploration, à la quatrième
décimale, sans arrondi de confort.

### Les données, jamais regardées

`BTCUSDT --depuis 2022-01-01 --jusqua 2023-12-31`

C'est la dernière période crypto intacte. 2026 et 2024-2025 sont dépensées.

### La règle de décision

Un seul test, une seule hypothèse — donc **pas de correction familiale** : la
correction sert à payer une recherche, et il n'y a plus de recherche.

| Condition | Verdict |
|---|---|
| `p < 0,05` **et** au-dessus > en-dessous **et** au moins 40 cas au-dessus | La piste survit. On mesure alors les coûts réels avant toute autre chose. |
| `p ≥ 0,05` | **Abandon.** C'étaient les dix tirages sur deux cents. |
| Écart significatif mais **inversé** | Abandon. Un effet de signe opposé n'est pas une confirmation. |
| Moins de 40 cas au-dessus | Non concluant. Ni abandon ni confirmation — on ne rejoue pas ailleurs pour autant. |

### Ce qui est écrit d'avance pour ne pas en discuter après

**2022-2023 est un régime différent** — effondrement de FTX, marché baissier
prolongé. Si le test échoue, la tentation sera de dire « c'est le régime, pas la
règle ». Cette excuse est **écartée par avance** : une règle qui ne survit pas
à un changement de régime n'est pas une règle, c'est une description de
2024-2025.

Et si le test échoue, **on ne rejoue pas sur l'or**, ni sur ETH, ni sur une
autre période. Il ne reste qu'une cartouche crypto, elle se dépense une fois.

---

## DEC-025 — Le test pré-enregistré réfute la largeur de zone

**2026-09-24 · Application de DEC-024**

Le test a été lancé sur BTCUSDT 2022-2023, avec la règle gelée, sans rien
modifier.

| | |
|---|---|
| Au-dessus du seuil | 46,8 % · n = 62 |
| En-dessous | 47,0 % · n = 232 |
| Écart | **−0,2 point** · z = −0,029 |
| `p` | **0,559** — 1118 permutations sur 2000 font aussi bien |

**La deuxième ligne du tableau de décision s'applique : écart nul ou inversé,
donc abandon.** On ne rejoue ni sur l'or, ni sur ETH, ni sur une autre période.

L'effet valait 21,8 points sur les données d'exploration. Il vaut −0,2 point
sur des données fraîches. C'étaient bien les dix tirages sur deux cents que le
`p` corrigé signalait à 0,0547.

### Le compte, sur cinq jeux de données

| Jeu | Résultat |
|---|---|
| BTCUSDT 2026, détection 15 min | rien |
| BTCUSDT 2026, détection 1 h | p = 0,129, compris ensuite comme un tirage sur six |
| BTCUSDT 2024-2025 | 50,0 % exactement · p corrigé 0,0547 sur la meilleure de 25 variables |
| BTCUSDT 2022-2023 | qualificatif pré-enregistré réfuté |
| ETHUSDT 2026 | rien |

**La règle mécanique des order blocks, et tous les qualificatifs qu'on sait
calculer, ne produisent rien de distinguable du hasard sur le crypto.** C'est
cohérent avec la littérature : une étude sur SPY, QQQ, DIA et IWM n'a trouvé
aucune des 648 variantes de concepts ICT capable de battre l'achat-conservation.

### Ce que le protocole a évité

Sans pré-enregistrement, on aurait retenu que les zones larges gagnent à 66,3 %
contre 44,5 %, construit un filtre dessus, et on y aurait cru. L'écart était
spectaculaire, le `z` valait 3,02, et la littérature SMC le confirmait sur le
volume.

**Le seul garde-fou qui l'a arrêté est le `p` corrigé à 0,0547**, puis le test
sur données fraîches. Ni le découpage en deux moitiés, ni le contrôle par
permutation du backtest n'auraient vu quoi que ce soit : le premier compare
deux moitiés des mêmes données, le second teste une règle à la fois et ignore
combien de variables ont été essayées.

### Ce qui n'est pas réfuté

**Le chemin vision.** Le backtest teste une règle mécanique ; la question du
raisonnement d'un modèle face à une capture est entièrement distincte, et
n'a jamais reçu la moindre mesure. C'est le point de départ du projet, et il
reste ouvert.

**L'or** est techniquement permis par DEC-018 — autre marché, pas une variante.
Mais le pronostic est mauvais après cinq échecs à intervalles serrés, et ce qui
change là-bas ce sont les coûts, pas la structure. Des coûts faibles ne créent
pas un avantage, ils en préservent un. À garder pour le jour où il y aura
quelque chose à préserver.

---

## DEC-026 — Pré-enregistrement : la même règle, sur le marché dont elle vient

**2026-09-24 · Retenue, écrite avant les données**

Cinq jeux crypto, cinq refus (DEC-025). Avant de clore la règle mécanique, un
dernier test — et il ne porte pas sur une variante, mais sur **le choix du
marché**, qui est une faute de conception qu'on n'avait pas identifiée.

### Le motif, énoncé avant la mesure

ICT s'est construit sur le forex et les futures, autour de choses qui
**n'existent pas en crypto** : ouvertures de session, kill zones, hauts et bas
de séance comme réservoirs de liquidité, open journalier. Le crypto tourne 24 h
sur 24, sans frontières de session, avec d'autres participants.

Tester exclusivement sur BTCUSDT une méthode née sur le forex est un défaut de
notre protocole, pas une variante à réessayer. Les mesures précédentes écartaient
l'or pour une raison de **coûts** — c'était incomplet : ce qui change aussi,
c'est la structure temporelle sur laquelle toute la méthode s'appuie.

### Ce qui ne bouge pas, et pourquoi

**La configuration reste identique au test crypto**, à la virgule près :

```
--ut-biais 4h  --ut-detection 1h  --ut-resolution 5m
--objectif 1r  --remplissage cloture  --fenetre 5  --horizon-heures 48
--cout-en-r 0  --controle 200
```

Changer le marché **et** l'unité de temps confondrait les deux causes. Si ça
échoue, on saura que ce n'est pas le marché. Si on change tout et que ça marche,
on ne saura pas pourquoi.

Seules deux options s'ajoutent, et elles ne sont pas des réglages :

- `--csv` — l'or n'est pas sur Binance ;
- `--decalage-heures -5` — HistData horodate en EST sans heure d'été.

### Les données, jamais regardées

**XAUUSD, 2023-01-01 → 2024-12-31**, en 1 minute, source HistData ASCII M1.

Si les fichiers ne couvrent pas exactement ces bornes, l'écart est annoncé
**avant** de lire le moindre résultat, jamais après.

### La règle de décision

Le test porte sur la règle de base, donc la statistique est le contrôle par
permutation du backtest — le réel contre ses propres bougies mélangées.

| Condition | Verdict |
|---|---|
| `p < 0,05` **et** espérance réelle > médiane des tirages **et** au moins 150 issues tranchées | La règle survit sur l'or. On mesure alors les coûts réels au spread Vantage. |
| `p ≥ 0,05` | **Clôture définitive de la règle mécanique.** Plus aucun marché, plus aucune période. |
| Moins de 150 issues tranchées | Non concluant. On élargit la période **une seule fois**, en l'annonçant d'avance. |

### Les excuses écartées d'avance

**« Ce n'est pas la bonne unité de temps. »** Refusée. C'est celle du test
crypto, et en changer ferait de ce test une variante.

**« Le volume manque. »** Vrai — HistData donne volume = 0 sur l'or, donc les
qualificatifs de volume seront `null`. Mais le test porte sur la règle de base,
qui n'en a jamais utilisé. Ce n'est pas une excuse recevable.

**« 2023-2024 est une période particulière. »** Refusée, comme pour
BTCUSDT 2022-2023. Une règle qui ne survit pas à un changement de période n'est
pas une règle.

### Ce que ce test ne dit pas

Il mesure **l'order block moyen**, pas la sélection d'un opérateur. Notre
détecteur en prend tous ; un praticien en trade quelques-uns par semaine, avec
un contexte qu'on n'encode pas. Un échec ici ne réfute pas « une personne
compétente peut en choisir de bons » — il réfute « les prendre tous rapporte
quelque chose ».

Cette seconde question n'est pas testable en l'état, et c'est précisément
pourquoi le projet bascule ensuite vers le chemin vision, où le jugement est
explicite et mesurable.

---

## DEC-027 — L'or se mesure sur COMEX, pas sur un flux de courtier

**2026-09-24 · Retenue, écrite avant les données · amende DEC-026**

### Ce qui change

DEC-026 gelait « XAUUSD spot, HistData ASCII M1 ». **Cette source est
abandonnée.** Le test sur l'or se fait sur **COMEX**, contrat GC, données
d'échange.

Tout le reste de DEC-026 est repris sans une virgule de changement : réglages,
seuils, règle de décision, excuses écartées d'avance.

Amender un pré-enregistrement est légitime ici parce qu'**aucune donnée n'a été
regardée** — ni HistData, ni COMEX. Après un premier chiffre, ça ne le serait
plus.

### Ce qu'il faut reconnaître avant tout le reste

**Cette piste n'est pas sortie du registre par la porte prévue.**

`PISTES.md` lui donnait un déclencheur écrit : *« se déclenche si le volume
ressort discriminant sur BTCUSDT, là où la donnée est réelle, gratuite et
abondante »*.

Il ne s'est pas produit. Le volume est bien sorti en tête de l'exploration —
`volumeRapporteALaMoyenne`, `z` = 2,94 — mais il était le **jumeau** de
`zoneSurAtr` : au-dessus du seuil, le volume médian valait 1,58× la moyenne,
parce qu'une zone large est une grosse bougie et qu'une grosse bougie a un gros
volume. Une seule chose, vue deux fois. Et cette chose a été réfutée sur
données fraîches par DEC-025 : −0,2 point, `p` = 0,559.

Le déclencheur est donc **éteint, pas en attente**. COMEX sort du registre
**par décision**, contre la règle « c'est une file d'attente, pas un menu ».
C'est écrit ici pour que la barre reste visible, et pour qu'on ne se raconte
pas plus tard que la mesure l'avait désigné.

### Ce qui rend la décision défendable malgré ça

Le motif n'est pas le volume, et ce n'est pas non plus « un marché de plus
après cinq refus ».

HistData XAUUSD est le flux **synthétique d'un agrégateur** : provenance non
auditable, volume à zéro, aucun horodatage d'appariement, aucun moyen de
vérifier qu'une bougie correspond à une transaction. COMEX GC est une **bourse
centralisée** : les bougies viennent du moteur d'appariement, elles sont
horodatées par lui, et elles portent des quantités réellement échangées.

Un projet qui vient de passer deux semaines à éliminer trois artefacts de
mesure — antériorité dans l'horodatage des évènements, antériorité dans la
règle de sortie, hypothèse de remplissage optimiste — n'a aucune raison de
jouer sa dernière hypothèse sur la source la moins vérifiable du marché.
Préférer la donnée d'échange est la continuation de ce travail, pas une
entorse commode.

### Le roll, et pourquoi on ne recolle rien

Les contrats GC expirent. Une série continue sur deux ans demande de les
raccorder, et chaque raccord crée un saut de prix qui n'est pas un mouvement de
marché. Notre détecteur lit les pivots et les impulsions sur le prix brut : il
lirait ce saut comme un déplacement suivi d'une cassure de structure. Une
machine à faux order blocks, placée exactement là où on cherche les vrais.

Personne ne règle ce problème à notre place. Databento livre ses contrats
continus en **prix bruts, non ajustés**, par principe : un ajustement opaque
introduit des erreurs de fournisseur. Leur feuille de route porte une demande
de continu ajusté, non livrée.

**Décision : on ne construit aucune série continue.**

Les données sont découpées **par contrat**. La chaîne complète tourne sur chaque
segment séparément, et les issues sont mises en commun à la fin. Aucun raccord,
donc aucun artefact ; aucun ajustement, donc aucun choix arbitraire à défendre.

Le découpage ne demande pas de calendrier codé en dur. En demandant le symbole
continu `GC.v.0` — roulement au volume — chaque ligne porte le symbole réel du
contrat sous-jacent. **On coupe quand ce champ change** : c'est la donnée qui
décide.

**Coût de la méthode, annoncé d'avance :** les order blocks situés à moins de
48 h d'une frontière de contrat sont écartés, faute d'horizon pour les résoudre.
Sur deux ans et une douzaine de contrats, cela retire de l'ordre de 3 % de la
période. C'est le prix d'une mesure sans artefact.

### Les données, jamais regardées

**Databento**, dataset `GLBX.MDP3`, schéma `ohlcv-1m`, symbole continu
`GC.v.0`, du **2023-01-01 au 2024-12-31**.

Si l'export ne couvre pas exactement ces bornes, l'écart est annoncé **avant**
de lire le moindre résultat.

### Le volume est disponible, et délibérément inutilisé

Pour la première fois, l'or vient avec un volume réel et une bourse centrale.

**Il n'entre pas dans ce test.** La règle gelée n'a jamais utilisé de volume ;
l'ajouter maintenant changerait deux choses à la fois — le marché et les
entrées — et un succès ne dirait pas laquelle a joué. C'est exactement la faute
que DEC-026 a été écrite pour empêcher.

Le volume sur l'or devient une **question distincte**, pré-enregistrée
séparément, et seulement si quelque chose survit ici.

L'excuse « le volume manque », écartée d'avance par DEC-026, devient donc sans
objet plutôt que recevable : il ne manque plus, on choisit de ne pas s'en
servir.

### La règle de décision — inchangée, et COMEX est dedans

| Condition | Verdict |
|---|---|
| `p < 0,05` **et** espérance réelle > médiane des tirages **et** au moins 150 issues tranchées | La règle survit. On mesure alors les coûts réels au spread Vantage. |
| `p ≥ 0,05` | **Clôture définitive de la règle mécanique.** Plus aucun marché, plus aucune période, **COMEX compris**. |
| Moins de 150 issues tranchées | Non concluant. Période élargie **une seule fois**, annoncée d'avance. |

Le point important est la deuxième ligne. Ce test est le **dernier** de la règle
mécanique, quel que soit son résultat autre que la survie. Aller chercher un
septième jeu de données après celui-ci ne serait plus une recherche, ce serait
un tirage répété jusqu'à obtenir le bon.

### Ce qui reste à construire avant de pouvoir mesurer

1. L'importateur du format Databento — **la forme exacte de l'export n'est pas
   connue**, notamment l'échelle des prix, qui sort en flottants ou en entiers
   au milliardième selon le client. Un échantillon d'une journée tranche la
   question ; l'écrire sans l'avoir vu, c'est l'écrire deux fois.
2. Le découpage par contrat et la mise en commun des issues, avec l'exclusion
   des 48 h de bord.
3. Un test qui vérifie qu'aucun order block ne chevauche une frontière de
   contrat — l'invariant qui donne son sens à toute la méthode.

Aucune mesure n'est lancée avant que ces trois points soient en place et testés.

---

## DEC-028 — Pré-enregistrement : le volume valide l'order block

**2026-09-24 · Retenue, écrite avant les données**

### L'hypothèse, gelée

**Un order block dont la bougie d'origine porte moins de 1,1 fois le volume
moyen des 20 bougies précédentes est un mauvais order block.**

Champ `volumeRapporteALaMoyenne`, seuil `1.1`. Rien d'autre.

### D'où vient ce seuil, sans maquillage

Exploration sur BTCUSDT 2024-01-01 → 2026-01-01. 800 order blocks, 319 issues
tranchées, taux de référence 49,8 % et espérance −0,003 R : le hasard, comme
partout ailleurs dans ce projet.

Découpé en bandes disjointes de volume :

| Volume de la bougie | Taux | Cas |
|---|---|---|
| **< 1,1×** | **45,2 %** | 99/219 |
| 1,1 à 1,25× | 61,9 % | 13/21 |
| 1,25 à 1,5× | 57,1 % | 16/28 |
| ≥ 1,5× | 60,8 % | 31/51 |

**Ce n'est pas une pente, c'est une marche.** Au-dessus de 1,1× tout tourne
autour de 60 % sans progresser ; les écarts entre les trois bandes hautes sont
du bruit sur 21, 28 et 51 cas. Ce qui se détache, c'est la bande basse.

Et ça retourne la lecture : le critère ne sélectionne pas des order blocks
d'élite, il **jette les mauvais**. La médiane de tous les candidats est à 0,79×
— la majorité des order blocks détectés sont des pauses molles, et ce sont
elles qui plombent la moyenne.

**Trois faits à charge, écrits ici pour qu'on ne les oublie pas :**

1. **Cinq seuils envisagés, trois lancés** (1,1× · 1,25× · 1,5×). Le seuil a
   donc été choisi après avoir vu les données.
2. **Le contrôle par permutation a tourné à 1,25× et il ne passe pas :
   `p = 0,070`.** Treize tirages sur deux cents font aussi bien, et le meilleur
   tirage a atteint 64,4 % de réussite — au-dessus de notre 59,5 %.
3. **1,1× a été retenu pour la puissance statistique** — 100 cas tranchés
   contre 79 — et recommandé *avant* que ce contrôle tourne. Mais relancer le
   contrôle à 1,1× ne sauverait rien : corrigé pour deux tirages emboîtés, un
   `p` à 0,03 remonterait vers 0,06. Ce run n'a pas été lancé, délibérément.

BTCUSDT 2024-2025 est désormais retourné dans tous les sens. **Ces données ne
peuvent plus rien prouver**, quoi qu'on leur fasse dire.

### La tension avec DEC-025, qui n'est pas contournée

Le volume a **déjà été réfuté** sur données fraîches. `volumeRapporteALaMoyenne`
sortait en tête de l'exploration précédente avec `z` = 2,94, jumeau de
`zoneSurAtr` — au-dessus du seuil, le volume médian valait 1,58× la moyenne.
Une seule chose vue deux fois, et DEC-025 l'a tuée : −0,2 point, `p` = 0,559.

La différence entre ce test-là et celui-ci est réelle, et elle est étroite :

- **là-bas**, le volume était testé comme *prédicteur d'issue parmi les order
  blocks détectés*, croisé avec vingt-quatre autres variables, corrigé en
  famille ;
- **ici**, il est testé comme *critère de détection* qui change quels order
  blocks existent, en hypothèse unique, sans famille à corriger.

Ce sont deux tests différents. **C'est le même nombre sous-jacent.** Je
n'écris pas que c'est une question neuve : j'écris que ce n'est pas la même
question, et que la distance entre les deux est faible.

### Pourquoi ce test est quand même légitime

Il ne sort pas d'un menu piocher après un échec. Il sort d'une demande explicite
— *« je veux que notre analyser se focalise sur les volumes et détermine avec
eux quand c'est un order block »* — sur le mécanisme que toute la littérature
SMC place au centre, et qui n'avait jamais été branché sur la **détection**.

Et le signal va dans le même sens sur quatre découpages indépendants : bandes
de volume, deux moitiés de période, amplitude maximale contre (0,95 R → 0,74 R),
espérance (−0,003 R → +0,19 R).

Une hypothèse sérieuse. Pas un résultat.

### La borne dure

**C'est la dernière hypothèse de détection mécanique du projet.**

Si elle échoue, la détection mécanique est close : pas d'autre seuil, pas
d'autre marché, pas d'autre période, pas de variante « volume de l'impulsion »
repêchée dans la foulée. Le projet bascule sur le chemin vision, et le registre
des pistes reste fermé sur ce sujet.

### Les données, jamais regardées

Celles de DEC-027 : **Databento `GLBX.MDP3`, `ohlcv-1m`, `GC.v.0`,
2023-01-01 → 2024-12-31**, découpées par contrat, sans aucun recollage.

Le volume y est réel et l'or y a une bourse centrale. C'est la seule source
où cette hypothèse peut être testée : sur un CFD, il n'y a rien à seuiller.

### La procédure, en deux commandes

**Le backtest tourne SANS `--volume-minimum`.** C'est le point à ne pas rater :
le test compare le groupe au-dessus du seuil au groupe en dessous, et filtrer
à la détection viderait le second. Le seuil s'applique ensuite, à l'analyse.

```
node scripts/backtest.mjs --csv <fichier COMEX> --symbole GC \
  --ut-biais 4h --ut-detection 1h --ut-resolution 5m \
  --objectif 1r --remplissage cloture --cout-en-r 0 \
  --export cas-or.jsonl

node scripts/tester-hypothese.mjs cas-or.jsonl volumeRapporteALaMoyenne 1.1
```

### La règle de décision

Celle de DEC-024, déjà codée dans `scripts/tester-hypothese.mjs` et appliquée
sans négociation :

| Condition | Verdict |
|---|---|
| Moins de 40 cas au-dessus du seuil | Non concluant. Ni abandon ni confirmation. |
| Écart nul ou inversé | Abandon. Un effet de signe opposé n'est pas une confirmation. |
| Écart positif et `p < 0,05` | La piste survit. Mesurer les coûts réels avant toute autre chose. |
| Écart positif et `p ≥ 0,05` | **Abandon.** C'étaient les tirages du hasard. |

Le `p` n'est pas corrigé : une seule hypothèse, un seul seuil, écrits ici avant
que la donnée existe.

### Ce qu'on attend si l'effet est réel

Écrit maintenant pour qu'un écart de trois points ne puisse pas être requalifié
en succès :

- taux **sous** le seuil autour de **45 %** ;
- taux **au-dessus** autour de **60 %** ;
- écart de l'ordre de **15 points**.

Un écart positif mais très inférieur — deux ou trois points — passant `p < 0,05`
grâce à un grand échantillon serait un succès statistique et un échec pratique.
Il serait consigné comme tel, et les coûts réels au spread le trancheraient.

### Les excuses écartées d'avance

**« L'or n'a pas assez d'order blocks. »** C'est la ligne « moins de 40 cas »,
et elle donne « non concluant », pas « à réessayer ailleurs ».

**« 1,1× n'est pas le bon seuil pour l'or. »** Refusée. Un seuil qui doit être
réajusté par marché n'est pas une règle, c'est un réglage.

**« Il fallait mesurer le volume de l'impulsion, pas celui de la pause. »**
C'est une hypothèse distincte et peut-être meilleure. Elle ne sera pas testée
en remplacement de celle-ci après son échec.

**« 2023-2024 est une période particulière. »** Refusée, comme partout ailleurs.

---

## DEC-029 — L'hypothèse du volume est réfutée. La détection mécanique est close.

**2026-09-24 · Verdict, rendu par le protocole**

### Le résultat

`node scripts/tester-hypothese.mjs cas-or.jsonl volumeRapporteALaMoyenne 1.1`

```
  taux global        50.3 % [43.0 % – 57.5 %]
  au-dessus du seuil 50.0 % [36.6 % – 63.4 %]   n = 50
  en-dessous         50.4 % [41.9 % – 58.9 %]   n = 129
  écart              -0.4 pts   (z = -0.047)

  p (non corrigé, une seule hypothèse)   0.57921
  1158/2000 permutations font aussi bien
```

**Verdict DEC-024 : abandon.** Écart nul ou inversé — un effet de signe opposé
n'est pas une confirmation.

### La prédiction, écrite avant les données

DEC-028 a consigné ce qu'on attendait, précisément pour rendre ce moment
impossible à négocier :

| | Prédit | Mesuré |
|---|---|---|
| Sous le seuil | ~45 % | **50,4 %** |
| Au-dessus | ~60 % | **50,0 %** |
| Écart | ~+15 points | **−0,4 point** |

Rien n'a répliqué. Pas une atténuation de l'effet : son absence complète.

### Le test est concluant, pas non concluant

**50 cas au-dessus du seuil**, contre 40 exigés par DEC-024. La taille
d'échantillon ne fournit aucune échappatoire.

### Le mécanisme proposé est mort avec l'hypothèse

L'exploration BTC ne disait pas seulement « un seuil sépare ». Elle disait
**pourquoi** : les order blocks posés sur une bougie anormalement calme
perdaient — 45,2 % sous 1,1×, bien en dessous du hasard — et le filtre était
censé les jeter.

Sur l'or, les order blocks sous le seuil font **50,4 %**. Il n'y a pas de
mauvais élèves à écarter. L'explication était aussi fausse que l'effet.

### Ce que le contrôle avait déjà dit

Le contrôle par permutation sur BTC au seuil 1,25× donnait `p = 0,070`, et le
meilleur tirage de hasard atteignait 64,4 % contre nos 59,5 %.

C'était suffisant pour refuser, et ça a quand même été présenté en séance comme
« le signal le plus intéressant depuis le début du projet ». L'enthousiasme
portait sur du bruit. Le protocole a rattrapé l'erreur, ce qui est exactement
sa fonction — mais il ne l'aurait pas fait si on avait cédé à la tentation de
relancer le contrôle à 1,1× jusqu'à passer sous 0,05.

### La règle de base n'a pas sauvé l'or non plus

Même exécution, sans critère de volume : **50,3 %** sur 179 issues tranchées,
espérance **+0,006 R**, rapport faveur/contre 1,03.

DEC-027 exige le contrôle par permutation pour un verdict formel. Il peut
tourner pour la trace, mais une espérance à six millièmes de R ne battra aucune
distribution de tirages : sur BTC, la médiane des tirages était à −0,035 R avec
une étendue de −0,52 à +0,29 R.

### La clôture, telle qu'elle était écrite

DEC-028 :

> Si elle échoue, la détection mécanique est close : pas d'autre seuil, pas
> d'autre marché, pas d'autre période, pas de variante « volume de
> l'impulsion » repêchée dans la foulée.

Cette variante avait été nommée d'avance parce qu'on savait qu'elle
reviendrait à l'esprit au moment de l'échec. Elle est revenue. Elle ne se
testera pas.

**Bilan de la détection mécanique : six jeux de données, six refus.** Cinq en
crypto (DEC-025), un sur l'or COMEX. Deux marchés, deux structures temporelles,
avec et sans volume réel, avec et sans bourse centrale.

Le registre `PISTES.md` reste fermé sur ce sujet. Une piste n'en sort que si
une mesure la désigne — et il n'y a plus de mesure à faire.

### Ce qui survit

**Un fait, établi sur deux marchés et trois échantillons.** La bougie d'order
block porte **moins** de volume que la moyenne des vingt précédentes :

| Échantillon | Médiane |
|---|---|
| BTCUSDT, 3 mois | 0,75× |
| BTCUSDT, 2 ans | 0,79× |
| GC COMEX, 2 ans | **0,64×** |

La raison est mécanique : l'order block est la dernière bougie de **repli**
avant l'impulsion. C'est une pause ; le volume est dans le mouvement qui suit.
La littérature SMC affirme le contraire — « empreinte institutionnelle », « pic
de volume qui valide l'order block ». C'est faux, et on peut le montrer.

Ce fait ne dépend d'aucune hypothèse réfutée ici.

**Un appareil de mesure.** En une journée il a tué trois artefacts dans notre
propre code — antériorité d'horodatage, dépendance au fuseau de la machine,
lecture positionnelle des colonnes — et il vient de refuser une hypothèse à
laquelle son auteur croyait. C'est le seul actif réel du projet.

### La suite

**Le chemin vision**, choisi par DEC-025 et jamais touché depuis. Zéro mesure à
ce jour, alors que c'est le point de départ du projet : la lecture d'un
graphique par un modèle, où le jugement est explicite plutôt qu'encodé dans une
règle.

La première chose à y construire n'est pas une analyse. C'est le **contrôle** :
rejouer la géométrie du plan proposé à des instants tirés au sort. Sans lui, on
recommencera exactement ce qui vient d'être réfuté, avec un modèle à la place
d'une formule.

---

## DEC-030 — Le sens déduit de la bougie est réfuté

**2026-09-25.** Le scanner d'anomalies range chaque évènement en « achat » ou
« vente » sur un seul indice : la bougie a-t-elle clôturé plus haut qu'elle n'a
ouvert. Cet indice est **faux une fois sur trois**. Mesuré, pas supposé.

### La mesure

Une journée réelle de transactions COMEX — `GC.v.0`, schéma `trades`,
2026-06-03, **71 826 transactions**, 0,09 USD. Le schéma porte le côté de
l'agresseur : celui qui a franchi le spread et payé pour que le prix bouge.
C'est la seule vérité disponible sur qui a voulu le mouvement.

`scripts/verifier-cote.mjs` compare, bougie par bougie, ce que le proxy affirme
et ce que l'agresseur a fait.

| Unité | Seuil de volume | n jugeables | Accord |
|---|---|---|---|
| 5 min | — | 272 | 71,7 % |
| 5 min | ≥ 500 | 47 | 72,3 % |
| 15 min | — | 91 | **62,6 %** |
| 15 min | ≥ 1 266 | 23 | 60,9 % |
| 1 heure | — | 23 | **47,8 %** |

Volume sans côté connu : 1,53 %. L'échantillon est propre.

### Trois lectures

**Le proxy se dégrade avec la durée de la bougie.** Plus elle est longue, plus
le prix a le temps de monter puis redescendre pendant que le flux agressif
pointe dans l'autre sens. À une heure, il fait moins bien que pile ou face.

**Le seuil de volume ne le sauve pas.** L'hypothèse qu'il tiendrait au moins là
où le scanner regarde — sur les grosses bougies — est réfutée : 72,3 % contre
71,7 % en 5 min, 60,9 % contre 62,6 % en 15 min. Aucune amélioration.

**À une heure, le vrai côté ne dit plus rien non plus.** Les désaccords y
portent sur des déséquilibres de 0,6 % à 10,3 % : 2 771 acheteurs contre 2 737
vendeurs n'est pas une réponse. L'agression se lit court — à 5 min les
désaccords montent à 38,8 % de déséquilibre, et le proxy s'y trompe quand même.

### Ce que ça condamne

`anomalies.js` calcule `sens` à la clôture. En dépendent : les deux appels à
`famille()`, donc **les quatre familles jour/semaine × achat/vente** ; le
marqueur contre-courant ; les sous-tableaux achat/vente de
`scanner-anomalies.mjs` ; les noms de planches et le filtre `--sens` de
`inspecter.mjs`.

Le champ est renommé `sensApparent` et l'affichage porte désormais le taux
d'erreur mesuré. Une devinette ne doit pas se lire comme un fait — c'est
exactement ainsi qu'on fabrique une fausse découverte.

### Ce que ça ne condamne pas

Les six détecteurs ne regardent que volume et amplitude : aucun côté n'y entre.
La classification de tendance se calcule sur le prix. `apres.js` mesure la
direction du mouvement **suivant**, sur le prix également. Tout cela tient.

### Ce que ça règle

La question posée au projet était : *déterminer si un gros mouvement de volume
a été fait à l'achat ou à la vente.* **On ne peut pas le lire sur un
graphique.** Ni à la forme de la bougie, ni à sa couleur, ni à sa clôture. Une
bougie rouge peut être une bougie d'achat — mesuré deux fois sur cette journée,
sur les deux plus fortes baisses :

```
13:15   prix -13,8   1669 acheteurs   1274 vendeurs
01:00   prix -14,1   1289 acheteurs   1108 vendeurs
```

Des vendeurs passifs postés à l'offre encaissent le flux acheteur sans reculer.
C'est de l'absorption au sens propre, et elle est invisible en OHLCV.

Il n'y a pas de raccourci : répondre à cette question exige la donnée
transaction par transaction. Ce n'est plus une option du projet, c'en est le
prix d'entrée.

### Portée de la mesure

**Une journée.** 272 bougies en 5 min, 91 en 15 min, 23 en 1 h. La direction du
résultat est nette et cohérente sur trois échelles, mais elle repose sur une
seule séance. Un mois — 2,52 USD, déjà chiffré — la trancherait définitivement.
Tant qu'il n'est pas acheté, DEC-030 est établie en direction, pas en
magnitude.

---

## HYP-001 — Pré-enregistrement, gelé le 2026-09-25

**Gelé AVANT d'avoir ouvert la moindre donnée postérieure au 2024-12-31.**
Rien de ce qui suit ne peut être modifié après la première exécution du test.
Un paramètre retouché après coup annule l'épreuve — c'est la seule règle qui
donne sa valeur au résultat.

### L'énoncé

> Sur GC COMEX, en bougies de quinze minutes, une bougie détectée `picVolume`
> dont la clôture est au-dessus de son ouverture, à l'intérieur d'une semaine
> haussière, atteint **3R avant de perdre 1R** plus souvent que les bougies
> **non détectées de la même famille**.

Écart attendu : **+5,5 points** (59,0 % contre 53,5 % mesurés sur 2023-2024).

### Les paramètres, figés

| | |
|---|---|
| Instrument | GC COMEX, contrat continu, découpé par `instrument_id` |
| Unité | 15 min, agrégée depuis 1 min |
| Détecteur | `picVolume` seul, seuil `PIC_MINIMUM = 4` |
| Fenêtre de référence | 60 bougies glissantes |
| Famille | `hausse-achat` lue sur la semaine (672 bougies en arrière) |
| Horizon | 24 h = 96 bougies |
| Objectif / stop | 3R / 1R, R = hauteur de la bougie détectée |
| Verdicts comptés | `atteint` et `perdu` seuls ; `ambigu` exclu du dénominateur |
| Fenêtres macro | exclues |
| Témoin | même famille, `picVolume === 0`, mêmes exclusions |

### La période d'épreuve

**2025-01-01 → 2026-09-01.** Vingt mois, jamais ouverts.

Douze mois ne suffisaient pas : la puissance n'y serait que de 64 %, soit plus
d'une chance sur trois de manquer un effet réel. Vingt mois portent la
puissance à **83 %**, pour un écart minimal détectable de 5,28 points — juste
en dessous des 5,5 attendus.

### La règle de décision

Test **unilatéral** — la direction était prédite — au seuil de 5 %, sur **une
seule** comparaison. Plus de correction pour vingt-quatre cellules : il n'y a
plus qu'une cellule.

- écart > 0 **et** p < 0,05 → **CONFIRMÉE**
- écart > 0 **et** p ≥ 0,05 → **NON CONFIRMÉE**
- écart ≤ 0 → **RÉFUTÉE**

Aucun quatrième cas. Aucune relecture « en tenant compte de ».

### Ce que HYP-001 n'est pas

Ce n'est **pas** une stratégie. Aucune entrée n'est décidée, aucun coût n'est
compté, aucun glissement n'est simulé. Un écart de cinq points sur un taux de
réussite ne dit rien du rendement d'un système qui paierait un spread à chaque
passage.

C'est la question minimale : **une bougie à volume anormal se comporte-t-elle
autrement qu'une bougie quelconque ?** Six fois, la réponse a été non.

### Pourquoi celle-ci mérite une épreuve

Sur 2023-2024, vingt-quatre cellules ont été examinées. Une seule dépasse le
bruit, et elle bascule selon l'arrondi : p × 24 vaut 0,047 avec l'écart
affiché (+6,0), 0,109 avec l'écart calculé (+5,5). Rien n'est établi.

Deux faits la maintiennent en vie malgré tout. `hausse-achat` est la **seule**
famille où faveur et contre se séparent franchement — médiane 2,79 R contre
2,09 R, q90 **8,92 R** contre 5,87 R. Cette asymétrie de queue expliquerait
qu'un effet n'apparaisse qu'à 3R et nulle part ailleurs.

Contre elle : le miroir échoue. `baisse-vente` devrait monter de même, elle
est à −1,2. Et l'hypothèse a été formée **après** avoir regardé les données.

C'est précisément pourquoi elle ne vaut qu'une chose : une épreuve sur une
période jamais ouverte, décidée d'avance, exécutée une fois.

### HYP-001 — Résultat, 2026-09-25

**CONFIRMÉE.** Exécutée une fois, sur `GC_2025_2026.csv` — 583 218 bougies
d'une minute, 2025-01-01 → 2026-08-31, 10 contrats, achetées 2,13 USD après le
gel et jamais ouvertes avant.

| | détectées | témoin |
|---|---|---|
| effectif | 272 | 8 788 |
| 3R atteint avant 1R perdu | **58,1 %** | **53,0 %** |

Écart **+5,11 points** · erreur type 3,078 · z = 1,66 · **p unilatéral = 0,0486**

C'est la première fois, en sept hypothèses, qu'un effet survit à une période
jamais regardée sous une règle décidée d'avance.

#### Quatre réserves, écrites le même jour que le résultat

**La marge est d'un vingtième de point.** Le seuil de passage était à 5,06
points ; l'écart obtenu vaut 5,11. Quatre cas classés autrement et le verdict
s'inversait. Un résultat à p = 0,049 est, statistiquement, le profil type de
ce qui ne se reproduit pas.

**La puissance annoncée était fausse.** Le pré-enregistrement promettait 83 %,
sur une prévision de 601 cas extrapolée des 721 de 2023-2024. Il y en a eu
**272** — moins de la moitié. L'erreur type réelle vaut 3,078 au lieu de
2,124, ce qui ramène la puissance à **56 %**. La décision de tester vingt mois
plutôt que douze a donc été prise sur un chiffre erroné. Cela n'invalide pas
le verdict — un test sous-puissant qui trouve quand même reste un test qui
trouve — mais la période choisie l'a été pour une raison qui ne tenait pas.

**Les jours dégradés n'ont pas été exclus.** Databento en signale au moins
trois (2025-09-17, 2025-09-24, 2025-11-28). Le gel n'en parlait pas ; les
retirer après coup aurait été l'ajustement que tout ce dispositif sert à
empêcher. Réserve connue, non corrigée.

**Le calcul de p repose sur une approximation.** `phi` implémente Abramowitz &
Stegun 7.1.26 ; un calcul indépendant en Python donne 0,0484 contre 0,0486.
L'écart est négligeable en soi, mais à cette marge il méritait d'être vérifié
plutôt que supposé. Les deux calculs concluent identiquement.

#### Ce qui a le mieux répliqué : l'amplitude, pas le seuil

| | 2023-2024 | 2025-2026 | écart |
|---|---|---|---|
| détectées | 59,0 % | 58,1 % | −0,9 |
| témoin | 53,5 % | 53,0 % | −0,5 |
| **différence** | **+5,5** | **+5,11** | **−0,39** |

Les trois valeurs atterrissent où elles étaient attendues, sur une autre
période, un autre régime de prix et un autre jeu de contrats. **C'est la
partie solide du résultat**, et elle vaut mieux que le p : un hasard franchit
un seuil bien plus souvent qu'il ne reproduit une forme.

#### La réalité économique, qui refroidit

Espérance par passage, **sans aucun coût** :

| | |
|---|---|
| détectées | +1,324 R |
| témoin | **+1,120 R** |
| **apport du détecteur** | **+0,204 R** |

Le témoin — une bougie **quelconque** dans une semaine haussière — rapporte
déjà +1,12 R. Ce n'est pas un edge, c'est la hausse de l'or lue avec un
objectif à 3R et un stop à 1R. Cela s'inverserait dans un marché baissier et
ne survivrait pas aux frais.

Ce que le détecteur apporte réellement, c'est **+0,204 R au-dessus de ce
fond**. Tout chiffre plus flatteur mélange l'effet et la dérive.

#### Ce que HYP-001 n'établit pas

Ni une stratégie, ni une rentabilité, ni un edge exploitable. Aucun spread,
aucun glissement, aucune règle d'entrée, aucune taille de position. La moitié
du gain apparent est la tendance du marché sous-jacent.

Ce qui est établi, et seulement cela : *parmi les bougies de quinze minutes
situées dans une semaine haussière sur GC COMEX, celles dont le volume dépasse
quatre fois la médiane glissante atteignent 3R avant 1R environ cinq points
plus souvent que les autres.*

#### La suite : répliquer, pas construire

Un résultat marginal et sous-puissant appelle une **réplication
indépendante**, pas un système. La même règle gelée, sans en changer une
virgule, sur d'autres marchés — argent, platine, cuivre. Quelques dollars de
données OHLCV.

Si l'effet s'y retrouve, il est réel et le système complet se justifie. S'il
disparaît, HYP-001 rejoint les six autres, et le projet se clôt sur un
résultat honnête plutôt que sur une conviction.

---

## HYP-002 — Réplication, gelée le 2026-09-25

**Gelée AVANT d'avoir ouvert la moindre donnée d'un autre marché que l'or.**
Ni l'argent, ni le platine, ni le cuivre, ni le pétrole, ni l'indice n'ont
jamais été chargés dans ce dépôt. `comparer-marches.mjs` a été écrit pour eux
et jamais exécuté sur eux.

### Pourquoi répliquer plutôt que construire

HYP-001 est CONFIRMÉE, et c'est un résultat fragile : p = 0,0486 pour un seuil
à 0,05, une puissance réelle de 56 % là où 83 % étaient annoncés, et une
hypothèse née de l'examen de vingt-quatre cellules. C'est le portrait-robot du
résultat qui ne se reproduit pas.

Construire un système dessus reviendrait à miser sur un tirage. Une seule
chose peut le départager d'un hasard : **la même règle, sur des marchés jamais
regardés.**

### La règle : inchangée, et c'est le point

`GEL.regle` **est** l'objet `GEL` de HYP-001, référencé et non recopié — un
test vérifie l'identité des deux. Détecteur `picVolume`, seuil 4× la médiane,
fenêtre 60 bougies, unité 15 minutes, famille `hausse-achat` lue sur la
semaine, horizon 24 h, objectif 3R, stop 1R, fenêtres macro exclues, verdicts
`ambigu` hors dénominateur.

Si un seul paramètre différait, on ne répliquerait plus : on chercherait une
variante qui marche, et on appellerait « confirmé » le premier réglage qui
passe.

### Les marchés, et pourquoi pas l'or

| | | |
|---|---|---|
| **SI** | argent, COMEX | métal précieux, corrélé à l'or |
| **PL** | platine, NYMEX | métal précieux, moins corrélé |
| **HG** | cuivre, COMEX | métal industriel |
| **CL** | pétrole WTI, NYMEX | énergie, hors métaux |
| **ES** | E-mini S&P 500, CME | indice actions, microstructure différente |

**L'or est exclu.** L'effet y a été trouvé ; l'y retrouver ne prouverait rien.

Le panel est délibérément étagé. Si l'effet n'apparaît que sur l'argent, il
est propre aux métaux précieux — peut-être même à la corrélation avec l'or.
S'il apparaît aussi sur `ES`, c'est une propriété de microstructure, bien plus
intéressante et bien plus surprenante.

**Lecture secondaire, énoncée d'avance :** HYP-001 porte sur les semaines
haussières, et l'or a pris 35 % sur la période. Si l'effet ne se manifeste que
sur les marchés fortement haussiers du panel, c'est la dérive qu'on mesure,
pas le détecteur. Cette lecture ne décide de rien — elle est notée maintenant
pour ne pas être inventée après coup.

### La période

**2023-01-01 → 2026-09-01**, identique pour les cinq. Quarante-quatre mois.

Aucun de ces marchés n'ayant jamais été ouvert, toute leur histoire est hors
échantillon. Prendre la période la plus longue disponible maximise la
puissance sans rien coûter en validité.

### Le critère principal : un seul chiffre

**Le regroupement en variance inverse des cinq écarts** — une méta-analyse à
effets fixes. Un test, un p.

Concaténer les cas de tous les marchés serait plus simple et faux : `ES`
fournirait dix fois plus de bougies que `PL` et imposerait son résultat, et le
mélange dépendrait de la liquidité de chacun plutôt que de l'effet cherché.

**Les écarts par marché sont SECONDAIRES.** Cinq marchés regardés séparément,
c'est cinq occasions de trouver par hasard — exactement l'erreur que les
vingt-quatre cellules de HYP-001 ont failli faire commettre. Ils seront
affichés parce qu'ils informent ; ils ne décident pas.

### La règle de décision : quatre issues

Test unilatéral, seuil 5 %, sur le regroupement seul.

| Condition | Verdict |
|---|---|
| erreur type > **2,055** | **NON CONCLUANTE** |
| écart ≤ 0 | **RÉFUTÉE** |
| écart > 0 et p < 0,05 | **RÉPLIQUÉE** |
| écart > 0 et p ≥ 0,05 | **NON RÉPLIQUÉE** |

**L'insuffisance de puissance se constate en premier, avant de regarder le
signe.** Sans cet ordre, on ne l'invoquerait que lorsque le résultat déplaît.

Le seuil de 2,055 n'est pas arbitraire : c'est l'erreur type au-dessous de
laquelle l'écart de référence de l'or (+5,11 points) est détectable à 80 % de
puissance, soit 5,11 / (1,645 + 0,842).

### Pourquoi un garde-fou de puissance plutôt qu'une puissance annoncée

HYP-001 promettait 83 % sur une prévision de 601 cas ; il y en a eu 272. **Je
me suis trompé d'un facteur 2,2 sur le seul chiffre qui justifiait le choix de
la période.**

Je ne sais pas prédire combien de bougies `hausse-achat` détectées chaque
marché fournira — cela dépend de sa volatilité, de sa tendance sur la période
et de la forme de sa distribution de volume, dont je ne sais rien puisque je
ne les ai jamais ouverts. Annoncer une puissance serait répéter la même faute.

À la place, le seuil est vérifié **sur les effectifs réellement obtenus**, et
un test trop imprécis se déclare non concluant au lieu de trancher. Une
réplication ratée faute de données n'est pas une réfutation.

### Le coût, à valider avant exécution

Environ **4,70 USD par marché** sur 44 mois en OHLCV-1m, extrapolé des 2,13
USD payés pour 20 mois d'or — soit **~23 USD pour les cinq**. À confirmer par
`get_cost` avant tout achat.

### Ce que HYP-002 ne fera pas

Ni décider d'une entrée, ni compter un spread, ni simuler un glissement, ni
dimensionner une position. La question reste la même : *une bougie à volume
anormal se comporte-t-elle autrement qu'une bougie quelconque ?*

Si la réponse est oui sur cinq marchés de plus, alors seulement un système
complet se justifie — pré-enregistré lui aussi, et avec ses coûts.

Si elle est non, HYP-001 rejoint les six réfutations, et le projet se clôt sur
un résultat honnête plutôt que sur une conviction.

### HYP-002 — Résultat, 2026-09-25

**RÉPLIQUÉE.** Exécutée une fois, sur cinq marchés jamais ouverts, achetés
22,52 USD après le gel. Six millions de bougies d'une minute, 115 contrats.

| marché | détectées | témoin | écart |
|---|---|---|---|
| CL pétrole | 1 732 à 49,1 % | 11 342 à 50,3 % | **−1,19** ± 1,29 |
| ES indice | 4 787 à 52,2 % | 14 015 à 52,0 % | **+0,21** ± 0,84 |
| HG cuivre | 1 514 à 54,7 % | 15 853 à 50,3 % | **+4,35** ± 1,34 |
| PL platine | 1 759 à 51,9 % | 16 086 à 50,3 % | **+1,60** ± 1,26 |
| SI argent | 1 376 à 53,1 % | 16 849 à 49,8 % | **+3,31** ± 1,40 |

Regroupement en variance inverse : **+1,26 point**, erreur type 0,518,
z = 2,43, **p unilatéral = 0,0076**. Le garde-fou de puissance n'a pas eu à
jouer : 0,518 est très en dessous du maximum utile de 2,055.

Première fois en huit hypothèses qu'un effet survit à une épreuve décidée
d'avance sur des données jamais regardées.

#### Trois réserves, écrites le même jour

**Ce n'est pas un effet universel, c'est un effet de métaux.** Le découpage
était pré-spécifié, avant tout téléchargement :

| | écart | p |
|---|---|---|
| métaux — HG, PL, SI | **+3,02** ± 0,77 | 0,00004 |
| hors métaux — CL, ES | **−0,21** ± 0,70 | 0,62 |

Le pré-enregistrement disait : *« S'il apparaît aussi sur ES, c'est une
propriété de microstructure, bien plus surprenante. »* Il n'y apparaît pas.
Le pétrole est même négatif. La portée de HYP-001 se réduit donc aux métaux.

**Les cinq marchés ne mesurent pas la même chose.** Q de Cochran = 12,70 à
4 degrés de liberté, p ≈ 0,013, **I² = 69 %**. Les écarts s'étalent de −1,19
à +4,35, trop largement pour du hasard.

Le regroupement à effets fixes suppose un effet commun ; cette supposition est
fausse. Le verdict tient — la règle gelée nommait le regroupement, et le
regroupement est positif — mais **le p de 0,0076 est trop flatteur** et ne
doit pas être cité comme un chiffre solide.

**L'amplitude vaut le quart de la référence.** +1,26 point contre +5,11 sur
l'or ; +3,02 sur les métaux seuls, soit 40 % de moins que la référence. C'est
la régression vers la moyenne ordinaire : un premier résultat marginal
surestime toujours son effet. La valeur à retenir pour la suite est +3,02, pas
+5,11.

#### Ce qui est établi, et rien de plus

> Sur les métaux — or, argent, platine, cuivre — en bougies de quinze minutes,
> une bougie dont le volume dépasse quatre fois la médiane glissante, à
> l'intérieur d'une semaine haussière, atteint 3R avant 1R environ **trois
> points** plus souvent qu'une bougie ordinaire de la même famille.

Pas sur le pétrole. Pas sur les indices. Et toujours **pas une stratégie** :
aucun coût compté, aucune entrée décidée, et un témoin qui rapporte déjà
+1,12 R par lui-même — la hausse des métaux sur la période, pas un edge.
## HYP-003 — Le système, frais compris. Gelée le 2026-09-25

**Gelée AVANT d'avoir ouvert la moindre donnée antérieure à 2023.**

### Pourquoi celle-ci, et pourquoi maintenant

HYP-001 puis HYP-002 ont établi qu'un effet existe sur les métaux : environ
**trois points** de taux de réussite au-dessus d'une bougie ordinaire, hors
échantillon, sous règle gelée.

Ce n'est pas une stratégie, et les deux pré-enregistrements le disaient déjà.
Aucune entrée n'était décidée, aucun coût compté, et surtout : **le témoin
rapportait +1,12 R par lui-même**, ce qui est la hausse des métaux de 2023 à
2026, pas un avantage.

La question qui reste est donc la seule qui vaille : **une fois tout compté,
ça rapporte ou pas ?**

### La période est choisie CONTRE l'hypothèse

**2020-01-01 → 2023-01-01.** Trois ans jamais ouverts, et **antérieurs** à
tout ce qui a servi jusqu'ici.

Le régime y est inverse : choc du COVID au printemps 2020, puis deux ans de
stagnation et de baisse sur l'or. Si l'effet mesuré n'était que la hausse de
2023-2026 déguisée, il doit s'y effondrer.

Choisir la période la plus favorable serait l'erreur inverse de celle qu'on
essaie d'éviter depuis huit hypothèses.

### Ce qui est compté, et qui ne l'était pas

| | |
|---|---|
| Détection | identique à HYP-001, `GEL.regle` référencé et non recopié |
| Marchés | GC, SI, PL, HG — les quatre métaux où l'effet tient |
| Entrée | **à la clôture** de la bougie signalée |
| Stop | 1R, R = hauteur de la bougie |
| Objectif | 3R |
| Frais | **4 ticks aller-retour**, deux de spread et deux de glissement |
| Pas de cotation | **lu dans les données**, jamais supposé de mémoire |
| Ni objectif ni stop | **fermée au marché** en fin d'horizon |

Ces deux derniers points comptent plus qu'ils n'en ont l'air.

Un pas de cotation supposé de mémoire serait faux un jour sur quatre, et rien
ne le signalerait — c'est la classe d'erreur qui a coûté trois bugs silencieux
dans la seule journée du 2026-09-25.

Et écarter les positions qui n'atteignent rien retirerait précisément les cas
où il ne s'est rien passé. L'espérance en sortirait gonflée, d'une façon qui
paraît anodine et qui ne l'est pas.

### La règle de décision

Test unilatéral sur l'espérance nette moyenne, seuil 5 %, une seule
comparaison.

| Condition | Verdict |
|---|---|
| erreur type > **0,10 R** | **NON CONCLUANTE** |
| espérance ≤ 0 | **NON RENTABLE** |
| espérance > 0 et p < 0,05 | **RENTABLE** |
| espérance > 0 et p ≥ 0,05 | **NON CONCLUANTE SUR LE SIGNE** |

La précision se vérifie **avant** le signe, comme dans HYP-002.

Le seuil de 0,10 R n'est pas arbitraire : il permet de distinguer de zéro une
espérance de **+0,25 R** à 80 % de puissance. En dessous de +0,25 R par
passage, rien n'est tradable une fois ajoutées les frictions que ce test ne
simule pas — carnets creux, exécutions partielles, jours fériés. C'est donc le
seuil qui compte économiquement, pas seulement statistiquement.

### Le calcul qui a motivé ce test

Fait avant, avec les chiffres de HYP-002 :

```
apport du détecteur   +0,120 R par passage
frais à 4 ticks       0,020 à 0,080 R selon la hauteur de la bougie
net                   +0,040 à +0,100 R
```

L'arithmétique dit que ça devrait survivre, **parce que l'unité de risque est
la hauteur d'une bougie à gros volume — donc large — et que les frais sont
fixes.** Ce test vérifie si l'arithmétique tient sur des données réelles, dans
un régime qui ne l'aide pas.

### Ce que HYP-003 ne fera toujours pas

Ni dimensionner une position, ni gérer plusieurs positions simultanées, ni
simuler un carnet. Une espérance positive par passage n'est pas un compte qui
monte : il y faut encore une taille, une corrélation entre positions, et une
tolérance au décrochage.

Mais une espérance négative, elle, clôt la question définitivement.

---

## ERRATUM-001 — Le stop annoncé n'était pas le stop mesuré

**2026-09-25, en fin de journée.** Découvert en exécutant HYP-003, dont le
taux de réussite est sorti à 22-26 % là où HYP-001 et HYP-002 donnaient
53-56 %. Deux mesures censées porter sur la même règle ne peuvent pas
s'écarter de trente points : l'une des deux ne mesurait pas ce qu'elle
annonçait.

### Le fait

`atteintAvantDePerdre(bougies, index, horizon, multiple)` calcule une cible
unique, `multiple × hauteur`, et l'applique **des deux côtés** :

    const cible = multiple * hauteur;
    const touche = enFaveur   >= cible;
    const perd   = aLEncontre >= cible;

La mesure est donc **symétrique** : +3R contre −3R.

Or le pré-enregistrement de HYP-001 annonce « atteint **3R avant de perdre
1R** », et son tableau de paramètres porte « Objectif / stop : **3R / 1R** ».
L'en-tête affiché par `eprouver-hyp001.mjs` répétait la même chose.

**Le texte disait 3R/1R. Le code faisait 3R/3R.** La formulation a été écrite
dans HYP-001, reprise telle quelle dans HYP-002, et jamais confrontée au code.

### Ce que les chiffres disaient déjà

| Règle | Marche aléatoire sans dérive | Mesuré |
|---|---|---|
| +3R avant −3R | ~50 % | **53-56 %** (HYP-001, HYP-002) |
| +3R avant −1R | ~25 % | **22-26 %** (HYP-003) |

Les deux séries tombent sur la valeur théorique de leur propre règle. Elles
sont cohérentes entre elles ; elles ne portaient simplement pas sur la même
question. Ce recoupement était disponible depuis HYP-001 et n'a pas été fait.

### Ce qui reste valide

**L'écart de +3,02 points sur les métaux.** Les bougies détectées et le témoin
ont subi **exactement la même mesure**, quelle qu'elle soit. Une comparaison
reste valide même quand la grandeur comparée est mal nommée. L'effet existe,
il a été répliqué hors échantillon, et rien de ce qui précède ne le touche.

Les verdicts de HYP-001 (CONFIRMÉE) et HYP-002 (RÉPLIQUÉE) tiennent donc, et
leurs règles de décision ont été appliquées correctement.

### Ce qui est corrigé

La **description**. L'énoncé exact de ce qui a été mesuré est :

> une bougie détectée atteint **+3R avant de subir −3R** plus souvent qu'une
> bougie ordinaire de la même famille — d'environ trois points sur les métaux.

Les pré-enregistrements de HYP-001, HYP-002 et HYP-003 ne sont **pas
réécrits** : les modifier après exécution briserait le gel, qui est la seule
chose qui donne leur valeur à ces résultats. Cet erratum les corrige par
ajout, daté, à sa place dans l'ordre chronologique.

L'étiquette affichée par `eprouver-hyp001.mjs` est corrigée — c'est une chaîne
de caractères, pas un paramètre. Les valeurs gelées restent inchangées, et les
tests d'immuabilité continuent de le vérifier.

### La leçon, qui vaut plus que la correction

Un nom de fonction n'est pas une spécification. `atteintAvantDePerdre` ne dit
pas ce que « perdre » vaut, et personne n'est allé voir. Le seul endroit du
dépôt où la formulation était juste est `comportement.mjs`, qui écrit « objectif
atteint AVANT le **stop symétrique** ».

C'est la quatrième panne silencieuse de la journée, après la garde d'exécution
Windows, l'option en tirets ignorée et le caractère illégal dans un nom de
fichier. Toutes avaient le même profil : **rien ne rougit, rien ne plante, et
le résultat paraît normal.** Celle-ci a survécu à deux pré-enregistrements
parce qu'aucun test ne compare un texte à un comportement.

Ce qui l'a trouvée n'est pas une relecture : c'est un troisième test dont le
chiffre ne collait pas avec les deux précédents.

### La question qui reste ouverte

HYP-003 a établi que viser 3R avec un stop à 1R **détruit** l'avantage :
−0,105 R par passage sur 6 148 positions. Ce résultat est valide pour cette
règle, qui n'a jamais été celle dont l'avantage était établi.

L'avantage existe, il est petit, et un rapport 3:1 est trop exigeant pour lui.
**Quel rapport gain/risque supporte-t-il ?** C'est une question neuve, et elle
demande son propre pré-enregistrement sur une période jamais ouverte — 2020-2022
ne l'est plus.

---

### HYP-003 — Résultat, 2026-09-25

**NON RENTABLE.** Exécutée une fois, sur quatre métaux de 2020 à 2022 — trois
ans jamais ouverts et antérieurs à tout le reste — achetés 14,26 USD après le
gel.

| marché | positions | espérance nette | objectif | stop | horizon |
|---|---|---|---|---|---|
| GC or | 1 114 | **−0,123** ± 0,049 R | 228 | 794 | 92 |
| HG cuivre | 1 357 | **−0,089** ± 0,047 R | 327 | 958 | 72 |
| PL platine | 2 102 | **−0,021** ± 0,038 R | 534 | 1 506 | 62 |
| SI argent | 1 575 | **−0,220** ± 0,042 R | 345 | 1 136 | 94 |

**6 148 positions · espérance nette −0,1053 R · erreur type 0,0217 R.**

z = −4,85. Les quatre métaux sont négatifs. Le garde-fou de puissance n'a pas
eu à jouer : 0,0217 est très en dessous du maximum utile de 0,10.

#### Ce que ce verdict recouvre, et ce qu'il ne recouvre pas

HYP-003 a implémenté ce que le texte de HYP-001 **annonçait** — objectif 3R,
stop 1R — et non ce que son code **mesurait**, qui était symétrique. Voir
ERRATUM-001, découvert précisément en exécutant ce test.

**Le verdict est donc valide pour la règle 3R/1R**, et pour elle seule :
viser trois fois le risque avec un stop à une fois détruit l'avantage. Les
taux de réussite — 22 à 26 % — tombent sur la valeur d'une marche aléatoire
soumise à ces barrières, soit un quart.

**Ce verdict ne réfute ni HYP-001 ni HYP-002.** Elles portaient sur une mesure
symétrique, leur comparaison détectées/témoin était correcte, et l'écart de
+3,02 points sur les métaux tient toujours.

#### Ce que l'ensemble établit maintenant

Un avantage existe sur les métaux, il est **petit**, et il ne supporte pas un
rapport gain/risque de 3:1. C'est un résultat, pas un échec : beaucoup de
règles de trading meurent exactement là, et la plupart de leurs auteurs ne le
mesurent jamais.

La question neuve — **quel rapport gain/risque cet avantage supporte-t-il ?**
— demande son propre pré-enregistrement, sur une période jamais ouverte.
2020-2022 ne l'est plus : ses chiffres sont désormais connus, et y chercher le
bon ratio reviendrait à l'ajuster sur ce qu'on a déjà vu. 2017-2019 reste
disponible.

---

## DEC-031 — Le volume prédit l'amplitude, jamais la direction

**2026-09-25.** Trois hypothèses gelées, trois verdicts, et la question du
projet toujours sans réponse : *un gros volume apparaît, que fait le graphique
ensuite ?* HYP-001 à HYP-003 mesuraient un taux de réussite à 24 heures. Elles
ne demandaient pas si le volume était corrélé à quoi que ce soit. Cette mesure
le demande.

### La mesure

**424 821 bougies de 15 minutes**, cinq marchés — SI, PL, HG, CL, ES —
corrélation de rang de Spearman entre le volume d'une bougie et ce que le prix
fait après elle, à quatre horizons.

Spearman plutôt que Pearson : la distribution des volumes a une queue épaisse,
et une poignée de bougies écraserait un coefficient linéaire. Les rangs
neutralisent cela ; les ex æquo partagent leur rang.

Deux grandeurs mesurées séparément, et c'est tout l'intérêt :

| Le volume est-il corrélé à… | 15 min | 1 h | 4 h | 24 h |
|---|---|---|---|---|
| …la **distance parcourue** (amplitude) | **+0,479** | **+0,430** | **+0,285** | −0,003 |
| …la **variation signée** (direction) | +0,009 | +0,013 | +0,009 | +0,001 |

### Deux faits, et ils ne sont pas du même ordre

**Le volume prédit l'amplitude.** +0,479 à 15 minutes n'est pas un effet
marginal arraché à la statistique : c'est la relation la plus forte que ce
projet ait mesurée, sur n'importe quoi, depuis son début.

**Le volume ne dit rien de la direction.** +0,013 est indiscernable de zéro à
tous les horizons. Cela vaut confirmation indépendante de DEC-030, par une voie
entièrement différente — non plus le côté de l'agresseur transaction par
transaction, mais le mouvement qui suit, sur cinq marchés et deux ans.

**Entrer à l'achat parce que le volume est élevé reste un pile ou face.** Le
volume dit *combien*, jamais *où*.

### Ce que cela explique rétrospectivement

Le signal est **mort à 24 heures** — l'horizon exact des trois hypothèses
gelées. Elles mesuraient à l'endroit où il ne reste rien.

Ce n'est pas un reproche au protocole : le pré-enregistrement a fait son
travail, et l'avantage de +3,02 points sur les métaux tient toujours. C'est que
l'horizon avait été choisi **avant** qu'on sache où vivait le signal, et que
personne n'avait posé la question du bon horizon. HYP-001 et HYP-002 ont
trouvé une lueur à l'endroit le plus défavorable qui soit.

### L'or ne se déduit pas des cinq autres, et je l'ai appris à mes dépens

Les chiffres ci-dessus ont d'abord été **transposés à l'or**. C'était une
erreur, et elle portait sur deux points.

Mesure refaite sur GC seul — `GC_2023_2024`, **46 421 bougies**, excursion
maximale en 1 heure depuis la **clôture**, par tranche de volume rapportée à la
médiane des 60 bougies précédentes :

| Volume | n | médiane | q75 | q90 |
|---|---|---|---|---|
| 1–1,5× | 7 333 | 0,09 % | 0,16 % | 0,25 % |
| 1,5–2× | 4 641 | 0,10 % | 0,18 % | 0,28 % |
| 2–3× | 4 970 | 0,11 % | 0,19 % | 0,34 % |
| 3–4× | 2 458 | 0,13 % | 0,24 % | 0,41 % |
| 4–6× | 2 281 | 0,14 % | 0,28 % | 0,46 % |
| 6–10× | 1 414 | 0,16 % | 0,31 % | 0,51 % |
| ≥ 10× | 669 | **0,20 %** | 0,35 % | 0,65 % |

**Premier point : les distances étaient deux fois trop grandes.** L'or bouge
moins que l'argent, le platine, le cuivre, le pétrole et l'indice. Un
pourcentage transposé d'un marché à l'autre n'est pas un pourcentage, c'est une
supposition.

**Second point, plus grave : le sens de la relation n'est pas le même.** Sur
les cinq autres marchés, l'amplitude **retombe** à la tranche ≥ 10×. Sur l'or
elle **continue de monter** — 0,20 % est la médiane la plus haute de la table.
La relation y est monotone. La conclusion « le plus gros volume bouge le moins »
est vraie ailleurs et fausse ici.

### Ce que l'or condamne quand même, et pour une autre raison

La conclusion pratique — éviter les plus gros volumes — tient, mais la raison
n'est pas celle qu'on croyait. Ce n'est pas le mouvement qui rétrécit, c'est le
**risque qui enfle plus vite que le gain** :

| Volume | stop (q90, 1 h) | objectif (q75, 4 h) | gain/risque |
|---|---|---|---|
| 1–1,5× | 0,25 % | 0,36 % | **1,44** |
| 2–3× | 0,34 % | 0,39 % | 1,15 |
| 4–6× | 0,46 % | 0,46 % | 1,00 |
| ≥ 10× | 0,65 % | 0,52 % | **0,80** |

Le stop nécessaire est multiplié par 2,6 d'un bout à l'autre, l'objectif
atteignable par 1,4 seulement. Les deux courbes se croisent vers **4–6×**.
Au-delà, il faut viser juste plus d'une fois sur deux pour rentrer dans ses
frais.

### Ce que cela ne fait pas

`correlations.mjs` et `dimensionner.mjs` ne produisent **aucun signal
d'entrée**, et ne doivent jamais être relus comme s'ils en produisaient. Ils
décrivent des distributions passées. Ils dimensionnent une position dont la
direction a été décidée ailleurs, par autre chose qu'eux.

Ces mesures ne sont pas pré-enregistrées. Elles ne réfutent ni ne confirment
rien : elles cartographient. Toute règle qu'on en tirerait devrait être gelée
puis éprouvée sur une période encore fermée — 2017-2019 reste disponible.

### La leçon

Une grandeur mesurée sur un marché n'est transposable à un autre que si on l'a
vérifié. Pas en ordre de grandeur, et pas même en **sens** : ici, c'est le sens
de la relation qui a changé d'un marché à l'autre. Le coût de la vérification
était d'une commande et de quatre minutes. Le coût de l'avoir sautée a été une
fiche publiée avec un graphique qui disait l'inverse de la vérité.
