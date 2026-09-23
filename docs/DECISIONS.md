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
