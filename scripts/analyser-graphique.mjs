// Une analyse de bout en bout : bougies réelles → image → modèle → issue.
//
//   node scripts/analyser-graphique.mjs --csv GC_2023_2024.csv --symbole GC \
//     --a 2023-06-15T14:00:00Z --modele qwen2.5vl:7b
//
// Deuxième brique du chemin vision. Elle ne mesure rien — elle vérifie qu'un
// plan RÉSOLUBLE sort de la chaîne. La mesure viendra après, pré-enregistrée,
// avec son contrôle.
//
// Trois propriétés tiennent la chaîne :
//
// L'image ne montre que les bougies fermées avant l'instant demandé, et la
// résolution ne regarde que celles d'après. Rien ne traverse cette frontière.
//
// L'échelle est DONNÉE au modèle, pas devinée par lui : sa dérive de lecture
// d'axe dépasse de neuf fois les distances qu'on mesure.
//
// L'issue est calculée par `resoudreIssue`, le même code que le backtest et
// que le journal. Ce qu'il répond ici, il le répondrait ailleurs.

import { readFile, writeFile } from 'node:fs/promises';

import { Resvg } from '@resvg/resvg-js';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { tracerGraphique } from '../src/lib/marche/graphique.js';
import { planDepuisAnalyse } from '../src/lib/marche/vision.js';
import { promptAvecEchelle } from '../src/lib/providers/schema.js';
import { analyzeChart, DEFAULT_BASE_URL } from '../src/lib/providers/ollama.js';
import { validateAnalysis, computeRR, rrVerdict } from '../src/lib/analysis.js';
import { resoudreIssue, OBJECTIFS, REMPLISSAGES } from '../src/lib/journal/resolve.js';
import { calculerExcursions, enUnitesDeRisque } from '../src/lib/journal/excursion.js';
import { parseArgs } from './backtest.mjs';
import { fenetreJusqua } from './tracer.mjs';

const DEFAUTS = {
  ut: '1h', utCsv: '1m', utResolution: '5m',
  bougies: 90, decalageHeures: 0, horizonHeures: 48,
  objectif: '1r', remplissage: 'cloture',
  modele: 'qwen2.5vl:7b',
};

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];

  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;

  if (args.a === undefined) erreurs.push('--a manquant : il faut un instant (ex. 2023-06-15T14:00:00Z)');
  else {
    const ms = Date.parse(args.a);
    if (Number.isNaN(ms)) erreurs.push(`--a "${args.a}" n’est pas une date valide`);
    else o.aMs = ms;
  }

  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv'], ['--ut-resolution', 'utResolution']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else o[cle] = args[cle];
  }

  for (const [option, cle, min] of [['--bougies', 'bougies', 10], ['--horizon-heures', 'horizonHeures', 1]]) {
    if (args[cle] === undefined) continue;
    const n = Number(args[cle]);
    if (!Number.isFinite(n) || n < min) erreurs.push(`${option} attend un nombre ≥ ${min}`);
    else o[cle] = n;
  }

  if (args.decalageHeures !== undefined) {
    const n = Number(args.decalageHeures);
    if (!Number.isFinite(n)) erreurs.push('--decalage-heures attend un nombre');
    else o.decalageHeures = n;
  }

  if (args.objectif !== undefined) {
    if (!OBJECTIFS[args.objectif]) erreurs.push(`--objectif "${args.objectif}" inconnu (${Object.keys(OBJECTIFS).join(', ')})`);
    else o.objectif = args.objectif;
  }

  if (args.remplissage !== undefined) {
    if (!REMPLISSAGES.includes(args.remplissage)) erreurs.push(`--remplissage "${args.remplissage}" inconnu (${REMPLISSAGES.join(', ')})`);
    else o.remplissage = args.remplissage;
  }

  if (typeof args.modele === 'string') o.modele = args.modele;
  o.baseUrl = typeof args.baseUrl === 'string' ? args.baseUrl : DEFAULT_BASE_URL;
  o.libelle = typeof args.symbole === 'string' ? args.symbole.toUpperCase() : 'INSTRUMENT';
  o.sortie = typeof args.sortie === 'string' ? args.sortie : null;

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}) : il faudrait inventer des bougies.`);
  }
  if (dureeUnite(o.utResolution) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut-resolution (${o.utResolution}) est plus fine que --ut-csv (${o.utCsv}).`);
  }

  return erreurs.length ? { erreurs } : o;
}

/** Les bougies de résolution : strictement après l'instant analysé. */
export function bougiesApres(bougies, aMs) {
  return bougies.filter((b) => b.ouvertureMs >= aMs);
}

const iso = (ms) => new Date(ms).toISOString();

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :');
    console.error('  node scripts/analyser-graphique.mjs --csv GC_2023_2024.csv --symbole GC \\');
    console.error('    --a 2023-06-15T14:00:00Z --modele qwen2.5vl:7b\n');
    process.exit(1);
  }

  // --- 1. Les bougies, coupées à l'instant demandé -------------------------
  let visibles, resolution;
  try {
    const { bougies: fines } = analyserCsv(await readFile(o.csv, 'utf8'), {
      unite: o.utCsv, decalageHeures: o.decalageHeures,
    });
    const serieAffichee = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? fines : agregerBougies(fines, o.ut);
    visibles = fenetreJusqua(serieAffichee, o.aMs, o.bougies);

    const serieFine = dureeUnite(o.utResolution) === dureeUnite(o.utCsv) ? fines : agregerBougies(fines, o.utResolution);
    resolution = bougiesApres(serieFine, o.aMs);
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  console.log(`\n${o.libelle}  ·  ${o.ut}  ·  ${visibles.length} bougies visibles`);
  console.log(`  analysé à   ${iso(o.aMs)}`);
  console.log(`  l'image s'arrête à ${iso(visibles.at(-1).fermetureMs)}`);
  console.log(`  ${resolution.length} bougies ${o.utResolution} disponibles pour trancher`);

  // --- 2. L'image ----------------------------------------------------------
  const { svg, echelle } = tracerGraphique(visibles, { libelle: o.libelle, unite: o.ut });
  const png = new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
  const base = o.sortie ?? `analyse-${o.libelle.toLowerCase()}-${iso(o.aMs).slice(0, 13)}`;
  await writeFile(`${base}.png`, png);

  console.log(`\n  échelle donnée au modèle : ${echelle.priceBottom} → ${echelle.priceTop}`);
  console.log(`  ${base}.png  (${(png.length / 1024).toFixed(0)} Ko)`);

  // --- 3. Le modèle --------------------------------------------------------
  process.stdout.write(`\n  ${o.modele} réfléchit… `);
  const debut = Date.now();
  let analyse;
  try {
    analyse = await analyzeChart(`data:image/png;base64,${png.toString('base64')}`, {
      model: o.modele,
      baseUrl: o.baseUrl,
      prompt: promptAvecEchelle(echelle),
    });
  } catch (err) {
    console.log('échec');
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(3);
  }
  console.log(`${((Date.now() - debut) / 1000).toFixed(1)} s`);

  const verdict = validateAnalysis(analyse);
  if (!verdict.ok) {
    console.error('\n  Le plan rendu est incohérent :');
    for (const e of verdict.errors) console.error('    - ' + e);
    console.error(`\n  Rendu brut : ${JSON.stringify(analyse)}\n`);
    process.exit(4);
  }

  const rr = computeRR(analyse.entry, analyse.stopLoss, analyse.tp1);
  console.log(`\n  ${analyse.direction}  ·  biais ${analyse.bias}  ·  confiance ${analyse.confidence}`);
  console.log(`    entrée  ${analyse.entry}`);
  console.log(`    stop    ${analyse.stopLoss}`);
  console.log(`    tp1     ${analyse.tp1}      R:R ${rr}  — ${rrVerdict(rr).label}`);
  console.log(`    tp2     ${analyse.tp2}`);
  for (const phrase of analyse.reasoning) console.log(`    · ${phrase}`);

  // --- 4. L'issue, par le même résolveur que partout ailleurs --------------
  const plan = planDepuisAnalyse(analyse);
  const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.utResolution));
  const suite = resolution.slice(0, horizonBougies);

  if (!suite.length) {
    console.log('\n  Aucune bougie après cet instant : issue indécidable.\n');
    return;
  }

  const { statut, detail } = resoudreIssue({
    plan, bougies: suite, horizonBougies, objectif: o.objectif, remplissage: o.remplissage,
  });

  const planReel = { ...plan, prixEntree: detail.prixEntreeReel ?? plan.prixEntree };
  const iDeclenchement = detail.declencheLe == null
    ? -1
    : suite.findIndex((b) => b.ouvertureMs === detail.declencheLe);
  const excursions = iDeclenchement >= 0
    ? enUnitesDeRisque(calculerExcursions(planReel, suite.slice(iDeclenchement, detail.bougiesExaminees)), planReel)
    : null;

  console.log(`\n  issue : ${statut}`);
  if (detail.declencheLe) console.log(`    déclenché le ${iso(detail.declencheLe)} à ${detail.prixEntreeReel}`);
  if (excursions) console.log(`    amplitude max  en faveur ${excursions.faveurEnR} R  ·  contre ${excursions.contreEnR} R`);

  await writeFile(`${base}.json`, JSON.stringify({
    instant: iso(o.aMs),
    libelle: o.libelle, unite: o.ut, modele: o.modele,
    echelle, analyse, plan, statut, detail, excursions,
  }, null, 2) + '\n');

  console.log(`\n  ${base}.json`);
  console.log('\n  Cette exécution ne mesure rien. Elle vérifie qu’un plan résoluble');
  console.log('  sort de la chaîne. La mesure viendra pré-enregistrée, avec son contrôle.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
