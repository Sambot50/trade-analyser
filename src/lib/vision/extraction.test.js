import { Resvg } from '@resvg/resvg-js';
import { describe, it, expect } from 'vitest';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { priceToY } from '../analysis.js';
import {
  saturation, chroma, teinte, ecartTeinte, ecartCouleur, detecterPalette, colonnesDeBougies,
  bougieDeColonnes, echelleDepuisReperes, bougiesDepuisImage,
} from './extraction.js';

/** Une série déterministe, ni plate ni monotone, aux corps et mèches variés. */
function serie(n = 24) {
  const b = [];
  let prix = 4300;
  for (let i = 0; i < n; i++) {
    const pas = 7 * Math.sin(i / 2.3) + 4 * Math.sin(i / 5.1);
    const ouverture = prix;
    const cloture = prix + pas;
    const amplitude = 3 + 2 * Math.abs(Math.sin(i / 1.7));
    b.push({
      ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
      ouverture, cloture,
      plusHaut: Math.max(ouverture, cloture) + amplitude,
      plusBas: Math.min(ouverture, cloture) - amplitude,
      volume: 100 + i,
    });
    prix = cloture;
  }
  return b;
}

/** Trace, rasterise, et rend les pixels RGBA. */
function rasteriser(bougies) {
  const { svg, echelle, avecVolume } = tracerGraphique(bougies, { libelle: 'ESSAI', unite: '15m' });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
  const img = png.asPng();
  // `pixels` du rendu resvg est déjà du RGBA à plat.
  const brut = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
  // La zone des PRIX s'arrête au-dessus du panneau de volume. L'y inclure
  // ferait avaler à chaque bougie sa propre barre de volume, et son plus bas
  // plongerait de cent cinquante pixels.
  const zone = {
    x0: GEOMETRIE.gaucheX, x1: GEOMETRIE.droiteX, y0: GEOMETRIE.hautY,
    y1: avecVolume ? GEOMETRIE.basAvecVolume : GEOMETRIE.basSansVolume,
  };
  return { données: brut.pixels, largeur: brut.width, hauteur: brut.height, echelle, zone, avecVolume, png: img };
}

describe('chroma et écart de couleur', () => {
  it('sépare une bougie du décor là où la saturation HSV échoue', () => {
    // Le piège : le fond bleu nuit a une saturation de 0,66, plus forte que
    // bien des gris. Son chroma, lui, le range avec le décor.
    expect(saturation([11, 17, 32])).toBeGreaterThan(0.6);       // fond #0B1120
    expect(chroma([11, 17, 32])).toBeLessThan(40);
    expect(chroma([16, 185, 129])).toBeGreaterThan(150);         // hausse #10B981
    expect(chroma([239, 68, 68])).toBeGreaterThan(150);          // baisse #EF4444
    expect(chroma([30, 41, 59])).toBeLessThan(40);               // grille
    expect(chroma([148, 163, 184])).toBeLessThan(40);            // texte
  });

  it('mesure l’écart canal par canal', () => {
    expect(ecartCouleur([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(ecartCouleur([0, 0, 0], [1, 2, 3])).toBe(6);
  });
});

describe('échelle depuis des repères', () => {
  const droits = [{ prix: 100, y: 10 }, { prix: 90, y: 20 }, { prix: 80, y: 30 }, { prix: 70, y: 40 }];

  it('retrouve la droite prix ↔ pixel', () => {
    const e = echelleDepuisReperes(droits);
    expect(e.prixDeY(10)).toBeCloseTo(100, 6);
    expect(e.prixDeY(25)).toBeCloseTo(85, 6);
    expect(e.n).toBe(4);
  });

  it('REFUSE deux repères — aucune incohérence n’y serait détectable', () => {
    expect(echelleDepuisReperes(droits.slice(0, 2))).toBeNull();
  });

  it('REFUSE un repère mal lu : 4 440 compris 4.440 casse l’alignement', () => {
    const faussés = [{ prix: 4440, y: 10 }, { prix: 4.44, y: 20 }, { prix: 4420, y: 30 }, { prix: 4410, y: 40 }];
    expect(echelleDepuisReperes(faussés)).toBeNull();
  });

  it('REFUSE un axe non linéaire, donc logarithmique', () => {
    const log = [10, 20, 30, 40].map((y) => ({ y, prix: 1000 / (y * y) }));
    expect(echelleDepuisReperes(log)).toBeNull();
  });

  it('REFUSE un axe qui monte vers le bas', () => {
    expect(echelleDepuisReperes(droits.map((p) => ({ ...p, prix: -p.prix })))).toBeNull();
  });

  it('tolère un léger bruit de lecture sans céder', () => {
    const bruités = [{ prix: 100, y: 10 }, { prix: 90.1, y: 20 }, { prix: 79.9, y: 30 }, { prix: 70, y: 40 }];
    expect(echelleDepuisReperes(bruités)).not.toBeNull();
  });
});

describe('aller-retour : tracer puis ré-extraire', () => {
  const bougies = serie(24);
  const { données, largeur, hauteur, echelle, zone } = rasteriser(bougies);

  it('relève les deux couleurs de bougie sur l’image, sans les supposer', () => {
    const p = detecterPalette(données, largeur, hauteur);
    expect(p).not.toBeNull();
    expect(ecartCouleur(p.hausse, [16, 185, 129])).toBeLessThan(60);   // #10B981
    expect(ecartCouleur(p.baisse, [239, 68, 68])).toBeLessThan(60);    // #EF4444
    expect(chroma(p.fond)).toBeLessThan(40);
  });

  it('retrouve EXACTEMENT autant de bougies qu’il en a été tracé', () => {
    const p = detecterPalette(données, largeur, hauteur);
    const groupes = colonnesDeBougies(données, largeur, hauteur, p, zone);
    expect(groupes).toHaveLength(bougies.length);
  });

  it('retrouve le sens de chaque bougie', () => {
    const p = detecterPalette(données, largeur, hauteur);
    const groupes = colonnesDeBougies(données, largeur, hauteur, p, zone);
    const lus = groupes.map((g) => bougieDeColonnes(g).hausse);
    expect(lus).toEqual(bougies.map((b) => b.cloture >= b.ouverture));
  });

  it('retrouve les PRIX à moins de deux pixels — la limite physique du support', () => {
    // Le repère est construit comme le ferait une lecture d'axe réussie :
    // quatre graduations et leur pixel, passées par la même projection que le
    // tracé. C'est l'échelle que l'OCR devra produire.
    const reperes = [0, 0.3, 0.6, 0.95].map((part) => {
      const prix = echelle.priceTop - part * (echelle.priceTop - echelle.priceBottom);
      return { prix, y: priceToY(prix, echelle, hauteur) };
    });
    const e = echelleDepuisReperes(reperes);
    expect(e).not.toBeNull();

    const lues = bougiesDepuisImage(données, largeur, hauteur, { echelle: e, zone });
    expect(lues).toHaveLength(bougies.length);

    // L'erreur se juge en PIXELS, pas en pour-mille : une image ne porte pas
    // plus de précision que son quadrillage. Un trait de mèche fait 1,5 px et
    // l'anticrénelage en étale les bords ; exiger mieux que deux pixels
    // reviendrait à tester le hasard de l'arrondi.
    const etendue = echelle.priceTop - echelle.priceBottom;
    const hauteurTrace = (echelle.plotBottomRatio - echelle.plotTopRatio) * hauteur;
    const prixParPixel = etendue / hauteurTrace;

    for (let i = 0; i < bougies.length; i++) {
      for (const champ of ['plusHaut', 'plusBas', 'ouverture', 'cloture']) {
        const enPixels = Math.abs(lues[i][champ] - bougies[i][champ]) / prixParPixel;
        expect(enPixels, `bougie ${i} · ${champ} : lu ${lues[i][champ].toFixed(2)} contre ${bougies[i][champ].toFixed(2)}`)
          .toBeLessThan(2);
      }
    }
  });

  it('avale la barre de volume si on lui donne la mauvaise zone', () => {
    // Ce que coûte une frontière mal posée : le plus bas plonge de cent
    // cinquante pixels. L'appli devra détecter cette frontière sur une
    // capture réelle, où personne ne la lui donnera.
    const p = detecterPalette(données, largeur, hauteur);
    const trop = colonnesDeBougies(données, largeur, hauteur, p, { ...zone, y1: GEOMETRIE.volumeBasY });
    const juste = colonnesDeBougies(données, largeur, hauteur, p, zone);
    expect(bougieDeColonnes(trop[0]).basMèche - bougieDeColonnes(juste[0]).basMèche).toBeGreaterThan(100);
  });

  it('refuse de rendre une série sans échelle', () => {
    expect(bougiesDepuisImage(données, largeur, hauteur, { echelle: null })).toBeNull();
  });
});

describe('teinte', () => {
  it('survit au mélange avec le fond, là où la distance RVB explose', () => {
    const vert = [16, 185, 129];
    const melange = [13, 67, 50];                  // le même vert à ~30 % sur fond sombre
    expect(ecartCouleur(melange, vert)).toBeGreaterThan(150);
    expect(ecartTeinte(teinte(melange), teinte(vert))).toBeLessThan(10);
  });

  it('sépare franchement la hausse de la baisse', () => {
    expect(ecartTeinte(teinte([16, 185, 129]), teinte([239, 68, 68]))).toBeGreaterThan(100);
  });

  it('rend null sur un gris, et 180 d’écart face à lui', () => {
    expect(teinte([40, 40, 40])).toBeNull();
    expect(ecartTeinte(null, 160)).toBe(180);
  });
});

describe('bougieDeColonnes', () => {
  it('accepte une bougie d’une seule colonne — un doji n’a que sa mèche', () => {
    const b = bougieDeColonnes([{ x: 7, haut: 10, bas: 80, n: 70, nHausse: 70 }]);
    expect(b).not.toBeNull();
    expect(b.hautMèche).toBe(10);
    expect(b.basMèche).toBe(80);
    expect(b.hausse).toBe(true);
  });

  it('refuse un groupe vide', () => {
    expect(bougieDeColonnes([])).toBeNull();
    expect(bougieDeColonnes(null)).toBeNull();
  });
});
