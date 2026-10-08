import { describe, it, expect } from 'vitest';
import { SEUILS_ATR, TEMOIN, mesurerSeuil, UNITES_MESUREES, UNITES_NON_MESURABLES } from './mesure-ob-bootcamp.mjs';
import { premierIndexAPartirDe } from './backtest.mjs';
import { validerOptions } from './backtest.mjs';

const MINUTE = 60_000;
/** Marche aléatoire déterministe, 1 min, sur trois jours. */
function marche(n = 3 * 1440) {
  let s = 7;
  const alea = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  let p = 2000;
  const t0 = Date.UTC(2024, 0, 2);
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = o + (alea() - 0.5) * 2 * (1 + 3 * (alea() < 0.02));
    p = c;
    return {
      ouvertureMs: t0 + i * MINUTE, fermetureMs: t0 + (i + 1) * MINUTE - 1,
      ouverture: o, cloture: c, plusHaut: Math.max(o, c) + alea() * 0.5, plusBas: Math.min(o, c) - alea() * 0.5, volume: 10,
    };
  });
}

describe('mesure de l’OB bootcamp', () => {
  it('fige quatre seuils et un témoin', () => {
    expect(SEUILS_ATR).toEqual([1, 1.5, 2, 3]);
    expect(Object.isFrozen(SEUILS_ATR) && Object.isFrozen(TEMOIN)).toBe(true);
  });

  it('mesure un seuil face à son témoin, sur la chaîne du backtest', () => {
    const o = validerOptions({ csv: 'x.csv', sansFiltreBiais: true });
    o.uniteFine = '1m';
    const l = mesurerSeuil(marche(), o, 1, { tirages: 3 });
    expect(l.seuilAtr).toBe(1);
    expect(l.orderBlocks).toBeGreaterThan(0);
    expect(l.p).toBeGreaterThan(0);
  });

  it('couvre les sept unités demandées : quatre mesurées, trois expliquées', () => {
    expect(UNITES_MESUREES).toEqual(['5m', '15m', '1h', '4h']);
    expect(Object.keys(UNITES_NON_MESURABLES)).toEqual(['1m', '1d', '1w']);
  });

  it('mesure chaque unité avec une issue lue en 1 min', () => {
    const o = validerOptions({ csv: 'x.csv', sansFiltreBiais: true });
    o.uniteFine = '1m';
    expect(mesurerSeuil(marche(), o, 1, { unite: '5m', tirages: 2 }).unite).toBe('5m');
  });

  it('trouve le départ par dichotomie', () => {
    const b = [10, 20, 30].map((ouvertureMs) => ({ ouvertureMs }));
    expect([5, 10, 11, 30, 31].map((ms) => premierIndexAPartirDe(b, ms))).toEqual([0, 0, 1, 2, -1]);
  });

  it('refuse le détecteur bootcamp sans seuil', () => {
    expect(validerOptions({ csv: 'x.csv', detecteur: 'bootcamp' }).erreurs).toBeTruthy();
    expect(validerOptions({ csv: 'x.csv', detecteur: 'autre' }).erreurs).toBeTruthy();
  });
});
