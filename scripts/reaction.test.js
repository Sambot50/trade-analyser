import { describe, expect, it } from 'vitest';
import { continueOuRevient, estReaction, resumer, validerOptions } from './reaction.mjs';

const b = (ouverture, cloture) => ({
  ouverture, cloture,
  plusHaut: Math.max(ouverture, cloture) + 1,
  plusBas: Math.min(ouverture, cloture) - 1,
  volume: 1000,
});
// Les mesures que `scorerSegment` attache à la bougie PRÉCÉDENTE.
const m = (partDuCorps, ratioAmplitude, ratioVolume) => ({ partDuCorps, ratioAmplitude, ratioVolume });

const SEUILS = { seuilCorps: 2, seuilVolume: 2 };

describe('estReaction', () => {
  it('reconnaît une bougie inverse démesurée à gros volume', () => {
    // Précédente verte, corps 0,8 × amplitude 4× médiane = 3,2× ; volume 5×.
    // Bougie jugée rouge. C'est la forme vue sur 2024-05-03 et 2023-11-03.
    expect(estReaction(b(100, 95), b(80, 100), m(0.8, 4, 5), SEUILS)).toBe(true);
  });

  it('refuse quand la précédente va dans le MÊME sens', () => {
    expect(estReaction(b(100, 105), b(80, 100), m(0.8, 4, 5), SEUILS)).toBe(false);
  });

  it('refuse quand la précédente est grande mais sans volume', () => {
    expect(estReaction(b(100, 95), b(80, 100), m(0.8, 4, 1.1), SEUILS)).toBe(false);
  });

  it('refuse quand la précédente a du volume mais un petit corps', () => {
    // Beaucoup d'échanges, le prix ne bouge pas : c'est de l'absorption, pas
    // le mouvement démesuré que l'hypothèse vise.
    expect(estReaction(b(100, 95), b(80, 81), m(0.1, 1.2, 8), SEUILS)).toBe(false);
  });

  it('refuse une bougie précédente plate, sans direction', () => {
    expect(estReaction(b(100, 95), b(80, 80), m(0.8, 4, 5), SEUILS)).toBe(false);
  });

  it('refuse quand la bougie jugée est elle-même plate', () => {
    expect(estReaction(b(100, 100), b(80, 100), m(0.8, 4, 5), SEUILS)).toBe(false);
  });

  it('refuse sans bougie précédente — début de segment', () => {
    expect(estReaction(b(100, 95), null, null, SEUILS)).toBe(false);
    expect(estReaction(b(100, 95), b(80, 100), null, SEUILS)).toBe(false);
  });

  it('suit les seuils qu’on lui donne', () => {
    const cas = [b(100, 95), b(80, 100), m(0.8, 2.5, 2.5)];   // corps 2,0× · volume 2,5×
    expect(estReaction(...cas, { seuilCorps: 2, seuilVolume: 2 })).toBe(true);
    expect(estReaction(...cas, { seuilCorps: 3, seuilVolume: 2 })).toBe(false);
    expect(estReaction(...cas, { seuilCorps: 2, seuilVolume: 3 })).toBe(false);
  });
});

describe('continueOuRevient', () => {
  const serie = [b(100, 110), b(110, 112), b(112, 118)];

  it('dit que ça continue quand le prix finit plus haut après une bougie verte', () => {
    expect(continueOuRevient(serie, 0, 2).continue).toBe(true);
  });

  it('dit que ça revient quand le prix finit plus bas après une bougie verte', () => {
    const baisse = [b(100, 110), b(110, 105), b(105, 102)];
    expect(continueOuRevient(baisse, 0, 2).continue).toBe(false);
  });

  it('compte dans le SENS de la bougie, pas en absolu', () => {
    // Bougie rouge suivie d'une baisse : le mouvement continue.
    const rouge = [b(110, 100), b(100, 98), b(98, 95)];
    expect(continueOuRevient(rouge, 0, 2).continue).toBe(true);
  });

  it('rend null quand l’horizon dépasse la série', () => {
    expect(continueOuRevient(serie, 0, 99)).toBeNull();
  });
});

describe('resumer', () => {
  const cas = (c, ordre) => ({ suite: { continue: c, net: c ? 1 : -1 }, ordre });

  it('compte la part qui continue et la part qui atteint 3R', () => {
    const r = resumer([cas(true, 'atteint'), cas(true, 'perdu'), cas(false, 'perdu'), cas(false, 'atteint')]);
    expect(r.n).toBe(4);
    expect(r.partContinue).toBe(50);
    expect(r.part3R).toBe(50);
  });

  it('écarte les verdicts ambigus du dénominateur de 3R', () => {
    const r = resumer([cas(true, 'atteint'), cas(true, 'ambigu')]);
    expect(r.n3R).toBe(1);
    expect(r.part3R).toBe(100);
  });

  it('rend null sur un groupe vide', () => expect(resumer([])).toBeNull());
});

describe('validerOptions', () => {
  it('exige un fichier', () => expect(validerOptions({}).erreurs).toBeTruthy());
  it('travaille en 15 minutes par défaut', () => expect(validerOptions({ csv: 'x' }).ut).toBe('15m'));
});
