// Le peu de code qui a besoin d'un navigateur.
//
// Tout le reste de `vision/` travaille sur du RGBA à plat et se teste sans
// écran. Ici on fait les deux conversions que seul un navigateur sait faire :
// décoder une image déposée, et rendre à Tesseract un objet qu'il accepte.

/** Les pixels d'une image déposée ou collée, dans sa taille d'origine. */
export async function pixelsDepuisDataUrl(dataUrl) {
  const img = await new Promise((resoudre, rejeter) => {
    const e = new Image();
    e.onload = () => resoudre(e);
    e.onerror = () => rejeter(new Error("L'image n'a pas pu être décodée."));
    e.src = dataUrl;
  });

  const largeur = img.naturalWidth || img.width;
  const hauteur = img.naturalHeight || img.height;
  if (!largeur || !hauteur) throw new Error("L'image est vide.");

  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  // `willReadFrequently` évite que le navigateur garde la surface sur le GPU,
  // d'où chaque lecture reviendrait bien plus cher.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, largeur, hauteur);
  return { données: data, largeur, hauteur };
}

/**
 * Rend une image préparée sous une forme que Tesseract accepte.
 *
 * Un canvas plutôt qu'un PNG : l'encodage PNG de `png.js` s'appuie sur zlib de
 * Node, absent du navigateur, et le canvas évite un aller-retour inutile.
 */
export function enCanvas({ données, largeur, hauteur }) {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.putImageData(new ImageData(new Uint8ClampedArray(données), largeur, hauteur), 0, 0);
  return canvas;
}
