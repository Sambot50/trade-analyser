import { describe, expect, it } from 'vitest';
import { agregerTransactions, lireCote, repererColonnesTransactions } from './transactions.js';

const ENTETE = 'ts_event,rtype,publisher_id,instrument_id,action,side,price,size,symbol';
const ligne = (heure, cote, prix, taille, action = 'T', instrument = '9466') =>
  `2024-06-03T${heure}.000000000Z,0,1,${instrument},${action},${cote},${prix},${taille},GC.v.0`;

const fichier = (...lignes) => [ENTETE, ...lignes].join('\n');

describe('lireCote', () => {
  it('reconnaît les deux côtés de l’agresseur', () => {
    expect(lireCote('B')).toBe('acheteur');
    expect(lireCote('A')).toBe('vendeur');
    expect(lireCote('b')).toBe('acheteur');
  });

  it('rend null sur un côté inconnu plutôt que de choisir un camp', () => {
    expect(lireCote('N')).toBeNull();
    expect(lireCote('')).toBeNull();
    expect(lireCote(undefined)).toBeNull();
  });
});

describe('repererColonnesTransactions', () => {
  it('trouve les colonnes quel que soit leur ordre', () => {
    const c = repererColonnesTransactions(['size', 'side', 'price', 'ts_event']);
    expect(c.taille).toBe(0);
    expect(c.cote).toBe(1);
    expect(c.prix).toBe(2);
    expect(c.horodatage).toBe(3);
  });

  it('refuse un fichier sans côté, en nommant ce qui manque', () => {
    expect(() => repererColonnesTransactions(['ts_event', 'price', 'size']))
      .toThrow(/"cote" introuvable/);
  });
});

describe('agregerTransactions', () => {
  it('sépare le volume acheteur du volume vendeur', () => {
    const { bougies } = agregerTransactions(
      fichier(ligne('14:00:10', 'B', 2340.5, 12), ligne('14:00:20', 'A', 2340.1, 30)),
      { unite: '15m' },
    );
    expect(bougies).toHaveLength(1);
    expect(bougies[0].volumeAcheteur).toBe(12);
    expect(bougies[0].volumeVendeur).toBe(30);
    expect(bougies[0].volume).toBe(42);
    expect(bougies[0].delta).toBe(-18);
  });

  it('construit l’OHLC dans l’ordre des transactions', () => {
    const { bougies } = agregerTransactions(
      fichier(
        ligne('14:00:10', 'B', 2340, 1),
        ligne('14:05:00', 'B', 2345, 1),
        ligne('14:10:00', 'A', 2338, 1),
        ligne('14:14:59', 'A', 2341, 1),
      ),
      { unite: '15m' },
    );
    expect(bougies[0]).toMatchObject({ ouverture: 2340, plusHaut: 2345, plusBas: 2338, cloture: 2341 });
  });

  it('aligne les bornes sur l’époque, comme l’agrégation des bougies', () => {
    const { bougies } = agregerTransactions(
      fichier(ligne('14:07:00', 'B', 2340, 1), ligne('14:16:00', 'B', 2341, 1)),
      { unite: '15m' },
    );
    expect(bougies.map((b) => new Date(b.ouvertureMs).toISOString())).toEqual([
      '2024-06-03T14:00:00.000Z',
      '2024-06-03T14:15:00.000Z',
    ]);
  });

  it('ne crée pas de bougie fantôme pour un créneau sans transaction', () => {
    const { bougies } = agregerTransactions(
      fichier(ligne('14:00:00', 'B', 2340, 1), ligne('18:00:00', 'B', 2350, 1)),
      { unite: '15m' },
    );
    expect(bougies).toHaveLength(2);
  });

  it('compte le volume sans côté dans le total, dans aucun camp, et le signale', () => {
    const r = agregerTransactions(
      fichier(ligne('14:00:10', 'B', 2340, 10), ligne('14:00:20', 'N', 2340, 90)),
      { unite: '15m' },
    );
    expect(r.bougies[0].volume).toBe(100);
    expect(r.bougies[0].volumeAcheteur).toBe(10);
    expect(r.bougies[0].volumeVendeur).toBe(0);
    expect(r.partSansCote).toBe(90);
  });

  it('écarte les évènements qui ne sont pas des transactions', () => {
    const r = agregerTransactions(
      fichier(ligne('14:00:10', 'B', 2340, 10), ligne('14:00:11', 'A', 2340, 999, 'C')),
      { unite: '15m' },
    );
    expect(r.bougies[0].volume).toBe(10);
    expect(r.ignorees).toBe(1);
  });

  it('retient le contrat, seul discriminant fiable entre échéances', () => {
    const { bougies } = agregerTransactions(
      fichier(ligne('14:00:10', 'B', 2340, 1, 'T', '9466')),
      { unite: '15m' },
    );
    expect(bougies[0].symbole).toBe('9466');
  });

  it('refuse une taille illisible en nommant la ligne', () => {
    expect(() => agregerTransactions(fichier(ligne('14:00:10', 'B', 2340, 'douze')), { unite: '15m' }))
      .toThrow(/Ligne 2/);
  });

  it('refuse un fichier sans en-tête exploitable', () => {
    expect(() => agregerTransactions('ts_event,price,size\n', { unite: '15m' })).toThrow();
  });
});
