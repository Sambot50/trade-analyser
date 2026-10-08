import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { validerOptions, obsALInstant, REGLAGES_CONTROLE } from './ob.mjs';
import { serieAleatoire, enCsv } from '../src/lib/marche/aleatoire.js';

const SCRIPT = fileURLToPath(new URL('./ob.mjs', import.meta.url));
const CINQ_MIN = 300_000;

// Dix jours de minutes : assez d'OB pour que chaque propriété soit éprouvée.
const fines = serieAleatoire({ graine: 3, minutes: 10 * 24 * 60 });
const milieu = fines[Math.floor(fines.length / 2)].ouvertureMs;

describe('validerOptions', () => {
  it('exige le fichier et l’instant', () => {
    expect(validerOptions({}).erreurs.join(' ')).toMatch(/--csv.*--a|--a.*--csv/s);
    expect(validerOptions({ csv: 'a', a: 'hier' }).erreurs[0]).toMatch(/ISO/);
  });
  it('refuse toute option qui changerait les réglages figés', () => {
    for (const cle of ['unite', 'seuilAtr', 'seuil', 'fenetre']) {
      expect(validerOptions({ csv: 'a', a: '2026-01-05T14:00:00Z', [cle]: '3' }).erreurs[0]).toMatch(/figés/);
    }
  });
});

describe('obsALInstant — aucune lecture du futur', () => {
  it('rend la même chose avec ou sans les bougies d’après l’instant', () => {
    const avec = obsALInstant(fines, milieu);
    const sans = obsALInstant(fines.filter((b) => b.ouvertureMs < milieu), milieu);
    expect(avec.obs.length).toBeGreaterThan(0);
    expect(sans.obs).toEqual(avec.obs);
    expect(sans.atr).toBe(avec.atr);
  });

  it('écarte la bougie 5 min encore ouverte à l’instant', () => {
    const aMs = milieu + 2 * 60_000 + 30_000; // au milieu d'une bougie 5 min
    const { bougies } = obsALInstant(fines, aMs);
    expect(bougies.at(-1).fermetureMs).toBeLessThan(aMs);
    expect(aMs - bougies.at(-1).fermetureMs).toBeLessThan(CINQ_MIN);
  });

  it('ne liste un OB qu’une fois sa validation connue', () => {
    const [ob] = obsALInstant(fines, milieu).obs;
    const avant = obsALInstant(fines, ob.valideMs);
    const apres = obsALInstant(fines, ob.valideMs + 1);
    expect(avant.obs.some((o) => o.derniereBougieMs === ob.derniereBougieMs)).toBe(false);
    expect(apres.obs.some((o) => o.derniereBougieMs === ob.derniereBougieMs)).toBe(true);
  });
});

describe('obsALInstant — la fenêtre de la procédure', () => {
  it('ne garde que les OB validés sur les 100 dernières bougies 5 min', () => {
    const r = obsALInstant(fines, milieu);
    expect(r.debutFenetreMs).toBe(r.bougies.at(-REGLAGES_CONTROLE.fenetre).ouvertureMs);
    for (const ob of r.obs) {
      expect(ob.valideMs).toBeGreaterThanOrEqual(r.debutFenetreMs);
      expect(ob.valideMs).toBeLessThan(milieu);
      expect(ob.haut).toBeGreaterThan(ob.bas);
      expect(['haussier', 'baissier']).toContain(ob.sens);
    }
  });

  it('déclare l’instant absent quand l’historique ne couvre pas la fenêtre', () => {
    const r = obsALInstant(fines, fines[300].ouvertureMs);
    expect(r.obs).toEqual([]);
    expect(r.manque).toMatch(/il en faut 100/);
  });
});

describe('le script, lancé pour de vrai', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'ob-'));
  const csv = join(dossier, 'XAU_test.csv');
  writeFileSync(csv, enCsv(fines));

  it('affiche les réglages figés, la tolérance et le tableau des OB', () => {
    const a = new Date(milieu).toISOString();
    const sortie = execFileSync(process.execPath, [SCRIPT, '--csv', csv, '--a', a], { encoding: 'utf8' });
    expect(sortie).toMatch(/5m, mouvement ≥ 2 ATR, toujours en tendance \(figé, HYP-005\)/);
    expect(sortie).toMatch(/tolérance 0,1 ATR = \d+\.\d{2}/);
    expect(sortie).toMatch(/\n {2} 1 {2}\d{4}-\d{2}-\d{2}T/);
    expect(sortie).toMatch(/pas un signal/);
  });
});
