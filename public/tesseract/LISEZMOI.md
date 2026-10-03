# Fichiers du moteur de lecture

Ce dossier contient tout ce dont `tesseract.js` a besoin, servi par l'application.

```
npm run assets:ocr
```

C'est aussi ce que fait `npm install` tout seul, par le `postinstall`. Rien à
télécharger à la main.

## Ce qu'il y a dedans, et pourquoi les trois

`tesseract.js` va chercher **trois** choses sur un CDN au premier appel, pas une :

| fichier | rôle | poids |
|---|---|---|
| `worker.min.js` | le script du worker | 60 Ko |
| `tesseract-core-*-lstm.wasm.js` | le cœur WebAssembly, en trois variantes | 20 Mo |
| `eng.traineddata.gz` | le dictionnaire | 4 Mo |

Le cœur se décline par jeu d'instructions — `simd`, `relaxedsimd`, ou la variante
neutre — et c'est le worker qui choisit selon ce que sait faire le navigateur. On ne
peut pas deviner lequel il demandera, d'où les trois.

Une version antérieure ne rapatriait que le dictionnaire. Elle ne supprimait donc pas
la dépendance réseau : elle en déplaçait un tiers, et laissait partir le plus lourd.

## Pourquoi en local

Le moteur de vision tourne sur la machine pour que rien ne sorte de la machine.
Dépendre d'un CDN au moment où l'on s'en sert irait contre ce choix.

Il y a une raison plus prosaïque : un chemin qui répond 404 ne fait pas échouer
`createWorker` proprement — selon les versions il réessaie ou reste suspendu. C'est ce
qui laissait le bouton sur « Lecture… » indéfiniment. L'application vérifie maintenant
chaque fichier par une requête `HEAD` avant de le demander au moteur, et prend ce qui
est servi en laissant le reste au CDN.

## Sans ces fichiers

L'application marche quand même : `creerWorkerParDefaut` retombe sur la source
habituelle de `tesseract.js`, au prix d'un téléchargement au premier usage — et à
condition d'avoir du réseau.

Les binaires ne sont pas versionnés : une trentaine de mégaoctets dans un dépôt
public, reconstituables par une commande. Seul ce fichier l'est.
