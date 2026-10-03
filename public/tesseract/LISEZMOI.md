# Dictionnaire Tesseract

Dépose ici `eng.traineddata.gz` pour que la lecture d'axe fonctionne **hors ligne**.

```
curl -L -o eng.traineddata.gz \
  https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
```

Sans ce fichier l'application marche quand même : `creerWorkerParDefaut` retombe sur
la source habituelle de `tesseract.js`, au prix d'un téléchargement au premier usage.

Le moteur de vision de cette application tourne en local pour que rien ne sorte de la
machine. Dépendre d'un CDN au moment où l'on s'en sert irait contre ce choix — d'où ce
dossier.
