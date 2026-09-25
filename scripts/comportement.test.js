import { describe, it, expect } from 'vitest';
import { validerOptions } from './comportement.mjs';

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
