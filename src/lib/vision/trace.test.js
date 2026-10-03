import { describe, it, expect } from 'vitest';

import { rectangleDeLOrderBlock, rectanglesDesOrderBlocks, etiquetteDuRectangle } from './trace.js';

// Échelle : 4400 en haut (y = 0), 4300 en bas (y = 500). 0,2 prix par pixel.
const echelle = { yDePrix: (p) => (4400 - p) * 5, prixDeY: (y) => 4400 - y / 5 };
const bougies = Array.from({ length: 50 }, (_, i) => ({ centreX: 20 + i * 10, largeur: 6 }));

describe('rectangleDeLOrderBlock', () => {
  const ob = { index: 10, sens: 'haussier', zone: { bas: 4340, haut: 4360, hauteur: 20 } };

  it('reporte la zone de prix aux bonnes ordonnées', () => {
    const r = rectangleDeLOrderBlock(ob, bougies, echelle, 800);
    expect(r.y).toBeCloseTo(200, 6);          // 4360 → (4400−4360)×5
    expect(r.hauteur).toBeCloseTo(100, 6);    // jusqu'à 4340 → 300
  });

  it('part de la bougie d’ancrage et court jusqu’au bord droit', () => {
    const r = rectangleDeLOrderBlock(ob, bougies, echelle, 800);
    expect(r.x).toBeCloseTo(117, 6);          // centre 120, moins la demi-largeur
    expect(r.x + r.largeur).toBeCloseTo(800, 6);
  });

  it('garde de quoi relire la zone sans l’image', () => {
    const r = rectangleDeLOrderBlock(ob, bougies, echelle, 800);
    expect(r).toMatchObject({ index: 10, sens: 'haussier', prixHaut: 4360, prixBas: 4340 });
  });

  it('refuse plutôt que de placer une zone au hasard', () => {
    expect(rectangleDeLOrderBlock(ob, bougies, { prixDeY: () => 1 }, 800)).toBeNull();
    expect(rectangleDeLOrderBlock(ob, [], echelle, 800)).toBeNull();
    expect(rectangleDeLOrderBlock({ index: 10 }, bougies, echelle, 800)).toBeNull();
    expect(rectangleDeLOrderBlock(null, bougies, echelle, 800)).toBeNull();
  });

  it('ne déborde pas à gauche quand la bougie touche le bord', () => {
    const r = rectangleDeLOrderBlock({ ...ob, index: 0 }, [{ centreX: 1, largeur: 6 }], echelle, 800);
    expect(r.x).toBe(0);
  });
});

describe('rectanglesDesOrderBlocks', () => {
  const lecture = {
    ok: true, bougies, echelle,
    analyses: {
      orderBlocks: [
        { index: 30, sens: 'baissier', zone: { bas: 4310, haut: 4320, hauteur: 10 } },
        { index: 10, sens: 'haussier', zone: { bas: 4340, haut: 4360, hauteur: 20 } },
      ],
    },
  };

  it('rend les zones dans l’ordre des bougies', () => {
    expect(rectanglesDesOrderBlocks(lecture, 800).map((r) => r.index)).toEqual([10, 30]);
  });

  it('rend un tableau vide plutôt que null — l’appelant dessine en boucle', () => {
    expect(rectanglesDesOrderBlocks(null, 800)).toEqual([]);
    expect(rectanglesDesOrderBlocks({ ok: false }, 800)).toEqual([]);
    expect(rectanglesDesOrderBlocks({ ok: true, analyses: { orderBlocks: [] } }, 800)).toEqual([]);
  });

  it('écarte en silence une zone impossible à placer, sans perdre les autres', () => {
    const abime = { ...lecture, analyses: { orderBlocks: [...lecture.analyses.orderBlocks, { index: 999, zone: { bas: 1, haut: 2 } }] } };
    expect(rectanglesDesOrderBlocks(abime, 800)).toHaveLength(2);
  });
});

describe('etiquetteDuRectangle', () => {
  it('nomme le sens et les qualificatifs trouvés', () => {
    expect(etiquetteDuRectangle({
      sens: 'haussier',
      qualificatifs: { priseDeLiquidite: {}, fvg: {}, premiumDiscount: { ote: true } },
    })).toBe('OB ↑ · liquidité · FVG · OTE');
  });

  it('se contente du sens quand rien n’est qualifié', () => {
    expect(etiquetteDuRectangle({ sens: 'baissier', qualificatifs: {} })).toBe('OB ↓');
    expect(etiquetteDuRectangle({})).toBe('OB');
  });

  it('n’annonce pas l’OTE quand la zone ne l’est pas', () => {
    expect(etiquetteDuRectangle({ sens: 'haussier', qualificatifs: { premiumDiscount: { ote: false } } }))
      .toBe('OB ↑');
  });
});
