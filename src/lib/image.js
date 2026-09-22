/**
 * Convertit une image servie par URL en data-URI PNG.
 *
 * Deux raisons, pas une :
 * - les fournisseurs attendent du base64, pas une URL ;
 * - un SVG n'est pas un format d'entrée fiable pour un modèle de vision.
 *   Le rasteriser met les démos sur le même chemin qu'une vraie capture,
 *   donc analysables — et comme leur échelle exacte est connue, elles servent
 *   de banc d'essai à la lecture de l'axe des prix.
 */
export function toPngDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        // Canvas contaminé : on ne peut pas extraire les pixels.
        reject(new Error(`Conversion impossible : ${err.message}`));
      }
    };

    img.onerror = () => reject(new Error(`Image introuvable : ${src}`));
    img.src = src;
  });
}
