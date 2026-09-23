import { describe, it, expect } from 'vitest';
import { validerOptions, agreger, chaine } from './backtest.mjs';
import { generateurAleatoire, melangerBougies } from '../src/lib/marche/controle.js';

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
    const agr = agreger([resultat('tp2'), resultat('stop')], 0.05);
    expect(agr.coutMesure).toBe(false);
    expect(agr.coutEnR).toBe(0.05);
  });

  it('moyenne les coûts mesurés et ignore la constante', () => {
    const agr = agreger([resultat('tp2', 0.02), resultat('stop', 0.04)], 0.05);
    expect(agr.coutMesure).toBe(true);
    expect(agr.coutEnR).toBe(0.03);
  });

  it('ne se fie pas à une mesure partielle', () => {
    // Un seul trade chiffré sur deux : la moyenne serait fausse, on garde la
    // constante et on continue de l'annoncer comme supposée.
    const agr = agreger([resultat('tp2', 0.02), resultat('stop')], 0.05);
    expect(agr.coutMesure).toBe(false);
    expect(agr.coutEnR).toBe(0.05);
  });

  it('ignore les issues hors statistiques dans le calcul du coût', () => {
    const agr = agreger([resultat('tp2', 0.02), resultat('stop', 0.04), resultat('ambigu')], 0.05);
    expect(agr.coutMesure).toBe(true);
    expect(agr.coutEnR).toBe(0.03);
  });
});

describe('agreger — seuil de rentabilité', () => {
  it('place le seuil au-dessus du taux observé quand les coûts écrasent le gain', () => {
    // 2 gains sur 5 à 2 R : seuil (1 + 0,8) / 3 = 60 %, observé 40 %.
    const resultats = [
      resultat('tp2', 0.8), resultat('tp2', 0.8),
      resultat('stop', 0.8), resultat('stop', 0.8), resultat('stop', 0.8),
    ];
    const agr = agreger(resultats, 0.05, '2r');
    expect(agr.ratioMoyen).toBe(2);
    expect(agr.seuil).toBeCloseTo(0.6, 4);
    expect(agr.seuil).toBeGreaterThan(agr.intervalle.proportion);
    expect(agr.esperance).toBeLessThan(0);
  });

  it('place le seuil sous le taux observé quand les coûts sont faibles', () => {
    const resultats = [
      resultat('tp2', 0.02), resultat('tp2', 0.02), resultat('tp2', 0.02),
      resultat('stop', 0.02), resultat('stop', 0.02),
    ];
    const agr = agreger(resultats, 0.05, '2r');
    expect(agr.seuil).toBeLessThan(agr.intervalle.proportion);
    expect(agr.esperance).toBeGreaterThan(0);
  });

  it('applique le gain de la règle choisie, pas un mélange', () => {
    // Le cœur du correctif : 3 gains sur 5 valent 1 R sous la sortie ferme et
    // 2 R sous la tenue. Aucune lecture ne doit produire les deux.
    const r = (statut) => resultat(statut, 0.02);
    const un = agreger([r('tp1'), r('tp1'), r('tp1'), r('stop'), r('stop')], 0.05, '1r');
    const deux = agreger([r('tp2'), r('tp2'), r('tp2'), r('stop'), r('stop')], 0.05, '2r');

    expect(un.ratioMoyen).toBe(1);
    expect(deux.ratioMoyen).toBe(2);
    expect(un.intervalle.proportion).toBe(deux.intervalle.proportion);
    expect(deux.esperance).toBeGreaterThan(un.esperance);
  });

  it('écarte un statut étranger à la règle de sortie', () => {
    // Un « tp1 » sous l'objectif 2 R vient d'une autre règle : le compter
    // à 2 R réintroduirait le mélange qu'on vient de supprimer.
    const agr = agreger([resultat('tp2', 0.02), resultat('tp1', 0.02), resultat('stop', 0.02)], 0.05, '2r');
    expect(agr.tranchees).toBe(2);
    expect(agr.intervalle.succes).toBe(1);
  });

  it('mesure la distribution des stops des issues tranchées', () => {
    const agr = agreger([resultat('tp2', 0.02), resultat('stop', 0.02)], 0.05, '2r');
    expect(agr.stops.nombre).toBe(2);
    expect(agr.stops.medianeRelative).toBeCloseTo(0.0025, 4);
  });

  it('ne produit ni seuil ni intervalle sans issue tranchée', () => {
    const agr = agreger([resultat('non_declenche'), resultat('ambigu')], 0.05);
    expect(agr.intervalle).toBeNull();
    expect(agr.esperance).toBeNull();
  });
});

describe('validerOptions — contrôle', () => {
  it('prend 100 tirages quand --controle est passé seul', () => {
    expect(validerOptions({ ...base, controle: true }).controle).toBe(100);
  });

  it('accepte un nombre de tirages explicite', () => {
    expect(validerOptions({ ...base, controle: '500' }).controle).toBe(500);
  });

  it('refuse un nombre de tirages absurde', () => {
    for (const n of ['0', '-5', '2.5', '99999']) {
      expect(validerOptions({ ...base, controle: n }).erreurs)
        .toEqual(expect.arrayContaining([expect.stringContaining('--controle')]));
    }
  });

  it('expose une graine par défaut, pour que le contrôle soit rejouable', () => {
    expect(validerOptions(base).graine).toBe(1);
    expect(validerOptions({ ...base, graine: '77' }).graine).toBe(77);
  });

  it('refuse une taille de paquet non entière', () => {
    expect(validerOptions({ ...base, controlePaquet: '1.5' }).erreurs)
      .toEqual(expect.arrayContaining([expect.stringContaining('--controle-paquet')]));
  });
});

/** Série 1 minute déterministe, assez longue pour produire des order blocks. */
function fines(n = 6000, phi = 0) {
  const alea = generateurAleatoire(2025);
  const normal = () => { let s = 0; for (let i = 0; i < 12; i++) s += alea(); return s - 6; };
  let prix = 2400, r = 0;
  return Array.from({ length: n }, (_, i) => {
    r = phi * r + normal() * 0.0004;
    const ouverture = prix;
    const cloture = prix * Math.exp(r);
    prix = cloture;
    return {
      ouvertureMs: Date.UTC(2025, 0, 1) + i * 60_000,
      fermetureMs: Date.UTC(2025, 0, 1) + (i + 1) * 60_000 - 1,
      ouverture, cloture,
      plusHaut: Math.max(ouverture, cloture) * (1 + alea() * 0.0002),
      plusBas: Math.min(ouverture, cloture) * (1 - alea() * 0.0002),
      volume: 100 + (i % 37), volumeAcheteur: null, volumeVendeur: null, delta: null, nombreTrades: null,
    };
  });
}

const options = {
  uniteFine: '1m', utBiais: '1h', utDetection: '15m', utResolution: '5m',
  fenetre: 5, horizonHeures: 48, coutEnR: 0.05, spread: 0, commission: 0,
  sansFiltreBiais: false, objectif: '2r',
};

describe('chaine — le chemin commun au réel et au contrôle', () => {
  it('produit des order blocks depuis une seule série fine', () => {
    const { resultats, compteurs } = chaine(fines(), options);
    expect(compteurs.orderBlocks).toBeGreaterThan(0);
    expect(resultats.length).toBeGreaterThan(0);
  });

  it('est déterministe : mêmes bougies, mêmes résultats', () => {
    const serie = fines();
    const a = chaine(serie, options).resultats;
    const b = chaine(serie, options).resultats;
    expect(a.map((r) => `${r.ms}:${r.statut}`)).toEqual(b.map((r) => `${r.ms}:${r.statut}`));
  });

  it('avale une série mélangée sans se casser', () => {
    // Le contrôle ne vaut que si le hasard traverse exactement le même code.
    const melangee = melangerBougies(fines(), generateurAleatoire(3));
    const { resultats } = chaine(melangee, options);
    for (const r of resultats) {
      expect(r.plan.prixEntree).toBeGreaterThan(0);
      expect(Number.isFinite(r.plan.risque)).toBe(true);
    }
  });

  it('donne un résultat différent après mélange', () => {
    // Garde-fou contre le contrôle silencieusement inopérant : si mélanger ne
    // changeait rien, chaque tirage rejouerait le réel et p vaudrait 1.
    const serie = fines();
    const reel = chaine(serie, options).resultats;
    const melange = chaine(melangerBougies(serie, generateurAleatoire(3)), options).resultats;
    expect(melange.map((r) => `${r.ms}:${r.statut}`)).not.toEqual(reel.map((r) => `${r.ms}:${r.statut}`));
  });

  it('respecte la même graine d’un tirage à l’autre', () => {
    const serie = fines();
    const a = chaine(melangerBougies(serie, generateurAleatoire(8)), options).resultats;
    const b = chaine(melangerBougies(serie, generateurAleatoire(8)), options).resultats;
    expect(a.map((r) => r.statut)).toEqual(b.map((r) => r.statut));
  });

  it('date toujours les order blocks à un instant connaissable', () => {
    // L'invariant anti-lecture du futur doit survivre au mélange : une bougie
    // déplacée garde son horodatage d'origine, donc la cassure reste datée à
    // une fermeture réelle.
    const melangee = melangerBougies(fines(), generateurAleatoire(3));
    const { resultats } = chaine(melangee, options);
    for (const r of resultats) {
      expect(r.ms).toBeGreaterThanOrEqual(melangee[0].ouvertureMs);
      expect(r.ms).toBeLessThanOrEqual(melangee[melangee.length - 1].fermetureMs);
    }
  });
});
