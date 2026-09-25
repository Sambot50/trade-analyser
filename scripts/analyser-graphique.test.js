import { describe, it, expect } from 'vitest';
import { validerOptions, bougiesApres } from './analyser-graphique.mjs';

const bougie = (i) => ({
  ouvertureMs: i * 300_000,
  fermetureMs: i * 300_000 + 299_999,
  ouverture: 2000, plusHaut: 2005, plusBas: 1995, cloture: 2002, volume: 100,
});
const serie = (n) => Array.from({ length: n }, (_, i) => bougie(i));

describe('bougies de résolution', () => {
  /**
   * La frontière qui tient toute la mesure : l'image montre l'avant,
   * la résolution ne voit que l'après. Rien ne la traverse.
   */
  it('ne garde que les bougies ouvrant à l’instant demandé ou après', () => {
    const s = serie(10);
    const apres = bougiesApres(s, s[4].ouvertureMs);
    expect(apres[0]).toBe(s[4]);
    expect(apres).toHaveLength(6);
  });

  it('rend une liste vide quand l’instant est après la fin', () => {
    expect(bougiesApres(serie(5), 10_000_000)).toHaveLength(0);
  });
});

describe('options', () => {
  const base = { csv: 'x.csv', a: '2023-06-15T14:00:00Z' };

  it('exige un fichier et un instant', () => {
    const e = validerOptions({}).erreurs.join(' ');
    expect(e).toMatch(/--csv/);
    expect(e).toMatch(/--a manquant/);
  });

  it('refuse une unité d’affichage plus fine que le fichier', () => {
    expect(validerOptions({ ...base, ut: '1m', utCsv: '1h' }).erreurs.join(' '))
      .toMatch(/inventer des bougies/);
  });

  it('refuse une résolution plus fine que le fichier', () => {
    expect(validerOptions({ ...base, utResolution: '1m', utCsv: '5m' }).erreurs.join(' '))
      .toMatch(/--ut-resolution/);
  });

  it('refuse un objectif ou un remplissage inconnus', () => {
    expect(validerOptions({ ...base, objectif: '3r' }).erreurs.join(' ')).toMatch(/--objectif/);
    expect(validerOptions({ ...base, remplissage: 'magique' }).erreurs.join(' ')).toMatch(/--remplissage/);
  });

  it('retient des défauts explicites plutôt que des surprises', () => {
    const o = validerOptions(base);
    expect(o).toMatchObject({
      ut: '1h', utResolution: '5m', bougies: 90,
      objectif: '1r', remplissage: 'cloture', horizonHeures: 48,
    });
  });
});
