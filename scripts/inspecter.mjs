// Met côte à côte le volume et l'image : une planche par anomalie.
//
//   node scripts/scanner-anomalies.mjs --csv GC_2023_2024.csv --symbole GC
//   node scripts/inspecter.mjs --csv GC_2023_2024.csv --symbole GC --anomalies anomalies.jsonl
//
// Le scanner sort des dates, `tracer.mjs` sort des images. Ce script est le
// pont : pour chaque anomalie de volume, il trace le graphique CENTRÉ sur
// elle, la marque, et éclaircit ce qui vient après.
//
// ┌───────────────────────────────────────────────────────────────────────┐
// │ CES IMAGES MONTRENT LA SUITE. ELLES NE PEUVENT JAMAIS SERVIR À UNE     │
// │ MESURE — l'œil comme le modèle y liraient la réponse.                 │
// │                                                                       │
// │ Elles servent à reconnaître, pas à prédire. Ce que l'œil y reconnaît  │
// │ devra ensuite s'écrire comme règle, se geler, et s'éprouver sur une   │
// │ période jamais regardée. C'est la seule étape qui vaudra preuve.      │
// └───────────────────────────────────────────────────────────────────────┘

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { tracerGraphique } from '../src/lib/marche/graphique.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = {
  ut: '1h', utCsv: '1m', decalageHeures: 0,
  avant: 60, apres: 30, dossier: 'planches',
};

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];

  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;

  o.anomalies = typeof args.anomalies === 'string' ? args.anomalies : 'anomalies.jsonl';

  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else { o[cle] = args[cle]; if (cle === 'ut') o.utDemandee = true; }
  }

  for (const [option, cle, min] of [['--avant', 'avant', 10], ['--apres', 'apres', 0]]) {
    if (args[cle] === undefined) continue;
    const n = Number(args[cle]);
    if (!Number.isInteger(n) || n < min) erreurs.push(`${option} attend un entier ≥ ${min}`);
    else o[cle] = n;
  }

  if (args.decalageHeures !== undefined) {
    const n = Number(args.decalageHeures);
    if (!Number.isFinite(n)) erreurs.push('--decalage-heures attend un nombre');
    else o.decalageHeures = n;
  }

  if (typeof args.dossier === 'string') o.dossier = args.dossier;
  if (typeof args.detecteur === 'string') o.detecteur = args.detecteur;
  if (args.sens !== undefined) {
    if (!['achat', 'vente'].includes(args.sens)) erreurs.push('--sens attend "achat" ou "vente"');
    else o.sens = args.sens;
  }
  o.symbole = typeof args.symbole === 'string' ? args.symbole.toUpperCase() : 'INSTRUMENT';

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}) : il faudrait inventer des bougies.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/**
 * La fenêtre autour d'un instant : `avant` bougies avant, `apres` après.
 *
 * L'instant vient d'un scan en 5 min et la planche se trace en 1 h : il ne
 * tombe donc pas sur une ouverture. On prend la bougie qui le CONTIENT, sans
 * quoi rien ne serait marqué et l'œil chercherait en vain.
 */
export function fenetreAutour(bougies, ms, { avant, apres }) {
  let pivot = bougies.findIndex((b) => b.ouvertureMs <= ms && ms <= b.fermetureMs);
  if (pivot === -1) pivot = bougies.findIndex((b) => b.ouvertureMs > ms) - 1;
  if (pivot < 0) return null;

  const debut = Math.max(0, pivot - avant);
  const fin = Math.min(bougies.length, pivot + apres + 1);
  return { bougies: bougies.slice(debut, fin), marquerMs: bougies[pivot].ouvertureMs };
}

/** Nom de fichier lisible et triable : détecteur, bande, score, date. */
export function nomDePlanche({ detecteur, sens, bande, score, horodatage }) {
  const date = horodatage.replace(/[:T]/g, '-').slice(0, 16);
  const rang = String(Math.round(Number(score) * 100)).padStart(6, '0');
  // Le sens vient en second : un tri alphabétique regroupe alors tous les
  // achats d'un détecteur, puis toutes les ventes. C'est dans cet ordre
  // qu'on cherche une structure commune, pas en alternant.
  return `${detecteur}-${sens ?? 'nc'}-${bande}-${rang}-${date}.png`;
}

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/inspecter.mjs --csv GC_2023_2024.csv --symbole GC\n');
    process.exit(1);
  }

  // Les anomalies EN PREMIER : elles portent l'unité du scan, et c'est elle
  // qui décide de l'unité des planches. Agréger avant de la connaître
  // reviendrait à ignorer ce qu'on vient de lire.
  let anomalies, fines;
  try {
    anomalies = (await readFile(o.anomalies, 'utf8'))
      .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  if (o.detecteur) anomalies = anomalies.filter((a) => a.detecteur === o.detecteur);
  if (o.sens) anomalies = anomalies.filter((a) => a.sens === o.sens);
  if (!anomalies.length) {
    console.error('\nAucune anomalie à inspecter.\n');
    process.exit(2);
  }

  // L'unité de scan l'emporte, sauf demande explicite. Tracer plus
  // grossièrement que la détection dilue le pic de volume dans une bougie
  // plus large : la planche ne montre plus ce qui a déclenché l'alerte.
  const uniteScan = anomalies.find((a) => a.unite)?.unite;
  if (uniteScan && !o.utDemandee) o.ut = uniteScan;

  if (uniteScan && dureeUnite(o.ut) > dureeUnite(uniteScan)) {
    console.log(`\n⚠  Scan en ${uniteScan}, planches en ${o.ut}.`);
    console.log('   Le pic de volume détecté sera dilué dans une bougie plus large :');
    console.log("   tu ne verras pas sur l'image ce qui a déclenché la détection.");
    console.log(`   Retire --ut, ou repasse le scanner en ${o.ut}.`);
  }

  let serie;
  try {
    process.stdout.write(`\nlecture de ${o.csv}… `);
    ({ bougies: fines } = analyserCsv(await readFile(o.csv, 'utf8'), {
      unite: o.utCsv, decalageHeures: o.decalageHeures,
    }));
    serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? fines : agregerBougies(fines, o.ut);
    console.log(`${serie.length} bougies ${o.ut}`);
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  await mkdir(o.dossier, { recursive: true });
  console.log(`${anomalies.length} anomalies · ${o.avant} bougies avant, ${o.apres} après\n`);

  let traces = 0;
  const ignorees = [];

  for (const a of anomalies) {
    const fenetre = fenetreAutour(serie, Date.parse(a.horodatage), { avant: o.avant, apres: o.apres });
    if (!fenetre || fenetre.bougies.length < 20) {
      ignorees.push(a.horodatage);
      continue;
    }

    const { svg } = tracerGraphique(fenetre.bougies, {
      libelle: `${o.symbole} · ${a.detecteur} · ${a.sens ?? '?'} · ${a.bande} · score ${a.score}${a.macro ? ' · ⚠ annonce' : ''}`,
      unite: o.ut,
      marquerMs: fenetre.marquerMs,
    });

    const nom = nomDePlanche(a);
    await writeFile(join(o.dossier, nom), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
    console.log(`  ${a.detecteur.padEnd(12)} ${String(a.sens ?? '?').padEnd(6)} ${a.bande.padEnd(7)} ${iso(Date.parse(a.horodatage))}`);
    traces++;
  }

  console.log(`\n${traces} planches dans ${o.dossier}/`);
  if (ignorees.length) console.log(`${ignorees.length} ignorées faute de bougies autour (bords de contrat)`);

  console.log('\nLecture :');
  console.log('  La bougie signalée porte un bandeau jaune et un ▼. Ce qui vient');
  console.log('  après elle est légèrement éclairci : c’est ce qui s’est passé ensuite.');
  console.log();
  console.log('  CES IMAGES MONTRENT LA SUITE. Elles servent à reconnaître, jamais à');
  console.log('  mesurer — l’œil comme un modèle y liraient la réponse. Ce que tu y');
  console.log('  reconnaîtras devra s’écrire comme règle, se geler, et s’éprouver sur');
  console.log('  une période jamais regardée.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
