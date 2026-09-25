// Où poser le take profit, le break-even, le stop — mesuré, pas deviné.
//
//   node scripts/comportement.mjs --csv GC_2023_2024.csv --symbole GC
//   node scripts/comportement.mjs --csv GC_2023_2024.csv --detecteur absorption --horizon-heures 24
//
// Le scanner repère les volumes anormaux. `inspecter.mjs` en montre quelques
// uns. Ce script-ci les mesure TOUS : jusqu'où le prix va dans le sens de
// celui qui est entré, jusqu'où il va contre, combien de temps ça prend, et
// s'il revient toucher le bloc.
//
// L'unité est la hauteur de la bougie d'anomalie — la distance naturelle du
// stop. Tout est donc en R, comparable d'un cas à l'autre et d'un prix à
// l'autre.
//
// ┌───────────────────────────────────────────────────────────────────────┐
// │ CE N'EST PAS UNE MESURE DE STRATÉGIE.                                 │
// │                                                                       │
// │ Aucune entrée n'est décidée, aucun coût n'est compté, et les données  │
// │ ont déjà été regardées. Ce qui sort d'ici est une DESCRIPTION, donc   │
// │ une hypothèse. Elle devra se geler et s'éprouver sur une période      │
// │ jamais ouverte — 2025 — avant de valoir quoi que ce soit.             │
// └───────────────────────────────────────────────────────────────────────┘

import { readFile } from 'node:fs/promises';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment, quantile, DETECTEURS, FAMILLES } from '../src/lib/marche/anomalies.js';
import { comportementApres, atteintAvantDePerdre } from '../src/lib/marche/apres.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = {
  ut: '15m', utCsv: '1m', decalageHeures: 0,
  fenetre: 60, horizonHeures: 24,
};

const MULTIPLES = [1, 1.5, 2, 3];

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

  for (const [option, cle, min] of [['--fenetre', 'fenetre', 20], ['--horizon-heures', 'horizonHeures', 1]]) {
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

  if (args.detecteur !== undefined) {
    if (!DETECTEURS.includes(args.detecteur)) erreurs.push(`--detecteur "${args.detecteur}" inconnu (${DETECTEURS.join(', ')})`);
    else o.detecteur = args.detecteur;
  }

  o.avecMacro = Boolean(args.avecMacro);
  o.horizon = args.horizon === undefined ? 'semaine' : args.horizon;
  if (!['jour', 'semaine'].includes(o.horizon)) erreurs.push('--horizon attend "jour" ou "semaine"');

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}).`);
  }

  return erreurs.length ? { erreurs } : o;
}

const q = (valeurs, part) => (valeurs.length ? quantile(valeurs, part).toFixed(2) : '—');

/** Distribution d'une famille : ce qu'elle dit sur l'objectif et le stop. */
/** La part d'objectifs atteints avant le stop, par multiple. */
export function partsAtteintes(cas) {
  return MULTIPLES.map((m) => {
    const verdicts = cas.map((c) => c.ordre[m]).filter((v) => v === 'atteint' || v === 'perdu');
    return verdicts.length ? (verdicts.filter((v) => v === 'atteint').length / verdicts.length) * 100 : null;
  });
}

/**
 * Le témoin : les bougies de la MÊME famille que le détecteur n'a PAS
 * signalées. C'est la seule comparaison qui répond à la question posée —
 * « une bougie à volume anormal se comporte-t-elle autrement qu'une bougie
 * ordinaire ? » Un taux de 59 % ne veut rien dire seul ; il ne veut dire
 * quelque chose que si l'ordinaire donne 50.
 *
 * Sans ce témoin, on mesure la dérive du marché et on l'attribue au
 * détecteur. Sur de l'or qui prend 35 % en deux ans, n'importe quelle règle
 * acheteuse paraît bonne.
 */
function decrireFamille(nom, cas, temoin = null) {
  if (!cas.length) {
    console.log(`\n  ${nom.padEnd(14)} aucun cas`);
    return;
  }

  const faveur = cas.map((c) => c.faveurEnR).sort((a, b) => a - b);
  const contre = cas.map((c) => c.contreEnR).sort((a, b) => a - b);
  const sortis = cas.filter((c) => c.sortiDeLaZone);
  const retours = cas.filter((c) => c.retourDansLaZone !== null);

  console.log(`\n  ${nom.padEnd(14)} ${cas.length} cas`);
  console.log(`    faveur (R)    q25 ${q(faveur, 0.25)}   médiane ${q(faveur, 0.5)}   q75 ${q(faveur, 0.75)}   q90 ${q(faveur, 0.9)}`);
  console.log(`    contre (R)    q25 ${q(contre, 0.25)}   médiane ${q(contre, 0.5)}   q75 ${q(contre, 0.75)}   q90 ${q(contre, 0.9)}`);
  console.log(
    `    quitte la zone : ${((sortis.length / cas.length) * 100).toFixed(0)} %`
    + `  ·  y revient ensuite : ${sortis.length ? ((retours.length / sortis.length) * 100).toFixed(0) : '—'} %`
    + (retours.length ? `, après ${q(retours.map((c) => c.retourDansLaZone).sort((a, b) => a - b), 0.5)} bougies en médiane` : ''),
  );

  const parts = partsAtteintes(cas);
  const ligne = MULTIPLES.map((m, k) => `${m}R ${parts[k] === null ? '—' : parts[k].toFixed(0) + '%'}`).join('   ');
  console.log(`    objectif atteint AVANT le stop :  ${ligne}`);

  if (!temoin || !temoin.length) return;

  const partsT = partsAtteintes(temoin);
  const ligneT = MULTIPLES.map((m, k) => `${m}R ${partsT[k] === null ? '—' : partsT[k].toFixed(0) + '%'}`).join('   ');
  console.log(`    TÉMOIN (${String(temoin.length).padStart(5)} non signalées)  :  ${ligneT}`);

  // L'écart est le seul chiffre qui porte une information. Son incertitude
  // aussi : deux points sur quatre cents cas, c'est du bruit.
  const ecarts = MULTIPLES.map((m, k) => {
    if (parts[k] === null || partsT[k] === null) return `${m}R —`;
    const d = parts[k] - partsT[k];
    // Erreur type de la différence de deux proportions, en points.
    const se = Math.sqrt(2500 / cas.length + 2500 / temoin.length);
    const sigma = se > 0 ? Math.abs(d) / se : 0;
    return `${m}R ${d >= 0 ? '+' : ''}${d.toFixed(1)}${sigma >= 2 ? ' *' : ''}`;
  }).join('   ');
  console.log(`    ÉCART (points)                   :  ${ecarts}`);
}

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/comportement.mjs --csv GC_2023_2024.csv --symbole GC\n');
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
      console.error('\nÉchec : ce fichier ne porte pas de volume réel.\n');
      process.exit(2);
    }
    ({ segments } = decouperParContrat(fines));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.ut));
  const demandes = o.detecteur ? [o.detecteur] : DETECTEURS;
  const champ = o.horizon === 'jour' ? 'familleJour' : 'familleSemaine';

  console.log(`${segments.length} contrat(s)  ·  unité ${o.ut}  ·  horizon ${o.horizonHeures} h = ${horizonBougies} bougies`);
  console.log(`familles lues ${o.horizon === 'jour' ? 'sur la journée' : 'sur la semaine'}`);

  // Un cas par anomalie, avec son comportement après.
  const parDetecteur = new Map(demandes.map((d) => [d, []]));
  // Même traitement, mêmes exclusions, même horizon : seule l'appartenance
  // au détecteur change. C'est ce qui rend la comparaison honnête.
  const temoins = new Map(demandes.map((d) => [d, []]));
  let tronques = 0;

  for (const segment of segments) {
    const serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? segment.bougies : agregerBougies(segment.bougies, o.ut);
    const scores = scorerSegment(serie, { fenetre: o.fenetre });

    for (const s of scores) {
      if (!o.avecMacro && s.mesures.macro) continue;

      const apres = comportementApres(serie, s.index, horizonBougies);
      if (!apres) { tronques++; continue; }

      const ordre = Object.fromEntries(MULTIPLES.map((m) => [m, atteintAvantDePerdre(serie, s.index, horizonBougies, m)]));

      for (const d of demandes) {
        const cas = { ...apres, famille: s.mesures[champ], ordre };
        (s.scores[d] > 0 ? parDetecteur : temoins).get(d).push(cas);
      }
    }
  }

  if (tronques) console.log(`${tronques} anomalies écartées : horizon incomplet en fin de contrat`);

  for (const detecteur of demandes) {
    const cas = parDetecteur.get(detecteur);
    console.log('\n' + '='.repeat(78));
    console.log(`  ${detecteur.toUpperCase()}  —  ${cas.length} anomalies mesurées`);
    console.log('='.repeat(78));

    if (!cas.length) continue;

    const temoin = temoins.get(detecteur);
    decrireFamille('TOUTES', cas, temoin);
    for (const f of FAMILLES) {
      decrireFamille(f, cas.filter((c) => c.famille === f), temoin.filter((c) => c.famille === f));
    }
    const sansFamille = cas.filter((c) => !c.famille);
    if (sansFamille.length) decrireFamille('plat/inconnu', sansFamille, temoin.filter((c) => !c.famille));
  }

  console.log('\n\nLecture :');
  console.log('  « faveur » et « contre » sont en multiples de la hauteur de la bougie');
  console.log('  d’anomalie — c’est-à-dire en R, le stop se posant au-delà du bloc.');
  console.log();
  console.log('  « objectif atteint AVANT le stop symétrique » est le seul chiffre qui');
  console.log('  répond vraiment à « où mettre le take profit » : comparer deux amplitudes');
  console.log('  maximales ne dit pas laquelle est arrivée en premier, et un objectif');
  console.log('  atteint après le stop ne rapporte rien.');
  console.log();
  console.log('  Le TÉMOIN est l’ensemble des bougies de la MÊME famille que le');
  console.log('  détecteur n’a PAS signalées — mêmes exclusions, même horizon. Un taux');
  console.log('  de 59 % ne dit rien seul ; il ne dit quelque chose que si l’ordinaire');
  console.log('  donne 50. Sans ce témoin on mesure la dérive du marché et on');
  console.log('  l’attribue au détecteur : sur de l’or qui prend 35 % en deux ans,');
  console.log('  n’importe quelle règle acheteuse paraît bonne.');
  console.log();
  console.log('  L’ÉCART est le seul chiffre qui porte une information. « * » marque');
  console.log('  deux erreurs types — le seuil au-dessous duquel c’est du bruit, et');
  console.log('  au-dessus duquel c’est à éprouver sur une période jamais ouverte.');
  console.log();
  console.log('  CE N’EST PAS UNE MESURE DE STRATÉGIE. Aucune entrée n’est décidée, aucun');
  console.log('  coût n’est compté, et ces données ont déjà été regardées. Ce qui sort');
  console.log('  d’ici est une hypothèse, à geler et à éprouver sur 2025.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
