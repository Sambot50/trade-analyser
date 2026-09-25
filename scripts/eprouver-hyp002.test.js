import { describe, expect, it } from 'vitest';
import { GEL, decider, mesurerMarche, regrouper } from './eprouver-hyp002.mjs';
import { GEL as GEL_001 } from './eprouver-hyp001.mjs';

const groupe = (atteints, total) => [
  ...Array(atteints).fill('atteint'), ...Array(total - atteints).fill('perdu'),
];

describe('paramètres gelés', () => {
  it('reprend la règle de HYP-001 SANS LA MODIFIER', () => {
    // Le cœur d'une réplication. Si un paramètre diffère, on ne réplique
    // plus : on cherche une variante qui marche, et on appellera « confirmé »
    // le premier réglage qui passe.
    expect(GEL.regle).toBe(GEL_001);
    expect(GEL.regle.multiple).toBe(3);
    expect(GEL.regle.famille).toBe('hausse-achat');
    expect(GEL.regle.detecteur).toBe('picVolume');
    expect(GEL.regle.fenetre).toBe(60);
  });

  it('fige les marchés et la période', () => {
    expect(GEL.marches).toEqual(['SI', 'PL', 'HG', 'CL', 'ES']);
    expect(GEL.debut).toBe('2023-01-01');
    expect(GEL.fin).toBe('2026-09-01');
  });

  it('est immuable, liste des marchés comprise', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(Object.isFrozen(GEL.marches)).toBe(true);
    expect(() => { GEL.alpha = 0.2; }).toThrow();
    expect(() => { GEL.marches.push('GC'); }).toThrow();
  });

  it('refuse l’or : l’effet y a été trouvé, l’y retrouver ne prouve rien', () => {
    expect(GEL.marches).not.toContain('GC');
  });
});

describe('mesure par marché', () => {
  it('rend écart, variance et effectifs', () => {
    const m = mesurerMarche(groupe(58, 100), groupe(530, 1000));
    expect(m.ecart).toBeCloseTo(5.0, 6);
    expect(m.nDetectes).toBe(100);
    expect(m.nTemoin).toBe(1000);
    expect(m.se).toBeCloseTo(Math.sqrt(25 + 2.5), 6);
  });

  it('rend null quand un groupe n’a aucun verdict exploitable', () => {
    expect(mesurerMarche(['ambigu'], groupe(530, 1000))).toBeNull();
  });
});

describe('regroupement en variance inverse', () => {
  it('donne plus de poids au marché le plus précis', () => {
    // Petit marché à +20, grand marché à 0 : le groupé doit pencher vers 0.
    const petit = mesurerMarche(groupe(60, 100), groupe(40, 100));
    const grand = mesurerMarche(groupe(5000, 10000), groupe(5000, 10000));
    const g = regrouper([petit, grand]);
    expect(g.ecart).toBeLessThan(5);
    expect(g.nMarches).toBe(2);
  });

  it('resserre l’erreur type à mesure qu’on ajoute des marchés', () => {
    const un = mesurerMarche(groupe(580, 1000), groupe(5300, 10000));
    expect(regrouper([un, un, un]).se).toBeLessThan(regrouper([un]).se);
  });

  it('écarte les marchés inexploitables sans faire échouer le reste', () => {
    const bon = mesurerMarche(groupe(580, 1000), groupe(5300, 10000));
    expect(regrouper([null, bon, null]).nMarches).toBe(1);
  });

  it('rend null quand rien n’est exploitable', () => {
    expect(regrouper([null, null])).toBeNull();
  });
});

describe('règle de décision', () => {
  it('déclare NON CONCLUANTE quand la puissance manque, quel que soit le signe', () => {
    // Le point le plus important du gel : l'insuffisance de puissance se
    // constate AVANT de regarder si l'écart plaît. HYP-001 avait été décidée
    // sur une puissance annoncée de 83 % qui valait 56 %.
    for (const ecart of [+12, -12]) {
      expect(decider({ ecart, se: 3.0, z: ecart / 3, p: 0.01 }).verdict).toBe('NON CONCLUANTE');
    }
  });

  it('réplique un écart franc et assez précis', () => {
    expect(decider({ ecart: 5.0, se: 2.0, z: 2.5, p: 0.006 }).verdict).toBe('RÉPLIQUÉE');
  });

  it('ne réplique pas un écart positif noyé dans le bruit', () => {
    expect(decider({ ecart: 1.2, se: 2.0, z: 0.6, p: 0.27 }).verdict).toBe('NON RÉPLIQUÉE');
  });

  it('réfute un écart nul ou inversé quand la puissance est suffisante', () => {
    expect(decider({ ecart: 0, se: 1.5, z: 0, p: 0.5 }).verdict).toBe('RÉFUTÉE');
    expect(decider({ ecart: -4, se: 1.5, z: -2.7, p: 0.996 }).verdict).toBe('RÉFUTÉE');
  });

  it('refuse de conclure sans aucun marché', () => {
    expect(decider(null).verdict).toBe('IMPOSSIBLE');
  });

  it('le seuil de puissance détecte bien l’écart de référence à 80 %', () => {
    // 1,645 + 0,842 = 2,487 erreurs types pour 80 % de puissance unilatérale.
    expect(GEL.ecartDeReference / GEL.erreurTypeMaximale).toBeCloseTo(2.487, 2);
  });
});
