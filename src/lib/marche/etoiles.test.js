import { describe, it, expect } from 'vitest';
import { HAUSSIER, BAISSIER } from './structure.js';
import {
  etoiles, etoilesEnDirect, CRITERES_ETOILES, imbalanceDepuisOB, liquiditeDevant, mitigeDepuisLaCassure, atrJusqua,
  PARAMETRES_ETOILES,
} from './etoiles.js';

const MINUTE = 60_000;
const DEBUT = Date.UTC(2025, 0, 6, 9, 0);

const serie = (lignes) => lignes.map(([o, h, l, c], i) => ({
  ouvertureMs: DEBUT + i * MINUTE, fermetureMs: DEBUT + (i + 1) * MINUTE - 1,
  ouverture: o, plusHaut: h, plusBas: l, cloture: c, volume: 100,
}));

/**
 * Range autour de 100 (bougies de 0,4), deux creux « égaux » à 98,60 et
 * 98,62 (bougies 10 et 20), order block baissier en 30 (zone 99,0 – 99,6),
 * impulsion à corps pleins, FVG entre 30 et 32, cassure en 34.
 */
function scenario({ creux = [98.6, 98.62], percee = null } = {}) {
  const l = [];
  for (let i = 0; i < 30; i++) {
    if (i === 10) l.push([99.8, 100.0, creux[0], 99.9]);
    else if (i === 20 && creux[1] !== null) l.push([99.8, 100.0, creux[1], 99.9]);
    else if (percee !== null && i === 25) l.push([99.8, 100.0, percee, 99.9]);
    else l.push([99.9, 100.1, 99.7, 100.0]);
  }
  l.push([99.6, 99.6, 99.0, 99.1]);      // 30 : OB baissier
  l.push([99.1, 100.4, 99.1, 100.3]);    // 31
  l.push([100.3, 101.2, 99.8, 101.1]);   // 32 : plus bas 99,8 > plus haut de l'OB 99,6 → FVG
  l.push([101.1, 101.9, 101.0, 101.8]);  // 33
  l.push([101.8, 102.6, 101.7, 102.5]);  // 34 : cassure
  l.push([102.5, 102.6, 99.2, 99.4]);    // 35 : retour dans l'OB, après la cassure
  return serie(l);
}

const OB = {
  index: 30, indexCassure: 34, indexOrigine: 29, sens: HAUSSIER, typeCassure: 'BOS',
  zone: { bas: 99.0, haut: 99.6, hauteur: 0.6 },
};

describe('étoiles — paramètres', () => {
  it('sont figés', () => {
    expect(Object.isFrozen(PARAMETRES_ETOILES)).toBe(true);
    expect(PARAMETRES_ETOILES).toEqual({ periodeAtr: 14, fenetrePivots: 5, toleranceEgauxEnAtr: 0.1, porteeEnAtr: 2, profondeur: 200 });
  });
});

describe('étoile 1 — imbalance depuis l’OB', () => {
  it('voit le FVG entre l’OB et la 3e bougie', () => {
    expect(imbalanceDepuisOB(scenario(), OB)).toBe(true);
  });
  it('le refuse quand la 3e bougie touche l’OB', () => {
    const b = scenario();
    b[32] = { ...b[32], plusBas: 99.5 };
    expect(imbalanceDepuisOB(b, OB)).toBe(false);
  });
});

describe('étoile 4 — liquidité devant l’OB', () => {
  it('trouve deux creux égaux non pris sous l’OB', () => {
    expect(atrJusqua(scenario(), 30)).toBeGreaterThan(0.2);
    const poche = liquiditeDevant(scenario(), OB);
    expect(poche).toEqual({ niveau: 98.6, pivots: [10, 20] });
  });
  it('ignore un creux seul', () => {
    expect(liquiditeDevant(scenario({ creux: [98.6, null] }), OB)).toBeNull();
  });
  it('ignore deux creux trop différents', () => {
    expect(liquiditeDevant(scenario({ creux: [98.6, 98.9] }), OB)).toBeNull();
  });
  it('ignore une poche déjà percée avant la cassure', () => {
    expect(liquiditeDevant(scenario({ percee: 98.3 }), OB)).toBeNull();
  });
  it('ne lit rien après la cassure', () => {
    const b = scenario();
    b[35] = { ...b[35], plusBas: 90 }; // percée APRÈS la cassure : inconnue à cet instant
    expect(liquiditeDevant(b, OB)).toEqual({ niveau: 98.6, pivots: [10, 20] });
  });
});

describe('les cinq étoiles', () => {
  it('compte les critères remplis', () => {
    const e = etoiles(scenario(), OB);
    expect(e).toMatchObject({ imbalance: true, tendance: true, discount: true, sansLiquiditeDevant: false, nonMitige: true });
    expect(e.nombre).toBe(4);
  });
  it('donne 5 étoiles sans la poche', () => {
    expect(etoiles(scenario({ creux: [98.6, null] }), OB).nombre).toBe(5);
  });
  it('retire l’étoile tendance à un CHoCH', () => {
    expect(etoiles(scenario(), { ...OB, typeCassure: 'CHoCH' }).tendance).toBe(false);
  });
  it('rend le même résultat sur la série tronquée à la cassure', () => {
    const b = scenario();
    expect(etoiles(b.slice(0, 35), OB)).toEqual(etoiles(b, OB));
  });
});

describe('mitigation en direct', () => {
  it('voit le retour dans l’OB après la cassure, une fois la bougie fermée', () => {
    const b = scenario();
    expect(mitigeDepuisLaCassure(b, OB, b[35].ouvertureMs)).toBe(false);
    expect(mitigeDepuisLaCassure(b, OB, b[35].fermetureMs + 1)).toBe(true);
  });
});

describe('étoiles en direct — pour l’affichage', () => {
  it('liste les cinq critères dans l’ordre de la méthode, remplis ou manquants', () => {
    const b = scenario();
    const e = etoilesEnDirect(b, OB, b[34].fermetureMs + 1);
    expect(e.criteres.map((c) => c.cle)).toEqual(CRITERES_ETOILES.map((c) => c.cle));
    expect(e.criteres.map((c) => c.rempli)).toEqual([true, true, true, false, true]);
    expect(e.criteres[3].phrase).toBe('égaux non pris devant l’OB');
    expect(e.nombre).toBe(4);
  });
  it('rend la même note que `etoiles` tant que l’OB n’est pas retouché', () => {
    const b = scenario();
    const e = etoilesEnDirect(b, OB, b[35].ouvertureMs);
    expect(e.retoucheDepuisLaCassure).toBe(false);
    expect(e.nombre).toBe(etoiles(b, OB).nombre);
  });
  it('retire l’étoile 5 à un OB retouché depuis la cassure, et le dit', () => {
    const b = scenario();
    const e = etoilesEnDirect(b, OB, b[35].fermetureMs + 1);
    expect(e.retoucheDepuisLaCassure).toBe(true);
    expect(e.nonMitige).toBe(false);
    expect(e.nombre).toBe(3);
    expect(e.criteres[4]).toMatchObject({ rempli: false, phrase: 'retouché depuis la cassure' });
  });
  it('dit « déjà retouché » quand le retour précède la cassure', () => {
    const b = scenario();
    b[33] = { ...b[33], plusBas: 99.3 }; // sorti en 32, revenu dans l'OB en 33, avant la cassure
    const e = etoilesEnDirect(b, OB, b[34].fermetureMs + 1);
    expect(e.criteres[4]).toMatchObject({ rempli: false, phrase: 'déjà retouché' });
  });
});

describe('symétrie — OB baissier', () => {
  const miroir = (b) => b.map((x) => ({
    ...x, ouverture: 200 - x.ouverture, cloture: 200 - x.cloture, plusHaut: 200 - x.plusBas, plusBas: 200 - x.plusHaut,
  }));
  const obBaissier = { ...OB, sens: BAISSIER, zone: { bas: 100.4, haut: 101.0, hauteur: 0.6 } };

  it('voit les plus hauts égaux au-dessus de l’OB', () => {
    expect(liquiditeDevant(miroir(scenario()), obBaissier)).toEqual({ niveau: 101.4, pivots: [10, 20] });
  });
  it('donne les mêmes étoiles qu’en haussier', () => {
    const { pocheDevant: _a, ...h } = etoiles(scenario(), OB);
    const { pocheDevant: _b, ...b } = etoiles(miroir(scenario()), obBaissier);
    expect(b).toEqual(h);
  });
});
