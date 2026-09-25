import { describe, it, expect } from 'vitest';
import { validerOptions } from './scanner-anomalies.mjs';

describe('options du scanner', () => {
  it('exige un fichier', () => {
    expect(validerOptions({}).erreurs).toContain('--csv attend un chemin de fichier');
  });

  it('refuse une unité plus fine que celle du fichier', () => {
    expect(validerOptions({ csv: 'x.csv', ut: '1m', utCsv: '5m' }).erreurs.join(' '))
      .toMatch(/inventer des bougies/);
  });

  it('refuse un détecteur inconnu, et le dit avec la liste', () => {
    const e = validerOptions({ csv: 'x.csv', detecteur: 'intuition' }).erreurs.join(' ');
    expect(e).toMatch(/intuition/);
    expect(e).toMatch(/absorption/);
  });

  it('refuse une fenêtre de référence trop courte pour être une référence', () => {
    expect(validerOptions({ csv: 'x.csv', fenetre: 5 }).erreurs.join(' ')).toMatch(/--fenetre/);
  });

  it('retient des défauts explicites', () => {
    expect(validerOptions({ csv: 'x.csv' })).toMatchObject({
      ut: '5m', utCsv: '1m', fenetre: 60, nombre: 20, ecartMinutes: 120,
    });
  });
});
