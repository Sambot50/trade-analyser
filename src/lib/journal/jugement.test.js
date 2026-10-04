import { describe, it, expect } from 'vitest';

import {
  ETATS, ETAT_INITIAL, idOrderBlock, etatValide, ligneTrouvaille, ligneJugement,
  fileDAttente, compteParEtat, tauxValidation, orderBlocksDe,
} from './jugement.js';
import { reduireIndex } from './schema.js';

const record = {
  id: '2026-10-03T13:45:12Z-XAUUSD-15m-mesure',
  horodatage: '2026-10-03T13:45:12Z',
  marche: { symbole: 'XAUUSD', uniteTemps: '15m' },
};
const ob = { type: 'order_block', indexBougie: 71, sens: 'haussier',
  prixHautDeZone: 4180.5, prixBasDeZone: 4166.2,
  qualificatifs: { priseDeLiquidite: true, fvg: true, ote: false } };

describe('idOrderBlock', () => {
  it('porte l’enregistrement dont il vient', () => {
    expect(idOrderBlock(record.id, 71)).toBe('2026-10-03T13:45:12Z-XAUUSD-15m-mesure#ob71');
  });
});

describe('ligneTrouvaille', () => {
  const l = ligneTrouvaille(record, ob, '2026-10-03/134512-XAUUSD-15m-mesure');

  it('naît EN ATTENTE, pas jugée', () => {
    // Une zone détectée n'a rien prouvé : le prix n'y est pas encore revenu.
    expect(l.etat).toBe(ETAT_INITIAL);
  });

  it('porte de quoi se juger sans ouvrir le moindre fichier', () => {
    // Une ligne par order block, et non une par mesure : c'est ce qui permet à
    // index.jsonl de rester le seul fichier à lire.
    expect(l).toMatchObject({
      type: 'order_block', symbole: 'XAUUSD', uniteTemps: '15m',
      sens: 'haussier', prixBasDeZone: 4166.2, indexBougie: 71,
      dossier: '2026-10-03/134512-XAUUSD-15m-mesure',
    });
    expect(l.qualificatifs.priseDeLiquidite).toBe(true);
  });
});

describe('ligneJugement', () => {
  it('ne répète QUE ce qui change', () => {
    // L'index est un journal : une ligne dit « voici ce qui est devenu vrai »,
    // pas « voici l'état complet ». Y recopier le reste inviterait à écrire
    // deux versions d'un même fait.
    const j = ligneJugement({ id: 'x#ob3', etat: 'valide', note: 'rejet net', horodatage: '2026-10-05T08:00:00Z' });
    expect(j).toEqual({
      schemaVersion: expect.any(Number), type: 'order_block', id: 'x#ob3',
      maj: '2026-10-05T08:00:00Z', etat: 'valide', note: 'rejet net',
    });
    expect(j.symbole).toBeUndefined();
  });

  it('refuse un état inventé', () => {
    expect(() => ligneJugement({ id: 'x', etat: 'peut-être', horodatage: 'h' })).toThrow(/État inconnu/);
    expect(etatValide('valide')).toBe(true);
    expect(etatValide('bof')).toBe(false);
  });

  it('se fusionne avec la ligne d’origine par l’identifiant', () => {
    const detectee = ligneTrouvaille(record, ob, 'd');
    const jugee = ligneJugement({ id: detectee.id, etat: 'invalide', horodatage: '2026-10-05T08:00:00Z' });
    const [fusion] = reduireIndex([detectee, jugee]);
    expect(fusion.etat).toBe('invalide');
    expect(fusion.symbole).toBe('XAUUSD');     // conservé de la ligne d'origine
    expect(fusion.prixBasDeZone).toBe(4166.2);
  });
});

describe('fileDAttente', () => {
  const l = (id, h, etat, symbole = 'XAUUSD') => ({ type: 'order_block', id, horodatage: h, etat, symbole });
  const lignes = [
    l('a', '2026-10-05T10:00:00Z', 'en_attente'),
    l('b', '2026-10-01T10:00:00Z', 'en_attente'),
    l('c', '2026-10-02T10:00:00Z', 'valide'),
    l('d', '2026-10-03T10:00:00Z', 'en_attente', 'BTCUSD'),
    { type: 'mesure', id: 'm', horodatage: '2026-10-01T09:00:00Z' },
  ];

  it('rend les plus ANCIENNES d’abord', () => {
    // Une zone de trois jours a eu le temps d'être tranchée, une de dix
    // minutes non. Les récentes en tête rempliraient la file de cas qu'on ne
    // peut pas juger.
    expect(fileDAttente(lignes).map((x) => x.id)).toEqual(['b', 'd', 'a']);
  });

  it('ignore ce qui est déjà jugé, et ce qui n’est pas un order block', () => {
    expect(fileDAttente(lignes).map((x) => x.id)).not.toContain('c');
    expect(fileDAttente(lignes).map((x) => x.id)).not.toContain('m');
  });

  it('se filtre par symbole', () => {
    expect(fileDAttente(lignes, { symbole: 'BTCUSD' }).map((x) => x.id)).toEqual(['d']);
  });

  it('traite une ligne sans état comme en attente', () => {
    expect(fileDAttente([{ type: 'order_block', id: 'z', horodatage: 'h' }])).toHaveLength(1);
  });
});

describe('tauxValidation', () => {
  const l = (etat) => ({ type: 'order_block', id: Math.random(), etat });

  it('EXCLUT les zones en attente du dénominateur', () => {
    // Une zone que le prix n'a pas encore atteinte n'a rien échoué. Les
    // compter perdantes ferait baisser le taux à mesure qu'on détecte.
    const t = tauxValidation([l('valide'), l('valide'), l('invalide'), l('en_attente'), l('en_attente')]);
    expect(t).toMatchObject({ valide: 2, invalide: 1, enAttente: 2, tranches: 3 });
    expect(t.taux).toBeCloseTo(2 / 3, 6);
  });

  it('rend null plutôt que zéro quand rien n’est tranché', () => {
    // Zéro pour cent dirait « ça ne marche pas ». Null dit « on ne sait pas ».
    expect(tauxValidation([l('en_attente')]).taux).toBeNull();
    expect(tauxValidation([]).taux).toBeNull();
  });

  it('compte chaque état, y compris absent', () => {
    expect(compteParEtat([{ type: 'order_block', id: 'x' }])).toEqual({ en_attente: 1, valide: 0, invalide: 0 });
    expect(ETATS).toEqual(['en_attente', 'valide', 'invalide']);
    expect(orderBlocksDe(null)).toEqual([]);
  });
});
