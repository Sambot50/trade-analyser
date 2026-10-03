// Préparer la bande d'axe, puis la faire lire.
//
// Tesseract ne lit pas une étiquette de graphique telle quelle : du gris clair
// en onze pixels sur fond sombre, c'est en dessous de ce qu'un moteur conçu
// pour du texte scanné sait traiter. Il faut découper, agrandir, et inverser
// pour lui rendre ce qu'il attend — du noir sur du blanc, en gros.
//
// Tout ce qui précède l'appel est PUR et se teste sans navigateur. L'appel
// lui-même est mince : il ne décide de rien.
//
// LE PIÈGE EST DANS LE RETOUR. L'OCR rend des ordonnées dans l'image
// RECADRÉE ET AGRANDIE. Les reporter telles quelles dans l'image d'origine
// décalerait toute l'échelle sans qu'aucune erreur ne se déclenche — et une
// échelle décalée fausse chaque prix de la série.

import { chroma } from './extraction.js';

/** Découpe une zone, en RGBA à plat. */
export function recadrer(données, largeur, hauteur, { x0, x1, y0, y1 }) {
  const gx = Math.max(0, Math.min(largeur, Math.floor(x0)));
  const dx = Math.max(gx, Math.min(largeur, Math.ceil(x1)));
  const gy = Math.max(0, Math.min(hauteur, Math.floor(y0)));
  const dy = Math.max(gy, Math.min(hauteur, Math.ceil(y1)));
  const l = dx - gx;
  const h = dy - gy;
  if (l <= 0 || h <= 0) return null;

  const sortie = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((gy + y) * largeur + gx) * 4;
    sortie.set(données.subarray(src, src + l * 4), y * l * 4);
  }
  return { données: sortie, largeur: l, hauteur: h, x0: gx, y0: gy };
}

/**
 * Agrandit au plus proche voisin.
 *
 * Volontairement sans lissage : un caractère interpolé a des bords flous, et
 * c'est précisément ce que l'OCR confond. On veut des marches nettes.
 */
export function agrandir(img, facteur = 3) {
  const f = Math.max(1, Math.round(facteur));
  if (f === 1) return img;
  const l = img.largeur * f;
  const h = img.hauteur * f;
  const sortie = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = (y / f) | 0;
    for (let x = 0; x < l; x++) {
      const sx = (x / f) | 0;
      const s = (sy * img.largeur + sx) * 4;
      const d = (y * l + x) * 4;
      sortie[d] = img.données[s];
      sortie[d + 1] = img.données[s + 1];
      sortie[d + 2] = img.données[s + 2];
      sortie[d + 3] = 255;
    }
  }
  return { ...img, données: sortie, largeur: l, hauteur: h, facteur: f };
}

/** Luminance perçue, de 0 à 255. */
export const luminance = ([r, v, b]) => 0.2126 * r + 0.7152 * v + 0.0722 * b;

/**
 * Binarise en noir sur blanc, en détectant la polarité.
 *
 * Un thème sombre porte du texte clair sur fond foncé ; Tesseract attend
 * l'inverse. La polarité se déduit de la luminance MÉDIANE : le fond occupe
 * toujours la majorité de la bande, donc la médiane est celle du fond.
 */
export function binariser(img, { seuilAuto = true, seuil = 128 } = {}) {
  const n = img.largeur * img.hauteur;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = luminance([img.données[i * 4], img.données[i * 4 + 1], img.données[i * 4 + 2]]);
  }

  let coupure = seuil;
  let fondClair = true;
  if (seuilAuto) {
    const triees = Float32Array.from(lum).sort();
    const médiane = triees[n >> 1];
    const min = triees[0];
    const max = triees[n - 1];
    fondClair = médiane > (min + max) / 2;
    // À mi-chemin entre le fond et l'extrême opposé : le texte est rare, donc
    // une moyenne globale le noierait.
    coupure = fondClair ? (médiane + min) / 2 : (médiane + max) / 2;
  }

  const sortie = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const estTexte = fondClair ? lum[i] < coupure : lum[i] > coupure;
    const v = estTexte ? 0 : 255;
    sortie[i * 4] = v; sortie[i * 4 + 1] = v; sortie[i * 4 + 2] = v; sortie[i * 4 + 3] = 255;
  }
  return { ...img, données: sortie, fondClair, coupure };
}

/**
 * Le facteur d'agrandissement réellement tenable pour cette bande.
 *
 * Agrandir ×4 une bande déjà large d'une capture plein écran produirait une
 * image de plusieurs dizaines de millions de pixels : l'OCR y passerait des
 * minutes, pour lire les mêmes chiffres. On réduit le facteur plutôt que de
 * laisser la lecture ne jamais rendre la main.
 */
export function facteurTenable(largeur, hauteur, demandé = 3, coteMax = 2400) {
  const plusGrand = Math.max(largeur, hauteur);
  if (!(plusGrand > 0)) return 1;
  return Math.max(1, Math.min(Math.round(demandé), Math.floor(coteMax / plusGrand) || 1));
}

/** Bande d'axe prête pour l'OCR : découpée, agrandie, binarisée. */
export function preparerBande(données, largeur, hauteur, bande, { facteur = 3, coteMax = 2400 } = {}) {
  const coupe = recadrer(données, largeur, hauteur, bande);
  if (!coupe) return null;
  return binariser(agrandir(coupe, facteurTenable(coupe.largeur, coupe.hauteur, facteur, coteMax)));
}

/**
 * Les étiquettes, REPORTÉES DANS L'IMAGE D'ORIGINE.
 *
 * `mots` sont les mots rendus par Tesseract, avec leur boîte dans l'image
 * préparée. On rend leur centre vertical dans l'image de départ : c'est la
 * seule coordonnée qui ait un sens pour l'échelle.
 */
export function etiquettesDepuisMots(mots, { y0 = 0, facteur = 1, confianceMinimale = 50 } = {}) {
  return (mots ?? [])
    .filter((m) => m && typeof m.text === 'string' && (m.confidence ?? 100) >= confianceMinimale)
    .map((m) => {
      const b = m.bbox ?? {};
      if (!Number.isFinite(b.y0) || !Number.isFinite(b.y1)) return null;
      return {
        texte: m.text.trim(),
        y: y0 + ((b.y0 + b.y1) / 2) / facteur,
        confiance: m.confidence ?? null,
      };
    })
    .filter((e) => e && e.texte);
}

/**
 * Le moteur, servi en local d'abord, depuis sa source habituelle ensuite.
 *
 * Servir le dictionnaire avec l'application est la bonne façon : rien ne sort
 * de la machine, et une coupure réseau n'empêche pas de lire un graphique.
 * Mais exiger ce fichier rendrait l'application inutilisable à qui ne l'a pas
 * encore déposé. On essaie donc le chemin local, et on retombe sur la source
 * par défaut s'il n'y est pas.
 */
export async function creerWorkerParDefaut({ langue = 'eng', cheminLangue, charger } = {}) {
  const createWorker = charger ?? (await import('tesseract.js')).createWorker;
  if (cheminLangue) {
    try {
      return await createWorker(langue, undefined, { langPath: cheminLangue });
    } catch {
      // Dictionnaire absent des fichiers servis : on continue sans.
    }
  }
  return createWorker(langue);
}

/** Les caractères qu'une graduation de prix peut contenir, et pas un de plus. */
export const CARACTERES = '0123456789.,';

/**
 * Lit la bande d'axe. Le seul endroit qui touche Tesseract.
 *
 * `cheminLangue` DOIT être servi par l'application, pas laissé au défaut.
 *
 * Sans lui, tesseract.js va chercher son dictionnaire sur un CDN au premier
 * appel. Une application qui analyse des graphiques hors ligne — et dont le
 * moteur de vision tourne en local, précisément pour que rien ne sorte de la
 * machine — ne peut pas dépendre d'un téléchargement au moment où l'on s'en
 * sert. Le fichier `eng.traineddata.gz` se récupère une fois et se place dans
 * les fichiers servis.
 *
 * `creerWorker` est injectable pour que le reste se teste sans moteur.
 */
export async function lireBande(données, largeur, hauteur, bande, options = {}) {
  const { facteur = 3, langue = 'eng', cheminLangue, creerWorker, enImage, caracteres = CARACTERES } = options;
  const prete = preparerBande(données, largeur, hauteur, bande, { facteur, coteMax: options.coteMax });
  if (!prete) return null;

  const fabrique = creerWorker ?? (() => creerWorkerParDefaut({ langue, cheminLangue }));

  const worker = await fabrique();
  try {
    await worker.setParameters({
      tessedit_char_whitelist: caracteres,
      // Un axe est une colonne de nombres isolés, pas un paragraphe.
      tessedit_pageseg_mode: '6',
    });
    const image = enImage ? await enImage(prete) : prete;
    const { data } = await worker.recognize(image);
    const mots = data?.words ?? [];
    return etiquettesDepuisMots(mots, { y0: bande.y0, facteur: prete.facteur ?? facteur });
  } finally {
    await worker.terminate?.();
  }
}
