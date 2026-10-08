import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lireBlocs, lireEnLigne, avancement } from './markdown.js';

describe('lireBlocs', () => {
  it('reconnaît titres, séparateurs, paragraphes, tableaux et listes à cocher', () => {
    const b = lireBlocs([
      '# Titre', '', 'Un paragraphe', 'sur deux lignes.', '', '---',
      '| A | B |', '|---|---|', '| 1 | 2 |', '',
      '- [x] fait', '- [ ] à faire', '  suite de la ligne', '- simple', '',
      '1. premier', '2. second',
    ].join('\n'));
    expect(b.map((x) => x.type)).toEqual(['titre', 'paragraphe', 'separateur', 'tableau', 'liste', 'liste']);
    expect(b[1].texte).toBe('Un paragraphe sur deux lignes.');
    expect(b[3]).toEqual({ type: 'tableau', entete: ['A', 'B'], rangees: [['1', '2']] });
    expect(b[4].elements).toEqual([
      { case: true, texte: 'fait' },
      { case: false, texte: 'à faire suite de la ligne' },
      { case: null, texte: 'simple' },
    ]);
    expect(b[5].numerotee).toBe(true);
  });
});

describe('lireEnLigne', () => {
  it('sépare gras, code et liens du texte', () => {
    expect(lireEnLigne('a **b** `c` [d](https://e) f')).toEqual([
      { type: 'texte', texte: 'a ' }, { type: 'gras', texte: 'b' }, { type: 'texte', texte: ' ' },
      { type: 'code', texte: 'c' }, { type: 'texte', texte: ' ' }, { type: 'lien', texte: 'd', url: 'https://e' },
      { type: 'texte', texte: ' f' },
    ]);
  });
});

describe('lireEnLigne — italique', () => {
  it('reconnaît l’italique sans confondre le gras ni un astérisque isolé', () => {
    expect(lireEnLigne('une *mesure* et **gras**')).toEqual([
      { type: 'texte', texte: 'une ' }, { type: 'italique', texte: 'mesure' }, { type: 'texte', texte: ' et ' }, { type: 'gras', texte: 'gras' },
    ]);
    expect(lireEnLigne('3 * 4')).toEqual([{ type: 'texte', texte: '3 * 4' }]);
  });
});

describe('avancement', () => {
  it('compte les cases de chaque étape', () => {
    const b = lireBlocs(['## 5', '### E0 — x', '- [x] a', '- [ ] b', '### E1 — y', '- [x] c', '## 6', '- [ ] hors étape'].join('\n'));
    expect(avancement(b)).toEqual([{ titre: 'E0 — x', faites: 1, total: 2 }, { titre: 'E1 — y', faites: 1, total: 1 }]);
  });

  it('lit la vraie feuille de route : chaque étape a des cases', () => {
    const texte = readFileSync(new URL('../../docs/FEUILLE-DE-ROUTE.md', import.meta.url), 'utf8');
    const etapes = avancement(lireBlocs(texte));
    expect(etapes.map((e) => e.titre.slice(0, 3).trim())).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'En']);
    for (const e of etapes) expect(e.total).toBeGreaterThan(0);
  });
});
