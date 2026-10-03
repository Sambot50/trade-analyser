import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';

import { enPng, depuisPng } from './png.js';

describe('depuisPng', () => {
  it('refait l’aller-retour sans perdre un octet', () => {
    const largeur = 23, hauteur = 17;   // dimensions non rondes, exprès
    const données = new Uint8ClampedArray(largeur * hauteur * 4);
    for (let i = 0; i < largeur * hauteur; i++) {
      données[i * 4] = (i * 7) % 256;
      données[i * 4 + 1] = (i * 13) % 256;
      données[i * 4 + 2] = (i * 29) % 256;
      données[i * 4 + 3] = 255;
    }
    const relu = depuisPng(enPng({ données, largeur, hauteur }));
    expect([relu.largeur, relu.hauteur]).toEqual([largeur, hauteur]);
    expect(Array.from(relu.données)).toEqual(Array.from(données));
  });

  it('refuse ce qu’il ne sait pas lire, au lieu de rendre du bruit', () => {
    expect(() => depuisPng(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/pas un PNG/);

    // Un PNG en 16 bits décodé comme du 8 bits rendrait une image plausible et
    // fausse — d'où le refus explicite plutôt qu'une lecture approximative.
    const seize = Buffer.from(enPng({ données: new Uint8ClampedArray(4), largeur: 1, hauteur: 1 }));
    seize[24] = 16;
    expect(() => depuisPng(seize)).toThrow(/16 bits/);

    const palette = Buffer.from(enPng({ données: new Uint8ClampedArray(4), largeur: 1, hauteur: 1 }));
    palette[25] = 3;
    expect(() => depuisPng(palette)).toThrow(/type couleur 3/);
  });
});
