import { describe, it, expect } from 'vitest';
import { lireJsonl, positionsDepuisDeals } from './mt5.js';

// Forme exacte d'une transaction du paquet MetaTrader5, plus `heureUtc` ajouté
// par le pont.
const deal = (x) => ({
  ticket: 1, order: 0, type: 0, entry: 0, magic: 0, position_id: 1, volume: 0.1, price: 0,
  commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'XAUUSD', comment: '', heureUtc: '2026-07-15T12:30:00Z', ...x,
});

describe('positionsDepuisDeals', () => {
  // Achat 0,10 lot à 4000, stop 3990, sortie à 4020 : +200 $ brut, 10 $ de risque par point × 10 points de stop.
  const deals = [
    deal({ ticket: 10, order: 100, type: 0, entry: 0, position_id: 77, price: 4000, commission: -0.35, comment: 'OB 4h' }),
    deal({ ticket: 11, order: 101, type: 1, entry: 1, position_id: 77, price: 4020, commission: -0.35, swap: -0.12, profit: 200, heureUtc: '2026-07-15T14:00:00Z' }),
  ];
  const ordres = [{ ticket: 100, sl: 3990, tp: 4020, comment: 'OB 4h' }];

  it('reconstitue une position fermée, avec ses frais et sa durée', () => {
    const { positions, anomalies } = positionsDepuisDeals(deals, ordres);
    expect(anomalies).toEqual([]);
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p).toMatchObject({
      position: 77, symbole: 'XAUUSD', sens: 'achat', statut: 'fermee', volume: 0.1,
      prixEntree: 4000, prixSortie: 4020, stop: 3990, objectif: 4020, setup: 'OB 4h', dureeMin: 90,
    });
    expect(p.net).toBeCloseTo(200 - 0.7 - 0.12);
  });

  it('calcule le R sur le stop posé à l’ouverture, net des frais', () => {
    const [p] = positionsDepuisDeals(deals, ordres).positions;
    // 20 points gagnés pour 10 de stop : 2 R bruts. Le risque vaut 100 $.
    expect(p.rBrut).toBeCloseTo(2);
    expect(p.rNet).toBeCloseTo((200 - 0.82) / 100);
  });

  it('laisse le R inconnu quand aucun stop n’était posé à l’ouverture', () => {
    const [p] = positionsDepuisDeals(deals, [{ ticket: 100, sl: 0, tp: 0 }]).positions;
    expect(p.stop).toBeNull();
    expect(p.rNet).toBeNull();
  });

  it('moyenne les clôtures partielles, et garde ouverte une position pas entièrement soldée', () => {
    const partiel = [
      deal({ ticket: 1, type: 1, entry: 0, position_id: 5, volume: 0.2, price: 4100 }),
      deal({ ticket: 2, type: 0, entry: 1, position_id: 5, volume: 0.1, price: 4090, profit: 100, heureUtc: '2026-07-15T13:00:00Z' }),
    ];
    const [ouverte] = positionsDepuisDeals(partiel).positions;
    expect(ouverte).toMatchObject({ sens: 'vente', statut: 'ouverte', fermeture: null });

    partiel.push(deal({ ticket: 3, type: 0, entry: 1, position_id: 5, volume: 0.1, price: 4070, profit: 300, heureUtc: '2026-07-15T14:00:00Z' }));
    const [fermee] = positionsDepuisDeals(partiel).positions;
    expect(fermee.statut).toBe('fermee');
    expect(fermee.prixSortie).toBeCloseTo(4080);
    expect(fermee.brut).toBe(400);
  });

  it('range les dépôts à part, et signale ce qu’il ne sait pas reconstituer', () => {
    const { positions, mouvements, anomalies } = positionsDepuisDeals([
      deal({ type: 2, profit: 1000, comment: 'dépôt' }),
      deal({ ticket: 4, type: 1, entry: 1, position_id: 9, price: 4000 }),
      deal({ ticket: 5, type: 0, entry: 2, position_id: 8, price: 4000 }),
    ]);
    expect(positions).toEqual([]);
    expect(mouvements).toEqual([{ heureUtc: '2026-07-15T12:30:00Z', montant: 1000, commentaire: 'dépôt' }]);
    expect(anomalies.map((a) => a.position)).toEqual([9, 8]);
    expect(anomalies[0].quoi).toMatch(/élargis --depuis/);
  });
});

describe('lireJsonl', () => {
  it('rend les numéros des lignes illisibles au lieu de les avaler', () => {
    expect(lireJsonl('{"a":1}\n{ cassé\n\n{"b":2}\n')).toEqual({ lignes: [{ a: 1 }, { b: 2 }], illisibles: [2] });
  });
});
