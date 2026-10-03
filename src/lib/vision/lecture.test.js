import { Resvg } from '@resvg/resvg-js';
import { describe, it, expect } from 'vitest';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { priceToY } from '../analysis.js';
import { lireGraphique, analyser } from './lecture.js';

function serie(n = 60) {
  const b = []; let prix = 4300;
  for (let i = 0; i < n; i++) {
    const pas = 9 * Math.sin(i / 3.1) + 5 * Math.sin(i / 7.3) + 3 * Math.sin(i / 1.9);
    const o = prix; const c = prix + pas;
    const a = 3 + 2 * Math.abs(Math.sin(i / 1.7));
    b.push({
      ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
      ouverture: o, cloture: c,
      plusHaut: Math.max(o, c) + a, plusBas: Math.min(o, c) - a,
      volume: Math.round(80 + 60 * Math.abs(Math.sin(i / 4.1)) ** 3),
    });
    prix = c;
  }
  return b;
}

function rendre(bougies) {
  const { svg, echelle } = tracerGraphique(bougies, { libelle: 'GC', unite: '15m' });
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
  return { données: r.pixels, largeur: r.width, hauteur: r.height, echelle };
}

/** Les graduations telles qu'un OCR réussi les rendrait. */
const etiquettesDe = (echelle, hauteur, parts = [0.05, 0.35, 0.65, 0.95]) =>
  parts.map((part) => {
    const prix = echelle.priceTop - part * (echelle.priceTop - echelle.priceBottom);
    return {
      texte: prix.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      y: priceToY(prix, echelle, hauteur),
    };
  });

describe('lireGraphique — la chaîne complète', () => {
  const bougies = serie(60);
  const { données, largeur, hauteur, echelle } = rendre(bougies);
  const etiquettes = etiquettesDe(echelle, hauteur);

  it('va de l’image aux figures en une passe', async () => {
    const r = await lireGraphique(données, largeur, hauteur, { etiquettes });
    expect(r.ok).toBe(true);
    expect(r.bougies).toHaveLength(bougies.length);
    expect(r.convention).toBe('point');
    expect(r.zone.avecVolume).toBe(true);
  });

  it('retrouve les figures que le dépôt sait déjà reconnaître', async () => {
    const r = await lireGraphique(données, largeur, hauteur, { etiquettes, fenetre: 3 });
    expect(r.analyses.assezDeBougies).toBe(true);
    expect(r.analyses.cassures.length).toBeGreaterThan(0);
    expect(r.analyses.orderBlocks.length).toBeGreaterThan(0);
    const ob = r.analyses.orderBlocks[0];
    expect(ob.qualificatifs).toHaveProperty('priseDeLiquidite');
    expect(ob.qualificatifs).toHaveProperty('fvg');
    expect(ob.qualificatifs.premiumDiscount).toHaveProperty('position');
  });

  it('retrouve les prix à moins de deux pixels, bout en bout', async () => {
    const r = await lireGraphique(données, largeur, hauteur, { etiquettes });
    const ppp = (echelle.priceTop - echelle.priceBottom)
      / ((echelle.plotBottomRatio - echelle.plotTopRatio) * hauteur);
    for (let i = 0; i < bougies.length; i++) {
      for (const champ of ['plusHaut', 'plusBas', 'ouverture', 'cloture']) {
        expect(Math.abs(r.bougies[i][champ] - bougies[i][champ]) / ppp,
          `bougie ${i} · ${champ}`).toBeLessThan(2);
      }
    }
  });
});

describe('lireGraphique — ce qu’il dit quand ça échoue', () => {
  // Un échec rendu comme un simple null laisserait l'utilisateur devant un
  // écran vide. « L'axe n'a pas pu être lu » et « aucune bougie trouvée »
  // demandent deux gestes opposés.
  const { données, largeur, hauteur, echelle } = rendre(serie(40));

  it('nomme l’étape « palette » sur une image sans bougies', async () => {
    const uni = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < 100 * 100; i++) {
      uni[i * 4] = 20; uni[i * 4 + 1] = 22; uni[i * 4 + 2] = 26; uni[i * 4 + 3] = 255;
    }
    const r = await lireGraphique(uni, 100, 100, { etiquettes: [] });
    expect(r.ok).toBe(false);
    expect(r.etape).toBe('palette');
    expect(r.probleme).toMatch(/chandeliers/);
  });

  it('nomme l’étape « echelle » sous trois graduations, et rend ce qu’il a déjà', async () => {
    const r = await lireGraphique(données, largeur, hauteur, {
      etiquettes: etiquettesDe(echelle, hauteur, [0.1, 0.8]),
    });
    expect(r.ok).toBe(false);
    expect(r.etape).toBe('echelle');
    expect(r.probleme).toMatch(/trois graduations/);
    expect(r.zone).toBeDefined();          // le travail déjà fait n'est pas perdu
    expect(r.palette).toBeDefined();
  });

  it('nomme l’étape « echelle » quand les graduations ne forment pas une droite', async () => {
    const r = await lireGraphique(données, largeur, hauteur, {
      etiquettes: [
        { texte: '4440', y: 100 }, { texte: '44', y: 200 },
        { texte: '4400', y: 300 }, { texte: '4380', y: 400 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.etape).toBe('echelle');
    expect(r.probleme).toMatch(/droite/);
  });
});

describe('analyser', () => {
  it('refuse de conclure sur une série trop courte plutôt que de lever', () => {
    const a = analyser(serie(4), { fenetre: 5 });
    expect(a.assezDeBougies).toBe(false);
    expect(a.orderBlocks).toEqual([]);
  });

  it('isole un qualificatif qui casse au lieu de perdre tous les autres', () => {
    // Les séries reconstruites depuis une image ne portent pas de volume ;
    // un qualificatif qui s'y briserait ne doit pas vider l'écran.
    const a = analyser(serie(60).map((b) => ({ ...b, volume: null })), { fenetre: 3 });
    expect(a.assezDeBougies).toBe(true);
    for (const ob of a.orderBlocks) expect(ob.qualificatifs).toBeTypeOf('object');
  });
});
