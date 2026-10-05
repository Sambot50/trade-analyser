import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { validerOptions, plansDuJournal, GEL } from './temoin.mjs';
import { parseArgs } from './backtest.mjs';
import { serieAleatoire, enCsv } from '../src/lib/marche/aleatoire.js';

const SCRIPT = fileURLToPath(new URL('./temoin.mjs', import.meta.url));

const ligne = (id, symbole, horodatage, extra = {}) => JSON.stringify({
  schemaVersion: 2, id, horodatage, symbole, direction: 'BUY',
  prixEntree: 100, prixStopLoss: 99, prixTp1: 101, prixTp2: 102, objectifDeSortie: '2r', statut: null, ...extra,
});

describe('validerOptions', () => {
  it('exige le journal et l’instrument', () => {
    expect(validerOptions({}).erreurs).toEqual([
      expect.stringMatching(/--journal manquant/), expect.stringMatching(/--symbole manquant/),
    ]);
  });

  it('refuse toute option qui réglerait le témoin — figé par DEC-035', () => {
    const { erreurs } = validerOptions(parseArgs(['--journal', 'j', '--symbole', 'BTCUSDT', '--tirages', '50', '--fenetre', '10']));
    expect(erreurs).toEqual([
      expect.stringMatching(/--fenetre n’existe pas/), expect.stringMatching(/--tirages n’existe pas/),
    ]);
  });

  it('demande un fichier pour un instrument que Binance ne cote pas', () => {
    expect(validerOptions({ journal: 'j', symbole: 'XAUUSD' }).erreurs[0]).toMatch(/--csv/);
    expect(validerOptions({ journal: 'j', symbole: 'XAUUSD', csv: 'x.csv' }).erreurs).toBeUndefined();
  });

  it('n’expose que des réglages gelés', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(GEL).toMatchObject({ fenetreJours: 30, horizonMinutes: 1440, ambigu: 'perdant', tirages: 1000, graine: 1 });
  });
});

describe('plansDuJournal', () => {
  it('ne retient que les analyses de l’instrument, et compte le reste', () => {
    const texte = [
      ligne('a', 'XAUUSD', '2026-01-10T10:00:00Z'),
      ligne('b', 'xau/usd', '2026-01-11T10:00:00Z'),
      ligne('c', 'BTCUSDT', '2026-01-12T10:00:00Z'),
      JSON.stringify({ id: 'm', type: 'mesure', symbole: 'XAUUSD', horodatage: '2026-01-12T11:00:00Z' }),
      '{ cassée',
      // Mise à jour d'issue : fusionnée avec sa ligne d'origine, pas un plan de plus.
      JSON.stringify({ schemaVersion: 2, id: 'a', maj: '2026-01-11T00:00:00Z', statut: 'stop' }),
    ].join('\n');

    const r = plansDuJournal(texte, 'XAUUSD');
    expect(r.objectif).toBe('2r');
    expect(r.entrees.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.entrees[0]).toMatchObject({ instantMs: Date.parse('2026-01-10T10:00:00Z'), plan: { direction: 'BUY', prixEntree: 100 } });
    expect(r.ignorees).toEqual({ illisibles: 1, autresSymboles: 1 });
  });

  it('refuse des règles de sortie mêlées', () => {
    const texte = [ligne('a', 'XAUUSD', '2026-01-10T10:00:00Z'), ligne('b', 'XAUUSD', '2026-01-11T10:00:00Z', { objectifDeSortie: '1r' })].join('\n');
    expect(plansDuJournal(texte, 'XAUUSD').erreur).toMatch(/mêlées/);
  });
});

describe('le script, lancé pour de vrai', () => {
  // Quarante jours de marche aléatoire, trois plans au marché sur les cinq
  // derniers jours, et un quatrième trop tôt pour avoir un témoin.
  const bougies = serieAleatoire({ graine: 4, minutes: 40 * 24 * 60 });
  const dossier = mkdtempSync(join(tmpdir(), 'temoin-'));
  const csv = join(dossier, 'XAUUSD_M1.csv');
  writeFileSync(csv, enCsv(bougies));

  const plan = (id, i) => {
    const p = bougies[i - 1].cloture;
    return ligne(id, 'XAUUSD', new Date(bougies[i].ouvertureMs).toISOString(),
      { prixEntree: p, prixStopLoss: p - 5, prixTp1: p + 5, prixTp2: p + 10 });
  };
  const J = 24 * 60;
  writeFileSync(join(dossier, 'index.jsonl'), [
    plan('p1', 34 * J), plan('p2', 35 * J), plan('p3', 36 * J), plan('trop-tot', 2 * J),
  ].join('\n') + '\n');

  const sortie = execFileSync(process.execPath, [SCRIPT, '--journal', dossier, '--symbole', 'XAUUSD', '--csv', csv], { encoding: 'utf8' });

  it('teste les plans retenus et dit pourquoi il écarte les autres', () => {
    expect(sortie).toMatch(/4 plan\(s\) pour XAUUSD/);
    expect(sortie).toMatch(/trop-tot\s+écarté : fenêtre de témoin incomplète/);
    for (const id of ['p1', 'p2', 'p3']) expect(sortie).toMatch(new RegExp(`${id}\\s+BUY`));
  });

  it('rend le réel, le témoin, p et la sensibilité', () => {
    expect(sortie).toMatch(/réel, moyenne sur 3 plan\(s\)/);
    expect(sortie).toMatch(/p\s+(?:1|0\.\d+) +\(\d+\/1000 tirages/);
    expect(sortie).toMatch(/sensibilité, ambigus gagnants/);
  });

  it('rappelle qu’aucun chiffre ne décide avant le pré-enregistrement', () => {
    expect(sortie).toMatch(/ne décide rien/);
  });
});
