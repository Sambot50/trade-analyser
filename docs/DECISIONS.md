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
