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
import { scorerSegment, meilleurs, echantillonStratifie, mediane, quantile, DETECTEURS, FAMILLES } from '../src/lib/marche/anomalies.js';
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
  // Multiplicateur du contrat, pour convertir un volume en notionnel : 100
  // onces pour le GC, 1 pour une action ou une paire de devises. Sert à
  // l'affichage seul — aucun détecteur ne s'en sert.
  o.tailleContrat = 1;
  if (args.tailleContrat !== undefined) {
    const n = Number(args.tailleContrat);
    if (!Number.isFinite(n) || n <= 0) erreurs.push('--taille-contrat attend un nombre positif');
    else o.tailleContrat = n;
  }

  if (dureeUnite(o.ut) < dureeUnite(o.utCsv)) {
    erreurs.push(`--ut (${o.ut}) est plus fine que --ut-csv (${o.utCsv}) : il faudrait inventer des bougies.`);
  }

  return erreurs.length ? { erreurs } : o;
}

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

const milliers = (n) => Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');

/**
 * L'échelle absolue du marché scanné.
 *
 * « Quatre fois la médiane » ne veut rien dire tant qu'on ignore si la médiane
 * vaut dix contrats ou dix mille. Et le notionnel varie d'un facteur mille
 * d'un instrument à l'autre : sur le GC, la bougie de quinze minutes la plus
 * calme brasse déjà un demi-milliard de dollars.
 */
function afficherEchelle(scores, o) {
  const volumes = scores.map((s) => s.mesures.volume).filter((v) => v > 0);
  if (volumes.length < 20) return;

  const prix = mediane(scores.map((s) => s.mesures.cloture).filter(Number.isFinite));
  const med = mediane(volumes);
  const notionnel = (v) => (prix ? `  ≈ ${milliers((v * prix * o.tailleContrat) / 1e6)} M USD` : '');

  console.log(`\n  ÉCHELLE — volume par bougie ${o.ut}`);
  console.log(`    médiane        ${milliers(med).padStart(9)}${notionnel(med)}`);
  console.log(`    q90            ${milliers(quantile(volumes, 0.9)).padStart(9)}${notionnel(quantile(volumes, 0.9))}`);
  console.log(`    q99            ${milliers(quantile(volumes, 0.99)).padStart(9)}${notionnel(quantile(volumes, 0.99))}`);
  console.log(`    maximum        ${milliers(Math.max(...volumes)).padStart(9)}${notionnel(Math.max(...volumes))}`
    + `   soit ${(Math.max(...volumes) / med).toFixed(1)}× la médiane`);
  if (o.tailleContrat !== 1) {
    console.log(`    1 contrat = ${o.tailleContrat} unités  ·  ≈ ${milliers(prix * o.tailleContrat)} USD de notionnel`);
  }
}

const ABREGE = { haussiere: 'haus', baissiere: 'bais', plate: 'plat', indetermine: '—' };
const abrege = (t) => ABREGE[t] ?? '—';

/**
 * Le volume va-t-il CONTRE la tendance de la semaine ?
 *
 * C'est la case qui intéresse : acheter dans une baisse ou vendre dans une
 * hausse demande une raison et des moyens. Suivre le flot n'en demande
 * aucun.
 */
/**
 * Le tableau des quatre familles, pour un horizon donné.
 *
 * C'est ce qu'on regarde avant les planches : une famille à trois cas ne
 * permettra de reconnaître aucune structure commune, et il vaut mieux le
 * savoir avant d'ouvrir trente images.
 */
function afficherFamilles(actifs, champ, titre) {
  const compte = (f) => actifs.filter((s) => s.mesures[champ] === f).length;
  const sans = actifs.filter((s) => !s.mesures[champ]).length;
  const largeur = 8;

  console.log(`\n  LES QUATRE FAMILLES — ${titre}`);
  console.log(`  ${''.padEnd(22)}${'achat'.padStart(largeur)}${'vente'.padStart(largeur)}`);
  for (const [nom, etiquette] of [['hausse', 'mouvement haussier'], ['baisse', 'mouvement baissier']]) {
    console.log(
      `  ${etiquette.padEnd(22)}`
      + `${String(compte(`${nom}-achat`)).padStart(largeur)}${String(compte(`${nom}-vente`)).padStart(largeur)}`,
    );
  }
  if (sans) console.log(`  ${'plat ou inconnu'.padEnd(22)}${String(sans).padStart(largeur * 2)}`);
}

export const contreCourant = (m) =>
  (m.sensApparent === 'achat' && m.tendanceSemaine === 'baissiere')
  || (m.sensApparent === 'vente' && m.tendanceSemaine === 'haussiere');

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

  // L'échelle absolue, avant tout classement. Sans elle, « 4× la médiane » ne
  // dit pas si on parle de dix contrats ou de dix mille — et l'intuition d'un
  // marché se trompe d'un facteur mille d'un instrument à l'autre.
  afficherEchelle(scores, o);

  const sansSemaine = scores.filter((s) => s.mesures.tendanceSemaine === 'indetermine').length;
  if (sansSemaine) {
    console.log(`${sansSemaine} bougies sans tendance hebdomadaire : moins d'une semaine d'historique dans leur contrat`);
  }

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

    const actifsDuDetecteur = retenusPourScan.filter((s) => s.scores[detecteur] > 0);
    afficherFamilles(actifsDuDetecteur, 'familleJour', 'sur la journée');
    afficherFamilles(actifsDuDetecteur, 'familleSemaine', 'sur la semaine');

    // Achat et vente séparés, et échantillonnés séparément : sans ça, un
    // marché qui monte remplirait les deux tableaux du même côté.
    // DEC-030 : ce découpage repose sur un indice réfuté. Le dire ICI, à
    // l'endroit exact où quelqu'un va lire « ACHAT » et y croire — un
    // avertissement en tête de sortie se perd dans le défilement.
    console.log('\n  ⚠  ACHAT / VENTE ci-dessous : PRÉSUMÉS d’après la clôture face à');
    console.log('     l’ouverture. Mesuré faux une fois sur trois contre le vrai côté');
    console.log('     de l’agresseur (DEC-030) : 62,6 % d’accord en 15 min, 47,8 % en');
    console.log('     1 h. Un seuil de volume n’y change rien. À ne pas lire comme un fait.');

    for (const sens of ['achat', 'vente']) {
      const duSens = retenusPourScan.filter((s) => s.mesures.sensApparent === sens);
      const options = { nombre: o.nombre, ecartMinimalMs: o.ecartMinutes * 60_000 };
      const retenus = o.sommet
        ? meilleurs(duSens, detecteur, options).map((r) => ({ ...r, bande: 'sommet' }))
        : echantillonStratifie(duSens, detecteur, options);

      console.log(`\n  ── ${sens.toUpperCase()} ── ${duSens.filter((s) => s.scores[detecteur] > 0).length} bougies`);

      if (!retenus.length) {
        console.log('     aucun candidat');
        continue;
      }

      console.log('     bande    score  date (UTC)          volume  vol×méd   jour   semaine   contre');
      for (const r of retenus) {
        const m = r.mesures;
        console.log(
          `     ${r.bande.padEnd(7)} ${String(r.scores[detecteur]).padStart(6)}  ${iso(r.ms)}  `
          + `${milliers(m.volume).padStart(7)}  ${String(m.ratioVolume).padStart(7)}  `
          + `${abrege(m.tendanceJour).padStart(5)}  ${abrege(m.tendanceSemaine).padStart(8)}   `
          + `${contreCourant(m) ? '  ◀' : ''}${m.macro ? ' ⚠' : ''}`,
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
  // Ne le dire que si le marqueur n'a JAMAIS reconnu de fenêtre, pas quand
  // --avec-macro est absent : dans ce cas les bougies macro ont été écartées
  // en amont, et zéro candidat marqué est le comportement attendu.
  if (!totalMarques && !macro && lignes.length >= 10) {
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
  console.log('  ◀ marque un volume à CONTRE-COURANT de la semaine : acheter dans une');
  console.log('  baisse, ou vendre dans une hausse. C’est la case où quelqu’un paie pour');
  console.log('  aller contre le marché — et celle que le filtre de biais jetait sans le');
  console.log('  savoir, lui qui ne gagnait rien (ETAT.md : 50,0 % contre 46,6 %).');
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
