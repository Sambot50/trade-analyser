// Quelle distance le prix parcourt-il après un gros volume ?
//
//   node scripts/dimensionner.mjs --dossier marches
//   node scripts/dimensionner.mjs --csv GC_2023_2024.csv --taille-contrat 100
//
// L'étude de corrélation a établi le fait : le volume prédit l'AMPLEUR d'un
// mouvement (Spearman +0,43 à une heure) et absolument pas sa DIRECTION
// (+0,013). Corréler ne suffit pas à s'en servir — il faut des distances.
//
// Ce script les donne. Par tranche de volume : jusqu'où le prix monte, jusqu'où
// il descend, en pour cent du prix et en multiples de la hauteur de la bougie.
//
// LES DEUX SENS SONT DONNÉS SÉPARÉMENT, et c'est délibéré. La direction étant
// imprévisible, la seule lecture honnête est « le prix va parcourir tant vers
// le haut ET tant vers le bas ». Un stop se dimensionne sur celle qui va
// contre, un objectif sur celle qui va dans le sens — sans savoir laquelle
// sera laquelle.
//
// DES QUANTILES, PAS DES MOYENNES. Une moyenne d'excursion est tirée par les
// quelques cas extrêmes et ne décrit aucune séance. La médiane dit le cas
// courant, le q90 dit ce qu'il faut encaisser une fois sur dix.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { UNITES, dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { mediane, quantile } from '../src/lib/marche/anomalies.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '15m', utCsv: '1m', fenetre: 60 };
// Bornes basses des tranches de volume, en multiples de la médiane glissante.
export const TRANCHES = [0, 1, 1.5, 2, 3, 4, 6, 10];
const HORIZONS = [[1, '15 min'], [4, '1 h'], [16, '4 h']];

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];
  if (typeof args.csv !== 'string' && typeof args.dossier !== 'string') {
    erreurs.push('--csv <fichier> ou --dossier <dossier> est requis');
  }
  o.csv = args.csv; o.dossier = args.dossier;
  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue`);
    else o[cle] = args[cle];
  }
  if (args.fenetre !== undefined) {
    const n = Number(args.fenetre);
    if (!Number.isFinite(n) || n < 20) erreurs.push('--fenetre attend un nombre ≥ 20');
    else o.fenetre = n;
  }
  return erreurs.length ? { erreurs } : o;
}

export function trancheDe(ratio) {
  for (let i = TRANCHES.length - 1; i >= 0; i--) if (ratio >= TRANCHES[i]) return i;
  return 0;
}

export function nomTranche(i) {
  const bas = TRANCHES[i];
  const haut = TRANCHES[i + 1];
  return haut === undefined ? `≥ ${bas}×` : `${bas}–${haut}×`;
}

/**
 * Les excursions après une bougie, depuis sa CLÔTURE.
 *
 * Le départ est la clôture parce que c'est le premier prix auquel on peut
 * agir en voyant la bougie. Le haut et le bas sont donnés séparément : la
 * direction étant imprévisible, aucun des deux n'est « le bon ».
 */
export function excursions(serie, index, horizon) {
  const b = serie[index];
  const suite = serie.slice(index + 1, index + 1 + horizon);
  if (suite.length < horizon) return null;
  const depart = b.cloture;
  if (!(depart > 0)) return null;
  const hauteur = b.plusHaut - b.plusBas;
  if (!(hauteur > 0)) return null;

  const haut = Math.max(...suite.map((p) => p.plusHaut));
  const bas = Math.min(...suite.map((p) => p.plusBas));
  return {
    monteePct: ((haut - depart) / depart) * 100,
    baissePct: ((depart - bas) / depart) * 100,
    monteeEnR: (haut - depart) / hauteur,
    baisseEnR: (depart - bas) / hauteur,
  };
}

const q = (xs, p) => (xs.length ? quantile([...xs].sort((a, b) => a - b), p) : null);
const n3 = (x) => (x === null ? '  —  ' : x.toFixed(2).padStart(5));

export function tableau(parTranche, cle, titre, unite) {
  console.log(`\n  ${titre}`);
  console.log('    tranche de volume        n      médiane     q75      q90      q99');
  console.log('    ' + '─'.repeat(64));
  for (let i = 0; i < TRANCHES.length; i++) {
    const cas = parTranche[i] ?? [];
    const xs = cas.map((c) => c[cle]).filter(Number.isFinite);
    if (xs.length < 30) {
      console.log(`    ${nomTranche(i).padEnd(12)} ${String(xs.length).padStart(8)}        trop peu de cas`);
      continue;
    }
    console.log(
      `    ${nomTranche(i).padEnd(12)} ${xs.length.toLocaleString('fr-FR').padStart(8)}     `
      + `${n3(q(xs, 0.5))}   ${n3(q(xs, 0.75))}   ${n3(q(xs, 0.9))}   ${n3(q(xs, 0.99))}   ${unite}`,
    );
  }
}

async function lire(chemin, o) {
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(chemin, 'utf8'), { unite: o.utCsv });
  if (!volumeExploitable) return null;
  const { segments } = decouperParContrat(fines);
  const parHorizon = new Map(HORIZONS.map(([h]) => [h, []]));

  for (const segment of segments) {
    const serie = agregerBougies(segment.bougies, o.ut);
    for (let i = o.fenetre; i < serie.length; i++) {
      const med = mediane(serie.slice(i - o.fenetre, i).map((p) => p.volume || 0));
      if (!med) continue;
      const ratio = (serie[i].volume || 0) / med;
      for (const [h] of HORIZONS) {
        const e = excursions(serie, i, h);
        if (e) parHorizon.get(h).push({ tranche: trancheDe(ratio), ...e });
      }
    }
  }
  return parHorizon;
}

async function principal() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('');
    process.exit(1);
  }

  const fichiers = o.csv ? [o.csv]
    : (await readdir(o.dossier)).filter((f) => f.toLowerCase().endsWith('.csv')).sort().map((f) => join(o.dossier, f));

  const global = new Map(HORIZONS.map(([h]) => [h, []]));
  for (const f of fichiers) {
    process.stdout.write(`  ${f.replace(/^.*[\\/]/, '')} … `);
    const parHorizon = await lire(f, o);
    if (!parHorizon) { console.log('pas de volume réel'); continue; }
    console.log(`${parHorizon.get(HORIZONS[0][0]).length.toLocaleString('fr-FR')} bougies`);
    for (const [h] of HORIZONS) global.get(h).push(...parHorizon.get(h));
  }

  console.log(`\nunité ${o.ut} · volume rapporté à la médiane des ${o.fenetre} bougies précédentes`);
  console.log('départ : la CLÔTURE de la bougie · les deux sens donnés séparément\n');

  for (const [h, nom] of HORIZONS) {
    const cas = global.get(h);
    const parTranche = {};
    for (const c of cas) (parTranche[c.tranche] ??= []).push(c);

    console.log('='.repeat(74));
    console.log(`  CE QUE LE PRIX PARCOURT DANS LES ${nom.toUpperCase()} QUI SUIVENT`);
    console.log('='.repeat(74));
    tableau(parTranche, 'monteePct', 'MONTÉE maximale, en % du prix', '%');
    tableau(parTranche, 'baissePct', 'BAISSE maximale, en % du prix', '%');
    tableau(parTranche, 'monteeEnR', 'MONTÉE maximale, en hauteurs de la bougie', 'R');
    console.log('');
  }

  console.log('  Lecture :');
  console.log('    Les deux sens sont donnés séparément parce que la direction est');
  console.log('    imprévisible — corrélation mesurée +0,013. Aucun des deux n\'est');
  console.log('    « le bon » : un stop se dimensionne sur celui qui ira contre, un');
  console.log('    objectif sur celui qui ira dans le sens, sans savoir lequel.');
  console.log();
  console.log('    Des quantiles, pas des moyennes : une moyenne d\'excursion est');
  console.log('    tirée par quelques cas extrêmes et ne décrit aucune séance. La');
  console.log('    médiane dit le cas courant, le q90 ce qu\'il faut encaisser une');
  console.log('    fois sur dix.');
  console.log();
  console.log('    CECI DÉCRIT, NE PRÉDIT PAS. Ce sont des distributions passées,');
  console.log('    utiles à dimensionner, jamais à garantir.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
