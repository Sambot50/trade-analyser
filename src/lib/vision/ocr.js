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
 * Met en niveaux de gris, sans rien décider.
 *
 * C'est ce qu'on donne au moteur par défaut, et c'est un revirement : la bande
 * était binarisée avant d'être lue, au motif d'aider le moteur. Mesuré, elle
 * l'empêchait de lire. Sur un axe TradingView en thème clair — graduations
 * grises #787B86 sur blanc — la binarisation faisait tomber 17 lectures sur 20
 * à une seule : l'étiquette du prix courant, blanche sur noir, assez contrastée
 * pour survivre à n'importe quel seuil. Les graduations, elles, disparaissaient.
 *
 * La raison tient au lissage. Un glyphe de 11 pixels n'a presque aucun pixel à
 * sa couleur nominale : il est fait de valeurs intermédiaires entre le gris du
 * trait et le blanc du fond. Un seuil global tranche dans cette pente et érode
 * les traits jusqu'à l'illisible. Tesseract binarise de lui-même, par-dessus, et
 * le fait mieux : il travaille sur des voisinages, pas sur la bande entière.
 *
 * Vérifié aussi en thème sombre, où la binarisation avait été écrite : même
 * lecture, même échelle, même écart. Elle ne servait nulle part.
 */
export function enNiveauxDeGris(img) {
  const n = img.largeur * img.hauteur;
  const sortie = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = luminance([img.données[i * 4], img.données[i * 4 + 1], img.données[i * 4 + 2]]);
    sortie[i * 4] = v; sortie[i * 4 + 1] = v; sortie[i * 4 + 2] = v; sortie[i * 4 + 3] = 255;
  }
  return { ...img, données: sortie };
}

/**
 * Binarise en noir sur blanc, en détectant la polarité.
 *
 * N'est plus utilisée par défaut — voir `enNiveauxDeGris`. Gardée pour les
 * captures très dégradées, où un seuil franc peut encore aider, et parce que
 * la mesure qui l'a écartée vaut pour les captures d'écran d'aujourd'hui, pas
 * pour toutes.
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
export function preparerBande(données, largeur, hauteur, bande, { facteur = 3, coteMax = 2400, binarisation = false } = {}) {
  const coupe = recadrer(données, largeur, hauteur, bande);
  if (!coupe) return null;
  const grand = agrandir(coupe, facteurTenable(coupe.largeur, coupe.hauteur, facteur, coteMax));
  return binarisation ? binariser(grand) : enNiveauxDeGris(grand);
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
 * Borne une promesse dans le temps.
 *
 * SANS CELA, UNE LECTURE QUI N'ABOUTIT PAS NE REND JAMAIS LA MAIN. Un worker
 * dont le dictionnaire ne se charge pas n'échoue pas : il attend. Le `finally`
 * qui remet le bouton en état n'est jamais atteint, et l'écran reste figé sur
 * « lecture en cours » indéfiniment, sans message ni recours.
 *
 * Une opération qui dépend du réseau doit toujours pouvoir renoncer.
 */
export function avecDelai(promesse, ms, message) {
  if (!(ms > 0)) return promesse;
  let minuteur;
  const garde = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error(message)), ms);
  });
  return Promise.race([promesse, garde]).finally(() => clearTimeout(minuteur));
}

/**
 * Ce fichier est-il réellement servi par l'application ?
 *
 * On le vérifie AVANT de le demander au moteur. Un chemin qui répond 404 ne
 * fait pas échouer `createWorker` proprement : selon les versions il réessaie
 * ou reste suspendu, et le repli ne se déclenche jamais. C'est exactement ce
 * qui laissait le bouton sur « Lecture… » indéfiniment.
 */
export async function fichierServi(url, { fetcher, delaiMs = 3000 } = {}) {
  if (!url) return false;
  const f = fetcher ?? (typeof fetch === 'function' ? fetch : null);
  if (!f) return false;
  try {
    const r = await avecDelai(f(url, { method: 'HEAD' }), delaiMs, 'délai dépassé');
    return Boolean(r?.ok);
  } catch {
    return false;
  }
}

const sansFinale = (chemin) => String(chemin).replace(/\/$/, '');

/** Le dictionnaire de la langue demandée. */
export async function dictionnaireServi(cheminLangue, langue = 'eng', options = {}) {
  if (!cheminLangue) return false;
  return fichierServi(`${sansFinale(cheminLangue)}/${langue}.traineddata.gz`, options);
}

/**
 * Le cœur WebAssembly se décline par jeu d'instructions, et c'est le worker
 * qui choisit la variante selon ce que sait faire le navigateur. On ne peut
 * donc pas vérifier celle qu'il demandera : on sonde la plus probable, et le
 * script de rapatriement dépose les trois ensemble, jamais une seule.
 */
export async function coeurServi(cheminCoeur, options = {}) {
  if (!cheminCoeur) return false;
  return fichierServi(`${sansFinale(cheminCoeur)}/tesseract-core-simd-lstm.wasm.js`, options);
}

/**
 * Le moteur, servi en local d'abord, depuis sa source habituelle ensuite.
 *
 * tesseract.js va chercher TROIS choses sur un CDN, pas une : son script de
 * worker, son cœur WebAssembly — le plus lourd des trois — et le dictionnaire
 * de la langue. Ne rapatrier que le dictionnaire, comme on le faisait, ne
 * supprimait donc pas la dépendance réseau ; ça n'en déplaçait qu'un tiers.
 *
 * Les trois sont vérifiés séparément et passés séparément. Un dossier complet
 * rend la lecture possible hors ligne ; un dossier partiel prend ce qu'il a
 * et laisse le reste au CDN, ce qui vaut mieux que de tout refuser. Exiger
 * ces fichiers rendrait l'application inutilisable à qui ne les a pas encore
 * déposés — `npm run assets:ocr` les met en place.
 */
export async function creerWorkerParDefaut({
  langue = 'eng', cheminLangue, cheminCoeur, cheminWorker,
  charger, fetcher, delaiMs = 60_000,
} = {}) {
  const createWorker = charger ?? (await import('tesseract.js')).createWorker;

  // Par défaut le cœur et le worker sont dans le même dossier que le dictionnaire.
  const coeur = cheminCoeur ?? cheminLangue;
  const worker = cheminWorker ?? (cheminLangue ? `${sansFinale(cheminLangue)}/worker.min.js` : null);

  const [dico, coeurLa, workerLa] = await Promise.all([
    dictionnaireServi(cheminLangue, langue, { fetcher }),
    coeurServi(coeur, { fetcher }),
    fichierServi(worker, { fetcher }),
  ]);

  const options = {};
  if (dico) options.langPath = cheminLangue;
  if (coeurLa) options.corePath = coeur;
  if (workerLa) options.workerPath = worker;

  if (Object.keys(options).length > 0) {
    try {
      return await avecDelai(
        createWorker(langue, undefined, options),
        delaiMs,
        `Le moteur de lecture n'a pas démarré en ${Math.round(delaiMs / 1000)} s `
        + `depuis ${cheminLangue ?? 'les fichiers locaux'}.`,
      );
    } catch {
      // Servis mais inutilisables : on retombe sur la source habituelle.
    }
  }

  return avecDelai(
    createWorker(langue),
    delaiMs,
    `Le moteur de lecture n'a pas démarré en ${Math.round(delaiMs / 1000)} s. `
    + `Ses fichiers se téléchargent au premier usage : vérifie ta connexion, `
    + `ou lance « npm run assets:ocr » pour les servir en local.`,
  );
}

/** Les caractères qu'une graduation de prix peut contenir, et pas un de plus. */
export const CARACTERES = '0123456789.,';

/**
 * Les mots d'un résultat, quelle que soit la version du moteur.
 *
 * tesseract.js les rendait à plat dans `data.words` ; depuis la 7 ils sont
 * imbriqués sous `blocks > paragraphs > lines > words`, et `data.words` n'est
 * plus renseigné. On lit les deux, parce qu'une montée de version ne doit pas
 * ramener un axe muet sans qu'aucun test ne bronche.
 */
export function motsDuResultat(data) {
  if (!data) return [];
  if (Array.isArray(data.words) && data.words.length > 0) return data.words;
  return (data.blocks ?? []).flatMap(
    (bloc) => (bloc?.paragraphs ?? []).flatMap(
      (par) => (par?.lines ?? []).flatMap((ligne) => ligne?.words ?? []),
    ),
  );
}

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
  const prete = preparerBande(données, largeur, hauteur, bande, {
    facteur, coteMax: options.coteMax, binarisation: options.binarisation,
  });
  if (!prete) return null;

  const fabrique = creerWorker ?? (() => creerWorkerParDefaut({ langue, cheminLangue, delaiMs: options.delaiMoteurMs }));

  const worker = await fabrique();
  try {
    await worker.setParameters({
      tessedit_char_whitelist: caracteres,
      // Un axe est une colonne de nombres isolés, pas un paragraphe.
      tessedit_pageseg_mode: '6',
    });
    const image = enImage ? await enImage(prete) : prete;
    // `{ blocks: true }` n'est PAS cosmétique : sans lui, tesseract.js 7 ne
    // rend que du texte, et `data.words` reste vide. L'axe se lisait donc
    // parfaitement — « 4440 4420 4400 4380 » — pour ne produire aucune
    // étiquette, faute de boîtes englobantes à reporter en ordonnées.
    const { data } = await avecDelai(
      worker.recognize(image, {}, { blocks: true }),
      options.delaiLectureMs ?? 120_000,
      "La reconnaissance de caractères n'a pas abouti. Recadre la capture : une bande trop large prend des minutes.",
    );
    return etiquettesDepuisMots(motsDuResultat(data), { y0: bande.y0, facteur: prete.facteur ?? facteur });
  } finally {
    await worker.terminate?.();
  }
}
