// Trace un graphique depuis de vraies bougies, à un instant donné.
//
//   node scripts/tracer.mjs --csv GC_2023_2024.csv --a 2023-06-15T14:00:00Z
//   node scripts/tracer.mjs --csv GC_2023_2024.csv --a 2023-06-15 --ut 4h --bougies 120
//
// Première brique du chemin vision. Elle ne fait qu'une chose, et elle la fait
// en ne regardant que le passé : les bougies retenues s'arrêtent à l'instant
// demandé. Ce que l'image ne montre pas, le modèle ne pourra pas le lire.
//
// L'échelle exacte est affichée et écrite à côté de l'image. C'est elle qu'on
// donnera au modèle, au lieu de lui faire deviner l'axe — sa dérive de lecture
// dépasse d'un ordre de grandeur les distances qu'on cherche à mesurer.

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { tracerGraphique } from '../src/lib/marche/graphique.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '1h', utCsv: '1m', bougies: 90, decalageHeures: 0 };

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];

  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;

  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    const brut = args[cle];
    if (brut === undefined) continue;
    if (!UNITES[brut]) erreurs.push(`${option} "${brut}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else o[cle] = brut;
  }

  if (args.a !== undefined) {
    const ms = Date.parse(args.a);
    if (Number.isNaN(ms)) erreurs.push(`--a "${args.a}" n’est pas une date valide`);
    else o.aMs = ms;
  }

  if (args.bougies !== undefined) {
    const n = Number(args.bougies);
    if (!Number.isInteger(n) || n < 10) erreurs.push('--bougies attend un entier ≥ 10');
    else o.bougies = n;
  }

  if (args.decalageHeures !== undefined) {
    const n = Number(args.decalageHeures);
    if (!Number.isFinite(n)) erreurs.push('--decalage-heures attend un nombre');
    else o.decalageHeures = n;
  }

  if (args.sortie !== undefined) {
    if (typeof args.sortie !== 'string') erreurs.push('--sortie attend un chemin de fichier');
    else o.sortie = args.sortie;
  }

  o.libelle = typeof args.symbole === 'string' ? args.symbole.toUpperCase() : 'INSTRUMENT';

  if (o.ut && o.utCsv && dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}) : il faudrait inventer des bougies.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/**
 * Les `nombre` dernières bougies se terminant AU PLUS TARD à `aMs`.
 *
 * Une bougie dont la fermeture dépasse l'instant demandé n'est pas encore
 * connue : la retenir montrerait au modèle un morceau d'avenir.
 */
export function fenetreJusqua(bougies, aMs, nombre) {
  const visibles = aMs === undefined ? bougies : bougies.filter((b) => b.fermetureMs <= aMs);
  if (!visibles.length) {
    throw new Error(aMs === undefined
      ? 'Aucune bougie dans le fichier.'
      : `Aucune bougie fermée avant ${new Date(aMs).toISOString()}.`);
  }
  return visibles.slice(-nombre);
}

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :');
    console.error('  node scripts/tracer.mjs --csv GC_2023_2024.csv --symbole GC --a 2023-06-15T14:00:00Z\n');
    process.exit(1);
  }

  let bougies;
  try {
    const { bougies: fines } = analyserCsv(await readFile(o.csv, 'utf8'), {
      unite: o.utCsv, decalageHeures: o.decalageHeures,
    });
    const serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? fines : agregerBougies(fines, o.ut);
    bougies = fenetreJusqua(serie, o.aMs, o.bougies);
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  const r = tracerGraphique(bougies, { libelle: o.libelle, unite: o.ut });
  const sortie = o.sortie ?? `graphique-${o.libelle.toLowerCase()}-${new Date(r.finMs).toISOString().slice(0, 13)}.svg`;

  await writeFile(sortie, r.svg);
  await writeFile(sortie.replace(/\.svg$/, '') + '.json', JSON.stringify({
    fichier: basename(sortie),
    libelle: o.libelle,
    unite: o.ut,
    nombreBougies: r.nombreBougies,
    debut: new Date(r.debutMs).toISOString(),
    fin: new Date(r.finMs).toISOString(),
    avecVolume: r.avecVolume,
    echelle: r.echelle,
  }, null, 2) + '\n');

  console.log(`\n${o.libelle}  ·  ${o.ut}  ·  ${r.nombreBougies} bougies`);
  console.log(`  de ${new Date(r.debutMs).toISOString()}`);
  console.log(`  à  ${new Date(r.finMs).toISOString()}`);
  console.log(`  volume tracé : ${r.avecVolume ? 'oui' : 'non — le fichier n’en porte pas'}`);
  console.log(`\n  échelle exacte, à donner au modèle plutôt qu’à lui faire deviner :`);
  console.log(`    haut de l’image   ${r.echelle.priceTop}`);
  console.log(`    bas de l’image    ${r.echelle.priceBottom}`);
  console.log(`\n  ${sortie}`);
  console.log(`  ${sortie.replace(/\.svg$/, '')}.json\n`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
