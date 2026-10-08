import { describe, it, expect } from 'vitest';
import { tableauDesSeuils, SEUILS_ATR, TEMOIN } from './mesure-mouvement.mjs';

const r = (atr, statut) => ({ statut, qualificatifs: { mouvementEnAtr: atr }, coutEnR: null, plan: { prixEntree: 100, prixStopLoss: 99 } });

describe('mesure du « fort mouvement »', () => {
  it('fige quatre seuils et un témoin, sans option pour les changer', () => {
    expect(SEUILS_ATR).toEqual([1, 1.5, 2, 3]);
    expect(Object.isFrozen(SEUILS_ATR)).toBe(true);
    expect(TEMOIN).toEqual({ tirages: 20, graine: 20261007 });
  });

  it('filtre par seuil et compte les issues à 2 R', () => {
    const resultats = [r(0.5, 'stop'), r(1.2, 'tp2'), r(1.8, 'stop'), r(2.5, 'tp2'), r(3.5, 'tp2')];
    const lignes = tableauDesSeuils(resultats);
    expect(lignes.map((l) => l.orderBlocks)).toEqual([5, 4, 3, 2, 1]);
    expect(lignes.map((l) => l.gagnants)).toEqual([3, 3, 2, 2, 1]);
    // Référence : 3 gagnants à 2 R, 2 perdants à −1 R → (6 − 2) / 5 = +0,8 R.
    expect(lignes[0].esperance).toBe(0.8);
  });

  it('écarte de toutes les lignes un OB dont la force est inconnue', () => {
    const lignes = tableauDesSeuils([r(null, 'tp2'), r(2.5, 'stop')]);
    expect(lignes[0].orderBlocks).toBe(1);
    expect(lignes[0].gagnants).toBe(0);
  });
});
