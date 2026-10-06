import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { validerOptions, serieA } from './structure.mjs';
import { serieAleatoire, enCsv } from '../src/lib/marche/aleatoire.js';

const SCRIPT = fileURLToPath(new URL('./structure.mjs', import.meta.url));

describe('validerOptions', () => {
  it('exige un fichier, et refuse une autre unité que la minute', () => {
    expect(validerOptions({}).erreurs[0]).toMatch(/--csv/);
    expect(validerOptions({ csv: 'a', utCsv: '15m' }).erreurs[0]).toMatch(/1m/);
    expect(validerOptions({ csv: 'a', a: 'hier' }).erreurs[0]).toMatch(/ISO/);
  });
});

describe('serieA', () => {
  it('lit le contrat coté à l’instant, jamais une série recollée', () => {
    const bougies = serieAleatoire({ graine: 1, minutes: 3 * 24 * 60, contrats: 2 }).map((b) => ({ ...b, symbole: String(b.contrat) }));
    const milieuSecond = bougies[3 * 24 * 60 + 600].ouvertureMs;
    expect(serieA(bougies, milieuSecond).symbole).toBe('1001');
    expect(serieA(bougies, bougies[100].ouvertureMs).symbole).toBe('1000');
    expect(serieA(bougies, bougies[0].ouvertureMs)).toBeNull();
  });
});

describe('le script, lancé pour de vrai', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'structure-'));
  const csv = join(dossier, 'GC_test.csv');
  writeFileSync(csv, enCsv(serieAleatoire({ graine: 2, minutes: 40 * 24 * 60 })));

  it('affiche le tableau, le biais, la lecture et les sessions', () => {
    const sortie = execFileSync(process.execPath, [SCRIPT, '--csv', csv, '--a', '2026-02-01T15:00:00Z'], { encoding: 'utf8' });
    for (const u of ['5m', '15m', '30m', '1h', '4h', '1d']) expect(sortie).toMatch(new RegExp(`\\n  ${u}\\s+(▲|▼|—)`));
    expect(sortie).toMatch(/Biais pondéré : [+-]?\d+ \/ 10/);
    expect(sortie).toMatch(/Lecture : /);
    expect(sortie).toMatch(/Asie\s+2026-/);
    expect(sortie).toMatch(/pas un signal/);
  });
});
