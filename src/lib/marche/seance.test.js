import { describe, it, expect } from 'vitest';
import { debutDeSeance, seanceSuivante, agregerSeance } from './seance.js';

const iso = (ms) => new Date(ms).toISOString().replace('.000', '');
const MIN = 60_000;

/** Bougies 1 min, prix = numéro de la minute, de `debut` sur `minutes`. */
function serie(debut, minutes) {
  return Array.from({ length: minutes }, (_, i) => {
    const o = Date.parse(debut) + i * MIN;
    return { ouvertureMs: o, fermetureMs: o + MIN - 1, ouverture: i, plusHaut: i + 0.5, plusBas: i - 0.5, cloture: i + 0.25, volume: 1 };
  });
}

describe('debutDeSeance', () => {
  it('commence à 17 h New York : 21 h UTC l’été, 22 h UTC l’hiver', () => {
    expect(iso(debutDeSeance(Date.parse('2026-07-15T12:00:00Z')))).toBe('2026-07-14T21:00:00Z');
    expect(iso(debutDeSeance(Date.parse('2026-07-15T21:00:00Z')))).toBe('2026-07-15T21:00:00Z');
    expect(iso(debutDeSeance(Date.parse('2026-01-15T21:30:00Z')))).toBe('2026-01-14T22:00:00Z');
  });

  it('enchaîne une séance de 25 h au passage à l’heure d’hiver', () => {
    // Séance ouverte le vendredi 30 octobre 2026 à 17 h EDT (21 h UTC) ;
    // celle du dimanche 1er novembre ouvre à 17 h EST, soit 22 h UTC.
    const debut = debutDeSeance(Date.parse('2026-11-01T12:00:00Z'));
    expect(iso(debut)).toBe('2026-10-31T21:00:00Z');
    expect(iso(seanceSuivante(debut))).toBe('2026-11-01T22:00:00Z');
  });
});

describe('agregerSeance', () => {
  // Du mardi 14 juillet 2026 20:00 UTC au mercredi 22:00 UTC : la séance du
  // mercredi commence le mardi à 21:00 UTC.
  const fines = serie('2026-07-14T20:00:00Z', 26 * 60);

  it('découpe la journée sur la séance, pas sur minuit UTC', () => {
    const jours = agregerSeance(fines, '1d');
    expect(jours.map((j) => iso(j.ouvertureMs))).toEqual([
      '2026-07-13T21:00:00Z', '2026-07-14T21:00:00Z', '2026-07-15T21:00:00Z',
    ]);
    // La séance pleine : de la minute 60 (21:00) à la minute 1499 (20:59).
    expect(jours[1]).toMatchObject({ ouverture: 60, cloture: 1499.25, plusHaut: 1499.5, plusBas: 59.5, volume: 1440 });
    expect(iso(jours[1].fermetureMs + 1)).toBe('2026-07-15T21:00:00Z');
  });

  it('découpe les 4 h à 17 h, 21 h, 1 h, 5 h, 9 h, 13 h New York', () => {
    const quatre = agregerSeance(fines, '4h').filter((b) => b.ouvertureMs >= Date.parse('2026-07-14T21:00:00Z') && b.ouvertureMs < Date.parse('2026-07-15T21:00:00Z'));
    expect(quatre.map((b) => iso(b.ouvertureMs))).toEqual([
      '2026-07-14T21:00:00Z', '2026-07-15T01:00:00Z', '2026-07-15T05:00:00Z',
      '2026-07-15T09:00:00Z', '2026-07-15T13:00:00Z', '2026-07-15T17:00:00Z',
    ]);
    for (const b of quatre) expect(b.volume).toBe(240);
  });

  it('ne fabrique aucune bougie là où il n’y a pas de marché', () => {
    // Aucune bougie de 01:00 à 05:00 UTC : la bougie de 4 h entière disparaît.
    const avecTrou = fines.filter((b, i) => i < 300 || i >= 540);
    const quatre = agregerSeance(avecTrou, '4h');
    expect(quatre.every((b) => b.volume > 0)).toBe(true);
    expect(quatre.length).toBe(agregerSeance(fines, '4h').length - 1);
    expect(quatre.some((b) => iso(b.ouvertureMs) === '2026-07-15T01:00:00Z')).toBe(false);
  });

  it('délègue les unités d’une heure ou moins à l’agrégation sur l’époque', () => {
    const h = agregerSeance(fines, '1h');
    expect(iso(h[0].ouvertureMs)).toBe('2026-07-14T20:00:00Z');
    expect(h).toHaveLength(26);
  });

  it('raccourcit la dernière bougie de 4 h d’une séance de 23 h', () => {
    // Passage à l'heure d'été, dimanche 8 mars 2026 : la séance ouverte le
    // vendredi 6 mars à 22:00 UTC court jusqu'au dimanche 21:00 UTC.
    const vendredi = serie('2026-03-06T22:00:00Z', 60);
    const dimanche = serie('2026-03-08T20:30:00Z', 60);
    const b = agregerSeance([...vendredi, ...dimanche], '4h');
    const derniere = b.find((x) => x.ouvertureMs <= Date.parse('2026-03-08T20:30:00Z') && x.fermetureMs >= Date.parse('2026-03-08T20:30:00Z'));
    expect(iso(derniere.fermetureMs + 1)).toBe('2026-03-08T21:00:00Z');
    expect(iso(b.at(-1).ouvertureMs)).toBe('2026-03-08T21:00:00Z');
  });
});
