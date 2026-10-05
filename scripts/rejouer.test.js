import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { validerOptions, GEL } from './rejouer.mjs';
import { parseArgs } from './backtest.mjs';
import { serieAleatoire, enCsv } from '../src/lib/marche/aleatoire.js';

const SCRIPT = fileURLToPath(new URL('./rejouer.mjs', import.meta.url));
const lancer = promisify(execFile);

describe('validerOptions', () => {
  it('exige le fichier, l’instrument et le dossier', () => {
    expect(validerOptions({}).erreurs).toHaveLength(3);
  });

  it('refuse tout réglage figé par DEC-036', () => {
    const { erreurs } = validerOptions(parseArgs(['--csv', 'a', '--symbole', 'GC', '--sortie', 's', '--modele', 'llava', '--graine', '3']));
    expect(erreurs).toEqual([expect.stringMatching(/--modele n’existe pas/), expect.stringMatching(/--graine n’existe pas/)]);
  });

  it('refuse une autre unité que la minute', () => {
    expect(validerOptions({ csv: 'a', symbole: 'GC', sortie: 's', utCsv: '15m' }).erreurs[0]).toMatch(/1m/);
  });

  it('gèle les réglages', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(GEL).toMatchObject({ nombre: 100, heure: '15:30', fuseau: 'Europe/Paris', graine: 20261005, modele: 'qwen3.8:27b' });
  });
});

describe('le rejeu, lancé pour de vrai contre un faux Ollama', () => {
  // Un faux serveur qui répond toujours le même plan, en échelle DÉGUISÉE.
  // Une réponse sur trois est incohérente : elle doit finir dans rejets.jsonl.
  let serveur;
  let url;
  const requetes = [];

  beforeAll(async () => {
    serveur = createServer((req, res) => {
      let corps = '';
      req.on('data', (c) => { corps += c; });
      req.on('end', () => {
        const json = JSON.parse(corps);
        requetes.push(json);
        const n = requetes.length;
        const analyse = n % 3 === 0
          ? { direction: 'BUY', entry: 100, stopLoss: 101, tp1: 102, tp2: 103 }
          : { direction: 'BUY', entry: 100, stopLoss: 99, tp1: 101, tp2: 102 };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ message: { content: JSON.stringify({
          symbol: 'X', timeframe: '15m', bias: 'HAUSSIER', confidence: 50, reasoning: ['r'],
          scale: { priceTop: 110, priceBottom: 90, plotTopRatio: 0.06, plotBottomRatio: 0.89 }, ...analyse,
        }) } }));
      });
    });
    await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${serveur.address().port}`;
  });
  afterAll(() => serveur.close());

  const dossier = mkdtempSync(join(tmpdir(), 'rejeu-'));
  const csv = join(dossier, 'GC_test.csv');
  writeFileSync(csv, enCsv(serieAleatoire({ graine: 6, minutes: 45 * 24 * 60, contrats: 2 })));
  const sortie = join(dossier, 'journal');
  const args = ['--csv', csv, '--symbole', 'GC', '--sortie', sortie];

  it('produit des plans à l’échelle réelle, consigne les rejets, et n’affiche aucune issue', async () => {
    const { stdout } = await lancer(process.execPath, [SCRIPT, ...args, '--base-url', url, '--limite', '4'], { encoding: 'utf8' });
    expect(stdout).toMatch(/Rejeu DEC-036/);
    // Aucune issue : le rejeu produit des plans, il ne les juge pas.
    expect(stdout).not.toMatch(/\b(STOP|TP1|TP2|non_declenche|horizon_depasse)\b/);

    const index = readFileSync(join(sortie, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const rejets = readFileSync(join(sortie, 'rejets.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(index).toHaveLength(3);
    expect(rejets).toHaveLength(1);
    expect(rejets[0].erreurs[0]).toMatch(/stop loss doit être sous/);

    for (const l of index) {
      expect(l).toMatchObject({ type: 'rejeu', symbole: 'GC', modele: 'qwen3.8:27b', objectifDeSortie: '2r', direction: 'BUY' });
      // Le modèle a répondu 100 en échelle déguisée : le journal porte 100 / k.
      expect(l.prixEntree).toBeCloseTo(100 / l.facteurDeguisement, 9);
      expect(l.prixStopLoss).toBeCloseTo(99 / l.facteurDeguisement, 9);
      expect(existsSync(join(sortie, l.id, 'graphique.png'))).toBe(true);
    }

    // Le modèle a reçu l'invite figée et une image, rien d'autre.
    expect(requetes[0].model).toBe('qwen3.8:27b');
    expect(requetes[0].messages[0].images).toHaveLength(1);
    const signature = JSON.parse(readFileSync(join(sortie, 'rejeu.json'), 'utf8'));
    expect(signature).toMatchObject({ protocole: 'DEC-036', graine: 20261005, fichier: 'GC_test.csv' });
  }, 120_000);

  it('reprend la même liste sans rien refaire', async () => {
    const avant = requetes.length;
    await lancer(process.execPath, [SCRIPT, ...args, '--base-url', url, '--limite', '2'], { encoding: 'utf8' });
    expect(requetes.length - avant).toBe(2);
    const index = readFileSync(join(sortie, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(new Set(index.map((l) => l.id)).size).toBe(index.length);
  }, 120_000);

  it('s’arrête sans rien sauter quand le modèle ne répond pas', async () => {
    const lignesAvant = readFileSync(join(sortie, 'index.jsonl'), 'utf8');
    const err = await lancer(process.execPath, [SCRIPT, ...args, '--base-url', 'http://127.0.0.1:9', '--limite', '1'], { encoding: 'utf8' })
      .then(() => null, (e) => e);
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/Rejeu arrêté ici, rien n’est perdu/);
    expect(readFileSync(join(sortie, 'index.jsonl'), 'utf8')).toBe(lignesAvant);
  }, 120_000);

  it('produit un journal que le témoin lit tel quel, contrat par contrat', async () => {
    const TEMOIN = fileURLToPath(new URL('./temoin.mjs', import.meta.url));
    const { stdout } = await lancer(process.execPath, [TEMOIN, '--journal', sortie, '--symbole', 'GC', '--csv', csv], { encoding: 'utf8' });
    const plans = readFileSync(join(sortie, 'index.jsonl'), 'utf8').trim().split('\n').length;
    expect(stdout).toContain(`${plans} plan(s) pour GC`);
    expect(stdout).toMatch(/contrat\(s\) concerné\(s\)/);
    expect(stdout).toMatch(/réel, moyenne sur \d plan\(s\)/);
  }, 120_000);

  it('refuse de mêler deux rejeux dans un même dossier', async () => {
    const autre = join(dossier, 'GC_autre.csv');
    writeFileSync(autre, enCsv(serieAleatoire({ graine: 7, minutes: 45 * 24 * 60, contrats: 2 })));
    const err = await lancer(process.execPath, [SCRIPT, '--csv', autre, '--symbole', 'GC', '--sortie', sortie, '--base-url', url, '--limite', '1'], { encoding: 'utf8' })
      .then(() => null, (e) => e);
    expect(err.code).toBe(2);
    expect(err.stderr).toMatch(/autre rejeu/);
  }, 120_000);
});
