import { describe, it, expect } from 'vitest';
import { detecterBootcamp, PARAMETRES_OB_BOOTCAMP } from './ob-bootcamp.js';
import { etoiles, discountALEntree } from './etoiles.js';
import { HAUSSIER, BAISSIER, cassures } from './structure.js';

const MINUTE = 60_000;
const DEBUT = Date.UTC(2025, 0, 6, 9, 0);
const serie = (lignes) => lignes.map(([o, h, l, c], i) => ({
  ouvertureMs: DEBUT + i * MINUTE, fermetureMs: DEBUT + (i + 1) * MINUTE - 1,
  ouverture: o, plusHaut: h, plusBas: l, cloture: c, volume: 100,
}));

/**
 * Range étroit (bougies de 0,4, alternées : les impaires sont baissières),
 * dernière bougie baissière en 20, puis le mouvement. L'accumulation compte
 * donc les bougies 19 et 20 : zone 99,5 – 100,3.
 */
function scenario(mouvement) {
  const l = [];
  for (let i = 0; i < 20; i++) l.push(i % 2 ? [100.1, 100.3, 99.9, 100.0] : [100.0, 100.3, 99.9, 100.1]);
  l.push([100.0, 100.1, 99.5, 99.6]); // 20 : OB baissier, zone 99,5 – 100,1
  for (const ligne of mouvement) l.push(ligne);
  for (let i = 0; i < 5; i++) l.push([101.5, 101.7, 101.3, 101.4]);
  return serie(l);
}

const FORT = [[99.6, 100.9, 99.6, 100.8], [100.8, 101.6, 100.7, 101.5]]; // +0,7 puis +1,4 au-dessus du haut

describe('OB bootcamp — la dernière bougie inverse d’un fort mouvement', () => {
  it('trouve l’OB et le date à la fermeture de la bougie qui rend le mouvement fort', () => {
    const b = scenario(FORT);
    const obs = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    expect(obs).toHaveLength(1);
    const [ob] = obs;
    expect(ob).toMatchObject({ sens: HAUSSIER, definition: 'bootcamp', indexDebut: 19, bougiesAccumulation: 2, zone: { bas: 99.5, haut: 100.3 } });
    expect(ob.indexCassure).toBe(22);
    expect(ob.valideAPartirDeMs).toBe(b[22].fermetureMs);
    expect(ob.plan.direction).toBe('BUY');
    expect(ob.plan.prixEntree).toBe(100.3);
  });

  it('n’attend jamais moins que la 3e bougie, celle qui dit s’il y a une imbalance', () => {
    const b = scenario([[99.6, 103.0, 99.6, 102.9], [102.9, 103.2, 102.8, 103.1]]);
    const [ob] = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    expect(ob.indexCassure).toBe(22);
  });

  it('englobe toute l’accumulation de bougies inverses, et elle seule', () => {
    const l = [];
    for (let i = 0; i < 17; i++) l.push(i % 2 ? [100.1, 100.3, 99.9, 100.0] : [100.0, 100.3, 99.9, 100.1]);
    l.push([100.0, 100.4, 99.9, 100.2]);   // 17 : haussière, hors accumulation
    l.push([100.2, 100.25, 99.8, 99.9]);   // 18 ┐
    l.push([99.9, 100.0, 99.6, 99.7]);     // 19 │ accumulation baissière
    l.push([99.7, 99.8, 99.4, 99.5]);      // 20 ┘ dernière bougie inverse
    l.push([99.5, 100.9, 99.5, 100.8], [100.8, 101.7, 100.7, 101.6]);
    for (let i = 0; i < 5; i++) l.push([101.5, 101.7, 101.3, 101.4]);
    const [ob] = detecterBootcamp(serie(l), { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    expect(ob).toMatchObject({ indexDebut: 18, bougiesAccumulation: 3, zone: { bas: 99.4, haut: 100.25 } });
  });

  it('ignore un mouvement trop faible', () => {
    const b = scenario([[99.6, 100.3, 99.6, 100.2], [100.2, 100.4, 100.1, 100.3]]);
    expect(detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20)).toHaveLength(0);
  });

  it('exige que le mouvement parte immédiatement', () => {
    const b = scenario([[99.6, 99.7, 99.3, 99.4], ...FORT]); // 21 encore baissière : l'OB devient 21
    const obs = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false });
    expect(obs.some((o) => o.index === 20)).toBe(false);
    expect(obs.some((o) => o.index === 21 && o.sens === HAUSSIER)).toBe(true);
  });

  it('ne lit rien après la validation', () => {
    const b = scenario(FORT);
    const [complet] = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    const [tronque] = detecterBootcamp(b.slice(0, 23), { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    expect(tronque).toEqual(complet);
  });

  it('a son miroir baissier', () => {
    const miroir = scenario(FORT).map((x) => ({
      ...x, ouverture: 200 - x.ouverture, cloture: 200 - x.cloture, plusHaut: 200 - x.plusBas, plusBas: 200 - x.plusHaut,
    }));
    const [ob] = detecterBootcamp(miroir, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    expect(ob).toMatchObject({ sens: BAISSIER, indexCassure: 22, zone: { bas: 99.7, haut: 100.5 }, plan: { direction: 'SELL', prixEntree: 99.7 } });
  });

  it('porte ce qu’il faut pour les cinq étoiles', () => {
    const b = scenario(FORT);
    const [ob] = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    const e = etoiles(b, ob);
    expect(typeof e.tendance).toBe('boolean');
    expect(e.imbalance).toBe(true); // haut de l'OB 100,1 < bas de la 3e bougie 100,7
    expect(e.nombre).toBeGreaterThanOrEqual(1);
  });

  it('mesure l’imbalance depuis le haut de toute l’accumulation', () => {
    const b = scenario(FORT);
    const [ob] = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).filter((o) => o.index === 20);
    // La 3e bougie descend à 100,2 : au-dessus de la dernière bougie (100,1),
    // mais sous le haut de l'accumulation (100,3). Pas d'imbalance.
    b[22] = { ...b[22], plusBas: 100.2 };
    expect(etoiles(b, ob).imbalance).toBe(false);
  });

  it('refuse un seuil absent et fige ses paramètres', () => {
    expect(() => detecterBootcamp([], {})).toThrow();
    expect(Object.isFrozen(PARAMETRES_OB_BOOTCAMP)).toBe(true);
  });
});

/**
 * Tendance haussière en escalier : 8 bougies montantes (+0,5), 6 de repli
 * (−0,3), six fois ; puis une dernière bougie baissière (84) et un mouvement
 * fort. Chaque repli est une accumulation suivie d'une reprise.
 */
function escalier() {
  const l = [];
  let p = 100;
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 8; i++) { l.push([p, p + 0.6, p - 0.05, p + 0.5]); p += 0.5; }
    for (let i = 0; i < 6; i++) { l.push([p, p + 0.05, p - 0.4, p - 0.3]); p -= 0.3; }
  }
  l.push([p, p + 0.05, p - 0.4, p - 0.3]); p -= 0.3; // 84
  l.push([p, p + 1.6, p, p + 1.5]); p += 1.5;
  l.push([p, p + 1.6, p - 0.1, p + 1.5]); p += 1.5;
  for (let i = 0; i < 6; i++) { l.push([p, p + 0.3, p - 0.1, p + 0.2]); p += 0.2; }
  return serie(l);
}

describe('« toujours en tendance »', () => {
  it('retient l’OB haussier d’une tendance haussière', () => {
    const ob = detecterBootcamp(escalier(), { seuilAtr: 2 }).find((o) => o.index === 84);
    expect(ob).toMatchObject({ sens: HAUSSIER, dansLaTendance: true, indexDebut: 78 });
  });

  it('écarte tout OB hors tendance, par défaut', () => {
    expect(detecterBootcamp(scenario(FORT), { seuilAtr: 2 }).filter((o) => o.index === 20)).toHaveLength(0);
  });
});

describe('étoile 3 à l’entrée — Fibonacci du bas de la structure au plus haut', () => {
  const b = escalier();
  const ob = detecterBootcamp(b, { seuilAtr: 2 }).find((o) => o.index === 84);
  const evenements = cassures(b, 5);

  it('part du creux d’où la tendance est partie, et va au plus haut atteint avant l’entrée', () => {
    const d = discountALEntree(b, ob, evenements, b.at(-1).fermetureMs + 1);
    expect(d.bas).toBe(99.95);
    expect(d.haut).toBeCloseTo(117.2, 6);
    // Un OB tardif dans une longue tendance est en premium : pas d'étoile 3.
    expect(d.position).toBe(0.8754);
    expect(d.enZoneFavorable).toBe(false);
  });

  it('ne lit rien après l’entrée', () => {
    const entree = b[89].fermetureMs + 1;
    const avant = discountALEntree(b, ob, evenements, entree);
    const pic = b.map((x, i) => (i > 89 ? { ...x, plusHaut: 500 } : x));
    expect(discountALEntree(pic, ob, evenements, entree)).toEqual(avant);
  });

  it('remplace l’étoile 3 quand l’appelant la fournit', () => {
    expect(etoiles(b, ob, { discount: true }).discount).toBe(true);
    expect(etoiles(b, ob, { discount: false }).discount).toBe(false);
  });
});

describe('balayage de liquidité avant l’OB', () => {
  /** Range, un creux de référence à 99,0, puis une mèche qui le perce et referme au-dessus, puis l'OB. */
  function avecBalayage(perce) {
    const l = [];
    for (let i = 0; i < 25; i++) l.push(i === 5 ? [100.0, 100.3, 99.0, 100.1] : (i % 2 ? [100.1, 100.3, 99.9, 100.0] : [100.0, 100.3, 99.9, 100.1]));
    l.push(perce ? [100.0, 100.1, 98.6, 99.8] : [100.0, 100.1, 99.5, 99.8]); // 25 : mèche sous 99,0 (ou non), clôture au-dessus
    l.push([99.8, 99.9, 99.4, 99.5]);                                        // 26 : dernière bougie inverse
    l.push([99.5, 101.0, 99.5, 100.9], [100.9, 101.8, 100.8, 101.7]);
    for (let i = 0; i < 5; i++) l.push([101.5, 101.7, 101.3, 101.4]);
    return serie(l);
  }

  it('le voit quand un creux est percé par une mèche qui referme au-dessus', () => {
    const b = avecBalayage(true);
    const ob = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).find((o) => o.index === 26);
    expect(etoiles(b, ob).balayageAvant).toBe(true);
  });

  it('ne le voit pas sans percée', () => {
    const b = avecBalayage(false);
    const ob = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).find((o) => o.index === 26);
    expect(etoiles(b, ob).balayageAvant).toBe(false);
  });

  it('ne compte pas dans les cinq étoiles', () => {
    const b = avecBalayage(true);
    const ob = detecterBootcamp(b, { seuilAtr: 2, seulementEnTendance: false }).find((o) => o.index === 26);
    const e = etoiles(b, ob);
    expect(e.nombre).toBe([e.imbalance, e.tendance, e.discount, e.sansLiquiditeDevant, e.nonMitige].filter(Boolean).length);
  });
});
