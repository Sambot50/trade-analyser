import { describe, it, expect } from 'vitest';
import { validerOptions, contreCourant } from './scanner-anomalies.mjs';

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
      ut: '15m', utCsv: '1m', fenetre: 60, nombre: 20, ecartMinutes: 120,
    });
  });
});


describe('volume à contre-courant', () => {
  /**
   * La case qui intéresse : acheter dans une baisse, ou vendre dans une
   * hausse. Suivre le flot ne demande ni raison ni moyens.
   */
  it('marque l’achat dans une baisse et la vente dans une hausse', () => {
    expect(contreCourant({ sens: 'achat', tendanceSemaine: 'baissiere' })).toBe(true);
    expect(contreCourant({ sens: 'vente', tendanceSemaine: 'haussiere' })).toBe(true);
  });

  it('ne marque pas la continuation', () => {
    expect(contreCourant({ sens: 'achat', tendanceSemaine: 'haussiere' })).toBe(false);
    expect(contreCourant({ sens: 'vente', tendanceSemaine: 'baissiere' })).toBe(false);
  });

  it('ne marque rien quand la tendance est plate ou inconnue', () => {
    expect(contreCourant({ sens: 'achat', tendanceSemaine: 'plate' })).toBe(false);
    expect(contreCourant({ sens: 'vente', tendanceSemaine: 'indetermine' })).toBe(false);
  });
});
