import { describe, it, expect, vi } from 'vitest';

import {
  recadrer, agrandir, luminance, binariser, preparerBande,
  etiquettesDepuisMots, lireBande, creerWorkerParDefaut, facteurTenable, avecDelai, dictionnaireServi, CARACTERES,
  motsDuResultat,
} from './ocr.js';

/** Image RGBA unie, avec de quoi peindre dessus. */
function image(largeur, hauteur, fond = [0, 0, 0]) {
  const données = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    données[i * 4] = fond[0]; données[i * 4 + 1] = fond[1];
    données[i * 4 + 2] = fond[2]; données[i * 4 + 3] = 255;
  }
  const poser = (x, y, c) => {
    const i = (y * largeur + x) * 4;
    données[i] = c[0]; données[i + 1] = c[1]; données[i + 2] = c[2];
  };
  return { données, largeur, hauteur, poser };
}
const lire = (img, x, y) => {
  const i = (y * img.largeur + x) * 4;
  return [img.données[i], img.données[i + 1], img.données[i + 2]];
};

describe('recadrer', () => {
  const img = image(10, 8, [10, 20, 30]);
  img.poser(5, 4, [200, 100, 50]);

  it('rend la zone demandée, pixels compris', () => {
    const c = recadrer(img.données, 10, 8, { x0: 4, x1: 8, y0: 2, y1: 6 });
    expect([c.largeur, c.hauteur]).toEqual([4, 4]);
    expect(lire(c, 1, 2)).toEqual([200, 100, 50]);        // (5,4) devient (1,2)
    expect(c.x0).toBe(4);
    expect(c.y0).toBe(2);
  });

  it('se borne à l’image plutôt que de déborder', () => {
    const c = recadrer(img.données, 10, 8, { x0: -5, x1: 50, y0: -2, y1: 40 });
    expect([c.largeur, c.hauteur]).toEqual([10, 8]);
  });

  it('rend null sur une zone vide ou inversée', () => {
    expect(recadrer(img.données, 10, 8, { x0: 5, x1: 5, y0: 0, y1: 8 })).toBeNull();
    expect(recadrer(img.données, 10, 8, { x0: 8, x1: 3, y0: 0, y1: 8 })).toBeNull();
  });
});

describe('agrandir', () => {
  it('multiplie la taille et RÉPLIQUE les pixels, sans lisser', () => {
    // Le lissage arrondit les bords d'un caractère : c'est exactement ce que
    // l'OCR confond. On veut des marches nettes.
    const img = image(2, 2, [0, 0, 0]);
    img.poser(1, 0, [255, 255, 255]);
    const g = agrandir(img, 3);
    expect([g.largeur, g.hauteur]).toEqual([6, 6]);
    for (const [x, y] of [[3, 0], [4, 1], [5, 2]]) expect(lire(g, x, y)).toEqual([255, 255, 255]);
    for (const [x, y] of [[2, 0], [0, 0], [3, 3]]) expect(lire(g, x, y)).toEqual([0, 0, 0]);
    expect(g.facteur).toBe(3);
  });

  it('ne touche à rien au facteur 1', () => {
    const img = image(3, 3, [7, 7, 7]);
    expect(agrandir(img, 1)).toBe(img);
  });
});

describe('luminance et binarisation', () => {
  it('pèse le vert plus que le bleu', () => {
    expect(luminance([0, 255, 0])).toBeGreaterThan(luminance([0, 0, 255]));
    expect(luminance([255, 255, 255])).toBeCloseTo(255, 3);
    expect(luminance([0, 0, 0])).toBe(0);
  });

  it('INVERSE un thème sombre : le texte clair devient noir, le fond blanc', () => {
    // Tesseract attend du noir sur blanc. Une capture TradingView sombre
    // porte l'inverse, et le lui donner tel quel ne rend rien.
    const img = image(20, 10, [11, 17, 32]);
    for (let x = 4; x < 9; x++) img.poser(x, 5, [200, 210, 220]);
    const b = binariser(img);
    expect(b.fondClair).toBe(false);
    expect(lire(b, 6, 5)).toEqual([0, 0, 0]);
    expect(lire(b, 0, 0)).toEqual([255, 255, 255]);
  });

  it('laisse un thème clair dans le bon sens', () => {
    const img = image(20, 10, [245, 245, 245]);
    for (let x = 4; x < 9; x++) img.poser(x, 5, [30, 30, 30]);
    const b = binariser(img);
    expect(b.fondClair).toBe(true);
    expect(lire(b, 6, 5)).toEqual([0, 0, 0]);
    expect(lire(b, 0, 0)).toEqual([255, 255, 255]);
  });

  it('ne rend que du noir ou du blanc', () => {
    const img = image(12, 12, [90, 120, 150]);
    for (let x = 0; x < 12; x++) img.poser(x, x, [250, 250, 250]);
    const b = binariser(img);
    for (let i = 0; i < 12 * 12; i++) expect([0, 255]).toContain(b.données[i * 4]);
  });
});

describe('preparerBande', () => {
  it('enchaîne découpe, agrandissement et binarisation', () => {
    const img = image(40, 20, [11, 17, 32]);
    for (let x = 32; x < 36; x++) img.poser(x, 10, [200, 200, 200]);
    const p = preparerBande(img.données, 40, 20, { x0: 30, x1: 40, y0: 0, y1: 20 }, { facteur: 4 });
    expect([p.largeur, p.hauteur]).toEqual([40, 80]);
    expect(p.facteur).toBe(4);
    expect(p.fondClair).toBe(false);
  });

  it('rend null si la bande est vide', () => {
    const img = image(10, 10);
    expect(preparerBande(img.données, 10, 10, { x0: 5, x1: 5, y0: 0, y1: 10 })).toBeNull();
  });
});

describe('etiquettesDepuisMots', () => {
  // LE test de ce fichier. L'OCR rend des ordonnées dans l'image recadrée ET
  // agrandie. Les reporter telles quelles décalerait toute l'échelle sans
  // qu'aucune erreur ne se déclenche, et chaque prix de la série serait faux.
  const mots = [
    { text: '4440.00', confidence: 92, bbox: { x0: 10, y0: 60, x1: 90, y1: 90 } },
    { text: '4420.00', confidence: 88, bbox: { x0: 10, y0: 360, x1: 90, y1: 390 } },
  ];

  it('reporte le centre vertical dans l’image D’ORIGINE', () => {
    // Bande découpée à y0 = 40, agrandie ×3. Un mot centré sur y = 75 dans
    // l'image préparée est à 40 + 75/3 = 65 dans l'image de départ.
    const e = etiquettesDepuisMots(mots, { y0: 40, facteur: 3 });
    expect(e[0]).toMatchObject({ texte: '4440.00', confiance: 92 });
    expect(e[0].y).toBeCloseTo(65, 9);
    expect(e[1].y).toBeCloseTo(165, 9);
  });

  it('sans décalage ni agrandissement, les ordonnées ne bougent pas', () => {
    expect(etiquettesDepuisMots(mots, {})[0].y).toBeCloseTo(75, 9);
  });

  it('écarte les mots peu sûrs, vides ou sans boîte', () => {
    const sales = [
      { text: '4440', confidence: 20, bbox: { y0: 0, y1: 10 } },
      { text: '   ', confidence: 99, bbox: { y0: 0, y1: 10 } },
      { text: '4420', confidence: 99, bbox: {} },
      { text: '4400', confidence: 99, bbox: { y0: 20, y1: 30 } },
    ];
    const e = etiquettesDepuisMots(sales, {});
    expect(e).toHaveLength(1);
    expect(e[0].texte).toBe('4400');
  });

  it('ne bronche pas sans mots', () => {
    expect(etiquettesDepuisMots(null, {})).toEqual([]);
    expect(etiquettesDepuisMots([], {})).toEqual([]);
  });
});

describe('creerWorkerParDefaut', () => {
  it('sert les TROIS fichiers en local quand ils y sont', async () => {
    // Le dictionnaire seul ne suffisait pas : le cœur WebAssembly et le script
    // de worker partaient encore sur le CDN, et c'est le cœur le plus lourd.
    const charger = vi.fn().mockResolvedValue('worker');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await creerWorkerParDefaut({ cheminLangue: '/tesseract', charger, fetcher });
    expect(charger).toHaveBeenCalledWith('eng', undefined, {
      langPath: '/tesseract',
      corePath: '/tesseract',
      workerPath: '/tesseract/worker.min.js',
    });
  });

  it('prend ce qui est servi et laisse le reste au CDN', async () => {
    // Un dossier à moitié rempli vaut mieux qu'un dossier refusé en bloc.
    const charger = vi.fn().mockResolvedValue('worker');
    const fetcher = vi.fn(async (url) => ({ ok: url.endsWith('.traineddata.gz') }));
    await creerWorkerParDefaut({ cheminLangue: '/tesseract', charger, fetcher });
    expect(charger).toHaveBeenCalledWith('eng', undefined, { langPath: '/tesseract' });
  });

  it('accepte des chemins distincts pour le cœur et le worker', async () => {
    const charger = vi.fn().mockResolvedValue('worker');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await creerWorkerParDefaut({
      cheminLangue: '/dico', cheminCoeur: '/wasm', cheminWorker: '/js/w.js',
      charger, fetcher,
    });
    expect(charger).toHaveBeenCalledWith('eng', undefined, {
      langPath: '/dico', corePath: '/wasm', workerPath: '/js/w.js',
    });
  });

  it('retombe sur le CDN quand RIEN n’est servi, sans attendre le moteur', async () => {
    const charger = vi.fn().mockResolvedValue('worker');
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    expect(await creerWorkerParDefaut({ cheminLangue: '/tesseract', charger, fetcher })).toBe('worker');
    expect(charger).toHaveBeenCalledTimes(1);
    expect(charger).toHaveBeenCalledWith('eng');
  });

  it('RETOMBE sur la source par défaut si le local est servi mais inutilisable', async () => {
    const charger = vi.fn()
      .mockRejectedValueOnce(new Error('archive corrompue'))
      .mockResolvedValueOnce('worker');
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    expect(await creerWorkerParDefaut({ cheminLangue: '/tesseract', charger, fetcher })).toBe('worker');
    expect(charger).toHaveBeenCalledTimes(2);
    expect(charger).toHaveBeenLastCalledWith('eng');
  });

  it('n’essaie pas le local quand aucun chemin n’est donné', async () => {
    const charger = vi.fn().mockResolvedValue('worker');
    await creerWorkerParDefaut({ charger });
    expect(charger).toHaveBeenCalledTimes(1);
    expect(charger).toHaveBeenCalledWith('eng');
  });
});

describe('lireBande', () => {
  it('n’offre au moteur que les caractères d’une graduation', () => {
    expect(CARACTERES).toBe('0123456789.,');
  });

  it('prépare, règle le moteur, et reporte les ordonnées', async () => {
    const img = image(60, 40, [11, 17, 32]);
    for (let x = 42; x < 50; x++) img.poser(x, 20, [200, 200, 200]);

    const setParameters = vi.fn();
    const terminate = vi.fn();
    const recognize = vi.fn().mockResolvedValue({
      data: { words: [{ text: '4440.00', confidence: 95, bbox: { x0: 0, y0: 54, x1: 40, y1: 66 } }] },
    });
    const creerWorker = vi.fn().mockResolvedValue({ setParameters, recognize, terminate });

    const e = await lireBande(img.données, 60, 40, { x0: 40, x1: 60, y0: 10, y1: 40 }, { facteur: 3, creerWorker });

    expect(setParameters).toHaveBeenCalledWith(expect.objectContaining({
      tessedit_char_whitelist: CARACTERES,
    }));
    // Boîte centrée sur 60 dans l'image ×3, bande partant de y = 10 : 10 + 20.
    expect(e).toEqual([{ texte: '4440.00', y: 30, confiance: 95 }]);
    expect(terminate).toHaveBeenCalled();
  });

  it('arrête le moteur même quand la lecture échoue', async () => {
    const img = image(60, 40, [11, 17, 32]);
    const terminate = vi.fn();
    const creerWorker = vi.fn().mockResolvedValue({
      setParameters: vi.fn(),
      recognize: vi.fn().mockRejectedValue(new Error('moteur absent')),
      terminate,
    });
    await expect(lireBande(img.données, 60, 40, { x0: 40, x1: 60, y0: 0, y1: 40 }, { creerWorker }))
      .rejects.toThrow('moteur absent');
    expect(terminate).toHaveBeenCalled();
  });

  it('rend null sans appeler le moteur si la bande est vide', async () => {
    const img = image(10, 10);
    const creerWorker = vi.fn();
    expect(await lireBande(img.données, 10, 10, { x0: 5, x1: 5, y0: 0, y1: 10 }, { creerWorker })).toBeNull();
    expect(creerWorker).not.toHaveBeenCalled();
  });
});

// ── La chaîne, sur une vraie image, avec un moteur simulé ────────────────────
//
// Les tests ci-dessus vérifient chaque pièce sur des images fabriquées à la
// main. Celui-ci fait passer la VRAIE géométrie d'un graphique rendu par le
// découpage, l'agrandissement et le report d'ordonnées — c'est là qu'un
// décalage d'un facteur se verrait, et nulle part ailleurs.

import { Resvg } from '@resvg/resvg-js';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { priceToY } from '../analysis.js';
import { detecterPalette } from './extraction.js';
import { zoneTrace, reperesDepuisEtiquettes } from './axe.js';
import { enPng } from './png.js';

describe('la chaîne sur une image réelle, moteur simulé', () => {
  const bougies = Array.from({ length: 30 }, (_, i) => {
    const o = 4300 + i * 2;
    const c = o + 9 * Math.sin(i / 3.1);
    return {
      ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
      ouverture: o, cloture: c,
      plusHaut: Math.max(o, c) + 4, plusBas: Math.min(o, c) - 4, volume: 100 + i,
    };
  });

  it('reporte les ordonnées de l’OCR aux bons pixels de l’image de départ', async () => {
    const { svg, echelle } = tracerGraphique(bougies, { libelle: 'GC', unite: '15m' });
    const r = new Resvg(svg, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
    const zone = zoneTrace(r.pixels, r.width, r.height, detecterPalette(r.pixels, r.width, r.height));
    const bande = { x0: zone.axeX0, x1: zone.axeX1, y0: zone.y0, y1: zone.y1 };
    const facteur = 4;

    // Quatre prix dont on connaît le pixel exact dans l'image d'origine.
    const attendus = [0.1, 0.4, 0.7, 0.9].map((part) => {
      const prix = echelle.priceTop - part * (echelle.priceTop - echelle.priceBottom);
      return { prix, y: priceToY(prix, echelle, r.height) };
    });

    // Le moteur simulé rend ces mêmes prix, mais placés comme Tesseract les
    // placerait : dans l'image recadrée PUIS agrandie.
    const creerWorker = async () => ({
      setParameters: async () => {},
      recognize: async () => ({
        data: {
          words: attendus.map(({ prix, y }) => {
            const yPrepare = (y - bande.y0) * facteur;
            return {
              text: prix.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              confidence: 94,
              bbox: { x0: 10, y0: yPrepare - 6, x1: 90, y1: yPrepare + 6 },
            };
          }),
        },
      }),
      terminate: async () => {},
    });

    const etiquettes = await lireBande(r.pixels, r.width, r.height, bande, { facteur, creerWorker, enImage: enPng });
    expect(etiquettes).toHaveLength(4);
    for (let i = 0; i < 4; i++) expect(etiquettes[i].y).toBeCloseTo(attendus[i].y, 6);

    // Et l'échelle reconstruite retombe sur celle du tracé.
    const lu = reperesDepuisEtiquettes(etiquettes);
    expect(lu.convention).toBe('point');
    for (const { prix, y } of attendus) expect(lu.echelle.prixDeY(y)).toBeCloseTo(prix, 2);
  });
});

describe('facteurTenable', () => {
  // Agrandir ×4 une bande large d'une capture plein écran produirait des
  // dizaines de millions de pixels : l'OCR y passerait des minutes pour lire
  // les mêmes chiffres.
  it('garde le facteur demandé sur une bande étroite', () => {
    expect(facteurTenable(120, 600, 4)).toBe(4);
  });

  it('le réduit plutôt que de laisser l’image exploser', () => {
    expect(facteurTenable(900, 900, 4, 2400)).toBe(2);
    expect(facteurTenable(1800, 1000, 4, 2400)).toBe(1);
  });

  it('ne descend jamais sous 1', () => {
    expect(facteurTenable(5000, 5000, 4, 2400)).toBe(1);
    expect(facteurTenable(0, 0, 4)).toBe(1);
  });

  it('preparerBande applique le plafond', () => {
    const d = new Uint8ClampedArray(1000 * 1000 * 4).fill(40);
    const p = preparerBande(d, 1000, 1000, { x0: 0, x1: 1000, y0: 0, y1: 1000 }, { facteur: 4, coteMax: 2000 });
    expect(Math.max(p.largeur, p.hauteur)).toBeLessThanOrEqual(2000);
  });
});

describe('avecDelai', () => {
  it('laisse passer une promesse qui aboutit', async () => {
    await expect(avecDelai(Promise.resolve('ok'), 1000, 'trop long')).resolves.toBe('ok');
  });

  it('REND LA MAIN sur une promesse qui n’aboutit jamais', async () => {
    // Le défaut qui figeait l'écran : un worker dont le dictionnaire ne se
    // charge pas n'échoue pas, il attend. Le `finally` n'était jamais atteint.
    await expect(avecDelai(new Promise(() => {}), 20, 'délai dépassé')).rejects.toThrow('délai dépassé');
  });

  it('sans délai, se contente de la promesse', async () => {
    await expect(avecDelai(Promise.resolve(1), 0, 'x')).resolves.toBe(1);
  });
});

describe('dictionnaireServi', () => {
  it('ne prétend pas servir ce qui répond 404', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    expect(await dictionnaireServi('/tesseract', 'eng', { fetcher })).toBe(false);
  });

  it('confirme un dictionnaire réellement servi', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    expect(await dictionnaireServi('/tesseract', 'eng', { fetcher })).toBe(true);
    expect(fetcher).toHaveBeenCalledWith('/tesseract/eng.traineddata.gz', { method: 'HEAD' });
  });

  it('ne reste pas suspendu si la requête n’aboutit pas', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    expect(await dictionnaireServi('/tesseract', 'eng', { fetcher, delaiMs: 20 })).toBe(false);
  });

  it('rend faux sans chemin', async () => {
    expect(await dictionnaireServi(null)).toBe(false);
  });
});

// ── Les mots, là où le moteur les range vraiment ─────────────────────────────

describe('motsDuResultat', () => {
  it('lit la forme imbriquée de tesseract.js 7', () => {
    // C'est LE défaut qui rendait l'axe muet : le moteur lisait
    // « 4440 4420 4400 4380 » sans faute, `data.words` restait vide, et
    // aucune étiquette ne sortait. Rien dans les tests ne le voyait.
    const data = {
      text: '4440\n4420\n',
      words: [],
      blocks: [{
        paragraphs: [{
          lines: [
            { words: [{ text: '4440', confidence: 94, bbox: { y0: 148, y1: 192 } }] },
            { words: [{ text: '4420', confidence: 95, bbox: { y0: 600, y1: 644 } }] },
          ],
        }],
      }],
    };
    expect(motsDuResultat(data).map((m) => m.text)).toEqual(['4440', '4420']);
  });

  it('préfère la forme à plat quand elle est renseignée', () => {
    const data = { words: [{ text: 'plat' }], blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'imbriqué' }] }] }] }] };
    expect(motsDuResultat(data).map((m) => m.text)).toEqual(['plat']);
  });

  it('ne bronche pas sur un résultat creux ou tronqué', () => {
    expect(motsDuResultat(null)).toEqual([]);
    expect(motsDuResultat({})).toEqual([]);
    expect(motsDuResultat({ words: [], blocks: [] })).toEqual([]);
    expect(motsDuResultat({ blocks: [{}, { paragraphs: [{}, { lines: [{}] }] }] })).toEqual([]);
  });
});

describe('lireBande demande les boîtes englobantes', () => {
  it('passe { blocks: true } au moteur, sans quoi il ne rend que du texte', async () => {
    const recognize = vi.fn().mockResolvedValue({
      data: { blocks: [{ paragraphs: [{ lines: [{ words: [{ text: '4440', confidence: 90, bbox: { y0: 0, y1: 8 } }] }] }] }] },
    });
    const worker = { setParameters: vi.fn(), recognize, terminate: vi.fn() };
    const données = new Uint8ClampedArray(4 * 10 * 10).fill(255);
    const lues = await lireBande(données, 10, 10, { x0: 0, y0: 0, x1: 10, y1: 10 }, {
      facteur: 1, creerWorker: () => worker,
    });
    expect(recognize).toHaveBeenCalledWith(expect.anything(), {}, { blocks: true });
    expect(lues.map((e) => e.texte)).toEqual(['4440']);
  });
});
