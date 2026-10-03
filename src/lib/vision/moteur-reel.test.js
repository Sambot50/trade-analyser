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
