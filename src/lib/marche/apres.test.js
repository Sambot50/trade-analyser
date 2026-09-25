import { describe, it, expect } from 'vitest';
import { comportementApres, atteintAvantDePerdre } from './apres.js';

const b = (i, { o = 2000, h = 2010, l = 1990, c = 2005 } = {}) => ({
  ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
  ouverture: o, plusHaut: h, plusBas: l, cloture: c, volume: 100,
});
/** Ancre acheteuse de hauteur 20, clôture à 2005, suivie de `suite`. */
const avecSuite = (...suite) => [b(0), ...suite.map((s, i) => b(i + 1, s))];

describe('comportement après une anomalie', () => {
  it('mesure la faveur dans le sens du volume, pas du marché', () => {
    const monte = avecSuite({ h: 2045, l: 2005, c: 2040 });
    // Ancre acheteuse, hauteur 20, clôture 2005 : +40 vers le haut = 2 R.
    expect(comportementApres(monte, 0, 1).faveurEnR).toBe(2);

    // La même hausse, mais après une ancre VENDEUSE : c'est à l'encontre.
    const ancreVendeuse = [{ ...b(0), ouverture: 2008, cloture: 2005 }, b(1, { h: 2045, l: 2005, c: 2040 })];
    expect(comportementApres(ancreVendeuse, 0, 1).contreEnR).toBe(2);
    expect(comportementApres(ancreVendeuse, 0, 1).sens).toBe('vente');
  });

  it('exprime tout en multiples de la hauteur du bloc', () => {
    const r = comportementApres(avecSuite({ h: 2025, l: 1985, c: 2020 }), 0, 1);
    expect(r.hauteur).toBe(20);
    expect(r.faveurEnR).toBe(1);   // +20 depuis 2005
    expect(r.contreEnR).toBe(1);   // −20 depuis 2005
  });

  /**
   * Le défaut trouvé en lisant la première sortie : sans exiger un départ,
   * la bougie suivante chevauche presque toujours la précédente — le prix
   * étant continu — et le « retour » se produisait dans 100 % des cas au bout
   * d'une bougie. Ça ne mesurait rien.
   */
  it('ne compte un retour qu’après une sortie franche de la zone', () => {
    const colle = avecSuite({ h: 2012, l: 1995, c: 2008 }, { h: 2011, l: 1998, c: 2006 });
    const r = colle && comportementApres(colle, 0, 2);
    expect(r.sortiDeLaZone).toBe(false);
    expect(r.retourDansLaZone).toBeNull();
  });

  it('compte le retour quand le prix est vraiment parti puis revenu', () => {
    const partiEtRevenu = avecSuite(
      { h: 2050, l: 2030, c: 2045 },   // entièrement au-dessus du bloc
      { h: 2040, l: 2020, c: 2030 },   // toujours au-dessus
      { h: 2015, l: 1995, c: 2000 },   // de retour dans le bloc
    );
    const r = comportementApres(partiEtRevenu, 0, 3);
    expect(r.sortiDeLaZone).toBe(true);
    expect(r.retourDansLaZone).toBe(3);
  });

  it('retient le délai de l’amplitude maximale', () => {
    const r = comportementApres(avecSuite(
      { h: 2015, l: 2000, c: 2010 },
      { h: 2065, l: 2010, c: 2060 },
      { h: 2030, l: 2020, c: 2025 },
    ), 0, 3);
    expect(r.bougiesFaveurMax).toBe(2);
  });

  it('refuse un horizon tronqué plutôt que de sous-estimer l’amplitude', () => {
    expect(comportementApres(avecSuite({ h: 2020, l: 2000, c: 2015 }), 0, 50)).toBeNull();
  });

  it('refuse une ancre plate, qui n’a ni sens ni hauteur', () => {
    const plate = [{ ...b(0), ouverture: 2005, cloture: 2005 }, b(1)];
    expect(comportementApres(plate, 0, 1)).toBeNull();
  });
});

describe('objectif atteint avant le stop', () => {
  it('rend « atteint » quand la faveur arrive la première', () => {
    expect(atteintAvantDePerdre(avecSuite(
      { h: 2010, l: 2000, c: 2008 },
      { h: 2050, l: 2005, c: 2048 },
    ), 0, 2, 2)).toBe('atteint');
  });

  it('rend « perdu » quand le stop arrive le premier', () => {
    expect(atteintAvantDePerdre(avecSuite(
      { h: 2010, l: 1960, c: 1962 },
      { h: 2050, l: 1960, c: 2048 },
    ), 0, 2, 2)).toBe('perdu');
  });

  /**
   * Une bougie qui touche les deux ne dit pas dans quel ordre. Deviner
   * flatterait la mesure — c'est la leçon de DEC-015, qui avait fabriqué
   * +0,330 R à partir de rien.
   */
  it('rend « ambigu » quand une bougie touche les deux', () => {
    expect(atteintAvantDePerdre(avecSuite({ h: 2050, l: 1960, c: 2000 }), 0, 1, 2)).toBe('ambigu');
  });

  it('rend « ni l’un ni l’autre » quand rien n’est atteint', () => {
    expect(atteintAvantDePerdre(avecSuite({ h: 2010, l: 2000, c: 2005 }), 0, 1, 2))
      .toBe('ni_lun_ni_lautre');
  });
});

// ERRATUM-001. Le nom `atteintAvantDePerdre` ne dit pas ce que « perdre »
// vaut, et personne n'est allé voir : trois documents gelés ont annoncé un
// stop à 1R pendant que le code en appliquait un à 3R. Rien ne rougissait,
// rien ne plantait, et le résultat paraissait normal.
//
// Ces tests rendent la symétrie EXPLICITE. Si quelqu'un rend la mesure
// asymétrique — ce qui serait un changement légitime, mais un changement —
// il devra les modifier, et la modification se verra dans le diff.
describe('la mesure est SYMÉTRIQUE (ERRATUM-001)', () => {
  // Bougie d'ancrage : ouverture 100, clôture 110, haut 112, bas 98.
  // Hauteur = 14, donc 1R = 14 et 3R = 42. Entrée à la clôture, 110.
  const ancre = { ouverture: 100, plusHaut: 112, plusBas: 98, cloture: 110 };
  const plat = (prix) => ({ ouverture: prix, plusHaut: prix, plusBas: prix, cloture: prix });
  const serie = (...suite) => [ancre, ...suite, ...Array(20).fill(plat(110))];

  it('ne rend PAS « perdu » à −1R : le stop est à −3R', () => {
    // 110 − 14 = 96. Sous un stop à 1R ce serait perdu ; il ne l'est pas.
    expect(atteintAvantDePerdre(serie(plat(96)), 0, 10, 3)).toBe('ni_lun_ni_lautre');
  });

  it('rend « perdu » à −3R', () => {
    // 110 − 42 = 68.
    expect(atteintAvantDePerdre(serie(plat(68)), 0, 10, 3)).toBe('perdu');
  });

  it('rend « atteint » à +3R', () => {
    // 110 + 42 = 152.
    expect(atteintAvantDePerdre(serie(plat(152)), 0, 10, 3)).toBe('atteint');
  });

  it('applique la MÊME distance des deux côtés, quel que soit le multiple', () => {
    for (const multiple of [1, 1.5, 2, 3]) {
      const cible = multiple * 14;
      const juste = 0.01;
      // Juste en deçà de la cible : ni l'un ni l'autre, des deux côtés.
      expect(atteintAvantDePerdre(serie(plat(110 + cible - juste)), 0, 10, multiple)).toBe('ni_lun_ni_lautre');
      expect(atteintAvantDePerdre(serie(plat(110 - cible + juste)), 0, 10, multiple)).toBe('ni_lun_ni_lautre');
      // Juste au-delà : atteint d'un côté, perdu de l'autre.
      expect(atteintAvantDePerdre(serie(plat(110 + cible + juste)), 0, 10, multiple)).toBe('atteint');
      expect(atteintAvantDePerdre(serie(plat(110 - cible - juste)), 0, 10, multiple)).toBe('perdu');
    }
  });

  it('le miroir donne le verdict miroir — la preuve exacte de la symétrie', () => {
    // Une marche aléatoire maison aurait été plus parlante, mais un générateur
    // congruentiel écrit à la main dérive : le mien donnait une moyenne de
    // 0,4952 au lieu de 0,5, soit −8,6 de biais sur trois cents pas, assez
    // pour fausser un problème de barrières à ±42. La symétrie se prouve
    // mieux sans hasard du tout.
    //
    // Une série et son reflet autour du prix d'entrée doivent rendre des
    // verdicts inversés. C'est vrai si et seulement si la même distance
    // s'applique des deux côtés.
    const plat = (prix) => ({ ouverture: prix, plusHaut: prix, plusBas: prix, cloture: prix });
    const remplissage = Array(20).fill(plat(110));

    for (const ecart of [10, 30, 42, 60]) {
      const monte = [ancre, plat(110 + ecart), ...remplissage];
      const descend = [ancre, plat(110 - ecart), ...remplissage];
      const haut = atteintAvantDePerdre(monte, 0, 10, 3);
      const bas = atteintAvantDePerdre(descend, 0, 10, 3);

      if (haut === 'atteint') expect(bas).toBe('perdu');
      else if (haut === 'perdu') expect(bas).toBe('atteint');
      else expect(bas).toBe(haut);
    }
  });

  it('le miroir vaut aussi pour une bougie d’ancrage vendeuse', () => {
    const vendeuse = { ouverture: 110, plusHaut: 112, plusBas: 98, cloture: 100 };
    const plat = (prix) => ({ ouverture: prix, plusHaut: prix, plusBas: prix, cloture: prix });
    const suite = Array(20).fill(plat(100));
    // Vente à 100, hauteur 14, cible 42 : le gain est vers le bas.
    expect(atteintAvantDePerdre([vendeuse, plat(100 - 43), ...suite], 0, 10, 3)).toBe('atteint');
    expect(atteintAvantDePerdre([vendeuse, plat(100 + 43), ...suite], 0, 10, 3)).toBe('perdu');
  });
});
