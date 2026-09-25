// Sur quel marché l'empreinte d'un seul opérateur se voit-elle ?
//
//   node scripts/comparer-marches.mjs --dossier marches --taille-contrat GC=100,SI=5000
//
// La question n'est pas « où interviennent les institutionnels » — ils
// interviennent partout, et massivement. C'est : où un seul d'entre eux
// laisse-t-il une TRACE DÉTECTABLE. Et ça, c'est l'inverse de la profondeur
// du marché.
//
// Mesuré sur l'or COMEX : la bougie de quinze minutes la plus calme brasse
// déjà un demi-milliard de dollars de notionnel, et le maximum sur seize
// jours n'atteint que 14,4 fois la médiane. Personne ne pèse cinquante fois
// ce marché.
//
// Ce script classe les marchés par ce rapport. Plus il est élevé, plus un
// évènement isolé peut se détacher du bruit de fond — donc plus la démarche
// « repérer un gros volume et regarder ensuite » a de chances d'aboutir.
//
// Il ne mesure AUCUNE rentabilité. Il mesure une visibilité.

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment, mediane, quantile, DETECTEURS } from '../src/lib/marche/anomalies.js';
import { parseArgs } from './backtest.mjs';

/**
 * Multiplicateurs des contrats CME les plus courants, pour convertir un
 * volume en notionnel. Sert à l'affichage : aucun classement n'en dépend.
 */
export const TAILLES = {
  GC: 100, SI: 5000, PL: 50, PA: 100, HG: 25_000,
  CL: 1000, NG: 10_000, ES: 50, NQ: 20, ZN: 1000, ZB: 1000, '6E': 125_000,
};

const DEFAUTS = { ut: '15m', utCsv: '1m', fenetre: 60, dossier: 'marches' };

export function validerOptions(args) {
  const o = { ...DEFAUTS, tailles: { ...TAILLES } };
  const erreurs = [];

  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else o[cle] = args[cle];
  }

  if (typeof args.dossier === 'string') o.dossier = args.dossier;

  if (args.fenetre !== undefined) {
    const n = Number(args.fenetre);
    if (!Number.isInteger(n) || n < 20) erreurs.push('--fenetre attend un entier ≥ 20');
    else o.fenetre = n;
  }

  // « GC=100,SI=5000 » complète ou corrige la table intégrée.
  if (typeof args.tailleContrat === 'string') {
    for (const paire of args.tailleContrat.split(',')) {
      const [symbole, valeur] = paire.split('=');
      const n = Number(valeur);
      if (!symbole || !Number.isFinite(n) || n <= 0) erreurs.push(`--taille-contrat : "${paire}" illisible (attendu SYMBOLE=nombre)`);
      else o.tailles[symbole.trim().toUpperCase()] = n;
    }
  }

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}).`);
  }

  return erreurs.length ? { erreurs } : o;
}

/** Le symbole porté par le nom du fichier : « GC.csv », « SI_2024.csv ». */
export function symboleDe(nomFichier) {
  return basename(nomFichier).split(/[._-]/)[0].toUpperCase();
}

/**
 * Ce qui décide du classement : à quel point le volume peut se détacher.
 *
 * Le rapport maximum sur médiane, et les parts au-dessus de seuils fixes.
 * Rien de tout cela ne parle de rentabilité — seulement de visibilité.
 */
export function visibilite(volumes) {
  const utiles = volumes.filter((v) => v > 0);
  if (utiles.length < 100) return null;

  const med = mediane(utiles);
  if (!med) return null;

  const part = (seuil) => (utiles.filter((v) => v >= seuil * med).length / utiles.length) * 100;

  return {
    bougies: utiles.length,
    medianeVolume: Math.round(med),
    maxSurMediane: Number((Math.max(...utiles) / med).toFixed(1)),
    q99SurMediane: Number((quantile(utiles, 0.99) / med).toFixed(1)),
    part3x: Number(part(3).toFixed(2)),
    part5x: Number(part(5).toFixed(2)),
    part10x: Number(part(10).toFixed(2)),
  };
}

const milliers = (n) => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/comparer-marches.mjs --dossier marches\n');
    process.exit(1);
  }

  let fichiers;
  try {
    fichiers = (await readdir(o.dossier)).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  if (!fichiers.length) {
    console.error(`\nAucun .csv dans ${o.dossier}/\n`);
    process.exit(2);
  }

  console.log(`\n${fichiers.length} marchés · unité ${o.ut}\n`);

  const lignes = [];
  for (const fichier of fichiers) {
    const symbole = symboleDe(fichier);
    process.stdout.write(`  ${symbole.padEnd(6)} `);

    let serie;
    try {
      const { bougies, volumeExploitable } = analyserCsv(await readFile(join(o.dossier, fichier), 'utf8'), { unite: o.utCsv });
      if (!volumeExploitable) { console.log('sans volume réel — ignoré'); continue; }
      // Découpé par contrat : une médiane calculée au travers d'un roulement
      // mélangerait deux régimes de liquidité.
      const { segments } = decouperParContrat(bougies);
      serie = segments.flatMap((s) => (dureeUnite(o.ut) === dureeUnite(o.utCsv) ? s.bougies : agregerBougies(s.bougies, o.ut)));
    } catch (err) {
      console.log(`illisible — ${err.message}`);
      continue;
    }

    const v = visibilite(serie.map((b) => b.volume));
    if (!v) { console.log('trop peu de bougies'); continue; }

    const prix = mediane(serie.map((b) => b.cloture).filter(Number.isFinite));
    const taille = o.tailles[symbole] ?? 1;
    const notionnel = (prix * taille * v.medianeVolume) / 1e6;

    // Combien d'anomalies se déclenchent réellement, avec nos détecteurs.
    const scores = scorerSegment(serie, { fenetre: o.fenetre });
    const anomalies = Object.fromEntries(
      DETECTEURS.map((d) => [d, scores.filter((s) => s.scores[d] > 0).length]),
    );

    lignes.push({ symbole, ...v, notionnel, anomalies });
    console.log(`${milliers(v.bougies)} bougies`);
  }

  if (!lignes.length) { console.error('\nRien à comparer.\n'); process.exit(2); }

  lignes.sort((a, b) => b.maxSurMediane - a.maxSurMediane);

  console.log('\n' + '='.repeat(78));
  console.log('  VISIBILITÉ D’UNE EMPREINTE — du plus détachable au moins');
  console.log('='.repeat(78));
  console.log('\n  marché   médiane    notionnel      max/méd   q99/méd    ≥3×     ≥5×    ≥10×');
  for (const l of lignes) {
    console.log(
      `  ${l.symbole.padEnd(7)}${milliers(l.medianeVolume).padStart(8)}`
      + `${(milliers(l.notionnel) + ' M$').padStart(13)}`
      + `${String(l.maxSurMediane).padStart(13)}${String(l.q99SurMediane).padStart(10)}`
      + `${(l.part3x + ' %').padStart(8)}${(l.part5x + ' %').padStart(8)}${(l.part10x + ' %').padStart(8)}`,
    );
  }

  console.log('\n\n  ANOMALIES DÉCLENCHÉES, en % des bougies');
  console.log(`\n  marché ${DETECTEURS.map((d) => d.slice(0, 9).padStart(11)).join('')}`);
  for (const l of lignes) {
    console.log(
      `  ${l.symbole.padEnd(7)}`
      + DETECTEURS.map((d) => `${((l.anomalies[d] / l.bougies) * 100).toFixed(1)} %`.padStart(11)).join(''),
    );
  }

  console.log('\n\nLecture :');
  console.log('  max/méd est la mesure directe de « à quel point un évènement isolé peut');
  console.log('  se détacher ». Plus il est haut, plus un opérateur unique est visible —');
  console.log('  c’est-à-dire moins le marché est profond.');
  console.log();
  console.log('  Le notionnel dit pourquoi : là où la bougie médiane brasse un milliard,');
  console.log('  une banque qui entre avec cinquante millions ne se voit pas.');
  console.log();
  console.log('  CE CLASSEMENT NE MESURE AUCUNE RENTABILITÉ. Un marché où l’empreinte se');
  console.log('  voit n’est pas un marché où elle rapporte : c’est seulement celui où la');
  console.log('  question peut être posée.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
