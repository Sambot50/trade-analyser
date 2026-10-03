import { describe, it, expect } from 'vitest';

import { lireEvenements, calculerR, reconstituer, bilan, BARRE, MINIMUM } from './carnet.js';

const ouv = (id, sur = {}) => ({
  t: 'ouverture', id, le: '2026-10-01T10:00:00.000Z',
  sens: 'achat', entree: 100, stop: 10, tranche: 2.4, marche: 'GC', ...sur,
});
const fer = (id, sur = {}) => ({
  t: 'fermeture', id, le: '2026-10-01T14:00:00.000Z', sortie: 115, issue: 'objectif', ...sur,
});
const rejouer = (...e) => reconstituer(e.map((x, i) => ({ ...x, ligne: i + 1 })));

describe('lireEvenements', () => {
  it('lit une ligne par évènement et numérote', () => {
    const { evenements, illisibles } = lireEvenements('{"t":"a"}\n\n  \n{"t":"b"}\n');
    expect(evenements.map((e) => e.t)).toEqual(['a', 'b']);
    expect(evenements.map((e) => e.ligne)).toEqual([1, 4]);
    expect(illisibles).toEqual([]);
  });

  it('SIGNALE une ligne illisible au lieu de l’écarter — un carnet amputé flatte la moyenne', () => {
    const { evenements, illisibles } = lireEvenements('{"t":"a"}\n{cassé\n{"t":"b"}');
    expect(evenements).toHaveLength(2);
    expect(illisibles).toHaveLength(1);
    expect(illisibles[0].ligne).toBe(2);
  });

  it('refuse une ligne qui n’est pas un objet', () => {
    expect(lireEvenements('42\n"texte"').illisibles).toHaveLength(2);
  });

  it('ne bronche pas sur un fichier vide ou absent', () => {
    for (const v of ['', null, undefined]) {
      expect(lireEvenements(v)).toEqual({ evenements: [], illisibles: [] });
    }
  });
});

describe('calculerR', () => {
  it('compte 1 R comme la distance du stop', () => {
    expect(calculerR(ouv(1), fer(1)).brut).toBeCloseTo(1.5, 9);        // +15 ÷ 10
    expect(calculerR(ouv(1), fer(1, { sortie: 90 })).brut).toBeCloseTo(-1, 9);
  });

  it('retranche les frais, rapportés eux aussi au stop', () => {
    const r = calculerR(ouv(1), fer(1, { frais: 0.5 }));
    expect(r.frais).toBeCloseTo(0.05, 9);
    expect(r.net).toBeCloseTo(1.45, 9);
  });

  it('compte des frais toujours positifs, quel que soit leur signe', () => {
    expect(calculerR(ouv(1), fer(1, { frais: -0.5 })).net).toBeCloseTo(1.45, 9);
  });

  it('traite une vente dans son propre sens', () => {
    const v = ouv(1, { sens: 'vente' });
    expect(calculerR(v, fer(1, { sortie: 85 })).brut).toBeCloseTo(1.5, 9);
    expect(calculerR(v, fer(1, { sortie: 110 })).brut).toBeCloseTo(-1, 9);
  });

  it('refuse de calculer sans sens, sans stop ou sans prix', () => {
    expect(calculerR(ouv(1, { sens: 'long' }), fer(1))).toBeNull();
    expect(calculerR(ouv(1, { stop: 0 }), fer(1))).toBeNull();
    expect(calculerR(ouv(1, { entree: NaN }), fer(1))).toBeNull();
    expect(calculerR(ouv(1), fer(1, { sortie: 'cher' }))).toBeNull();
  });
});

describe('reconstituer', () => {
  it('apparie ouverture et fermeture, et range la tranche', () => {
    const { fermes, ouverts, anomalies } = rejouer(ouv(1), fer(1));
    expect(anomalies).toEqual([]);
    expect(ouverts).toEqual([]);
    expect(fermes).toHaveLength(1);
    expect(fermes[0]).toMatchObject({ id: 1, tranche: '2–3×', issue: 'objectif', marche: 'GC' });
    expect(fermes[0].brut).toBeCloseTo(1.5, 9);
  });

  it('laisse ouverts les trades non fermés', () => {
    const { fermes, ouverts } = rejouer(ouv(1), ouv(2), fer(1));
    expect(fermes.map((t) => t.id)).toEqual([1]);
    expect(ouverts.map((o) => o.id)).toEqual([2]);
  });

  it('signale une fermeture sans ouverture', () => {
    const { anomalies, fermes } = rejouer(fer(7));
    expect(fermes).toEqual([]);
    expect(anomalies[0].quoi).toMatch(/sans ouverture/);
  });

  it('signale une double fermeture et ne compte le trade qu’une fois', () => {
    const { fermes, anomalies } = rejouer(ouv(1), fer(1), fer(1, { sortie: 200 }));
    expect(fermes).toHaveLength(1);
    expect(anomalies[0].quoi).toMatch(/deux fois/);
  });

  it('signale une ouverture en double', () => {
    expect(rejouer(ouv(1), ouv(1)).anomalies[0].quoi).toMatch(/en double/);
  });

  it('signale un carnet rempli après coup, sans refuser le trade', () => {
    const { fermes, anomalies } = rejouer(ouv(1), fer(1, { le: '2026-09-30T10:00:00.000Z' }));
    expect(fermes).toHaveLength(1);
    expect(anomalies[0].quoi).toMatch(/AVANT son ouverture/);
  });

  it('refuse une ouverture sans stop — aucun R n’en sortirait', () => {
    const { ouverts, anomalies } = rejouer(ouv(1, { stop: 0 }));
    expect(ouverts).toEqual([]);
    expect(anomalies[0].quoi).toMatch(/sans stop/);
  });

  it('refuse un sens inconnu et un évènement inconnu', () => {
    expect(rejouer(ouv(1, { sens: 'long' })).anomalies[0].quoi).toMatch(/sens inconnu/);
    expect(rejouer({ t: 'modification', id: 1 }).anomalies[0].quoi).toMatch(/inconnu/);
  });

  it('laisse la tranche à null quand aucun rapport de volume n’est noté', () => {
    expect(rejouer(ouv(1, { tranche: null }), fer(1)).fermes[0].tranche).toBeNull();
  });
});

describe('bilan', () => {
  const trades = (...R) => R.map((brut, i) => ({
    id: i + 1, brut, net: brut - 0.03, frais: 0.03,
    issue: brut > 0 ? 'objectif' : 'stop', tranche: '2–3×', sens: 'achat',
  }));

  it('rend l’espérance brute et nette avec leur erreur type', () => {
    const b = bilan(trades(1.5, -1, 1.5, -1));
    expect(b.brut.moyenne).toBeCloseTo(0.25, 9);
    expect(b.net.moyenne).toBeCloseTo(0.22, 9);
    expect(b.brut.n).toBe(4);
    expect(b.brut.erreurType).toBeGreaterThan(0);
  });

  it('situe la brute par rapport à la barre de DEC-034', () => {
    const b = bilan(trades(1.5, -1, 1.5, -1));
    expect(b.barre).toBe(BARRE);
    expect(b.marge).toBeCloseTo((0.25 - BARRE) / b.brut.erreurType, 9);
  });

  it('refuse de conclure sous le minimum, et le dit', () => {
    expect(bilan(trades(...Array(MINIMUM - 1).fill(0.5))).assez).toBe(false);
    expect(bilan(trades(...Array(MINIMUM).fill(0.5))).assez).toBe(true);
  });

  it('ventile par issue, par tranche et par sens', () => {
    const b = bilan(trades(1.5, -1, -1));
    expect(b.parIssue.map((r) => [r.cle, r.n])).toEqual([['stop', 2], ['objectif', 1]]);
    expect(b.parTranche[0]).toMatchObject({ cle: '2–3×', n: 3 });
    expect(b.parSens[0]).toMatchObject({ cle: 'achat', n: 3 });
  });

  it('ne prétend pas à une erreur type sur un seul trade', () => {
    const b = bilan(trades(1.5));
    expect(b.brut.ecartType).toBeNull();
    expect(b.marge).toBeNull();
  });

  it('rend null sans aucun trade fermé', () => expect(bilan([])).toBeNull());
});
