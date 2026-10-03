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
    //
    // Le compte était figé à 210 — un nombre qui venait de la sortie du code,
    // pas d'un comptage. Il valait donc exactement ce que valait le code, et
    // il a laissé passer le défaut ci-dessous sans broncher. 214 est le compte
    // obtenu une fois les bougies séparées de la ligne du prix courant.
    expect(r.bougies.length).toBe(214);
    const clotures = r.bougies.map((b) => b.cloture);
    expect(Math.min(...clotures)).toBeGreaterThan(bas);
    expect(Math.max(...clotures)).toBeLessThan(haut);

    // CE QUI AURAIT DÛ ÊTRE VÉRIFIÉ DEPUIS LE DÉBUT.
    //
    // Un compte exact ne dit rien de la justesse des bougies comptées. La
    // ligne pointillée du prix courant posait un pixel isolé dans une colonne
    // vide ; cette colonne rejoignait la bougie voisine et sa mèche s'étirait
    // jusqu'au trait. Une bougie en est sortie avec quinze points de corps et
    // mille cinq cent quatre-vingt-douze de mèche, et l'order block bâti
    // dessus couvrait quarante pour cent du graphique.
    //
    // Rien ne le signalait : la bougie restait une bougie, ses quatre prix
    // restaient ordonnés. Seule la DISTRIBUTION le trahit.
    const etendue = haut - bas;
    const amplitudes = r.bougies.map((b) => b.plusHaut - b.plusBas).sort((x, y) => x - y);
    const q = (f) => amplitudes[Math.floor(f * (amplitudes.length - 1))];

    // Une bougie sur dix dépassait le tiers du graphique entier. C'est le
    // chiffre qui dénonce, et il est passé de 33 % à moins de 10 %.
    expect(q(0.9) / etendue).toBeLessThan(0.15);
    expect(q(0.5) / etendue).toBeLessThan(0.06);
    // Une seule bougie peut légitimement être énorme — la chute de ce
    // graphique en est une. Deux tiers du tracé reste au-delà du plausible.
    expect(q(1) / etendue).toBeLessThan(0.4);

    // Pas de panneau de volume sur cette capture : le détecter à tort ferait
    // plonger le plus bas des bougies de la hauteur du panneau.
    expect(r.zone.avecVolume).toBe(false);

    // La structure.
    expect(r.analyses.cassures.length).toBeGreaterThanOrEqual(3);
    expect(r.analyses.orderBlocks.length).toBeGreaterThanOrEqual(3);
    for (const ob of r.analyses.orderBlocks) {
      expect(ob.zone.haut).toBeGreaterThan(ob.zone.bas);
      expect(ob.zone.bas).toBeGreaterThan(bas);
      expect(ob.zone.haut).toBeLessThan(haut);

      // Un order block est la zone d'UNE bougie. Au-delà d'un cinquième du
      // graphique, ce n'est plus une zone d'entrée : c'est un pan du
      // graphique, et le plan bâti dessus porte un risque qui n'a aucun
      // rapport avec celui qu'on croit prendre.
      expect((ob.zone.haut - ob.zone.bas) / etendue, `OB #${ob.index}`).toBeLessThan(0.2);
    }

    // Le bandeau, absent de CETTE capture. L'assertion n'est pas un détail :
    // c'est pourquoi la mesure s'est rangée sous « INCONNU » sur le disque de
    // l'utilisateur, et pourquoi la carte Instrument existe.
    expect(r.titre.symbole).toBeNull();
  }, 180_000);
});
