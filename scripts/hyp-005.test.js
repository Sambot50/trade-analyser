import { describe, it, expect } from 'vitest';
import { GEL, GROUPES, verdict, regrouper, compterGroupes, optionsMarche, choisirFichiers } from './hyp-005.mjs';
import { chaine } from './backtest.mjs';
import { optionsDeMesure } from './mesure-ob-bootcamp.mjs';

const MINUTE = 60_000;
/** Marche aléatoire déterministe, 1 min, sur trois jours. */
function marche(n = 3 * 1440) {
  let s = 11;
  const alea = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let p = 70;
  const t0 = Date.UTC(2024, 0, 2);
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = Math.round((o + (alea() - 0.5) * 0.2 * (1 + 3 * (alea() < 0.02))) * 100) / 100;
    p = c;
    return {
      ouvertureMs: t0 + i * MINUTE, fermetureMs: t0 + (i + 1) * MINUTE - 1,
      ouverture: o, cloture: c, plusHaut: Math.max(o, c) + 0.01, plusBas: Math.min(o, c) - 0.01, volume: 10,
    };
  });
}

describe('HYP-005 — gel', () => {
  it('fige la configuration retenue sur GC 2023-2024 : 5 min, ≥ 2 ATR', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(GEL).toMatchObject({
      dossier: 'marches', unite: '5m', seuilAtr: 2, seulementEnTendance: true, objectif: '2r',
      ticksAllerRetour: 4, tirages: 200, minimumTrades: 300, seuilP: 0.01,
    });
    expect(GEL.marches).toEqual(['SI', 'PL', 'HG', 'CL', 'ES']);
    expect(GEL.marches).not.toContain('GC');
  });

  it('passe par exactement la chaîne de la mesure, frais à 4 ticks', () => {
    const o = optionsMarche('CL_2023_2026.csv', 0.01);
    expect(o).toMatchObject({ detecteur: 'bootcamp', seuilAtr: 2, utDetection: '5m', utResolution: '1m', horizonHeures: 16, spread: 0.04, objectif: '2r', remplissage: 'meche', ambigu: 'exclu', uniteFine: '1m' });
    const { uniteFine, ...reste } = o;
    expect(reste).toEqual(optionsDeMesure({ ...reste }, 2, '5m'));
  });

  it('exige les cinq marchés, un fichier chacun, et ignore le reste', () => {
    const tous = ['SI_2023.csv', 'PL_2023.csv', 'HG_2023.csv', 'CL_2023.csv', 'ES_2023.csv', 'GC_2023.csv', 'notes.txt'];
    expect(choisirFichiers(tous)).toMatchObject({ manquants: [], doublons: [] });
    expect(choisirFichiers(tous).fichiers).toHaveLength(5);
    expect(choisirFichiers(tous.slice(1)).manquants).toEqual(['SI']);
    expect(choisirFichiers([...tous, 'ES_bis.csv']).doublons).toEqual(['ES']);
  });
});

describe('HYP-005 — regroupement', () => {
  it('met les trades des marchés en commun, frais compris', () => {
    const g = regrouper([
      { total: 12, tranchees: 10, gagnants: 4, cout: 1 },
      { total: 25, tranchees: 20, gagnants: 6, cout: 2 },
    ]);
    expect(g.tranchees).toBe(30);
    // 10 × 2 − 20 − 3, sur 30
    expect(g.esperance).toBeCloseTo(-3 / 30, 10);
    expect(regrouper([]).esperance).toBeNull();
  });

  it('compte chaque groupe sur une vraie chaîne', () => {
    const o = optionsMarche('CL.csv', 0.01);
    const r = chaine(marche(), o).resultats;
    const c = compterGroupes(r, o);
    expect(Object.keys(c)).toEqual(Object.keys(GROUPES));
    expect(c.tous.total).toBe(r.length);
    expect(c.achats.total + c.ventes.total).toBe(c.tous.total);
    expect(c.methodeComplete.total).toBeLessThanOrEqual(Math.min(c.cinqEtoiles.total, c.balayageAvant.total));
  });
});

describe('HYP-005 — règle de décision', () => {
  it('confirme : espérance positive et p < 0,01', () => {
    expect(verdict({ tranchees: 500, esperance: 0.1, p: 0.005 }).code).toBe('confirmee');
  });
  it('réfute à p = 0,01 tout juste', () => {
    expect(verdict({ tranchees: 500, esperance: 0.1, p: 0.01 }).code).toBe('refutee');
  });
  it('réfute une espérance nulle, même face à un témoin pire', () => {
    expect(verdict({ tranchees: 500, esperance: 0, p: 0.005 }).code).toBe('refutee');
  });
  it('ne conclut pas sous 300 trades', () => {
    expect(verdict({ tranchees: 299, esperance: 0.5, p: 0.005 }).code).toBe('non_concluant');
  });
});
