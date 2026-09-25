import { describe, expect, it } from 'vitest';
import { comparer, validerOptions, verdict } from './verifier-cote.mjs';

const bougie = (o, c, acheteur, vendeur) => ({
  ouvertureMs: 0, ouverture: o, cloture: c, plusHaut: Math.max(o, c), plusBas: Math.min(o, c),
  volume: acheteur + vendeur, volumeAcheteur: acheteur, volumeVendeur: vendeur,
  delta: acheteur - vendeur,
});

describe('validerOptions', () => {
  it('exige un fichier', () => expect(() => validerOptions({})).toThrow(/--csv/));
  it('refuse une unité inconnue', () =>
    expect(() => validerOptions({ csv: 'x', ut: '7m' })).toThrow(/--ut inconnue/));
  it('retient 15 minutes par défaut', () => expect(validerOptions({ csv: 'x' }).ut).toBe('15m'));
});

describe('comparer', () => {
  it('compte un accord quand le proxy et l’agresseur disent la même chose', () => {
    const r = comparer([bougie(100, 105, 80, 20)]);
    expect(r.accords).toBe(1);
    expect(r.desaccords).toBe(0);
    expect(r.tauxAccord).toBe(100);
  });

  it('compte un désaccord quand la bougie monte alors que les vendeurs dominent', () => {
    const r = comparer([bougie(100, 105, 20, 80)]);
    expect(r.desaccords).toBe(1);
    expect(r.fautes[0]).toMatchObject({ proxy: 'achat', vrai: 'vente', desequilibre: 60 });
  });

  it('ne juge pas une bougie dont la clôture égale l’ouverture', () => {
    const r = comparer([bougie(100, 100, 80, 20)]);
    expect(r.juges).toBe(0);
    expect(r.proxyMuet).toBe(1);
    expect(r.tauxAccord).toBeNull();
  });

  it('ne juge pas un delta nul', () => {
    const r = comparer([bougie(100, 105, 50, 50)]);
    expect(r.juges).toBe(0);
    expect(r.vraiMuet).toBe(1);
  });

  it('écarte les bougies sous le seuil de volume', () => {
    const r = comparer([bougie(100, 105, 20, 80), bougie(100, 105, 800, 200)], { seuilVolume: 500 });
    expect(r.bougies).toBe(1);
    expect(r.accords).toBe(1);
  });

  it('classe les désaccords du plus franc au plus douteux', () => {
    const r = comparer([bougie(100, 105, 49, 51), bougie(100, 105, 5, 95)]);
    expect(r.fautes.map((f) => f.desequilibre)).toEqual([90, 2]);
  });
});

describe('verdict', () => {
  it('ne déclare pas fiable un proxy qui se trompe une fois sur cinq', () => {
    expect(verdict(80)).toMatch(/approximatif/);
    expect(verdict(96)).toMatch(/fiable/);
    expect(verdict(55)).toMatch(/INUTILISABLE/);
    expect(verdict(null)).toMatch(/aucune/);
  });
});
