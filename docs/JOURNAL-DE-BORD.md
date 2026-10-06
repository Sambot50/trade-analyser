# Journal de bord

Une entrée par jour de travail, la plus récente en haut. Cinq rubriques,
toujours les mêmes : **Fait**, **Mesuré**, **Décidé**, **Bloqué**,
**Prochaine action**. L'étape en cours renvoie à `FEUILLE-DE-ROUTE.md`.

Ce fichier dit *ce qui s'est passé*. Les motifs des choix vivent dans
`DECISIONS.md`, l'état vérifié dans `ETAT.md`. Il ne les recopie pas : il y
renvoie.

---

## 2026-10-06 — étapes E0, E1, E2

**Fait**
- Analyse du produit de référence (bootcamp), à partir de toutes les captures envoyées.
  Inventaire complet dans la feuille de route, § 3.
- DEC-038 : on garde le moteur, on refait l'interface ; la donnée vient de MT5.
- **E0** : `donnees/` ignoré par git, commandes `npm run journal`,
  `mt5:export`, `rejeu:037`, `temoin:037`. Branche fusionnée dans `main`
  ([#52](https://github.com/Sambot50/trade-analyser/pull/52)).
- **E1** : pont MT5 (`pont-mt5/exporter.py`), journal de performances
  (`npm run journal`, onglet Performances).
- **E2** : Claude (Anthropic) et tout fournisseur compatible OpenAI (OpenAI,
  Mistral, Groq, OpenRouter, LM Studio) ; une clé par fournisseur ; réglages
  généralisés.
- Feuille de route et journal de bord créés, puis la feuille de route
  passée **en cases à cocher**, avec la règle ⏸ « en attente de
  l'opérateur » : une étape dont tout le développement est fait et qui
  n'attend qu'une vérification de l'opérateur ne bloque pas la suivante.
- Feuille de route affichée en permanence dans l'analyseur (onglet, avec
  l'avancement par étape) ; lanceur et raccourcis bureau dans `outils/`.

**Mesuré**
- 1 220 tests JS + 10 tests Python en fin de journée ; écrans
  Performances, Réglages et Feuille de route vérifiés dans Chromium.

**Décidé**
- Produit : aide à la décision + mesure des trades de l'opérateur, en
  briques interchangeables, IA au choix, deux usages (capture et direct).
- Le journal ne désigne aucun « meilleur » groupe (DEC-038).

**Bloqué**
- Connexion MT5 Axi : E1 attend sa validation sur le vrai terminal.
- Push des tags depuis l'environnement d'écriture.

**Erreur reconnue**
- Deux cases d'E0 cochées avant d'être faites. Corrigé dans la foulée :
  construites, vérifiées, puis cochées.

**Prochaine action**
- **E3 — moteur multi-unités de temps.**

---

## 2026-10-05 — témoin et premier rejeu

**Fait**
- `ETAT.md` et `CLAUDE.md` remis à jour : ils avaient onze jours de retard.
- Import CSV durci : l'unité de temps est vérifiée (un fichier 15 min lu en
  1 min lisait le futur), un double décalage horaire est refusé, l'export
  TradingView est reconnu.
- Témoin des plans (DEC-035), rejeu pré-enregistré (DEC-036), puis rejeu
  lancé sur le Legion : 100 plans, aucun rejet.

**Mesuré**
- **+0,110 R contre −0,138 R au témoin, p = 0,049.** 99 ventes sur 100.

**Décidé**
- Réplication sur GC 2025-2026 avant tout direct (DEC-037), 10 000 tirages.

**Bloqué**
- Export TradingView payant, d'où la bascule vers MT5.

**Prochaine action**
- Réplication DEC-037 (opérateur).
