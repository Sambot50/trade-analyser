import { describe, expect, it } from 'vitest';
import { pearson, rangs, significativite, spearman } from './correlation.js';

describe('rangs', () => {
  it('range du plus petit au plus grand', () => {
    expect(rangs([30, 10, 20])).toEqual([3, 1, 2]);
  });

  it('partage les ex æquo au lieu de les départager arbitrairement', () => {
    // Les volumes ont beaucoup de paliers ; départager au hasard créerait
    // une corrélation là où il n'y a qu'un ordre d'arrivée.
    expect(rangs([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(rangs([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe('pearson', () => {
  it('vaut 1 sur une relation linéaire croissante', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 9);
  });

  it('vaut −1 sur une relation linéaire décroissante', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 9);
  });

  it('rend null quand une série est constante — aucune variance à corréler', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('rend null sur trop peu de points', () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
});

describe('spearman', () => {
  it('vaut 1 sur une relation monotone NON linéaire, là où Pearson faiblit', () => {
    // C'est toute la raison de son emploi ici : le volume a une queue lourde,
    // et la question posée est « quand il monte, le mouvement monte-t-il »,
    // pas « la relation est-elle une droite ».
    const xs = [1, 2, 3, 4]; const ys = [1, 4, 9, 16];
    expect(spearman(xs, ys)).toBeCloseTo(1, 9);
    expect(pearson(xs, ys)).toBeLessThan(1);
  });

  it('résiste à une valeur extrême qui détourne Pearson', () => {
    const xs = [1, 2, 3, 4, 5, 1000];
    const ys = [5, 4, 3, 2, 1, 1000];
    // Les cinq premiers points descendent ; le sixième, énorme, tire Pearson
    // vers +1 à lui seul. Spearman ne voit qu'un rang de plus.
    expect(pearson(xs, ys)).toBeGreaterThan(0.9);
    expect(spearman(xs, ys)).toBeLessThan(pearson(xs, ys));
  });
});

describe('significativité', () => {
  it('rétrécit le seuil de bruit à mesure que l’échantillon grandit', () => {
    expect(significativite(0.1, 100).seuilBruit).toBeGreaterThan(significativite(0.1, 50000).seuilBruit);
  });

  it('montre que sur 50 000 points presque tout dépasse le bruit', () => {
    // D'où la règle de lecture du script : c'est l'AMPLEUR qui compte, pas
    // la significativité. Un r de 0,02 sur 50 000 points est certain et sans
    // le moindre intérêt.
    expect(significativite(0.02, 50000).seuilBruit).toBeLessThan(0.02);
  });

  it('rend null sans échantillon exploitable', () => {
    expect(significativite(0.5, 3)).toBeNull();
    expect(significativite(null, 1000)).toBeNull();
  });
});
