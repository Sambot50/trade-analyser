import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { charger } from './journal-mt5.mjs';

const SCRIPT = fileURLToPath(new URL('./journal-mt5.mjs', import.meta.url));
const PONT = fileURLToPath(new URL('../pont-mt5/', import.meta.url));

const deal = (x) => JSON.stringify({ ticket: 1, order: 0, type: 0, entry: 0, magic: 0, position_id: 1, volume: 0.1, price: 4000,
  commission: -0.35, swap: 0, profit: 0, fee: 0, symbol: 'XAUUSD', comment: '', heureUtc: '2026-07-15T12:30:00Z', ...x });

function dossierDeTest() {
  const d = mkdtempSync(join(tmpdir(), 'journal-mt5-'));
  writeFileSync(join(d, 'deals.jsonl'), [
    deal({ type: 2, profit: 1000, comment: 'dépôt' }),
    deal({ ticket: 10, order: 100, position_id: 7, comment: 'OB 4h' }),
    deal({ ticket: 11, type: 1, entry: 1, position_id: 7, price: 4020, profit: 200, heureUtc: '2026-07-15T14:00:00Z' }),
    deal({ ticket: 20, order: 200, type: 1, position_id: 8, heureUtc: '2026-07-16T07:00:00Z' }),
    deal({ ticket: 21, type: 0, entry: 1, position_id: 8, price: 4010, profit: -100, heureUtc: '2026-07-16T08:00:00Z' }),
  ].join('\n') + '\n');
  writeFileSync(join(d, 'ordres.jsonl'), [
    JSON.stringify({ ticket: 100, sl: 3990, tp: 4020, comment: 'OB 4h' }),
    JSON.stringify({ ticket: 200, sl: 4010, tp: 3980, comment: '' }),
  ].join('\n') + '\n');
  writeFileSync(join(d, 'compte.json'), JSON.stringify({ serveur: 'Axi-US51-Live', devise: 'USD', exporteLe: '2026-10-06T10:00:00Z', regleHeure: 'NY+7', verificationHeure: 'confirmée' }));
  return d;
}

describe('le journal, lancé pour de vrai', () => {
  const dossier = dossierDeTest();

  it('reconstitue les positions de l’export', async () => {
    const j = await charger(dossier);
    expect(j.positions.map((p) => [p.position, p.sens, p.statut])).toEqual([[7, 'achat', 'fermee'], [8, 'vente', 'fermee']]);
    expect(j.mouvements).toHaveLength(1);
  });

  it('affiche les métriques, les ventilations, et la mise en garde', () => {
    const sortie = execFileSync(process.execPath, [SCRIPT, '--dossier', dossier], { encoding: 'utf8' });
    expect(sortie).toMatch(/Axi-US51-Live/);
    expect(sortie).toMatch(/2 position\(s\) fermée\(s\), 0 ouverte\(s\), 1 dépôt/);
    // 199,30 de gains pour 100,70 de pertes, frais compris.
    expect(sortie).toMatch(/profit factor\s+1\.98/);
    expect(sortie).toMatch(/14 h .*trop peu/);
    expect(sortie).toMatch(/OB 4h/);
    expect(sortie).toMatch(/Aucun groupe n’est désigné « meilleur »/);
  });

  it('dit quoi faire quand l’export manque', () => {
    let erreur;
    try { execFileSync(process.execPath, [SCRIPT, '--dossier', mkdtempSync(join(tmpdir(), 'vide-'))], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { erreur = e; }
    expect(erreur.status).toBe(2);
    expect(erreur.stderr).toMatch(/npm run mt5:export/);
  });
});

describe('le pont MT5 (Python), contre un faux terminal', () => {
  let python = null;
  for (const exe of ['python3', 'python']) {
    try { execFileSync(exe, ['--version'], { stdio: 'pipe' }); python = exe; break; } catch { /* absent */ }
  }

  it.skipIf(!python)('passe ses tests unitaires', () => {
    // Un échec rend un code non nul, et execFileSync lève : rien d'autre à vérifier.
    expect(() => execFileSync(python, ['-m', 'unittest', 'discover', '-s', join(PONT, 'tests')], { stdio: 'pipe' })).not.toThrow();
  });
});
