// Le journal de performances, depuis l'export MT5.
//
//   python pont-mt5/exporter.py --sortie donnees/mt5     (ou : npm run mt5:export)
//   node scripts/journal-mt5.mjs --dossier donnees/mt5   (ou : npm run journal)
//
// Aucune saisie : les positions sont reconstituées depuis les transactions du
// compte. Les heures et les jours sont lus à l'heure de Paris.
//
// Les tableaux par heure, jour, symbole et setup ne désignent AUCUN meilleur
// groupe : comparer vingt-quatre heures garantit qu'une sortira gagnante par
// hasard. Un groupe sous 30 trades est marqué « trop peu ».

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseArgs } from './backtest.mjs';
import { lireJsonl, positionsDepuisDeals } from '../src/lib/journal/mt5.js';
import { performances } from '../src/lib/journal/performances.js';

export async function charger(dossier) {
  const lire = async (nom) => {
    try { return await readFile(join(dossier, nom), 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  };
  const textes = { deals: await lire('deals.jsonl'), ordres: await lire('ordres.jsonl'), compte: await lire('compte.json') };
  if (textes.deals === null) throw new Error(`Aucun deals.jsonl dans ${dossier} : lance d'abord npm run mt5:export.`);
  const deals = lireJsonl(textes.deals);
  const ordres = lireJsonl(textes.ordres ?? '');
  return {
    compte: textes.compte ? JSON.parse(textes.compte) : null,
    illisibles: deals.illisibles.length + ordres.illisibles.length,
    ...positionsDepuisDeals(deals.lignes, ordres.lignes),
  };
}

const argent = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
const pct = (t) => (t ? `${(t.proportion * 100).toFixed(0)} % [${(t.bas * 100).toFixed(0)}–${(t.haut * 100).toFixed(0)}]` : '—');
const num = (x, d = 2) => (x === null || x === undefined ? '—' : x.toFixed(d));

function tableau(titre, groupes, libelle = (g) => String(g.groupe ?? '(sans)')) {
  console.log(`\n=== ${titre} ===\n`);
  console.log(`  ${'groupe'.padEnd(14)} ${'n'.padStart(4)}  ${'réussite [IC 95 %]'.padEnd(18)} ${'P&L'.padStart(10)}  ${'PF'.padStart(5)}`);
  for (const g of groupes) {
    console.log(`  ${libelle(g).padEnd(14)} ${String(g.n).padStart(4)}  ${pct(g.taux).padEnd(18)} ${argent(g.pnl).padStart(10)}  ${num(g.profitFactor).padStart(5)}${g.suffisant ? '' : '   trop peu'}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dossier = typeof args.dossier === 'string' ? args.dossier : 'donnees/mt5';
  let j;
  try { j = await charger(dossier); } catch (err) { console.error(`\n${err.message}\n`); process.exit(2); }

  const r = performances(j.positions);
  const g = r.global;
  const devise = j.compte?.devise ?? '';

  console.log(`\nJournal — ${j.compte?.serveur ?? 'compte'} · export du ${j.compte?.exporteLe ?? '?'} · heures de ${r.fuseau}`);
  if (j.compte?.verificationHeure) console.log(`  heure du serveur : ${j.compte.regleHeure}, ${j.compte.verificationHeure}`);
  console.log(`  ${g.n} position(s) fermée(s), ${r.ouvertes} ouverte(s), ${j.mouvements.length} dépôt(s)/retrait(s)`);
  for (const a of j.anomalies) console.log(`  ⚠  position ${a.position} : ${a.quoi}`);
  if (j.illisibles) console.log(`  ⚠  ${j.illisibles} ligne(s) illisible(s) dans l'export`);
  if (!g.n) { console.log('\nAucune position fermée.\n'); return; }

  console.log('\n=== Ensemble ===\n');
  console.log(`  réussite            ${pct(g.taux)}   (${g.gagnants} gagnants, ${g.perdants} perdants, ${g.nuls} nuls)`);
  console.log(`  gain moyen          ${argent(g.gainMoyen)} ${devise}    perte moyenne  ${argent(g.perteMoyenne === null ? null : -g.perteMoyenne)} ${devise}`);
  console.log(`  profit factor       ${g.profitFactor === null ? '— (aucune perte)' : num(g.profitFactor)}`);
  console.log(`  espérance / trade   ${argent(g.esperance)} ${devise}`);
  console.log(`  P&L net             ${argent(g.pnl)} ${devise}    dont frais ${argent(g.frais)} ${devise}`);
  console.log(`  creux maximal       ${argent(-g.drawdownMax)} ${devise}`);
  console.log(`  durée               moyenne ${num(g.dureeMoyenneMin, 0)} min, médiane ${num(g.dureeMedianeMin, 0)} min`);
  console.log(`  R net moyen         ${g.r.n ? num(g.r.moyen) : '—'}   (${g.r.n} trades avec stop à l'ouverture, ${g.r.sansStop} sans)`);
  console.log(`  Sharpe par trade    ${g.sharpeParTrade === null ? `— (moins de ${r.minimum} trades)` : num(g.sharpeParTrade)}`);
  if (!g.suffisant) console.log(`\n  Moins de ${r.minimum} trades : ces chiffres décrivent, ils ne prouvent rien.`);

  tableau('Par heure d’ouverture (Paris)', r.parHeure, (x) => `${String(x.groupe).padStart(2, '0')} h`);
  tableau('Par jour', r.parJour, (x) => x.libelle);
  tableau('Par symbole', r.parSymbole);
  tableau('Par setup (commentaire de l’ordre)', r.parSetup);
  tableau('Par sens', r.parSens);

  console.log('\n  Aucun groupe n’est désigné « meilleur » : sur 24 heures ou 5 jours, l’un sort');
  console.log('  toujours gagnant par hasard. Un écart ne compte qu’au-delà de 30 trades par groupe,');
  console.log('  et seulement s’il se confirme sur les trades SUIVANTS.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
