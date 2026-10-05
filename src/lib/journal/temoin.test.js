import { describe, it, expect } from 'vitest';

import {
  prixDeReference, geometrieDe, planDepuisGeometrie, rendementComplet,
  instantsCandidats, evaluerReel, controlerParTemoin, controlerParTemoinGroupes, memeHeureLocale,
} from './temoin.js';
import { serieAleatoire } from '../marche/aleatoire.js';
import { generateurAleatoire } from '../marche/controle.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 5);

/** Bougie d'une minute, à l'indice `i` après T0. */
const bougie = (i, o, h, l, c) => ({
  ouvertureMs: T0 + i * MIN, fermetureMs: T0 + (i + 1) * MIN - 1,
  ouverture: o, plusHaut: h, plusBas: l, cloture: c,
});
const plate = (i, p) => bougie(i, p, p + 0.1, p - 0.1, p);

const ACHAT = { direction: 'BUY', prixEntree: 100, prixStopLoss: 99, prixTp1: 101, prixTp2: 102 };
const REGLAGES = { horizonBougies: 5, objectif: '2r', remplissage: 'meche', ambigu: 'perdant' };

describe('prixDeReference', () => {
  it('prend la clôture de la dernière bougie FERMÉE, jamais celle en cours', () => {
    const bs = [plate(0, 100), plate(1, 101), plate(2, 102)];
    // À 1 min 30, la bougie 1 est en cours : son prix n'est pas encore connu.
    expect(prixDeReference(bs, T0 + 1.5 * MIN)).toEqual({ prix: 100, indice: 0 });
    expect(prixDeReference(bs, T0 + 2 * MIN)).toEqual({ prix: 101, indice: 1 });
    expect(prixDeReference(bs, T0)).toBeNull();
  });
});

describe('géométrie', () => {
  it('se reconstruit à l’identique sur le même prix', () => {
    const plan = { direction: 'SELL', prixEntree: 4170, prixStopLoss: 4180, prixTp1: 4160, prixTp2: 4150 };
    const g = geometrieDe(plan, 4162.8);
    const refait = planDepuisGeometrie(g, 4162.8);
    for (const champ of ['prixEntree', 'prixStopLoss', 'prixTp1', 'prixTp2']) {
      expect(refait[champ]).toBeCloseTo(plan[champ], 9);
    }
    expect(refait.direction).toBe('SELL');
  });

  it('garde les proportions, pas les distances absolues', () => {
    const g = geometrieDe(ACHAT, 100);
    const ailleurs = planDepuisGeometrie(g, 200);
    expect(ailleurs.prixEntree).toBeCloseTo(200);
    expect(ailleurs.prixStopLoss).toBeCloseTo(198);
    expect(ailleurs.prixTp2).toBeCloseTo(204);
  });

  it('mesure l’entrée depuis le prix du moment : un ordre éloigné reste éloigné', () => {
    const g = geometrieDe(ACHAT, 101);
    expect(planDepuisGeometrie(g, 202).prixEntree).toBeCloseTo(200);
  });
});

describe('rendementComplet — rien n’est écarté', () => {
  it('compte 0 R pour un plan jamais déclenché', () => {
    const bs = [0, 1, 2, 3, 4].map((i) => plate(i, 105));
    expect(rendementComplet({ plan: ACHAT, bougies: bs, ...REGLAGES })).toEqual({ statut: 'non_declenche', r: 0 });
  });

  it('valorise un horizon dépassé à la dernière clôture, rapportée au risque', () => {
    const bs = [plate(0, 100), plate(1, 100.2), plate(2, 100.3), plate(3, 100.4), bougie(4, 100.4, 100.6, 100.3, 100.5)];
    const { statut, r } = rendementComplet({ plan: ACHAT, bougies: bs, ...REGLAGES });
    expect(statut).toBe('horizon_depasse');
    expect(r).toBeCloseTo(0.5);
  });

  it('le valorise dans le bon sens pour une vente', () => {
    const vente = { direction: 'SELL', prixEntree: 100, prixStopLoss: 101, prixTp1: 99, prixTp2: 98 };
    const bs = [plate(0, 100), plate(1, 100.2), plate(2, 100.3), plate(3, 100.4), plate(4, 100.5)];
    expect(rendementComplet({ plan: vente, bougies: bs, ...REGLAGES }).r).toBeCloseTo(-0.5);
  });

  it('compte l’ambigu en perte par défaut, en gain sur demande — jamais écarté', () => {
    const bs = [plate(0, 100), bougie(1, 100, 102.5, 98.5, 100)];
    expect(rendementComplet({ plan: ACHAT, bougies: bs, ...REGLAGES }).r).toBe(-1);
    expect(rendementComplet({ plan: ACHAT, bougies: bs, ...REGLAGES, ambigu: 'gagnant' }).r).toBe(2);
    expect(() => rendementComplet({ plan: ACHAT, bougies: bs, ...REGLAGES, ambigu: 'exclu' })).toThrow(/compte tout/);
  });

  it('rend null tant que l’horizon n’est pas couvert', () => {
    expect(rendementComplet({ plan: ACHAT, bougies: [plate(0, 100)], ...REGLAGES }).r).toBeNull();
  });
});

describe('memeHeureLocale', () => {
  it('garde 15 h 30 à Paris à travers le passage à l’heure d’hiver', () => {
    // 2026-10-26 15:30 Paris = 14:30 UTC (hiver) ; la veille, 13:30 UTC (été).
    const lundi = Date.parse('2026-10-26T14:30:00Z');
    expect(new Date(memeHeureLocale(lundi, 1)).toISOString()).toBe('2026-10-25T14:30:00.000Z');
    expect(new Date(memeHeureLocale(lundi, 2)).toISOString()).toBe('2026-10-24T13:30:00.000Z');
  });
});

describe('instantsCandidats', () => {
  // Dix jours de bougies d'une heure, 24 h sur 24.
  const H = 3_600_000;
  const bs = Array.from({ length: 240 }, (_, i) => ({
    ouvertureMs: T0 + i * H, fermetureMs: T0 + (i + 1) * H - 1,
    ouverture: 100, plusHaut: 100.1, plusBas: 99.9, cloture: 100,
  }));
  const instant = T0 + 9 * 24 * H + 14 * H; // jour 9, 14 h UTC = 15 h Paris (hiver)

  it('ne prend que la même heure locale, les jours précédents', () => {
    const c = instantsCandidats(bs, instant, { fenetreMs: 9 * 24 * H, horizonBougies: 24 });
    expect(c.map((i) => (bs[i].fermetureMs + 1 - T0) / H % 24)).toEqual(Array(c.length).fill(14));
  });

  it('referme l’horizon de chaque candidat AVANT l’analyse : aucune bougie partagée avec le réel', () => {
    const c = instantsCandidats(bs, instant, { fenetreMs: 9 * 24 * H, horizonBougies: 24 });
    for (const i of c) expect(bs[i + 24].ouvertureMs).toBeLessThan(instant);
    // La veille est permise : son horizon se referme une milliseconde avant
    // l'analyse, sans aucune bougie commune.
    expect(bs[c.at(-1)].fermetureMs + 1).toBe(instant - 24 * H);
    // Avec un horizon d'une bougie de plus, elle déborderait : exclue.
    const plusLong = instantsCandidats(bs, instant, { fenetreMs: 9 * 24 * H, horizonBougies: 25 });
    expect(bs[plusLong.at(-1)].fermetureMs + 1).toBe(instant - 2 * 24 * H);
  });

  it('reste dans la fenêtre qui précède l’analyse', () => {
    const c = instantsCandidats(bs, instant, { fenetreMs: 4 * 24 * H, horizonBougies: 24 });
    expect(c).toHaveLength(4); // J-1 à J-4
  });

  it('saute un jour sans marché à cette heure', () => {
    const troue = bs.filter((b) => !(b.ouvertureMs >= instant - 4 * 24 * H - 3 * H && b.ouvertureMs < instant - 4 * 24 * H + H));
    const c = instantsCandidats(troue, instant, { fenetreMs: 6 * 24 * H, horizonBougies: 24 });
    expect(c).toHaveLength(5); // J-1 à J-6, sauf J-4 : dernière clôture trois heures plus tôt
  });
});

describe('evaluerReel', () => {
  it('résout le plan sur les bougies qui s’ouvrent à l’analyse ou après', () => {
    const bs = [plate(0, 99.5), plate(1, 100), bougie(2, 100, 102.2, 99.9, 102)];
    const r = evaluerReel({ plan: ACHAT, instantMs: T0 + MIN }, bs, { ...REGLAGES, horizonBougies: 2 });
    expect(r).toMatchObject({ statut: 'tp2', r: 2 });
    expect(r.geometrie.entree).toBeCloseTo(100 / 99.5 - 1);
  });

  it('écarte un plan dont l’issue n’est pas tranchée, en le disant', () => {
    const r = evaluerReel({ plan: ACHAT, instantMs: T0 + MIN }, [plate(0, 100), plate(1, 100)], REGLAGES);
    expect(r.exclu).toMatch(/pas encore tranchée/);
  });
});

// ─── Le témoin éprouvé dans les deux sens ────────────────────────────────────
//
// Un contrôle qui répond toujours « pas d'avantage » ne vaut rien, et un
// contrôle qui crédite le marché au modèle non plus. Trois épreuves :
//
//   1. hasard pur        — des plans posés au hasard ne doivent PAS passer ;
//   2. oracle            — des plans qui lisent le futur DOIVENT passer ;
//   3. marché haussier   — des achats qui gagnent seulement parce que tout
//                          monte ne doivent PAS passer. C'est la raison d'être
//                          du témoin : un taux de réussite brut les créditerait.

const HORIZON = 240; // 4 heures de bougies 1 minute
const VALIDATION = {
  horizonBougies: HORIZON, objectif: '2r', remplissage: 'meche', ambigu: 'perdant',
  fenetreMs: 9 * 24 * 60 * MIN, tirages: 300, graine: 7,
};

/**
 * Trente plans au marché, stop à 0,15 %, objectifs à 1 R et 2 R, posés à des
 * instants réguliers sur les dix derniers jours d'une série de vingt.
 */
function plansSur(bougies, choisirSens) {
  const debut = 10 * 24 * 60;
  return Array.from({ length: 30 }, (_, k) => {
    const i = debut + k * 400;
    const instantMs = bougies[i].ouvertureMs;
    const p = bougies[i - 1].cloture;
    const sens = choisirSens(i, k);
    const d = p * 0.0015 * (sens === 'BUY' ? 1 : -1);
    return {
      id: `plan-${k}`, instantMs,
      plan: { direction: sens, prixEntree: p, prixStopLoss: p - d, prixTp1: p + d, prixTp2: p + 2 * d },
    };
  });
}

const serie = (graine) => serieAleatoire({ graine, minutes: 20 * 24 * 60 });

describe('le témoin, éprouvé', () => {
  it('ne crédite pas des plans posés au hasard — moins d’un p sous 0,05 sur cinq, sur vingt séries', () => {
    let significatifs = 0;
    for (let graine = 1; graine <= 20; graine++) {
      const bs = serie(graine);
      const alea = generateurAleatoire(1000 + graine);
      const r = controlerParTemoin(plansSur(bs, () => (alea() < 0.5 ? 'BUY' : 'SELL')), bs, VALIDATION);
      expect(r.retenus).toHaveLength(30);
      if (r.p.p < 0.05) significatifs++;
    }
    // Attendu : une fois sur vingt. Quatre laisserait encore la place au hasard.
    expect(significatifs).toBeLessThanOrEqual(4);
  }, 60_000);

  it('détecte des plans qui connaissent le sens des quatre heures suivantes', () => {
    const bs = serie(3);
    const oracle = (i) => (bs[i + HORIZON].cloture > bs[i - 1].cloture ? 'BUY' : 'SELL');
    const r = controlerParTemoin(plansSur(bs, oracle), bs, VALIDATION);
    expect(r.reel).toBeGreaterThan(r.temoin.maximum);
    expect(r.p.p).toBe(r.p.plancher);
  }, 60_000);

  it('ne crédite pas au modèle une hausse que tout le monde a eue', () => {
    // Même marche, plus une pente : +0,02 par minute, soit +4,8 en quatre heures
    // pour un écart type d'environ 7,7. Tous les plans achètent.
    const bs = serie(5).map((b, i) => {
      const pente = 0.02 * i;
      return { ...b, ouverture: b.ouverture + pente, plusHaut: b.plusHaut + pente, plusBas: b.plusBas + pente, cloture: b.cloture + pente };
    });
    const r = controlerParTemoin(plansSur(bs, () => 'BUY'), bs, VALIDATION);

    // Le chiffre brut est flatteur…
    expect(r.reel).toBeGreaterThan(0.1);
    // … et le témoin, posé sur la même pente, l'est tout autant.
    expect(r.temoin.mediane).toBeGreaterThan(0.1);
    expect(r.p.p).toBeGreaterThan(0.05);
  }, 60_000);
});

describe('controlerParTemoin — ce qu’il écarte', () => {
  it('dit pourquoi un plan est écarté, et ne le compte nulle part', () => {
    const bs = serie(9);
    const entrees = plansSur(bs, () => 'BUY');
    // Analyse au tout début : aucune fenêtre de témoin derrière elle.
    // Analyse au début des données : sa fenêtre de neuf jours n'est pas
    // couverte, même si quelques instants de témoin existeraient.
    const p0 = bs[HORIZON - 1].cloture;
    entrees.push({ id: 'trop-tot', instantMs: bs[HORIZON].ouvertureMs,
      plan: { direction: 'BUY', prixEntree: p0, prixStopLoss: p0 - 5, prixTp1: p0 + 5, prixTp2: p0 + 10 } });
    // Analyse à la toute fin : l'horizon n'est pas couvert.
    const fin = bs.length - 10;
    entrees.push({ id: 'trop-tard', instantMs: bs[fin].ouvertureMs,
      plan: { direction: 'BUY', prixEntree: bs[fin - 1].cloture, prixStopLoss: bs[fin - 1].cloture - 5, prixTp1: bs[fin - 1].cloture + 5, prixTp2: bs[fin - 1].cloture + 10 } });

    const r = controlerParTemoin(entrees, bs, { ...VALIDATION, tirages: 10 });
    expect(r.retenus).toHaveLength(30);
    expect(r.exclus).toEqual([
      { id: 'trop-tot', raison: expect.stringMatching(/fenêtre de témoin incomplète/) },
      { id: 'trop-tard', raison: expect.stringMatching(/pas encore tranchée/) },
    ]);
  });

  it('écarte un plan dont l’horizon chevauche celui du précédent retenu', () => {
    const bs = serie(9);
    const entrees = plansSur(bs, () => 'BUY');
    const i = 10 * 24 * 60 + 100; // 100 minutes après plan-0, dans son horizon de 240
    const p = bs[i - 1].cloture;
    entrees.push({ id: 'chevauche', instantMs: bs[i].ouvertureMs,
      plan: { direction: 'BUY', prixEntree: p, prixStopLoss: p - 5, prixTp1: p + 5, prixTp2: p + 10 } });
    const r = controlerParTemoin(entrees, bs, { ...VALIDATION, tirages: 10 });
    expect(r.retenus).toHaveLength(30);
    expect(r.exclus).toEqual([{ id: 'chevauche', raison: expect.stringMatching(/chevauchant/) }]);
  });

  it('écarte un plan posé marché fermé', () => {
    const bs = serie(9);
    const [plan] = plansSur(bs, () => 'BUY');
    const sansLaVeille = bs.filter((b) => b.ouvertureMs < plan.instantMs - 60 * MIN || b.ouvertureMs >= plan.instantMs);
    const r = controlerParTemoin([plan], sansLaVeille, { ...VALIDATION, tirages: 10 });
    expect(r.exclus).toEqual([{ id: 'plan-0', raison: expect.stringMatching(/marché fermé/) }]);
  });

  it('juge et témoigne chaque plan dans sa propre série — deux contrats ne se recollent pas', () => {
    const a = serie(12);
    // Un second « contrat », 3 % plus cher : le recoller créerait un saut.
    const b = serie(13).map((x) => ({ ...x, ouverture: x.ouverture * 1.03, plusHaut: x.plusHaut * 1.03, plusBas: x.plusBas * 1.03, cloture: x.cloture * 1.03 }));
    const alea = generateurAleatoire(3);
    const sens = () => (alea() < 0.5 ? 'BUY' : 'SELL');
    const r = controlerParTemoinGroupes([
      { bougies: a, entrees: plansSur(a, sens).map((e) => ({ ...e, id: `a-${e.id}` })) },
      { bougies: b, entrees: plansSur(b, sens).map((e) => ({ ...e, id: `b-${e.id}` })) },
    ], { ...VALIDATION, tirages: 50 });
    expect(r.retenus).toHaveLength(60);
    expect(r.exclus).toEqual([]);
  });

  it('rend le même résultat pour la même graine', () => {
    const bs = serie(11);
    const entrees = plansSur(bs, (i) => (i % 800 ? 'BUY' : 'SELL'));
    const a = controlerParTemoin(entrees, bs, { ...VALIDATION, tirages: 50 });
    const b = controlerParTemoin(entrees, bs, { ...VALIDATION, tirages: 50 });
    expect(a).toEqual(b);
  });

  it('refuse une série vide plutôt que de rendre « aucun plan »', () => {
    expect(() => controlerParTemoin([], [], VALIDATION)).toThrow(/Aucune bougie/);
  });

  it('refuse une règle de sortie absente', () => {
    expect(() => controlerParTemoin([], [], { ...VALIDATION, objectif: undefined })).toThrow(/Objectif de sortie/);
  });
});
