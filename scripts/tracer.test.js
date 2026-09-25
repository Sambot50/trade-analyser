import { describe, it, expect } from 'vitest';
import { validerOptions, fenetreJusqua } from './tracer.mjs';

const bougie = (i) => ({
  ouvertureMs: i * 3_600_000,
  fermetureMs: i * 3_600_000 + 3_599_999,
  ouverture: 2000, plusHaut: 2005, plusBas: 1995, cloture: 2002, volume: 100,
});
const serie = (n) => Array.from({ length: n }, (_, i) => bougie(i));

describe('fenêtre jusqu’à un instant', () => {
  /**
   * L'invariant de tout le chemin vision. Une seule bougie du futur dans
   * l'image, et le modèle lirait la réponse au lieu de la prédire.
   */
  it('exclut toute bougie dont la fermeture dépasse l’instant demandé', () => {
    const s = serie(10);
    // Instant pile sur l'ouverture de la bougie 5 : celle-ci n'est pas fermée.
    const f = fenetreJusqua(s, s[5].ouvertureMs, 10);
    expect(f.at(-1).fermetureMs).toBeLessThanOrEqual(s[5].ouvertureMs);
    expect(f.at(-1)).toBe(s[4]);
  });

  it('garde une bougie fermée exactement à l’instant demandé', () => {
    const s = serie(10);
    expect(fenetreJusqua(s, s[5].fermetureMs, 10).at(-1)).toBe(s[5]);
  });

  it('ne rend que les `nombre` dernières', () => {
    const f = fenetreJusqua(serie(100), undefined, 30);
    expect(f).toHaveLength(30);
    expect(f[0].ouvertureMs).toBe(70 * 3_600_000);
  });

  it('rend tout ce qu’il y a quand il y en a moins que demandé', () => {
    expect(fenetreJusqua(serie(8), undefined, 30)).toHaveLength(8);
  });

  it('refuse plutôt que de tracer une image vide', () => {
    expect(() => fenetreJusqua(serie(10), 0, 30)).toThrow(/Aucune bougie fermée/);
    expect(() => fenetreJusqua([], undefined, 30)).toThrow(/Aucune bougie/);
  });
});

describe('options', () => {
  it('exige un fichier', () => {
    expect(validerOptions({}).erreurs).toContain('--csv attend un chemin de fichier');
  });

  it('refuse une unité plus fine que celle du fichier', () => {
    const o = validerOptions({ csv: 'x.csv', ut: '1m', utCsv: '1h' });
    expect(o.erreurs.join(' ')).toMatch(/inventer des bougies/);
  });

  it('refuse une date illisible', () => {
    expect(validerOptions({ csv: 'x.csv', a: 'hier' }).erreurs.join(' ')).toMatch(/date valide/);
  });

  it('lit une date ISO en millisecondes', () => {
    expect(validerOptions({ csv: 'x.csv', a: '2023-06-15T14:00:00Z' }).aMs)
      .toBe(Date.UTC(2023, 5, 15, 14, 0, 0));
  });

  it('refuse une fenêtre trop courte pour montrer une structure', () => {
    expect(validerOptions({ csv: 'x.csv', bougies: 3 }).erreurs.join(' ')).toMatch(/≥ 10/);
  });
});
