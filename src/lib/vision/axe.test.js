import { Resvg } from '@resvg/resvg-js';
import { describe, it, expect } from 'vitest';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { priceToY } from '../analysis.js';
import { detecterPalette, bougiesDepuisImage } from './extraction.js';
import { nombreDepuisTexte, conventionTranchee, reperesDepuisEtiquettes, zoneTrace } from './axe.js';

function serie(n = 30, { volume = true } = {}) {
  const b = []; let prix = 4300;
  for (let i = 0; i < n; i++) {
    const pas = 9 * Math.sin(i / 3.1) + 5 * Math.sin(i / 7.3);
    const o = prix; const c = prix + pas;
    const a = 3 + 2 * Math.abs(Math.sin(i / 1.7));
    b.push({
      ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
      ouverture: o, cloture: c,
      plusHaut: Math.max(o, c) + a, plusBas: Math.min(o, c) - a,
      ...(volume ? { volume: 100 + i } : {}),
    });
    prix = c;
  }
  return b;
}

const rasteriser = (bougies) => {
  const { svg, echelle, avecVolume } = tracerGraphique(bougies, { libelle: 'GC', unite: '15m' });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
  return { données: r.pixels, largeur: r.width, hauteur: r.height, echelle, avecVolume };
};

describe('nombreDepuisTexte', () => {
  it('lit la convention anglo-saxonne', () => {
    expect(nombreDepuisTexte('4,440.000', 'point')).toBeCloseTo(4440, 9);
    expect(nombreDepuisTexte('4440.50', 'point')).toBeCloseTo(4440.5, 9);
    expect(nombreDepuisTexte('1,234,567.89', 'point')).toBeCloseTo(1234567.89, 9);
  });

  it('lit la convention française, espaces insécables compris', () => {
    expect(nombreDepuisTexte('4 440,00', 'virgule')).toBeCloseTo(4440, 9);
    expect(nombreDepuisTexte('1.234,56', 'virgule')).toBeCloseTo(1234.56, 9);
  });

  it('écarte les symboles et le bruit d’OCR autour du nombre', () => {
    expect(nombreDepuisTexte('$ 4,440.00', 'point')).toBeCloseTo(4440, 9);
    expect(nombreDepuisTexte('4440.00 USD', 'point')).toBeCloseTo(4440, 9);
  });

  it('refuse plutôt que de rendre un nombre douteux', () => {
    expect(nombreDepuisTexte('----', 'point')).toBeNull();
    expect(nombreDepuisTexte('', 'point')).toBeNull();
    expect(nombreDepuisTexte(null, 'point')).toBeNull();
    expect(nombreDepuisTexte('4.4.4', 'point')).toBeNull();     // deux séparateurs décimaux
  });

  it('LA MÊME chaîne vaut mille fois plus selon la convention', () => {
    // Tout le problème en une ligne. Aucune règle locale ne tranche ;
    // c'est l'alignement des repères qui le fera.
    expect(nombreDepuisTexte('4,440', 'point')).toBeCloseTo(4440, 9);
    expect(nombreDepuisTexte('4,440', 'virgule')).toBeCloseTo(4.44, 9);
  });
});

describe('conventionTranchee', () => {
  it('lit le DERNIER séparateur quand les deux sont présents', () => {
    expect(conventionTranchee([{ texte: '4,440.00' }])).toBe('point');
    expect(conventionTranchee([{ texte: '1.234,56' }])).toBe('virgule');
  });

  it('ne tranche pas sur un séparateur unique — c’est là qu’est l’ambiguïté', () => {
    expect(conventionTranchee([{ texte: '4,440' }, { texte: '4,420' }])).toBeNull();
    expect(conventionTranchee([{ texte: '4440' }])).toBeNull();
    expect(conventionTranchee([])).toBeNull();
    expect(conventionTranchee(null)).toBeNull();
  });

  it('se contente d’une seule étiquette complète pour fixer tout l’axe', () => {
    expect(conventionTranchee([{ texte: '4440' }, { texte: '4,420.00' }, { texte: '4400' }])).toBe('point');
  });
});

describe('reperesDepuisEtiquettes', () => {
  it('l’alignement SEUL ne peut pas trancher — les deux lectures sont des droites', () => {
    // Pourquoi `conventionTranchee` existe : sous 'point' ces étiquettes
    // valent 1,234 · 1,23 · 1,226, et sous 'virgule' 1234 · 1230 · 1226.
    // Les deux sont parfaitement linéaires, à un facteur mille près.
    const sansSeparateurDouble = [
      { texte: '1234', y: 100 }, { texte: '1230', y: 200 },
      { texte: '1226', y: 300 }, { texte: '1222', y: 400 },
    ];
    expect(conventionTranchee(sansSeparateurDouble)).toBeNull();
    expect(reperesDepuisEtiquettes(sansSeparateurDouble).echelle.prixDeY(100)).toBeCloseTo(1234, 3);
  });

  it('choisit la convention qui ALIGNE, sans rien supposer de la locale', () => {
    const anglo = [
      { texte: '4,440.00', y: 100 }, { texte: '4,420.00', y: 200 },
      { texte: '4,400.00', y: 300 }, { texte: '4,380.00', y: 400 },
    ];
    const r = reperesDepuisEtiquettes(anglo);
    expect(r.convention).toBe('point');
    expect(r.echelle.prixDeY(100)).toBeCloseTo(4440, 3);
  });

  it('bascule sur l’autre convention quand c’est elle qui aligne', () => {
    const francais = [
      { texte: '1.234,00', y: 100 }, { texte: '1.230,00', y: 200 },
      { texte: '1.226,00', y: 300 }, { texte: '1.222,00', y: 400 },
    ];
    const r = reperesDepuisEtiquettes(francais);
    expect(r.convention).toBe('virgule');
    expect(r.echelle.prixDeY(100)).toBeCloseTo(1234, 3);
  });

  it('REFUSE quand une étiquette est mal lue au point de casser la droite', () => {
    const abime = [
      { texte: '4440', y: 100 }, { texte: '44', y: 200 },
      { texte: '4400', y: 300 }, { texte: '4380', y: 400 },
    ];
    expect(reperesDepuisEtiquettes(abime)).toBeNull();
  });

  it('REFUSE sous trois étiquettes lisibles', () => {
    expect(reperesDepuisEtiquettes([{ texte: '4440', y: 100 }, { texte: '4420', y: 200 }])).toBeNull();
    expect(reperesDepuisEtiquettes([])).toBeNull();
    expect(reperesDepuisEtiquettes(null)).toBeNull();
  });

  it('ignore les étiquettes illisibles et conclut sur les autres', () => {
    const avecBruit = [
      { texte: '4440', y: 100 }, { texte: '~~~', y: 150 },
      { texte: '4420', y: 200 }, { texte: '4400', y: 300 }, { texte: '4380', y: 400 },
    ];
    const r = reperesDepuisEtiquettes(avecBruit);
    expect(r.reperes).toHaveLength(4);
    expect(r.echelle.prixDeY(300)).toBeCloseTo(4400, 3);
  });
});

describe('zoneTrace', () => {
  it('trouve la frontière du panneau de volume, que personne ne lui donne', () => {
    const { données, largeur, hauteur } = rasteriser(serie(30, { volume: true }));
    const z = zoneTrace(données, largeur, hauteur, detecterPalette(données, largeur, hauteur));
    expect(z.avecVolume).toBe(true);
    // Le tracé place la frontière entre 500 et 530.
    expect(z.y1).toBeGreaterThan(GEOMETRIE.basAvecVolume - 40);
    expect(z.y1).toBeLessThanOrEqual(GEOMETRIE.volumeHautY);
    expect(z.volumeY1).toBeGreaterThan(z.volumeY0);
  });

  it('ne fabrique pas de panneau de volume quand il n’y en a pas', () => {
    const { données, largeur, hauteur } = rasteriser(serie(30, { volume: false }));
    const z = zoneTrace(données, largeur, hauteur, detecterPalette(données, largeur, hauteur));
    expect(z.avecVolume).toBe(false);
    expect(z.volumeY0).toBeNull();
  });

  it('borne le tracé sur les bougies, et désigne la bande d’axe à leur droite', () => {
    const { données, largeur, hauteur } = rasteriser(serie(30));
    const z = zoneTrace(données, largeur, hauteur, detecterPalette(données, largeur, hauteur));
    expect(z.x0).toBeGreaterThanOrEqual(GEOMETRIE.gaucheX - 2);
    expect(z.x1).toBeLessThanOrEqual(GEOMETRIE.droiteX + 2);
    expect(z.axeX0).toBe(z.x1);
    expect(z.axeX1).toBe(largeur);
  });

  it('rend null sans palette', () => {
    const { données, largeur, hauteur } = rasteriser(serie(10));
    expect(zoneTrace(données, largeur, hauteur, null)).toBeNull();
  });
});

describe('chaîne complète, sans rien donner d’autre que l’image', () => {
  it('délimite, lit l’axe, et retrouve les bougies à deux pixels près', () => {
    const bougies = serie(30);
    const { données, largeur, hauteur, echelle } = rasteriser(bougies);

    // 1. La palette et la zone se déduisent de l'image seule.
    const palette = detecterPalette(données, largeur, hauteur);
    const zone = zoneTrace(données, largeur, hauteur, palette);
    expect(zone.avecVolume).toBe(true);

    // 2. Les étiquettes telles qu'un OCR les rendrait, avec la virgule des
    //    milliers — la forme exacte qui piège une lecture naïve.
    const etiquettes = [0.05, 0.35, 0.65, 0.95].map((part) => {
      const prix = echelle.priceTop - part * (echelle.priceTop - echelle.priceBottom);
      return {
        texte: prix.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        y: priceToY(prix, echelle, hauteur),
      };
    });
    expect(etiquettes[0].texte).toMatch(/,/);

    const lu = reperesDepuisEtiquettes(etiquettes);
    expect(lu.convention).toBe('point');

    // 3. Les bougies.
    const lues = bougiesDepuisImage(données, largeur, hauteur, { palette, echelle: lu.echelle, zone });
    expect(lues).toHaveLength(bougies.length);

    const etendue = echelle.priceTop - echelle.priceBottom;
    const prixParPixel = etendue / ((echelle.plotBottomRatio - echelle.plotTopRatio) * hauteur);
    for (let i = 0; i < bougies.length; i++) {
      for (const champ of ['plusHaut', 'plusBas', 'ouverture', 'cloture']) {
        expect(Math.abs(lues[i][champ] - bougies[i][champ]) / prixParPixel,
          `bougie ${i} · ${champ}`).toBeLessThan(2);
      }
    }
  });
});
