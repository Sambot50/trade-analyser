#!/usr/bin/env node
// Rapatrie les fichiers du moteur de lecture depuis node_modules vers public/.
//
// Sans ce script, tesseract.js va chercher trois choses sur un CDN au premier
// appel : son script de worker, son cœur WebAssembly et son dictionnaire. Pour
// une application qui lit des graphiques en local — précisément pour que rien
// ne sorte de la machine — c'est une dépendance réseau injustifiable, et c'est
// aussi ce qui faisait rester le bouton sur « Lecture… » indéfiniment : un
// 404 sur un langPath ne fait pas échouer createWorker, il le suspend.
//
// Les fichiers ne sont PAS versionnés (une vingtaine de mégaoctets de binaire
// dans un dépôt public). Ils se reconstituent par `npm install`, qui déclenche
// ce script, ou à la main par `npm run assets:ocr`.

import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const cible = join(racine, 'public', 'tesseract');

/** Le dictionnaire, dont le nom de dossier porte la version des données. */
function dictionnaires(paquet) {
  const sorties = [];
  if (!existsSync(paquet)) return sorties;
  for (const entree of readdirSync(paquet)) {
    const chemin = join(paquet, entree);
    if (!statSync(chemin).isDirectory()) continue;
    // « 4.0.0 » est le modèle rapide, « 4.0.0_best_int » le modèle précis.
    // Pour quatre chiffres sur un axe, le rapide suffit et pèse moitié moins.
    if (entree.endsWith('_best_int')) continue;
    for (const f of readdirSync(chemin)) {
      if (f.endsWith('.traineddata.gz')) sorties.push(join(chemin, f));
    }
  }
  return sorties;
}

/**
 * Le cœur se décline par jeu d'instructions : le worker choisit `simd`,
 * `relaxedsimd` ou la variante neutre selon ce que sait faire le navigateur.
 * On ne peut pas deviner lequel il demandera, donc on copie les trois — mais
 * seulement en moteur LSTM, le seul que l'on utilise.
 */
function coeurs(paquet) {
  if (!existsSync(paquet)) return [];
  return readdirSync(paquet)
    .filter((f) => f.includes('-lstm') && /\.(js|wasm)$/.test(f))
    .map((f) => join(paquet, f));
}

export function sourcesAttendues(racineModules) {
  const worker = join(racineModules, 'tesseract.js', 'dist', 'worker.min.js');
  return [
    ...(existsSync(worker) ? [worker] : []),
    ...coeurs(join(racineModules, 'tesseract.js-core')),
    ...dictionnaires(join(racineModules, '@tesseract.js-data', 'eng')),
  ];
}

export function rapatrier({ modules = join(racine, 'node_modules'), vers = cible } = {}) {
  const sources = sourcesAttendues(modules);
  mkdirSync(vers, { recursive: true });
  for (const src of sources) copyFileSync(src, join(vers, basename(src)));
  return { copies: sources.map((s) => basename(s)), vers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { copies, vers } = rapatrier();
  if (copies.length === 0) {
    // Un postinstall ne doit jamais casser une installation : on signale et on sort.
    console.warn('[assets-ocr] rien à copier — les paquets du moteur ne sont pas installés.');
    process.exit(0);
  }
  const dico = copies.filter((f) => f.endsWith('.traineddata.gz'));
  console.log(`[assets-ocr] ${copies.length} fichiers vers ${vers}`);
  if (dico.length === 0) {
    console.warn('[assets-ocr] aucun dictionnaire : l’axe restera à saisir à la main.');
  }
}
