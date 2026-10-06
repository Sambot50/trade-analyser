// La structure multi-unités de temps, à un instant, depuis un fichier de bougies.
//
//   node scripts/structure.mjs --csv donnees/GC_2025_2026.csv --a 2026-07-15T12:30:00Z
//   npm run structure -- --csv donnees/mt5/bougies/XAUUSD_M1.csv
//
// Le tableau de la brique Multi-UT (src/lib/marche/multiut.js) : pour chaque
// unité de 5 min au Daily, la structure, le dernier BOS / CHoCH, son âge, le
// niveau d'invalidation et sa distance, les derniers points nommés ; puis le
// biais pondéré, la lecture, et les niveaux des sessions.
//
// Un fichier de contrats à terme est découpé par contrat (DEC-027) : on lit le
// contrat coté à l'instant demandé, jamais une série recollée.
//
// C'est un RÉSUMÉ de la structure, pas un signal : aucune mesure ne dit
// encore que le biais prédit quoi que ce soit (Labo, E8).

import { readFile } from 'node:fs/promises';

import { parseArgs } from './backtest.mjs';
import { analyser as analyserCsv } from '../src/lib/marche/csv.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { UNITES } from '../src/lib/marche/bougies.js';
import { tableauMultiUT, POIDS } from '../src/lib/marche/multiut.js';
import { niveauxDeSessions, FUSEAU_SESSIONS } from '../src/lib/marche/sessions.js';

export function validerOptions(args) {
  const erreurs = [];
  const o = { fenetre: 5, utCsv: '1m', decalageHeures: 0 };
  if (typeof args.csv !== 'string') erreurs.push('--csv manquant : un fichier de bougies 1 minute');
  else o.csv = args.csv;
  if (args.a !== undefined) {
    o.aMs = Date.parse(args.a);
    if (Number.isNaN(o.aMs)) erreurs.push(`--a "${args.a}" n’est pas une date ISO 8601`);
  }
  if (args.fenetre !== undefined) {
    o.fenetre = Number(args.fenetre);
    if (!Number.isInteger(o.fenetre) || o.fenetre < 1) erreurs.push('--fenetre attend un entier ≥ 1');
  }
  if (args.utCsv !== undefined) {
    if (args.utCsv !== '1m' || !UNITES[args.utCsv]) erreurs.push('--ut-csv doit valoir 1m : toutes les unités en sont déduites');
  }
  if (args.decalageHeures !== undefined) {
    o.decalageHeures = Number(args.decalageHeures);
    if (!Number.isFinite(o.decalageHeures)) erreurs.push('--decalage-heures attend un nombre');
  }
  return erreurs.length ? { erreurs } : o;
}

/** Le contrat coté à l'instant : le segment qui le contient, sinon le dernier avant lui. */
export function serieA(bougies, aMs) {
  const { segments } = decouperParContrat(bougies);
  const avant = segments.filter((s) => s.debutMs < aMs);
  if (!avant.length) return null;
  return avant.find((s) => s.debutMs < aMs && aMs <= s.finMs + 1) ?? avant.at(-1);
}

const fleche = (t) => (t === 'haussier' ? '▲ Haussier' : t === 'baissier' ? '▼ Baissier' : '— Indéterminé');
const duree = (ms) => {
  if (ms === null) return '';
  const h = Math.floor(ms / 3_600_000);
  return h >= 48 ? `${Math.floor(h / 24)} j` : h >= 1 ? `${h} h` : `${Math.round(ms / 60_000)} min`;
};
const prix = (x) => (x === null || x === undefined ? '—' : x.toFixed(2));
const iso = (ms) => new Date(ms).toISOString().replace('.000', '');

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  npm run structure -- --csv donnees/GC_2025_2026.csv --a 2026-07-15T12:30:00Z\n');
    process.exit(1);
  }

  let bougies;
  try {
    ({ bougies } = analyserCsv(await readFile(o.csv, 'utf8'), { unite: '1m', decalageHeures: o.decalageHeures }));
  } catch (err) {
    console.error(`\nÉchec de lecture : ${err.message}\n`);
    process.exit(2);
  }
  const aMs = o.aMs ?? bougies.at(-1).fermetureMs + 1;
  const segment = serieA(bougies, aMs);
  if (!segment) { console.error(`\nAucune bougie avant ${iso(aMs)}.\n`); process.exit(2); }

  const t = tableauMultiUT(segment.bougies, { aMs, fenetre: o.fenetre });

  console.log(`\nStructure multi-UT — ${o.csv}${segment.symbole ? ` · contrat ${segment.symbole}` : ''}`);
  console.log(`  à ${iso(aMs)} · pivots sur ${o.fenetre} bougies de chaque côté · 4 h et Daily découpés sur la séance (17 h New York)\n`);
  console.log(`  ${'UT'.padEnd(5)} ${'Structure'.padEnd(14)} ${'Évènement'.padEnd(10)} ${'Âge'.padEnd(16)} ${'Invalidation'.padStart(12)} ${'Distance'.padStart(9)}   Derniers points`);
  for (const l of t.lignes) {
    const evt = l.evenement ? `${l.evenement.type} ${l.evenement.sens === 'haussier' ? '▲' : '▼'}` : '—';
    const age = l.ageBougies === null ? '—' : `${l.ageBougies} b (${duree(l.ageMs)})`;
    const dist = l.distance === null ? '—' : `${(l.distance * 100).toFixed(2)} %`;
    const points = l.points.map((p) => `${p.type} ${prix(p.prix)}`).join(' · ');
    console.log(`  ${l.unite.padEnd(5)} ${fleche(l.tendance).padEnd(14)} ${evt.padEnd(10)} ${age.padEnd(16)} ${prix(l.invalidation).padStart(12)} ${dist.padStart(9)}   ${points}`);
  }
  const poids = Object.entries(POIDS).map(([u, p]) => `${u} ${p}`).join(' · ');
  console.log(`\n  Biais pondéré : ${t.biais.score >= 0 ? '+' : ''}${t.biais.score} / ${t.biais.sur}   (poids ${poids})`);
  console.log(`  Lecture : ${t.lecture.texte}`);

  console.log(`\n  Sessions terminées (bornes en heure de ${FUSEAU_SESSIONS}) :`);
  for (const s of niveauxDeSessions(segment.bougies, aMs)) {
    if (!s.nombre) { console.log(`    ${s.libelle.padEnd(9)} pas de bougie`); continue; }
    console.log(`    ${s.libelle.padEnd(9)} ${iso(s.debutMs)} → ${iso(s.finMs)}   haut ${prix(s.haut)}${s.hautBalaye ? ' (balayé)' : ''}   bas ${prix(s.bas)}${s.basBalaye ? ' (balayé)' : ''}`);
  }
  console.log('\n  Résumé de la structure, pas un signal : le biais n’a encore aucune mesure derrière lui (E8).\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
