// La chaîne avec le VRAI moteur, pas un moteur simulé.
//
// Tous les autres tests d'OCR substituent le moteur, ce qui est la bonne
// manière de vérifier le découpage, l'agrandissement et le report
// d'ordonnées — mais c'est aussi pourquoi un défaut est resté invisible des
// semaines : tesseract.js 7 ne renseigne plus `data.words`, le moteur lisait
// l'axe sans faute et aucune étiquette n'en sortait. Un moteur simulé rend ce
// qu'on lui a dit de rendre ; il ne peut pas signaler ça.
//
// Le test est IGNORÉ si les fichiers du moteur ne sont pas servis en local
// (`npm run assets:ocr`) : une trentaine de mégaoctets de binaire non
// versionnés, qu'on ne peut pas exiger d'une intégration continue sans réseau.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { detecterPalette } from './extraction.js';
import { zoneTrace, reperesDepuisEtiquettes } from './axe.js';
import { lireBande } from './ocr.js';
import { enPng } from './png.js';
import { prixSelonLeModele } from './confrontation.js';

const DOSSIER = join(process.cwd(), 'public', 'tesseract');
const servi = existsSync(join(DOSSIER, 'eng.traineddata.gz'))
  && existsSync(join(DOSSIER, 'tesseract-core-simd-lstm.wasm.js'));

describe.skipIf(!servi)('le moteur réel, sur un axe rendu', () => {
  const bougies = Array.from({ length: 40 }, (_, i) => {
    const o = 4380 + i * 1.6;
    const c = o + 11 * Math.sin(i / 3.1);
    return {
      ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
      ouverture: o, cloture: c,
      plusHaut: Math.max(o, c) + 5, plusBas: Math.min(o, c) - 5, volume: 100 + i,
    };
  });

  it('lit l’axe et en tire une échelle juste au prix près', async () => {
    const { svg, echelle: verite } = tracerGraphique(bougies, { libelle: 'GC', unite: '15m' });
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
    const zone = zoneTrace(r.pixels, r.width, r.height, detecterPalette(r.pixels, r.width, r.height));

    const { createWorker } = await import('tesseract.js');
    const etiquettes = await lireBande(
      r.pixels, r.width, r.height,
      { x0: zone.axeX0, x1: zone.axeX1, y0: zone.y0, y1: zone.y1 },
      {
        facteur: 4,
        enImage: enPng,
        creerWorker: () => createWorker('eng', undefined, { langPath: DOSSIER, corePath: DOSSIER }),
      },
    );

    // Sans `{ blocks: true }` dans lireBande, c'est ici que tout s'arrêtait.
    expect(etiquettes?.length).toBeGreaterThanOrEqual(3);

    const essai = reperesDepuisEtiquettes(etiquettes);
    expect(essai).not.toBeNull();
    expect(essai.convention).toBe('point');

    // La vérité est l'échelle qui a servi à DESSINER le graphique : on compare
    // le prix lu au prix réellement tracé à cette hauteur, pas à une moyenne.
    const etendue = Math.abs(verite.priceTop - verite.priceBottom);
    let pire = 0;
    for (const rep of essai.reperes) {
      pire = Math.max(pire, Math.abs(rep.prix - prixSelonLeModele(verite, rep.y, r.height)));
    }
    // Le résidu est le décalage entre le centre du texte et le pixel de la
    // graduation, pas une erreur de lecture : mesuré à 0,24 point sur 81.
    expect(pire / etendue).toBeLessThan(0.01);
    expect(pire / verite.priceTop).toBeLessThan(0.0005);
  }, 120_000);
});

// ── L'axe en thème CLAIR, qui est celui que l'utilisateur capture ───────────
//
// Tout le reste de ce dépôt dessine en thème sombre, parce que c'est ce que
// l'application rend. L'axe lu sur une capture d'écran, lui, est celui de
// TradingView tel que l'utilisateur l'a configuré — souvent clair : des
// graduations grises #787B86 sur blanc, plus l'étiquette du prix courant en
// blanc sur noir.
//
// Cette bande-là mettait la lecture en échec, et rien ne le voyait : la
// binarisation érodait les graduations grises jusqu'à l'illisible, et seule
// l'étiquette du prix courant survivait — assez contrastée pour franchir
// n'importe quel seuil. Une étiquette lue, dix-neuf perdues, et le message
// « moins de trois graduations lisibles » pour tout diagnostic.

function bandeClaire({ police = 11 } = {}) {
  const prix = Array.from({ length: 20 }, (_, i) => ({
    texte: `${(87000 - i * 200).toLocaleString('en-US')}.00`, y: 30 + i * 45,
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="880">
    <rect width="100%" height="100%" fill="#FFFFFF"/>
    ${prix.map((p) => `<text x="10" y="${p.y}" font-family="Arial, Helvetica, sans-serif"
      font-size="${police}" fill="#787B86">${p.texte}</text>`).join('\n')}
    <rect x="4" y="52" width="92" height="20" fill="#131722"/>
    <text x="10" y="67" font-family="Arial, Helvetica, sans-serif" font-size="${police}"
      font-weight="bold" fill="#FFFFFF">86,903.65</text>
  </svg>`;
  const r = new Resvg(svg).render();
  return { données: r.pixels, largeur: r.width, hauteur: r.height, attendus: prix };
}

describe.skipIf(!servi)('l’axe en thème clair, moteur réel', () => {
  it('lit les graduations grises malgré l’étiquette du prix courant', async () => {
    const { données, largeur, hauteur } = bandeClaire();
    const { createWorker } = await import('tesseract.js');
    const lues = await lireBande(données, largeur, hauteur, { x0: 0, y0: 0, x1: largeur, y1: hauteur }, {
      facteur: 4,
      enImage: enPng,
      creerWorker: () => createWorker('eng', undefined, { langPath: DOSSIER, corePath: DOSSIER }),
    });

    // Avec la binarisation d'avant : 1 sur 20, et c'était l'étiquette de prix.
    expect(lues.length).toBeGreaterThanOrEqual(12);

    const essai = reperesDepuisEtiquettes(lues);
    expect(essai).not.toBeNull();
    expect(essai.convention).toBe('point');

    // L'échelle est linéaire par construction : 200 unités tous les 45 pixels.
    // Le consensus doit la retrouver, et écarter l'étiquette de prix qui ne
    // tombe sur aucune graduation.
    expect(essai.echelle.pireEcart).toBeLessThan(0.01);
    // Le niveau absolu n'est PAS vérifiable ici : l'ordonnée d'un `<text>` SVG
    // est sa ligne de base, l'OCR rend le centre de la boîte. Quatre pixels
    // d'écart, soit dix-huit unités de prix — un décalage du repère, pas de
    // l'échelle. C'est la PENTE qui doit être juste, et elle l'est au millième.
    const prixEn = (y) => essai.echelle.prixDeY(y);
    const pente = (prixEn(0) - prixEn(855)) / 855;
    expect(pente).toBeCloseTo(200 / 45, 3);
  }, 120_000);
});
