import { describe, it, expect } from 'vitest';
import { pivots, cassures, tendanceAuFilDuTemps, tendanceA, HAUSSIER, BAISSIER, INDETERMINE } from './structure.js';
import { normaliser, dureeUnite, nombreDeRequetes, UNITES } from './bougies.js';
import { orderBlockDe, detecter, anomalieVolume, MARGE_STOP } from './orderblocks.js';
import { intervalleWilson, conclusionPossible, esperanceEnR } from './statistiques.js';

/** Bougie compacte : ouverture, haut, bas, clôture, volume, volume acheteur. */
const b = (o, h, l, c, v = 100, va = 50) => ({
  ouvertureMs: 0, ouverture: o, plusHaut: h, plusBas: l, cloture: c,
  volume: v, volumeAcheteur: va, volumeVendeur: v - va, delta: va - (v - va), nombreTrades: 10,
});
const serie = (...bs) => bs.map((x, i) => ({ ...x, ouvertureMs: i * 60000 }));
const plat = (prix, n) => Array.from({ length: n }, () => b(prix, prix + 1, prix - 1, prix));

describe('pivots', () => {
  it('trouve un sommet net', () => {
    const s = serie(...plat(100, 3), b(100, 120, 99, 110), ...plat(100, 3));
    const { hauts } = pivots(s, 3);
    expect(hauts).toHaveLength(1);
    expect(hauts[0].index).toBe(3);
    expect(hauts[0].prix).toBe(120);
  });

  it('trouve un creux net', () => {
    const s = serie(...plat(100, 3), b(100, 101, 80, 90), ...plat(100, 3));
    const { bas } = pivots(s, 3);
    expect(bas).toHaveLength(1);
    expect(bas[0].prix).toBe(80);
  });

  it('ignore un plateau : trois sommets identiques ne font aucun pivot', () => {
    const s = serie(...plat(100, 2), b(100, 120, 99, 110), b(100, 120, 99, 110), b(100, 120, 99, 110), ...plat(100, 2));
    expect(pivots(s, 2).hauts).toHaveLength(0);
  });

  it('ne peut rien détecter dans les bords de la fenêtre', () => {
    const s = serie(b(100, 200, 99, 150), ...plat(100, 5));
    expect(pivots(s, 3).hauts).toHaveLength(0);
  });

  it('refuse une fenêtre nulle', () => {
    expect(() => pivots(serie(...plat(100, 5)), 0)).toThrow(/au moins 1/);
  });
});

describe('cassures', () => {
  it('ne casse pas sur une mèche, seulement sur clôture', () => {
    // pivot haut à 120, puis une bougie dont la mèche monte à 130 mais clôture à 110
    const s = serie(...plat(100, 3), b(100, 120, 99, 110), ...plat(100, 3), b(105, 130, 104, 110));
    expect(cassures(s, 3)).toHaveLength(0);
  });

  it('casse sur clôture au-delà du pivot', () => {
    const s = serie(...plat(100, 3), b(100, 120, 99, 110), ...plat(100, 3), b(105, 130, 104, 125));
    const e = cassures(s, 3);
    expect(e).toHaveLength(1);
    expect(e[0].sens).toBe(HAUSSIER);
    expect(e[0].prixCasse).toBe(120);
  });

  it('n’utilise pas un pivot avant sa confirmation — pas de lecture du futur', () => {
    // La clôture dépasse le sommet AVANT que le pivot soit confirmé (fenêtre 3).
    const s = serie(...plat(100, 3), b(100, 120, 99, 110), b(110, 125, 109, 124), ...plat(100, 4));
    // À l'index 4 le pivot de l'index 3 n'est pas encore confirmé : aucune cassure.
    expect(cassures(s, 3).filter((e) => e.index === 4)).toHaveLength(0);
  });

  it('distingue BOS et CHoCH', () => {
    const s = serie(
      ...plat(100, 3), b(100, 120, 99, 110), ...plat(100, 3), b(105, 130, 104, 125), // cassure haussière : BOS
      ...plat(125, 3), b(125, 126, 105, 108), ...plat(120, 3), b(110, 111, 100, 102), // cassure baissière : CHoCH
    );
    const e = cassures(s, 3);
    expect(e[0].type).toBe('BOS');
    expect(e[0].tendanceAvant).toBe(INDETERMINE);
    const retournement = e.find((x) => x.sens === BAISSIER);
    expect(retournement?.type).toBe('CHoCH');
    expect(retournement?.tendanceAvant).toBe(HAUSSIER);
  });
});

describe('tendanceA', () => {
  const s = tendanceAuFilDuTemps([{ ms: 1000, sens: HAUSSIER }, { ms: 5000, sens: BAISSIER }]);

  it('renvoie indéterminé avant toute cassure', () => {
    expect(tendanceA(s, 500)).toBe(INDETERMINE);
  });
  it('renvoie la tendance en vigueur', () => {
    expect(tendanceA(s, 3000)).toBe(HAUSSIER);
    expect(tendanceA(s, 9000)).toBe(BAISSIER);
  });
  it('prend la cassure exactement à son horodatage', () => {
    expect(tendanceA(s, 5000)).toBe(BAISSIER);
  });
});

describe('orderBlockDe', () => {
  const s = serie(
    ...plat(100, 3),
    b(100, 120, 99, 110),          // 3 : pivot haut
    ...plat(100, 3),               // 4-6
    b(104, 105, 95, 96),           // 7 : dernière baissière avant l'impulsion
    b(96, 130, 96, 125),           // 8 : impulsion qui casse
  );
  const cassure = cassures(s, 3)[0];

  it('retient la dernière bougie de couleur opposée avant l’impulsion', () => {
    const ob = orderBlockDe(s, cassure);
    expect(ob.index).toBe(7);
    expect(ob.zone).toEqual({ bas: 95, haut: 105, hauteur: 10 });
  });

  it('pose l’entrée au bord proximal et le stop au-delà, avec marge', () => {
    const { plan } = orderBlockDe(s, cassure);
    expect(plan.direction).toBe('BUY');
    expect(plan.prixEntree).toBe(105);
    expect(plan.prixStopLoss).toBe(95 - 10 * MARGE_STOP);
    expect(plan.risque).toBe(11);
  });

  it('pose les objectifs à 1 R et 2 R', () => {
    const { plan } = orderBlockDe(s, cassure);
    expect(plan.prixTp1).toBe(105 + 11);
    expect(plan.prixTp2).toBe(105 + 22);
  });

  it('produit un plan cohérent avec sa direction', () => {
    const { plan } = orderBlockDe(s, cassure);
    expect(plan.prixStopLoss).toBeLessThan(plan.prixEntree);
    expect(plan.prixEntree).toBeLessThan(plan.prixTp1);
    expect(plan.prixTp1).toBeLessThan(plan.prixTp2);
  });

  it('n’invente rien quand aucune bougie opposée n’existe', () => {
    const impulsion = serie(...plat(100, 3), b(100, 120, 99, 110), ...plat(100, 3), b(110, 130, 110, 125));
    const c = { ...cassures(impulsion, 3)[0], indexOrigine: 7 };
    expect(orderBlockDe(impulsion, c)).toBeNull();
  });
});

describe('anomalieVolume', () => {
  it('chiffre un volume exceptionnel en écarts-types', () => {
    // Volumes variés en amont : l'écart-type existe, la mesure a un sens.
    const s = serie(
      ...Array.from({ length: 20 }, (_, i) => b(100, 101, 99, 100, 90 + (i % 5) * 5, 50)),
      b(100, 101, 99, 100, 400, 50),
    );
    const a = anomalieVolume(s, 20, 20);
    expect(a.ecartsTypes).toBeGreaterThan(3);
    expect(a.volumeRapporteALaMoyenne).toBeGreaterThan(3);
  });

  it('rend le rapport à la moyenne même quand l\u2019écart-type est nul', () => {
    // Volume parfaitement constant avant : la mesure en écarts-types n'a plus
    // de sens, mais le rapport à la moyenne reste lisible.
    const s = serie(...Array.from({ length: 20 }, () => b(100, 101, 99, 100, 100, 50)), b(100, 101, 99, 100, 400, 50));
    const a = anomalieVolume(s, 20, 20);
    expect(a.ecartsTypes).toBeNull();
    expect(a.volumeRapporteALaMoyenne).toBe(4);
  });

  it('renvoie null sur un historique trop court', () => {
    expect(anomalieVolume(serie(...plat(100, 3)), 2, 20)).toBeNull();
  });

  it('signale un déséquilibre vendeur', () => {
    const s = serie(...Array.from({ length: 20 }, () => b(100, 101, 99, 100, 100, 55)), b(100, 101, 99, 100, 300, 10));
    expect(anomalieVolume(s, 20, 20).deltaRapporteAuMoyen).toBeLessThan(0);
  });
});

describe('intervalleWilson', () => {
  it('donne un intervalle très large sur 5 observations', () => {
    const i = intervalleWilson(3, 5);
    expect(i.proportion).toBe(0.6);
    expect(i.bas).toBeCloseTo(0.231, 2);
    expect(i.haut).toBeCloseTo(0.882, 2);
  });

  it('resserre quand l’échantillon grandit', () => {
    const petit = intervalleWilson(60, 100);
    const grand = intervalleWilson(600, 1000);
    expect(grand.haut - grand.bas).toBeLessThan(petit.haut - petit.bas);
  });

  it('reste borné entre 0 et 1', () => {
    expect(intervalleWilson(0, 10).bas).toBe(0);
    expect(intervalleWilson(10, 10).haut).toBe(1);
  });

  it('refuse un échantillon vide', () => {
    expect(intervalleWilson(0, 0)).toBeNull();
  });
});

describe('conclusionPossible', () => {
  it('refuse de conclure sur 20 observations', () => {
    const r = conclusionPossible(intervalleWilson(12, 20));
    expect(r.possible).toBe(false);
    expect(r.raison).toMatch(/trop large/);
  });

  it('accepte sur un échantillon suffisant', () => {
    expect(conclusionPossible(intervalleWilson(600, 1000)).possible).toBe(true);
  });
});

describe('esperanceEnR', () => {
  it('reste négative malgré une majorité de gagnants si le ratio est mauvais', () => {
    // 60 % de réussite à 0,87 R : 0,6*0,87 − 0,4 = 0,122 ; avec 0,15 R de coûts, négatif.
    expect(esperanceEnR({ gagnants: 60, perdants: 40, ratioMoyen: 0.87, coutEnR: 0.15 })).toBeLessThan(0);
  });

  it('devient positive avec un bon ratio', () => {
    expect(esperanceEnR({ gagnants: 40, perdants: 60, ratioMoyen: 2 })).toBeCloseTo(0.2, 3);
  });

  it('refuse un échantillon vide', () => {
    expect(esperanceEnR({ gagnants: 0, perdants: 0, ratioMoyen: 2 })).toBeNull();
  });
});

describe('bougies', () => {
  it('extrait le volume acheteur et en déduit le delta', () => {
    const n = normaliser([1700000000000, '100', '110', '90', '105', '50', 0, '0', 12, '30', '0', '0']);
    expect(n.volumeAcheteur).toBe(30);
    expect(n.volumeVendeur).toBe(20);
    expect(n.delta).toBe(10);
    expect(n.cloture).toBe(105);
  });

  it('connaît les durées des unités', () => {
    expect(dureeUnite('15m')).toBe(900_000);
    expect(dureeUnite('1h')).toBe(3_600_000);
    expect(Object.keys(UNITES)).toContain('4h');
  });

  it('refuse une unité inconnue', () => {
    expect(() => dureeUnite('7m')).toThrow(/Unité de temps inconnue/);
  });

  it('annonce le nombre de requêtes avant de les lancer', () => {
    const r = nombreDeRequetes({ unite: '15m', depuisMs: 0, jusquaMs: 90 * 86_400_000 });
    expect(r.bougies).toBe(8640);
    expect(r.requetes).toBe(9);
  });
});
