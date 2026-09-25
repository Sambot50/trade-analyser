// Scanne un historique et sort les moments qui ne ressemblent pas au reste.
//
//   node scripts/scanner-anomalies.mjs --csv GC_2023_2024.csv --symbole GC
//   node scripts/scanner-anomalies.mjs --csv GC_2023_2024.csv --ut 15m --nombre 30
//
// Renversement de méthode, après DEC-029. On ne part plus d'une règle qu'on
// demande aux données de valider — elle a échoué six fois. On part des
// données, on repère ce qui est anormal, et on regarde ensuite.
//
// CE SCRIPT NE MESURE RIEN. Il fabrique des candidats à regarder. Un classement
// n'est pas une preuve, et l'œil qui jugera ensuite est un juge partial. Ce
// qu'on cherche ici, c'est une hypothèse — on n'en a plus une seule.
//
// Le découpage par contrat est appliqué : une fenêtre de référence à cheval
// sur un roulement donnerait une amplitude médiane fausse et un faux gap.

import { readFile, writeFile } from 'node:fs/promises';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment, meilleurs, DETECTEURS } from '../src/lib/marche/anomalies.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = {
  ut: '5m', utCsv: '1m', decalageHeures: 0,
  fenetre: 60, nombre: 20, ecartMinutes: 120,
};

const TITRES = {
  absorption: 'ABSORPTION — beaucoup d’échanges, le prix ne bouge pas',
  deplacement: 'DÉPLACEMENT — gros volume, grande amplitude, corps plein',
  rejet: 'REJET — grosse mèche, gros volume',
  horsSeance: 'HORS SÉANCE — du volume là où il ne devrait pas y en avoir',
  gap: 'GAP — saut de prix entre deux bougies',
  picVolume: 'PIC DE VOLUME — le détecteur le plus grossier',
};

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];

  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;

  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else o[cle] = args[cle];
  }

  for (const [option, cle, min] of [['--fenetre', 'fenetre', 20], ['--nombre', 'nombre', 1], ['--ecart-minutes', 'ecartMinutes', 0]]) {
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

  if (args.detecteur !== undefined) {
    if (!DETECTEURS.includes(args.detecteur)) erreurs.push(`--detecteur "${args.detecteur}" inconnu (${DETECTEURS.join(', ')})`);
    else o.detecteur = args.detecteur;
  }

  o.symbole = typeof args.symbole === 'string' ? args.symbole.toUpperCase() : 'INSTRUMENT';
  o.export = typeof args.export === 'string' ? args.export : 'anomalies.jsonl';

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}) : il faudrait inventer des bougies.`);
  }

  return erreurs.length ? { erreurs } : o;
}

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/scanner-anomalies.mjs --csv GC_2023_2024.csv --symbole GC\n');
    process.exit(1);
  }

  let segments;
  try {
    process.stdout.write(`\nlecture de ${o.csv}… `);
    const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(o.csv, 'utf8'), {
      unite: o.utCsv, decalageHeures: o.decalageHeures,
    });
    console.log(`${fines.length} bougies ${o.utCsv}`);

    if (!volumeExploitable) {
      console.error('\nÉchec : ce fichier ne porte pas de volume réel. Tous les détecteurs en dépendent.\n');
      process.exit(2);
    }

    ({ segments } = decouperParContrat(fines));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  console.log(`${segments.length} contrat(s), mesurés séparément`);

  const scores = [];
  for (const segment of segments) {
    const serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? segment.bougies : agregerBougies(segment.bougies, o.ut);
    scores.push(...scorerSegment(serie, { fenetre: o.fenetre }));
  }
  scores.sort((a, b) => a.ms - b.ms);

  console.log(`${scores.length} bougies ${o.ut} scorées, référence sur ${o.fenetre} bougies glissantes\n`);

  const demandes = o.detecteur ? [o.detecteur] : DETECTEURS;
  const lignes = [];

  for (const detecteur of demandes) {
    const retenus = meilleurs(scores, detecteur, {
      nombre: o.nombre,
      ecartMinimalMs: o.ecartMinutes * 60_000,
    });

    console.log('='.repeat(72));
    console.log(`  ${TITRES[detecteur]}`);
    console.log('='.repeat(72));

    if (!retenus.length) {
      console.log('  aucun candidat\n');
      continue;
    }

    console.log('   score  date (UTC)         vol×méd  ampl×méd  corps  mèche   clôture');
    for (const r of retenus) {
      const m = r.mesures;
      console.log(
        `  ${String(r.scores[detecteur]).padStart(6)}  ${iso(r.ms)}  `
        + `${String(m.ratioVolume).padStart(7)}  ${String(m.ratioAmplitude).padStart(8)}  `
        + `${String(m.partDuCorps).padStart(5)}  ${String(m.partDeLaMeche).padStart(5)}  ${String(m.cloture).padStart(9)}`,
      );
      lignes.push(JSON.stringify({ detecteur, horodatage: new Date(r.ms).toISOString(), score: r.scores[detecteur], ...r.mesures }));
    }
    console.log();
  }

  await writeFile(o.export, lignes.join('\n') + '\n');
  console.log(`${lignes.length} candidats écrits dans ${o.export}\n`);

  console.log('Lecture :');
  console.log('  Ce classement ne prouve rien. Il fabrique des candidats à regarder.');
  console.log('  Pour voir l’un d’eux, prends sa date et trace le graphique :');
  console.log(`    node scripts/tracer.mjs --csv ${o.csv} --symbole ${o.symbole} --ut 1h --a <date>\n`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
