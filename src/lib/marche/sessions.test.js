import { describe, it, expect } from 'vitest';
import { bornesSession, niveauxDeSessions, SESSIONS } from './sessions.js';

const iso = (ms) => new Date(ms).toISOString().replace('.000', '');
const asie = SESSIONS.find((s) => s.id === 'asie');
const londres = SESSIONS.find((s) => s.id === 'londres');

describe('bornesSession', () => {
  it('place l’Asie de 19 h à 4 h New York : 23 h → 8 h UTC l’été', () => {
    const b = bornesSession(asie, Date.parse('2026-07-15T12:00:00Z'));
    expect([iso(b.debutMs), iso(b.finMs)]).toEqual(['2026-07-14T23:00:00Z', '2026-07-15T08:00:00Z']);
  });

  it('suit l’heure d’hiver de New York : Londres de 3 h à 12 h NY = 8 h → 17 h UTC en janvier', () => {
    const b = bornesSession(londres, Date.parse('2026-01-15T18:00:00Z'));
    expect([iso(b.debutMs), iso(b.finMs)]).toEqual(['2026-01-15T08:00:00Z', '2026-01-15T17:00:00Z']);
  });

  it('ne rend qu’une session terminée, sauf demande', () => {
    const pendant = Date.parse('2026-07-15T10:00:00Z'); // Londres en cours
    expect(iso(bornesSession(londres, pendant).finMs)).toBe('2026-07-14T16:00:00Z');
    expect(iso(bornesSession(londres, pendant, { enCours: true }).debutMs)).toBe('2026-07-15T07:00:00Z');
  });
});

describe('niveauxDeSessions', () => {
  // De 22:00 UTC le 14 juillet à 14:00 UTC le 15 : toute la session d'Asie,
  // puis un plus haut qui la dépasse à 12:00 UTC.
  const T0 = Date.parse('2026-07-14T22:00:00Z');
  const bougies = Array.from({ length: 16 * 60 }, (_, i) => {
    const o = T0 + i * 60_000;
    const enAsie = o >= Date.parse('2026-07-14T23:00:00Z') && o < Date.parse('2026-07-15T08:00:00Z');
    const pic = o === Date.parse('2026-07-15T12:00:00Z');
    const p = enAsie ? 100 + (i % 7) : 101;
    return { ouvertureMs: o, fermetureMs: o + 59_999, ouverture: p, plusHaut: pic ? 120 : p + 0.5, plusBas: p - 0.5, cloture: p };
  });

  it('rend le plus haut et le plus bas de l’Asie, et le balayage de son plus haut', () => {
    const [a] = niveauxDeSessions(bougies, Date.parse('2026-07-15T14:00:00Z'));
    expect(a).toMatchObject({ id: 'asie', haut: 106.5, bas: 99.5, hautBalaye: true, basBalaye: false });
    expect(a.nombre).toBe(9 * 60);
  });

  it('ne voit pas un balayage postérieur à l’instant de lecture', () => {
    const [a] = niveauxDeSessions(bougies, Date.parse('2026-07-15T11:00:00Z'));
    expect(a.hautBalaye).toBe(false);
  });
});
