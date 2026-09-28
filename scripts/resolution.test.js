import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mesurer, resumer, sortDeLaPosition } from './resolution.mjs';
import { serieAleatoire, enCsv } from '../src/lib/marche/aleatoire.js';

const bg = (ouverture, plusHaut, plusBas, cloture) => ({ ouverture, plusHaut, plusBas, cloture, volume: 1 });
const plat = (prix) => bg(prix, prix, prix, prix);
// Ancre : 100 → 110, haut 112, bas 98. Hauteur 14, départ 110, ±3R = ±42.
const ancre = bg(100, 112, 98, 110);
const suite = (...b) => [ancre, ...b, ...Array(10).fill(plat(110))];

describe('sort de la position', () => {
  it('rend +3R à la barrière haute', () => {
    expect(sortDeLaPosition(suite(plat(153)), 0, 5, 3)).toEqual({ issue: 'atteint', R: 3 });
  });

  it('rend −3R à la barrière basse', () => {
    expect(sortDeLaPosition(suite(plat(67)), 0, 5, 3)).toEqual({ issue: 'perdu', R: -3 });
  });

  it('ne compte PAS une barrière à 1R — la mesure est symétrique', () => {
    // 110 − 14 = 96. Sous un stop à 1R ce serait perdu ; ici non.
    expect(sortDeLaPosition(suite(plat(96)), 0, 5, 3).issue).toBe('horizon');
  });

  it('ferme au marché quand aucune barrière n’est touchée, au lieu d’écarter', () => {
    // C'est tout l'objet de ce diagnostic : la règle gelée sortait ces cas
    // du dénominateur, donc le taux qu'elle publiait ne décrivait qu'une
    // partie des signaux.
    const r = sortDeLaPosition([ancre, plat(117), ...Array(10).fill(plat(117))], 0, 5, 3);
    expect(r.issue).toBe('horizon');
    expect(r.R).toBeCloseTo(7 / 14, 9);
  });

  it('rend « ambigu » sans valeur quand une bougie touche les deux', () => {
    expect(sortDeLaPosition(suite(bg(110, 153, 67, 110)), 0, 5, 3)).toEqual({ issue: 'ambigu', R: null });
  });

  it('traite une ancre vendeuse dans son propre sens', () => {
    const vente = bg(110, 112, 98, 100);            // départ 100, gain vers le bas
    const s = [vente, plat(57), ...Array(10).fill(plat(57))];
    expect(sortDeLaPosition(s, 0, 5, 3).issue).toBe('atteint');
  });

  it('refuse une ancre plate ou un horizon incomplet', () => {
    expect(sortDeLaPosition(suite(plat(153)), 0, 500, 3)).toBeNull();
    expect(sortDeLaPosition([bg(100, 101, 99, 100), plat(153)], 0, 1, 3)).toBeNull();
  });
});

describe('résumé', () => {
  const s = (issue, R) => ({ issue, R });

  it('sépare le taux sur barrières de l’espérance complète', () => {
    // Deux barrières (une gagnante, une perdante) et deux sorties au marché.
    const r = resumer([s('atteint', 3), s('perdu', -3), s('horizon', 0.5), s('horizon', 0.5)], 0);
    expect(r.tauxBarriere).toBe(50);
    expect(r.evBarrieresSeules).toBe(0);
    expect(r.evComplete).toBeCloseTo(0.25, 9);      // (3 − 3 + 0,5 + 0,5) / 4
    expect(r.horizon).toBe(2);
  });

  it('retranche les frais de l’espérance nette', () => {
    expect(resumer([s('atteint', 3), s('perdu', -3)], 0.04).evNette).toBeCloseTo(-0.04, 9);
  });

  it('exclut les ambigus de toutes les espérances', () => {
    const r = resumer([s('atteint', 3), s('ambigu', null)], 0);
    expect(r.ambigu).toBe(1);
    expect(r.evComplete).toBe(3);
  });

  it('rend null sur un ensemble vide', () => expect(resumer([], 0)).toBeNull());

  it('reporte les frais qu’on lui a passés, pour qu’on voie lesquels', () => {
    expect(resumer([s('atteint', 3), s('perdu', -3)], 0.0887).cout).toBeCloseTo(0.0887, 9);
  });

  it('rend l’erreur type de l’espérance complète', () => {
    // Quatre R : 3, −3, 3, −3. Écart-type d'échantillon = 2√3 ≈ 3,4641.
    const r = resumer([s('atteint', 3), s('perdu', -3), s('atteint', 3), s('perdu', -3)], 0);
    expect(r.ecartType).toBeCloseTo(2 * Math.sqrt(3), 9);
    expect(r.erreurType).toBeCloseTo((2 * Math.sqrt(3)) / 2, 9);
  });

  it('ne prétend pas à une erreur type sur une seule position', () => {
    const r = resumer([s('atteint', 3)], 0);
    expect(r.ecartType).toBeNull();
    expect(r.erreurType).toBeNull();
  });
});

describe('frais mesurés bras par bras', () => {
  // Le défaut corrigé : les frais n'étaient relevés que sur les bougies
  // DÉTECTÉES, puis appliqués aux deux bras. Or le coût en R vaut
  // `ticks ÷ hauteur`, et les deux bras n'ont pas la même hauteur de bougie.
  // Le témoin se voyait donc attribuer des frais qui n'étaient pas les siens.
  const fichier = join(tmpdir(), 'resolution-frais.csv');
  writeFileSync(fichier, enCsv(serieAleatoire({ graine: 5, minutes: 25 * 1440, contrats: 1 })));

  it('relève un coût par position, dans chaque bras séparément', async () => {
    const m = await mesurer(fichier);
    expect(m.pas).toBeGreaterThan(0);
    expect(m.coutsDetectees.length).toBe(m.detectees.length);
    expect(m.coutsTemoin.length).toBe(m.temoin.length);
    expect(m.coutsDetectees.length).toBeGreaterThan(0);
    expect(m.coutsTemoin.length).toBeGreaterThan(0);
    for (const c of [...m.coutsDetectees, ...m.coutsTemoin]) expect(c).toBeGreaterThan(0);
  });

  it('n’expose plus de coût unique partagé', async () => {
    expect(await mesurer(fichier)).not.toHaveProperty('coutMoyen');
  });
});
