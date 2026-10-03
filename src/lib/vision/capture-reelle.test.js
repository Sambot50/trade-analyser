// La chaîne sur une VRAIE capture d'écran.
//
// Tout le reste de ce dépôt se vérifie sur des images rendues par resvg. Ça
// prouve la géométrie — un corps, une mèche, une échelle — mais pas la
// rencontre avec un écran réel : la police de TradingView, son lissage, son
// thème clair, son étiquette de prix courant, le recadrage de l'utilisateur.
//
// Les deux défauts les plus coûteux de ce module n'étaient visibles que là.
// `data.words` vide en tesseract.js 7, et la binarisation qui effaçait les
// graduations grises : l'un comme l'autre passaient tous les tests et
// échouaient en production, et chaque correction coûtait un aller-retour avec
// l'utilisateur. Ce fichier remplace cet aller-retour.
//
// Ignoré si les fichiers du moteur ne sont pas servis — `npm run assets:ocr`.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lireGraphique } from './lecture.js';
import { enPng, depuisPng } from './png.js';

const DOSSIER = join(process.cwd(), 'public', 'tesseract');
const FIXTURE = join(process.cwd(), 'fixtures', 'tradingview-clair.png');
const servi = existsSync(join(DOSSIER, 'eng.traineddata.gz'))
  && existsSync(join(DOSSIER, 'tesseract-core-simd-lstm.wasm.js'));

describe.skipIf(!servi || !existsSync(FIXTURE))('une capture TradingView réelle, thème clair', () => {
  it('lit l’axe, les bougies et la structure, sans aucune saisie', async () => {
    const { données, largeur, hauteur } = depuisPng(readFileSync(FIXTURE));
    expect([largeur, hauteur]).toEqual([1790, 822]);

    const { createWorker } = await import('tesseract.js');
    const r = await lireGraphique(données, largeur, hauteur, {
      facteur: 4,
      enImage: enPng,
      creerWorker: () => createWorker('eng', undefined, { langPath: DOSSIER, corePath: DOSSIER }),
    });

    expect(r.ok, r.probleme).toBe(true);

    // L'axe. Quinze graduations lues, aucune rejetée par le consensus : si une
    // seule l'était, c'est que l'OCR aurait mal lu un chiffre, et l'échelle
    // tiendrait quand même — c'est à ça que sert le consensus. Zéro rejet dit
    // que la lecture est franche, pas seulement rattrapée.
    expect(r.convention).toBe('point');
    expect(r.echelle.retenus.length).toBeGreaterThanOrEqual(10);
    expect(r.echelle.rejetes.length).toBe(0);
    expect(r.echelle.pireEcart).toBeLessThan(0.002);

    // Les prix, à l'échelle du BTC de ce jour-là.
    const haut = r.echelle.prixDeY(r.zone.y0);
    const bas = r.echelle.prixDeY(r.zone.y1);
    expect(haut).toBeGreaterThan(87000);
    expect(haut).toBeLessThan(87500);
    expect(bas).toBeGreaterThan(83000);
    expect(bas).toBeLessThan(83500);

    // Les bougies.
    expect(r.bougies.length).toBe(210);
    const clotures = r.bougies.map((b) => b.cloture);
    expect(Math.min(...clotures)).toBeGreaterThan(bas);
    expect(Math.max(...clotures)).toBeLessThan(haut);

    // Pas de panneau de volume sur cette capture : le détecter à tort ferait
    // plonger le plus bas des bougies de la hauteur du panneau.
    expect(r.zone.avecVolume).toBe(false);

    // La structure.
    expect(r.analyses.cassures.length).toBe(3);
    expect(r.analyses.orderBlocks.length).toBe(3);
    expect(r.analyses.orderBlocks.map((ob) => ob.sens))
      .toEqual(['haussier', 'haussier', 'baissier']);
    for (const ob of r.analyses.orderBlocks) {
      expect(ob.zone.haut).toBeGreaterThan(ob.zone.bas);
      expect(ob.zone.bas).toBeGreaterThan(bas);
      expect(ob.zone.haut).toBeLessThan(haut);
    }

    // Le bandeau, absent de CETTE capture. L'assertion n'est pas un détail :
    // c'est pourquoi la mesure s'est rangée sous « INCONNU » sur le disque de
    // l'utilisateur, et pourquoi la carte Instrument existe.
    expect(r.titre.symbole).toBeNull();
  }, 180_000);
});
