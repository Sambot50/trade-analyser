import { describe, it, expect } from 'vitest';
import { validerOptions, fenetreAutour, nomDePlanche } from './inspecter.mjs';

const bougie = (i) => ({
  ouvertureMs: i * 3_600_000,
  fermetureMs: i * 3_600_000 + 3_599_999,
  ouverture: 2000, plusHaut: 2005, plusBas: 1995, cloture: 2002, volume: 100,
});
const serie = (n) => Array.from({ length: n }, (_, i) => bougie(i));

describe('fenêtre autour d’une anomalie', () => {
  /**
   * L'anomalie vient d'un scan plus fin que la planche : son instant ne tombe
   * pas sur une ouverture. Sans « la bougie qui le contient », rien ne serait
   * marqué et l'œil chercherait en vain.
   */
  it('retient la bougie qui contient l’instant, pas celle qui l’ouvre', () => {
    const s = serie(50);
    const auMilieu = s[20].ouvertureMs + 1_800_000;
    expect(fenetreAutour(s, auMilieu, { avant: 5, apres: 5 }).marquerMs).toBe(s[20].ouvertureMs);
  });

  it('prend le nombre de bougies demandé de chaque côté', () => {
    const s = serie(100);
    const f = fenetreAutour(s, s[50].ouvertureMs, { avant: 10, apres: 4 });
    expect(f.bougies).toHaveLength(15);
    expect(f.bougies[10].ouvertureMs).toBe(f.marquerMs);
  });

  it('tronque aux bords sans se plaindre', () => {
    const s = serie(20);
    expect(fenetreAutour(s, s[1].ouvertureMs, { avant: 50, apres: 50 }).bougies).toHaveLength(20);
  });

  it('rend null quand l’instant précède toute la série', () => {
    expect(fenetreAutour(serie(10), -1, { avant: 5, apres: 5 })).toBeNull();
  });
});

describe('nom de planche', () => {
  it('trie par score décroissant au sein d’un détecteur et d’une bande', () => {
    const fort = nomDePlanche({ detecteur: 'absorption', bande: 'sommet', score: 12.5, horodatage: '2023-06-15T14:00:00.000Z' });
    const faible = nomDePlanche({ detecteur: 'absorption', bande: 'sommet', score: 2.5, horodatage: '2023-06-15T14:00:00.000Z' });
    expect([fort, faible].sort().reverse()[0]).toBe(fort);
  });

  it('porte le détecteur, la bande et la date', () => {
    const n = nomDePlanche({ detecteur: 'gap', bande: 'milieu', score: 1.5, horodatage: '2023-06-15T14:30:00.000Z' });
    expect(n).toMatch(/^gap-milieu-/);
    expect(n).toContain('2023-06-15-14-30');
    expect(n.endsWith('.png')).toBe(true);
  });
});

describe('options', () => {
  it('exige un fichier', () => {
    expect(validerOptions({}).erreurs).toContain('--csv attend un chemin de fichier');
  });

  it('refuse une unité plus fine que le fichier', () => {
    expect(validerOptions({ csv: 'x.csv', ut: '1m', utCsv: '5m' }).erreurs.join(' '))
      .toMatch(/inventer des bougies/);
  });

  it('retient qu’une unité a été demandée explicitement', () => {
    expect(validerOptions({ csv: 'x.csv' }).utDemandee).toBeUndefined();
    expect(validerOptions({ csv: 'x.csv', ut: '4h' }).utDemandee).toBe(true);
  });

  it('refuse une fenêtre avant trop courte pour montrer un contexte', () => {
    expect(validerOptions({ csv: 'x.csv', avant: 3 }).erreurs.join(' ')).toMatch(/--avant/);
  });
});
