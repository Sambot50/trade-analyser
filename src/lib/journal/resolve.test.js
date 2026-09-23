import { describe, it, expect } from 'vitest';
import { resoudreIssue, compteDansLesStats, estGagnant, gainEnR, reglageObjectif } from './resolve.js';
import { symboleResolvable, normaliserBougie } from './market.js';

// Plan repris du premier essai réel sur capture TradingView.
const SHORT = { direction: 'SELL', prixEntree: 86523, prixStopLoss: 86780, prixTp1: 86300, prixTp2: 86100 };
const LONG = { direction: 'BUY', prixEntree: 1.0842, prixStopLoss: 1.0821, prixTp1: 1.0889, prixTp2: 1.0931 };

/** Fabrique des bougies à partir de couples [plusHaut, plusBas]. */
const bougies = (...paires) =>
  paires.map(([h, l], i) => ({ ouvertureMs: 1_700_000_000_000 + i * 60_000, plusHaut: h, plusBas: l }));

const resoudre = (plan, b, horizon = 100, objectif = '2r') =>
  resoudreIssue({ plan, bougies: b, horizonBougies: horizon, objectif });

describe('resoudreIssue — entrée jamais atteinte', () => {
  it('déclare non déclenché quand l’horizon est couvert', () => {
    const b = bougies([86400, 86350], [86450, 86380], [86420, 86390]);
    expect(resoudre(SHORT, b, 3).statut).toBe('non_declenche');
  });

  it('reste en cours tant que l’horizon n’est pas couvert', () => {
    const b = bougies([86400, 86350], [86450, 86380]);
    const r = resoudre(SHORT, b, 100);
    expect(r.statut).toBe('en_cours');
    expect(r.detail.declencheLe).toBeNull();
  });
});

describe('resoudreIssue — short', () => {
  it('stop touché après déclenchement', () => {
    const b = bougies([86530, 86500], [86800, 86600]);
    const r = resoudre(SHORT, b, 10);
    expect(r.statut).toBe('stop');
    expect(r.detail.declencheLe).toBe(1_700_000_000_000);
  });

  it('TP1 atteint sous l’objectif 1 R', () => {
    const b = bougies([86530, 86500], [86520, 86280], [86400, 86350]);
    expect(resoudre(SHORT, b, 3, '1r').statut).toBe('tp1');
  });

  it('le même parcours n’est pas tranché sous l’objectif 2 R', () => {
    const b = bougies([86530, 86500], [86520, 86280], [86400, 86350]);
    expect(resoudre(SHORT, b, 3, '2r').statut).toBe('horizon_depasse');
  });

  it('TP2 atteint', () => {
    const b = bougies([86530, 86500], [86520, 86280], [86350, 86050]);
    expect(resoudre(SHORT, b, 3).statut).toBe('tp2');
  });

  it('TP1 puis stop est un STOP sous l’objectif 2 R', () => {
    // Le cas qui fabriquait du rendement : on ne peut pas encaisser 1 R en
    // passant ET tenir jusqu'à 2 R. Sous l'objectif 2 R, on n'était pas
    // sorti à 1 R — le stop est un stop.
    const b = bougies([86530, 86500], [86520, 86280], [86850, 86600]);
    expect(resoudre(SHORT, b, 10, '2r').statut).toBe('stop');
  });

  it('le même parcours est un gain sous l’objectif 1 R, parce qu’on en était sorti', () => {
    const b = bougies([86530, 86500], [86520, 86280], [86850, 86600]);
    expect(resoudre(SHORT, b, 10, '1r').statut).toBe('tp1');
  });

  it('bougie touchant stop ET objectif : ambigu, jamais deviné', () => {
    const b = bougies([86530, 86500], [86800, 86280]);
    const r = resoudre(SHORT, b, 10, '1r');
    expect(r.statut).toBe('ambigu');
    expect(r.detail.raison).toMatch(/ne dit pas dans quel ordre/);
  });

  it('ambigu dès la bougie de déclenchement', () => {
    // La bougie franchit l'entrée, le stop et TP1 : sous l'objectif 1 R son
    // OHLC ne dit pas l'ordre. Sous l'objectif 2 R, TP2 n'est pas atteint,
    // donc il n'y a rien d'ambigu — c'est un stop.
    const b = bougies([86850, 86250]);
    expect(resoudre(SHORT, b, 10, '1r').statut).toBe('ambigu');
    expect(resoudre(SHORT, b, 10, '2r').statut).toBe('stop');
  });
});

describe('resoudreIssue — long', () => {
  it('stop touché', () => {
    const b = bougies([1.0845, 1.0840], [1.0843, 1.0815]);
    expect(resoudre(LONG, b, 10).statut).toBe('stop');
  });

  it('TP1 atteint sous l’objectif 1 R', () => {
    const b = bougies([1.0845, 1.0840], [1.0895, 1.0860], [1.0880, 1.0870]);
    expect(resoudre(LONG, b, 3, '1r').statut).toBe('tp1');
  });

  it('TP2 atteint', () => {
    const b = bougies([1.0845, 1.0840], [1.0940, 1.0860]);
    expect(resoudre(LONG, b, 3).statut).toBe('tp2');
  });

  it('bougie ambiguë sous l’objectif 1 R', () => {
    const b = bougies([1.0845, 1.0840], [1.0895, 1.0810]);
    expect(resoudre(LONG, b, 10, '1r').statut).toBe('ambigu');
  });

  it('la même bougie est un stop sous l’objectif 2 R, qu’elle n’atteint pas', () => {
    // 1,0895 dépasse TP1 (1,0889) mais pas TP2 (1,0931) : sous l'objectif 2 R
    // il n'y a pas d'ambiguïté, seulement un stop.
    const b = bougies([1.0845, 1.0840], [1.0895, 1.0810]);
    expect(resoudre(LONG, b, 10, '2r').statut).toBe('stop');
  });
});

describe('resoudreIssue — horizon', () => {
  it('déclare l’horizon dépassé quand rien n’est touché', () => {
    const b = bougies([86530, 86500], [86540, 86450], [86560, 86400]);
    expect(resoudre(SHORT, b, 3).statut).toBe('horizon_depasse');
  });

  it('reste en cours si l’horizon n’est pas encore couvert', () => {
    const b = bougies([86530, 86500], [86540, 86450]);
    expect(resoudre(SHORT, b, 100).statut).toBe('en_cours');
  });

  it('ignore les bougies au-delà de l’horizon', () => {
    // Le stop n'est touché qu'à la 4e bougie, hors d'un horizon de 3.
    const b = bougies([86530, 86500], [86540, 86450], [86560, 86400], [86900, 86700]);
    expect(resoudre(SHORT, b, 3).statut).toBe('horizon_depasse');
    expect(resoudre(SHORT, b, 4).statut).toBe('stop');
  });
});

describe('statistiques', () => {
  it('ne compte que les issues tranchées', () => {
    expect(compteDansLesStats('tp1')).toBe(true);
    expect(compteDansLesStats('stop')).toBe(true);
    expect(compteDansLesStats('ambigu')).toBe(false);
    expect(compteDansLesStats('non_declenche')).toBe(false);
    expect(compteDansLesStats('en_cours')).toBe(false);
    expect(compteDansLesStats('horizon_depasse')).toBe(false);
  });

  it('identifie les gagnants', () => {
    expect(estGagnant('tp2')).toBe(true);
    expect(estGagnant('stop')).toBe(false);
  });
});

describe('symboleResolvable', () => {
  it('accepte une paire crypto cotée', () => {
    expect(symboleResolvable('BTCUSDT')).toBe('BTCUSDT');
    expect(symboleResolvable('BTC / USDT')).toBe('BTCUSDT');
  });
  it('refuse une paire forex', () => {
    expect(symboleResolvable('EURUSD')).toBeNull();
  });
  it('refuse une entrée absente', () => {
    expect(symboleResolvable(null)).toBeNull();
  });
});

describe('normaliserBougie', () => {
  it('extrait ouverture, plus haut et plus bas du format Binance', () => {
    expect(normaliserBougie([1700000000000, '86500.00', '86780.10', '86290.50', '86400.00']))
      .toEqual({ ouvertureMs: 1700000000000, plusHaut: 86780.1, plusBas: 86290.5 });
  });
});

describe('symboleResolvable — frontières', () => {
  it('accepte une base courte comme BTC', () => {
    expect(symboleResolvable('BTCUSDT')).toBe('BTCUSDT');
    expect(symboleResolvable('ETHBTC')).toBe('ETHBTC');
  });
  it('accepte une base longue', () => {
    expect(symboleResolvable('1000SATSUSDT')).toBe('1000SATSUSDT');
  });
  it('refuse les paires forex et les métaux', () => {
    for (const s of ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY']) {
      expect(symboleResolvable(s)).toBeNull();
    }
  });
  it('refuse une devise de cotation seule', () => {
    expect(symboleResolvable('USDT')).toBeNull();
  });
});

describe('objectif de sortie — pas de convention implicite', () => {
  it('refuse de résoudre sans objectif', () => {
    // La valeur par défaut est ce qui a faussé toutes les mesures
    // précédentes. Mieux vaut une exception qu'un chiffre.
    expect(() => resoudreIssue({ plan: SHORT, bougies: bougies([86530, 86500]), horizonBougies: 10 }))
      .toThrow(/Objectif de sortie manquant/);
  });

  it('refuse un objectif inconnu', () => {
    expect(() => resoudre(SHORT, bougies([86530, 86500]), 10, '3r')).toThrow(/Objectif de sortie/);
  });

  it('expose le seuil de rentabilité hors coûts de chaque règle', () => {
    expect(reglageObjectif('1r').seuil).toBe(0.5);
    expect(reglageObjectif('2r').seuil).toBeCloseTo(1 / 3, 6);
  });

  it('inscrit l’objectif dans le détail, pour que l’issue reste interprétable seule', () => {
    const b = bougies([86530, 86500], [86520, 86280], [86400, 86350]);
    expect(resoudre(SHORT, b, 3, '1r').detail.objectif).toBe('1r');
    expect(resoudre(SHORT, b, 3, '2r').detail.objectif).toBe('2r');
  });
});

describe('gainEnR', () => {
  it('rend le gain de la règle choisie', () => {
    expect(gainEnR('tp1', '1r')).toBe(1);
    expect(gainEnR('tp2', '2r')).toBe(2);
  });

  it('rend −1 pour un stop, quelle que soit la règle', () => {
    expect(gainEnR('stop', '1r')).toBe(-1);
    expect(gainEnR('stop', '2r')).toBe(-1);
  });

  it('ignore un statut étranger à la règle', () => {
    // Sous l'objectif 2 R, un « tp1 » ne peut pas exister ; s'il apparaît,
    // c'est un enregistrement d'une autre règle et il ne se compte pas.
    expect(gainEnR('tp2', '1r')).toBeNull();
    expect(gainEnR('tp1', '2r')).toBeNull();
    expect(gainEnR('ambigu', '1r')).toBeNull();
    expect(gainEnR('non_declenche', '2r')).toBeNull();
  });
});
