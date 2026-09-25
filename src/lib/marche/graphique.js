// Tracé d'un graphique depuis de vraies bougies.
//
// `make-samples.mjs` dessine déjà, mais depuis un générateur synthétique et
// avec une échelle choisie à la main. Ici les bougies sont réelles et
// l'échelle est **calculée puis rendue**, ce qui change tout.
//
// Pourquoi rendre l'échelle importe autant :
//
// Le banc d'essai mesure une dérive de lecture d'axe de l'ordre de 1,7 % sur
// une capture réelle. Le stop médian mesuré sur l'or vaut 0,188 % du prix.
// **L'erreur de lecture est neuf fois plus grande que ce qu'on veut mesurer.**
//
// Comme c'est nous qui traçons, nous connaissons l'échelle exacte. On la donne
// au modèle plutôt que de la lui faire deviner : la mesure porte alors sur sa
// lecture de la STRUCTURE, pas sur sa vision de petits chiffres.
//
// Rien ici ne regarde au-delà des bougies fournies. C'est à l'appelant de ne
// passer que le passé — et c'est l'invariant que le premier test vérifie.

import { dureeUnite } from './bougies.js';

/** Géométrie de l'image, en pixels. Fixe, pour que tout soit comparable. */
export const GEOMETRIE = {
  largeur: 1200,
  hauteur: 700,
  gaucheX: 20,
  droiteX: 1090,
  hautY: 40,
  // Bas du panneau des prix quand le volume est tracé sous lui, et quand il
  // ne l'est pas.
  basAvecVolume: 500,
  basSansVolume: 620,
  volumeHautY: 530,
  volumeBasY: 620,
};

const COULEURS = {
  fond: '#0B1120',
  grille: '#1E293B',
  axe: '#334155',
  texte: '#94A3B8',
  titre: '#E2E8F0',
  hausse: '#10B981',
  baisse: '#EF4444',
};

/** Échelons de grille lisibles : 1, 2 et 5 fois une puissance de dix. */
function pasDeGrille(etendue, cibles = 7) {
  if (!(etendue > 0)) return 1;
  const brut = etendue / cibles;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  for (const facteur of [1, 2, 5, 10]) {
    if (facteur * puissance >= brut) return facteur * puissance;
  }
  return 10 * puissance;
}

/** Nombre de décimales nécessaires pour distinguer deux graduations. */
const decimalesPour = (pas) => Math.max(0, Math.min(8, Math.ceil(-Math.log10(pas)) + 1));

/**
 * Repère de prix couvrant toutes les bougies, avec une marge.
 *
 * Rendu au format qu'attend `priceToY` de `analysis.js`, pour que la
 * projection prix → pixel soit exactement celle du reste de l'application.
 */
export function repereDePrix(bougies, { marge = 0.06, avecVolume = false } = {}) {
  if (!bougies.length) throw new Error('Aucune bougie à tracer.');

  let haut = -Infinity;
  let bas = Infinity;
  for (const b of bougies) {
    if (b.plusHaut > haut) haut = b.plusHaut;
    if (b.plusBas < bas) bas = b.plusBas;
  }

  // Une série parfaitement plate n'a pas d'étendue : on en invente une, faute
  // de quoi la projection diviserait par zéro.
  const etendue = haut - bas || Math.abs(haut) * 0.001 || 1;
  const coussin = etendue * marge;

  const basY = avecVolume ? GEOMETRIE.basAvecVolume : GEOMETRIE.basSansVolume;
  return {
    priceTop: haut + coussin,
    priceBottom: bas - coussin,
    plotTopRatio: GEOMETRIE.hautY / GEOMETRIE.hauteur,
    plotBottomRatio: basY / GEOMETRIE.hauteur,
  };
}

const echappe = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/**
 * Trace les bougies fournies et rend l'image avec l'échelle exacte utilisée.
 *
 * @param libelle  nom de l'instrument, écrit en haut à gauche
 * @param unite    unité de temps, pour l'étiquette et la durée des bougies
 * @returns { svg, echelle, nombreBougies, debutMs, finMs, avecVolume }
 */
export function tracerGraphique(bougies, { libelle = '', unite = '1h' } = {}) {
  if (!Array.isArray(bougies) || !bougies.length) throw new Error('Aucune bougie à tracer.');

  const avecVolume = bougies.some((b) => Number.isFinite(b.volume) && b.volume > 0);
  const echelle = repereDePrix(bougies, { avecVolume });
  const { priceTop, priceBottom } = echelle;

  const basY = avecVolume ? GEOMETRIE.basAvecVolume : GEOMETRIE.basSansVolume;
  const y = (p) => GEOMETRIE.hautY + ((priceTop - p) / (priceTop - priceBottom)) * (basY - GEOMETRIE.hautY);

  const creneau = (GEOMETRIE.droiteX - GEOMETRIE.gaucheX) / bougies.length;
  const corps = Math.max(1, creneau * 0.62);

  const pas = pasDeGrille(priceTop - priceBottom);
  const decimales = decimalesPour(pas);

  const parts = [`<rect width="${GEOMETRIE.largeur}" height="${GEOMETRIE.hauteur}" fill="${COULEURS.fond}"/>`];

  for (let p = Math.ceil(priceBottom / pas) * pas; p <= priceTop; p += pas) {
    const py = y(p).toFixed(1);
    parts.push(`<line x1="${GEOMETRIE.gaucheX}" y1="${py}" x2="${GEOMETRIE.droiteX}" y2="${py}" stroke="${COULEURS.grille}" stroke-width="1"/>`);
    parts.push(`<text x="${GEOMETRIE.droiteX + 10}" y="${(Number(py) + 4).toFixed(1)}" fill="${COULEURS.texte}" font-family="monospace" font-size="15">${p.toFixed(decimales)}</text>`);
  }

  const volumeMax = avecVolume ? Math.max(...bougies.map((b) => b.volume || 0)) : 0;
  const hauteurVolume = GEOMETRIE.volumeBasY - GEOMETRIE.volumeHautY;

  bougies.forEach((b, i) => {
    const cx = GEOMETRIE.gaucheX + creneau * i + creneau / 2;
    const couleur = b.cloture >= b.ouverture ? COULEURS.hausse : COULEURS.baisse;
    const hautCorps = y(Math.max(b.ouverture, b.cloture));
    const basCorps = y(Math.min(b.ouverture, b.cloture));

    parts.push(`<line x1="${cx.toFixed(1)}" y1="${y(b.plusHaut).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(b.plusBas).toFixed(1)}" stroke="${couleur}" stroke-width="1.5"/>`);
    parts.push(`<rect x="${(cx - corps / 2).toFixed(1)}" y="${hautCorps.toFixed(1)}" width="${corps.toFixed(1)}" height="${Math.max(1, basCorps - hautCorps).toFixed(1)}" fill="${couleur}"/>`);

    if (avecVolume && volumeMax > 0) {
      const h = ((b.volume || 0) / volumeMax) * hauteurVolume;
      parts.push(`<rect x="${(cx - corps / 2).toFixed(1)}" y="${(GEOMETRIE.volumeBasY - h).toFixed(1)}" width="${corps.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${couleur}" opacity="0.55"/>`);
    }
  });

  parts.push(`<line x1="${GEOMETRIE.gaucheX}" y1="${basY}" x2="${GEOMETRIE.droiteX}" y2="${basY}" stroke="${COULEURS.axe}" stroke-width="1"/>`);
  if (avecVolume) {
    parts.push(`<line x1="${GEOMETRIE.gaucheX}" y1="${GEOMETRIE.volumeBasY}" x2="${GEOMETRIE.droiteX}" y2="${GEOMETRIE.volumeBasY}" stroke="${COULEURS.axe}" stroke-width="1"/>`);
    parts.push(`<text x="${GEOMETRIE.gaucheX + 8}" y="${GEOMETRIE.volumeHautY - 6}" fill="${COULEURS.texte}" font-family="sans-serif" font-size="13">Volume</text>`);
  }
  parts.push(`<text x="${GEOMETRIE.gaucheX + 8}" y="26" fill="${COULEURS.titre}" font-family="sans-serif" font-size="18" font-weight="bold">${echappe(libelle)} · ${echappe(unite)}</text>`);

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${GEOMETRIE.largeur}" height="${GEOMETRIE.hauteur}" viewBox="0 0 ${GEOMETRIE.largeur} ${GEOMETRIE.hauteur}">${parts.join('')}</svg>`,
    echelle,
    nombreBougies: bougies.length,
    debutMs: bougies[0].ouvertureMs,
    finMs: bougies.at(-1).fermetureMs ?? bougies.at(-1).ouvertureMs + dureeUnite(unite) - 1,
    avecVolume,
  };
}
