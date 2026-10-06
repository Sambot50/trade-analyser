import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { parseArgs, construirePlan, bougiesDepuis } from './resoudre-plan.mjs';

const SCRIPT = fileURLToPath(new URL('./resoudre-plan.mjs', import.meta.url));

const PLAN = ['--le', '2026-09-21T13:30:00Z', '--direction', 'BUY',
  '--entree', '2650', '--stop', '2645', '--tp1', '2655', '--tp2', '2660'];

describe('parseArgs', () => {
  it('lit un drapeau sans avaler l’option qui le suit', () => {
    expect(parseArgs(['--garder-derniere', '--le', 'x'])).toEqual({ garderDerniere: true, le: 'x' });
    expect(parseArgs(['--csv', 'a.csv', '--garder-derniere'])).toEqual({ csv: 'a.csv', garderDerniere: true });
  });
});

describe('construirePlan — source fichier', () => {
  it('se passe de symbole avec --csv, et prend le nom du fichier pour l’afficher', () => {
    const r = construirePlan(parseArgs(['--csv', '/x/OANDA_XAUUSD, 1.csv', ...PLAN]));
    expect(r.erreurs).toBeUndefined();
    expect(r.symbole).toBe('OANDA_XAUUSD, 1');
    expect(r).toMatchObject({ csv: '/x/OANDA_XAUUSD, 1.csv', utCsv: '1m', decalageHeures: 0, garderDerniere: false });
  });

  it('exige toujours un symbole Binance sans fichier', () => {
    expect(construirePlan(parseArgs(PLAN)).erreurs).toEqual([expect.stringMatching(/--symbole manquant/)]);
    expect(construirePlan(parseArgs(['--symbole', 'XAUUSD', ...PLAN])).erreurs[0]).toMatch(/--csv/);
  });

  it('refuse deux sources à la fois, et un décalage sans fichier', () => {
    expect(construirePlan(parseArgs(['--csv', 'a.csv', '--base-url', 'http://x', ...PLAN])).erreurs[0]).toMatch(/deux sources/);
    expect(construirePlan(parseArgs(['--symbole', 'BTCUSDT', '--decalage-heures', '-5', ...PLAN])).erreurs[0]).toMatch(/qu’à un fichier/);
    expect(construirePlan(parseArgs(['--csv', 'a.csv', '--ut-csv', '7m', ...PLAN])).erreurs[0]).toMatch(/--ut-csv "7m"/);
  });
});

describe('bougiesDepuis', () => {
  const t0 = Date.UTC(2026, 8, 21, 13, 30);
  const b = (min) => ({ ouvertureMs: t0 + min * 60_000 });

  it('part de la première bougie qui s’ouvre à l’analyse ou après — jamais de celle en cours', () => {
    const r = bougiesDepuis([b(-2), b(-1), b(0), b(1)], t0 + 30_000, '1m');
    expect(r.bougies.map((x) => x.ouvertureMs)).toEqual([b(1).ouvertureMs]);
    expect(r.trou).toBe(false);
  });

  it('signale une première bougie lointaine, sans la refuser', () => {
    const r = bougiesDepuis([b(-1), b(120)], t0, '1m');
    expect(r).toMatchObject({ attenteMs: 120 * 60_000, trou: true });
  });

  it('refuse un fichier qui ne couvre pas l’instant de l’analyse', () => {
    expect(bougiesDepuis([b(5), b(6)], t0, '1m').erreur).toMatch(/commence .* après l'analyse/);
    expect(bougiesDepuis([b(-6), b(-5)], t0, '1m').erreur).toMatch(/s'arrête .* avant l'analyse/);
    expect(bougiesDepuis([], t0, '1m').erreur).toMatch(/aucune bougie/);
  });
});

describe('le script, lancé pour de vrai sur un export TradingView construit', () => {
  // 09:30-04:00 = 13:30 UTC, l'instant de l'analyse. L'entrée est touchée à la
  // première bougie ; rien ne se passe ensuite, sauf sur la DERNIÈRE ligne,
  // celle qui était en cours à l'export, et qui descend sous le stop.
  const lignes = [
    'time,open,high,low,close,Volume',
    '2026-09-21T09:29:00-04:00,2652,2653,2651,2652,10',
    '2026-09-21T09:30:00-04:00,2652,2652.5,2649.5,2651,10',
    '2026-09-21T09:31:00-04:00,2651,2652,2650.5,2651.5,10',
    '2026-09-21T09:32:00-04:00,2651.5,2652,2650.8,2651,10',
    '2026-09-21T09:33:00-04:00,2651,2651.8,2650.6,2651.2,10',
    '2026-09-21T09:34:00-04:00,2651.2,2651.9,2650.7,2651.1,10',
    '2026-09-21T09:35:00-04:00,2651.1,2651.2,2644,2644.5,10',
  ];
  const dossier = mkdtempSync(join(tmpdir(), 'resoudre-plan-'));
  const fichier = join(dossier, 'OANDA_XAUUSD, 1.csv');
  writeFileSync(fichier, lignes.join('\n'));

  const lancer = (...extra) => {
    try {
      return { code: 0, sortie: execFileSync(process.execPath, [SCRIPT, '--csv', fichier, ...PLAN, '--horizon-heures', '0.1', ...extra], { encoding: 'utf8' }) };
    } catch (err) {
      return { code: err.status, sortie: `${err.stdout}${err.stderr}` };
    }
  };

  it('écarte la bougie en cours : le plan reste ouvert, il n’est pas stoppé sur un prix provisoire', () => {
    const { code, sortie } = lancer();
    expect(code).toBe(0);
    expect(sortie).toMatch(/export TradingView reconnu/);
    expect(sortie).toMatch(/dernière bougie \(2026-09-21T13:35:00\.000Z\) écartée/);
    expect(sortie).toMatch(/EN_COURS/);
  });

  it('la garde sur demande, et elle tranche', () => {
    const { sortie } = lancer('--garder-derniere');
    expect(sortie).toMatch(/STOP/);
  });

  it('refuse un décalage horaire sur un fichier qui porte déjà son fuseau', () => {
    const { code, sortie } = lancer('--decalage-heures', '-4');
    expect(code).toBe(2);
    expect(sortie).toMatch(/porte déjà son fuseau/);
  });

  it('refuse une unité déclarée qui contredit le fichier', () => {
    const { code, sortie } = lancer('--ut-csv', '5m');
    expect(code).toBe(2);
    expect(sortie).toMatch(/espacées de 1m/);
  });
});
