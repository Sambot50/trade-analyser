import { describe, it, expect } from 'vitest';
import { validerOptions, agreger } from './backtest.mjs';

const base = { symbole: 'BTCUSDT', depuis: '2025-01-01' };

describe('validerOptions — source Binance', () => {
  it('accepte les arguments minimaux', () => {
    const o = validerOptions(base);
    expect(o.erreurs).toBeUndefined();
    expect(o.symbole).toBe('BTCUSDT');
    expect(o.coutEnR).toBe(0.05);
  });

  it('exige --symbole et --depuis sans fichier', () => {
    const { erreurs } = validerOptions({});
    expect(erreurs).toEqual(expect.arrayContaining([
      expect.stringContaining('--symbole'),
      expect.stringContaining('--depuis'),
    ]));
  });
});

describe('validerOptions — source CSV', () => {
  it('se passe de --symbole et de --depuis, et nomme le symbole d’après le fichier', () => {
    const o = validerOptions({ csv: '/donnees/XAUUSD_M1_2025.csv' });
    expect(o.erreurs).toBeUndefined();
    expect(o.symbole).toBe('XAUUSD_M1_2025');
    expect(o.depuisMs).toBeUndefined();
    expect(o.jusquaMs).toBeUndefined();
  });

  it('refuse --csv sans chemin', () => {
    const { erreurs } = validerOptions({ csv: true });
    expect(erreurs).toEqual(expect.arrayContaining([expect.stringContaining('chemin')]));
  });

  it('refuse deux sources à la fois', () => {
    const { erreurs } = validerOptions({ csv: 'or.csv', baseUrl: 'http://localhost:8080' });
    expect(erreurs).toEqual(expect.arrayContaining([expect.stringContaining("deux sources")]));
  });

  it('refuse un fichier plus grossier que l’unité de résolution', () => {
    // Un fichier 1 heure ne peut pas produire des bougies 5 minutes.
    const { erreurs } = validerOptions({ csv: 'or.csv', utCsv: '1h' });
    expect(erreurs).toEqual(expect.arrayContaining([expect.stringContaining('--ut-csv')]));
  });

  it('accepte un fichier à l’unité de résolution exacte', () => {
    expect(validerOptions({ csv: 'or.csv', utCsv: '5m' }).erreurs).toBeUndefined();
  });

  it('borne le décalage horaire à des valeurs de fuseau plausibles', () => {
    expect(validerOptions({ csv: 'or.csv', decalageHeures: '-5' }).decalageHeures).toBe(-5);
    expect(validerOptions({ csv: 'or.csv', decalageHeures: '99' }).erreurs)
      .toEqual(expect.arrayContaining([expect.stringContaining('--decalage-heures')]));
  });

  it('rejette un spread négatif', () => {
    expect(validerOptions({ ...base, spread: '-1' }).erreurs)
      .toEqual(expect.arrayContaining([expect.stringContaining('--spread')]));
    expect(validerOptions({ ...base, spread: '0.25' }).spread).toBe(0.25);
  });
});

const resultat = (statut, coutEnR = null) => ({
  statut, coutEnR, plan: { prixEntree: 2400, prixStopLoss: 2394 },
});

describe('agreger — coûts', () => {
  it('retombe sur la constante quand aucun coût n’est mesuré', () => {
    const agr = agreger([resultat('tp1'), resultat('stop')], 0.05);
    expect(agr.coutMesure).toBe(false);
    expect(agr.coutEnR).toBe(0.05);
  });

  it('moyenne les coûts mesurés et ignore la constante', () => {
    const agr = agreger([resultat('tp1', 0.02), resultat('stop', 0.04)], 0.05);
    expect(agr.coutMesure).toBe(true);
    expect(agr.coutEnR).toBe(0.03);
  });

  it('ne se fie pas à une mesure partielle', () => {
    // Un seul trade chiffré sur deux : la moyenne serait fausse, on garde la
    // constante et on continue de l'annoncer comme supposée.
    const agr = agreger([resultat('tp1', 0.02), resultat('stop')], 0.05);
    expect(agr.coutMesure).toBe(false);
    expect(agr.coutEnR).toBe(0.05);
  });

  it('ignore les issues hors statistiques dans le calcul du coût', () => {
    const agr = agreger([resultat('tp1', 0.02), resultat('stop', 0.04), resultat('ambigu')], 0.05);
    expect(agr.coutMesure).toBe(true);
    expect(agr.coutEnR).toBe(0.03);
  });
});

describe('agreger — seuil de rentabilité', () => {
  it('place le seuil au-dessus du taux observé quand les coûts écrasent le gain', () => {
    // 2 tp2 + 1 tp1 sur 5 : ratio moyen 1,667, taux 60 %.
    const resultats = [
      resultat('tp2', 0.8), resultat('tp2', 0.8), resultat('tp1', 0.8),
      resultat('stop', 0.8), resultat('stop', 0.8),
    ];
    const agr = agreger(resultats, 0.05);
    expect(agr.ratioMoyen).toBeCloseTo(1.667, 2);
    expect(agr.seuil).toBeGreaterThan(agr.intervalle.proportion);
    expect(agr.esperance).toBeLessThan(0);
  });

  it('place le seuil sous le taux observé quand les coûts sont faibles', () => {
    const resultats = [
      resultat('tp2', 0.02), resultat('tp2', 0.02), resultat('tp1', 0.02),
      resultat('stop', 0.02), resultat('stop', 0.02),
    ];
    const agr = agreger(resultats, 0.05);
    expect(agr.seuil).toBeLessThan(agr.intervalle.proportion);
    expect(agr.esperance).toBeGreaterThan(0);
  });

  it('mesure la distribution des stops des issues tranchées', () => {
    const agr = agreger([resultat('tp1', 0.02), resultat('stop', 0.02)], 0.05);
    expect(agr.stops.nombre).toBe(2);
    expect(agr.stops.medianeRelative).toBeCloseTo(0.0025, 4);
  });

  it('ne produit ni seuil ni intervalle sans issue tranchée', () => {
    const agr = agreger([resultat('non_declenche'), resultat('ambigu')], 0.05);
    expect(agr.intervalle).toBeNull();
    expect(agr.esperance).toBeNull();
  });
});
