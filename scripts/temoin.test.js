import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { validerOptions, plansDuJournal, GEL, LECTURES, lectureDuJournal, parTrimestre } from './temoin.mjs';
import { createHash } from 'node:crypto';
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

describe('lectures pré-enregistrées', () => {
  it('garde DEC-036 à 1 000 tirages, le réglage sous lequel son résultat a été lu', () => {
    expect(lectureDuJournal({ protocole: 'DEC-036' })).toEqual({ protocole: 'DEC-036', tirages: 1000, seuil: 0.05, trimestres: false });
  });

  it('lit DEC-037 à 10 000 tirages, avec la ventilation par trimestre', () => {
    expect(lectureDuJournal({ protocole: 'DEC-037' })).toMatchObject({ tirages: 10_000, seuil: 0.05, trimestres: true });
    expect(Object.isFrozen(LECTURES['DEC-037'])).toBe(true);
  });

  it('n’applique rien à un journal ordinaire, et refuse un protocole inconnu', () => {
    expect(lectureDuJournal(null)).toBeNull();
    expect(() => lectureDuJournal({ protocole: 'DEC-999' })).toThrow(/inconnu/);
  });

  it('ventile par trimestre civil, en UTC', () => {
    const q = parTrimestre([
      { instantMs: Date.parse('2025-03-31T13:30:00Z'), r: 2, temoinMoyen: 0 },
      { instantMs: Date.parse('2025-04-01T13:30:00Z'), r: -1, temoinMoyen: -0.5 },
      { instantMs: Date.parse('2025-02-10T14:30:00Z'), r: 0, temoinMoyen: 1 },
    ]);
    expect(q).toEqual([
      { trimestre: '2025-T1', n: 2, reel: 1, temoin: 0.5 },
      { trimestre: '2025-T2', n: 1, reel: -1, temoin: -0.5 },
    ]);
  });
});

describe('le script, sur un journal de rejeu DEC-037', () => {
  const bougies = serieAleatoire({ graine: 8, minutes: 40 * 24 * 60 });
  const dossier = mkdtempSync(join(tmpdir(), 'temoin-037-'));
  const csv = join(dossier, 'GC_2025_2026.csv');
  const contenu = enCsv(bougies);
  writeFileSync(csv, contenu);
  const J = 24 * 60;
  const plan = (id, i) => {
    const p = bougies[i - 1].cloture;
    return ligne(id, 'GC', new Date(bougies[i].ouvertureMs).toISOString(),
      { type: 'rejeu', prixEntree: p, prixStopLoss: p + 5, prixTp1: p - 5, prixTp2: p - 10, direction: 'SELL' });
  };
  writeFileSync(join(dossier, 'index.jsonl'), [plan('a', 34 * J), plan('b', 36 * J)].join('\n') + '\n');
  writeFileSync(join(dossier, 'rejeu.json'), JSON.stringify({
    protocole: 'DEC-037', fichier: 'GC_2025_2026.csv', sha256Fichier: createHash('sha256').update(contenu).digest('hex'),
  }));

  it('applique la lecture du protocole écrit dans rejeu.json, et sa règle', () => {
    const sortie = execFileSync(process.execPath, [SCRIPT, '--journal', dossier, '--symbole', 'GC', '--csv', csv], { encoding: 'utf8' });
    expect(sortie).toMatch(/lecture pré-enregistrée DEC-037/);
    expect(sortie).toMatch(/\/10000 tirages/);
    expect(sortie).toMatch(/Par trimestre — descriptif/);
    expect(sortie).toMatch(/Règle de DEC-037, écrite d'avance : p < 0.05 → (PASSE|NE PASSE PAS)/);
  });

  it('refuse un autre fichier que celui du rejeu', () => {
    const autre = join(dossier, 'autre.csv');
    writeFileSync(autre, enCsv(serieAleatoire({ graine: 9, minutes: 40 * 24 * 60 })));
    let erreur;
    try { execFileSync(process.execPath, [SCRIPT, '--journal', dossier, '--symbole', 'GC', '--csv', autre], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { erreur = e; }
    expect(erreur.status).toBe(2);
    expect(erreur.stderr).toMatch(/n'est pas celui du rejeu/);
  });
});
