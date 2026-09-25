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
import { scorerSegment, meilleurs, echantillonStratifie, DETECTEURS } from '../src/lib/marche/anomalies.js';
import { parseArgs } from './backtest.mjs';

/**
 * Quinze minutes, et ce n'est pas un réglage arbitraire.
 *
 * Trois sources indépendantes encadrent la même fenêtre :
 *
 * LA MICROSTRUCTURE, qui porte sur ce qu'on détecte réellement — le temps
 * qu'un institutionnel met à exécuter. Un ordre valant 0,01 % du volume passe
 * en ~200 secondes, un ordre à 10 % du volume en ~90 minutes. Le cadre
 * Almgren–Chriss, standard de l'exécution algorithmique, découpe le temps en
 * tranches de 5 à 10 minutes ; les algorithmes VWAP profilent le volume par
 * segments de 15 minutes — exactement ce que fait ce scanner.
 *
 * LA PRATIQUE SMC, qui place l'entrée en 15 minutes sous un biais 4 h. C'est
 * de l'opinion sans mesure, mais elle tombe au même endroit.
 *
 * NOTRE PROPRE MESURE sur l'or. Le rapport du volume à sa médiane glissante
 * se distribue identiquement de 1 à 15 minutes — q90 à 2,75 / 2,64 / 2,61.
 * Ça se dégrade à 30 minutes et s'effondre à 1 heure, où le maximum tombe de
 * 38× à 9×. Au-delà de 15 minutes, on efface l'anomalie en l'agrégeant.
 *
 * Dans cette fenêtre de 5 à 15, un seul critère départage : le contexte
 * visible. Quatre-vingt-dix bougies de 15 minutes montrent 22 heures, soit
 * une séance entière — de quoi juger une structure. À 5 minutes, sept heures
 * et demie ; à 1 minute, une heure et demie, où rien ne se lit.
 */
const DEFAUTS = {
  ut: '15m', utCsv: '1m', decalageHeures: 0,
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
  // Par défaut on échantillonne toute la distribution. `--sommet` revient à
  // ne regarder que les cas extrêmes, ce qui sur un marché revient surtout à
  // regarder ses annonces macro.
  o.sommet = Boolean(args.sommet);
  // Les fenêtres d'annonce sont écartées PAR DÉFAUT : le sommet d'un marché,
  // ce sont ses publications macro, et ce n'est pas ce qu'on cherche.
  o.avecMacro = Boolean(args.avecMacro);

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

  const macro = scores.filter((s) => s.mesures.macro).length;
  if (!o.avecMacro) {
    console.log(`${macro} bougies écartées : fenêtre d'annonce américaine (--avec-macro pour les garder)\n`);
  }
  const retenusPourScan = o.avecMacro ? scores : scores.filter((s) => !s.mesures.macro);

  const demandes = o.detecteur ? [o.detecteur] : DETECTEURS;
  const lignes = [];
  let totalMarques = 0;

  for (const detecteur of demandes) {
    const actifs = retenusPourScan.filter((s) => s.scores[detecteur] > 0).length;

    console.log('='.repeat(78));
    console.log(`  ${TITRES[detecteur]}`);
    console.log(`  ${actifs} bougies sur ${retenusPourScan.length} (${((actifs / retenusPourScan.length) * 100).toFixed(1)} %)`);
    console.log('='.repeat(78));

    // Achat et vente séparés, et échantillonnés séparément : sans ça, un
    // marché qui monte remplirait les deux tableaux du même côté.
    for (const sens of ['achat', 'vente']) {
      const duSens = retenusPourScan.filter((s) => s.mesures.sens === sens);
      const options = { nombre: o.nombre, ecartMinimalMs: o.ecartMinutes * 60_000 };
      const retenus = o.sommet
        ? meilleurs(duSens, detecteur, options).map((r) => ({ ...r, bande: 'sommet' }))
        : echantillonStratifie(duSens, detecteur, options);

      console.log(`\n  ── ${sens.toUpperCase()} ── ${duSens.filter((s) => s.scores[detecteur] > 0).length} bougies`);

      if (!retenus.length) {
        console.log('     aucun candidat');
        continue;
      }

      console.log('     bande    score  date (UTC)         vol×méd  ampl×méd  corps  mèche  macro');
      for (const r of retenus) {
        const m = r.mesures;
        console.log(
          `     ${r.bande.padEnd(7)} ${String(r.scores[detecteur]).padStart(6)}  ${iso(r.ms)}  `
          + `${String(m.ratioVolume).padStart(7)}  ${String(m.ratioAmplitude).padStart(8)}  `
          + `${String(m.partDuCorps).padStart(5)}  ${String(m.partDeLaMeche).padStart(5)}  ${m.macro ? '  ⚠' : ''}`,
        );
        lignes.push(JSON.stringify({
          detecteur, bande: r.bande, horodatage: new Date(r.ms).toISOString(),
          // L'unité de scan voyage avec l'anomalie : une planche tracée plus
          // grossièrement dilue le pic de volume qui a déclenché la détection,
          // et l'œil ne voit plus ce qu'on lui demande de juger.
          unite: o.ut,
          score: r.scores[detecteur], ...m,
        }));
      }
      totalMarques += retenus.filter((r) => r.mesures.macro).length;
    }
    console.log();
  }

  // Un marqueur qui ne marque jamais ressemble à « aucune annonce », alors
  // qu'il dit surtout « les horodatages ne sont pas en UTC ». Les exports
  // FirstRate sont en heure de New York ; ceux de Databento sont en UTC.
  if (!totalMarques && lignes.length >= 10) {
    console.log("⚠  Aucun candidat marqué « macro » sur l'ensemble.");
    console.log('   Les fenêtres d’annonce supposent des horodatages UTC. Si ton fichier');
    console.log('   est horodaté autrement, ramène-le avec --decalage-heures, sans quoi');
    console.log('   ce marqueur reste muet sans que rien ne le signale.\n');
  }

  await writeFile(o.export, lignes.join('\n') + '\n');
  console.log(`${lignes.length} candidats écrits dans ${o.export}\n`);

  console.log('Lecture :');
  console.log('  Ce classement ne prouve rien. Il fabrique des candidats à regarder.');
  console.log();
  console.log('  La colonne « bande » dit d’où vient le candidat dans la distribution.');
  console.log('  Le sommet d’un marché, ce sont surtout ses annonces macro — d’où');
  console.log('  l’échantillonnage sur toute la hauteur, et la colonne « macro » qui');
  console.log('  marque 8h30, 10h00 et 14h00 heure de New York. C’est une heuristique');
  console.log('  d’horaire, pas un calendrier : elle dit qu’une publication avait lieu');
  console.log('  d’être, pas qu’il y en a eu une.');
  console.log('  Pour voir l’un d’eux, prends sa date et trace le graphique :');
  console.log(`    node scripts/tracer.mjs --csv ${o.csv} --symbole ${o.symbole} --ut 1h --a <date>\n`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
