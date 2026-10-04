import { describe, it, expect } from 'vitest';

import {
  estMarteau, estMarteauInverse, estDoji, estEnglobante, estInsideBar,
  figuresDe, mesurable, PART_CORPS_PETIT, PART_CORPS_DOJI,
} from './figures.js';

/** Une bougie décrite par ses quatre prix, dans l'ordre naturel de lecture. */
const b = (ouverture, plusHaut, plusBas, cloture, ms = 0) =>
  ({ ouverture, plusHaut, plusBas, cloture, ouvertureMs: ms });

describe('mesurable', () => {
  it('refuse ce qui n’a pas quatre prix finis', () => {
    expect(mesurable(b(10, 12, 9, 11))).toBe(true);
    expect(mesurable({ ouverture: 10, plusHaut: NaN, plusBas: 9, cloture: 11 })).toBe(false);
    expect(mesurable(null)).toBe(false);
  });

  it('refuse une bougie PLATE', () => {
    // Amplitude nulle : toutes les proportions deviendraient des divisions par
    // zéro, et chaque test répondrait « oui » par accident.
    expect(mesurable(b(10, 10, 10, 10))).toBe(false);
  });
});

describe('estMarteau', () => {
  it('reconnaît un petit corps haut perché sur une longue mèche basse', () => {
    expect(estMarteau(b(108, 110, 100, 109))).toBe(true);
  });

  it('se moque de la COULEUR du corps', () => {
    // La même forme s'appelle marteau en bas d'une baisse et pendu en haut
    // d'une hausse. La forme ne dit rien du sens ; le contexte le dira.
    expect(estMarteau(b(109, 110, 100, 108))).toBe(true);
  });

  it('refuse un gros corps, même avec une mèche basse', () => {
    expect(estMarteau(b(110, 111, 100, 102))).toBe(false);
  });

  it('refuse quand la mèche HAUTE dépasse le corps', () => {
    // Sinon un toupie — mèches des deux côtés — passerait pour un marteau.
    expect(estMarteau(b(105, 110, 100, 106))).toBe(false);
  });

  it('exige une mèche basse d’au moins la moitié de l’amplitude', () => {
    // Un corps minuscule au milieu de l'amplitude n'est pas un marteau : sans
    // ce plancher, deux mèches courtes et un corps nul suffiraient.
    expect(estMarteau(b(105, 110, 100, 105.2))).toBe(false);
  });

  it('reconnaît le marteau inversé, et ne confond pas les deux', () => {
    const inverse = b(101, 110, 100, 102);
    expect(estMarteauInverse(inverse)).toBe(true);
    expect(estMarteau(inverse)).toBe(false);
  });
});

describe('estDoji', () => {
  it('reconnaît une ouverture et une clôture qui se rejoignent', () => {
    expect(estDoji(b(105, 110, 100, 105.5))).toBe(true);
    expect(estDoji(b(105, 110, 100, 108))).toBe(false);
  });

  it('juge en PROPORTION de l’amplitude, pas en absolu', () => {
    // Un corps d'un point est un doji sur une bougie de cent points et une
    // bougie pleine sur une bougie de deux. Un seuil absolu dépendrait du prix
    // de l'instrument.
    expect(estDoji(b(1000, 1100, 1000, 1005))).toBe(true);
    expect(estDoji(b(1000, 1002, 1000, 1001.5))).toBe(false);
    expect(PART_CORPS_DOJI).toBeLessThan(PART_CORPS_PETIT);
  });
});

describe('estEnglobante', () => {
  it('exige que le CORPS recouvre le corps, et des couleurs opposées', () => {
    expect(estEnglobante(b(105, 106, 103, 104), b(103, 108, 102, 107))).toBe(true);
  });

  it('refuse deux bougies de même couleur', () => {
    expect(estEnglobante(b(103, 106, 102, 105), b(104, 110, 103, 109))).toBe(false);
  });

  it('refuse une bougie qui déborde par ses MÈCHES seulement', () => {
    // L'usage dit « englobe la précédente », mais une bougie dont les mèches
    // dépassent sans que son corps recouvre quoi que ce soit n'a rien englobé :
    // elle a été volatile. Le corps est ce qui a été accepté.
    const precedente = b(104, 106, 103, 106);
    const suivante = b(105.5, 112, 98, 104.5);
    expect(suivante.plusHaut).toBeGreaterThan(precedente.plusHaut);
    expect(suivante.plusBas).toBeLessThan(precedente.plusBas);
    expect(estEnglobante(precedente, suivante)).toBe(false);
  });

  it('refuse un corps égal ou plus petit', () => {
    expect(estEnglobante(b(103, 108, 102, 107), b(107, 108, 103, 103))).toBe(false);
  });
});

describe('estInsideBar', () => {
  it('juge sur les AMPLITUDES, mèches comprises', () => {
    // Ce qui fait une inside bar, c'est que le prix n'est allé nulle part où
    // il n'était pas déjà allé. Les mèches bornent le terrain.
    expect(estInsideBar(b(100, 110, 90, 105), b(102, 108, 95, 103))).toBe(true);
    expect(estInsideBar(b(100, 110, 90, 105), b(102, 111, 95, 103))).toBe(false);
    expect(estInsideBar(b(100, 110, 90, 105), b(102, 108, 89, 103))).toBe(false);
  });

  it('accepte les bornes ÉGALES', () => {
    expect(estInsideBar(b(100, 110, 90, 105), b(102, 110, 90, 103))).toBe(true);
  });
});

describe('figuresDe', () => {
  const serie = [
    b(100, 102, 99, 101, 1000),          // 0 — ordinaire
    b(108, 110, 100, 109, 2000),         // 1 — marteau
    b(105, 110, 100, 105.5, 3000),       // 2 — doji
    b(105, 106, 103, 104, 4000),         // 3 — ordinaire
    b(103, 108, 102, 107, 5000),         // 4 — englobante de la 3
  ];

  it('rend chaque figure au format des trouvailles', () => {
    const f = figuresDe(serie);
    const marteau = f.find((x) => x.type === 'marteau');
    expect(marteau).toMatchObject({ index: 1, ms: 2000, sens: null });
    expect(marteau.zone).toEqual({ haut: 110, bas: 100 });
  });

  it('donne un sens à l’englobante, et pas au marteau', () => {
    // Une englobante a une couleur, donc une direction. Un marteau n'en a pas :
    // la même forme est haussière ou baissière selon où elle tombe.
    const f = figuresDe(serie);
    expect(f.find((x) => x.type === 'englobante')).toMatchObject({ index: 4, sens: 'haussier' });
    expect(f.find((x) => x.type === 'marteau').sens).toBeNull();
  });

  it('ne cherche pas de figure à deux bougies sur la première', () => {
    expect(figuresDe([serie[4]]).every((x) => x.index === 0 && !['englobante', 'inside_bar'].includes(x.type))).toBe(true);
  });

  it('laisse une bougie porter PLUSIEURS figures', () => {
    // Un doji peut être une inside bar. Les rendre exclusives ferait perdre
    // l'une des deux sans qu'on sache laquelle.
    const f = figuresDe([b(100, 120, 80, 110), b(105, 110, 90, 105.5)]);
    const types = f.filter((x) => x.index === 1).map((x) => x.type).sort();
    expect(types).toContain('doji');
    expect(types).toContain('inside_bar');
  });

  it('saute les bougies inexploitables sans s’arrêter', () => {
    const f = figuresDe([b(10, 10, 10, 10), null, serie[1]]);
    expect([...new Set(f.map((x) => x.index))]).toEqual([2]);
    expect(f.length).toBeGreaterThan(0);
  });

  it('un marteau à corps minuscule est AUSSI un doji, et c’est exact', () => {
    // Les deux descriptions sont vraies : la forme est un marteau, le corps
    // est un doji. Les rendre exclusives obligerait à décider arbitrairement
    // laquelle efface l'autre, et ferait disparaître une information.
    const types = figuresDe([b(108, 110, 100, 109)]).map((x) => x.type).sort();
    expect(types).toEqual(['doji', 'marteau']);
  });

  it('ne bronche pas sur une entrée qui n’est pas une série', () => {
    expect(figuresDe(null)).toEqual([]);
    expect(figuresDe([])).toEqual([]);
  });
});
