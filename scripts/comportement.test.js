import { describe, it, expect } from 'vitest';
import { validerOptions, partsAtteintes } from './comportement.mjs';

describe('options', () => {
  it('exige un fichier', () => {
    expect(validerOptions({}).erreurs).toContain('--csv attend un chemin de fichier');
  });

  it('refuse un horizon de familles inconnu', () => {
    expect(validerOptions({ csv: 'x.csv', horizon: 'mois' }).erreurs.join(' ')).toMatch(/--horizon/);
    expect(validerOptions({ csv: 'x.csv', horizon: 'jour' }).horizon).toBe('jour');
  });

  it('lit la semaine par défaut', () => {
    expect(validerOptions({ csv: 'x.csv' }).horizon).toBe('semaine');
  });

  it('refuse une unité plus fine que le fichier', () => {
    expect(validerOptions({ csv: 'x.csv', ut: '1m', utCsv: '5m' }).erreurs.join(' ')).toMatch(/--ut/);
  });

  it('retient les défauts, dont l’unité de quinze minutes', () => {
    expect(validerOptions({ csv: 'x.csv' })).toMatchObject({
      ut: '15m', utCsv: '1m', fenetre: 60, horizonHeures: 24,
    });
  });
});

// Le témoin est ce qui sépare une mesure d'une impression. Ces tests portent
// sur le calcul qui le rend lisible, pas sur l'affichage.
describe('parts atteintes', () => {
  const cas = (...verdicts) => verdicts.map((v) => ({ ordre: { 1: v, 1.5: v, 2: v, 3: v } }));

  it('compte la part d’objectifs atteints', () => {
    expect(partsAtteintes(cas('atteint', 'atteint', 'perdu', 'perdu'))[0]).toBe(50);
  });

  it('écarte les verdicts ambigus du dénominateur plutôt que de trancher', () => {
    // Un « ambigu » est une bougie qui touche l'objectif ET le stop : on ne
    // sait pas lequel est arrivé en premier. Le compter comme perdu
    // sous-estimerait, comme atteint surestimerait. DEC-015 est née d'une
    // supposition de ce genre.
    expect(partsAtteintes(cas('atteint', 'perdu', 'ambigu', 'ni_lun_ni_lautre'))[0]).toBe(50);
  });

  it('rend null quand aucun verdict n’est exploitable', () => {
    expect(partsAtteintes(cas('ambigu', 'ni_lun_ni_lautre'))[0]).toBeNull();
  });

  it('rend null sur une famille vide', () => {
    expect(partsAtteintes([])[0]).toBeNull();
  });
});
