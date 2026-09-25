// Un gros volume qui RÉAGIT se comporte-t-il autrement qu'un gros volume qui
// EST le mouvement ?
//
//   node scripts/reaction.mjs --csv GC_2023_2024.csv --symbole GC
//
// Née de l'œil, pas d'un calcul. Sur les huit plus gros volumes de deux ans
// d'or, deux formes reviennent :
//
//   RÉACTION   une bougie démesurée vient de passer, la bougie à gros volume
//              part en sens INVERSE. Trois cas sur trois : le prix revient.
//
//   IMPULSION  rien de violent juste avant, la bougie à gros volume EST le
//              mouvement. Trois cas sur quatre : le prix continue.
//
// Si ça tient sur les milliers d'évènements du fichier, ça explique les 50 %
// de `comportement.mjs` : le détecteur ne se trompait pas, il MÉLANGEAIT deux
// choses opposées, et leur moyenne est une pièce de monnaie.
//
// LE CRITÈRE NE REGARDE QUE CE QUI PRÉCÈDE. Aucune information postérieure à
// la bougie n'entre dans le classement — sans quoi on rangerait les cas par
// leur résultat et on s'étonnerait de le retrouver.
//
// PLUSIEURS SEUILS SONT ESSAYÉS, ET TOUS SONT AFFICHÉS. Un seul seuil choisi
// après coup serait le seuil qui plaît. Une séparation qui n'existe qu'à un
// réglage précis n'est pas une séparation.

import { readFile } from 'node:fs/promises';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { atteintAvantDePerdre } from '../src/lib/marche/apres.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '15m', utCsv: '1m', fenetre: 60, horizonHeures: 24 };
const SEUILS_CORPS = [1.5, 2, 3];
const SEUILS_VOLUME = [1.5, 2, 3];

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];
  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;
  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue`);
    else o[cle] = args[cle];
  }
  for (const [option, cle, min] of [['--fenetre', 'fenetre', 20], ['--horizon-heures', 'horizonHeures', 1]]) {
    if (args[cle] === undefined) continue;
    const n = Number(args[cle]);
    if (!Number.isFinite(n) || n < min) erreurs.push(`${option} attend un nombre ≥ ${min}`);
    else o[cle] = n;
  }
  o.avecMacro = Boolean(args.avecMacro);
  return erreurs.length ? { erreurs } : o;
}

const signe = (b) => Math.sign(b.cloture - b.ouverture);

/**
 * La bougie précédente est-elle une réaction inverse démesurée ?
 *
 * Trois conditions, toutes antérieures à la bougie jugée :
 *   — sa direction est opposée
 *   — son corps dépasse `seuilCorps` fois l'amplitude médiane locale
 *   — son volume dépasse `seuilVolume` fois le volume médian local
 *
 * `precedente` porte les mesures calculées pour la bougie d'avant par
 * `scorerSegment`, donc rapportées à SA propre fenêtre de référence — celle
 * qui s'arrêtait avant elle.
 */
export function estReaction(bougie, avant, mesuresAvant, { seuilCorps, seuilVolume }) {
  if (!avant || !mesuresAvant) return false;
  if (signe(avant) === 0 || signe(bougie) === 0) return false;
  if (signe(avant) === signe(bougie)) return false;
  // corps / amplitude médiane locale, obtenu sans division reconstituée :
  // partDuCorps vaut corps/amplitude, ratioAmplitude vaut amplitude/médiane.
  const corpsRelatif = (mesuresAvant.partDuCorps ?? 0) * (mesuresAvant.ratioAmplitude ?? 0);
  return corpsRelatif >= seuilCorps && (mesuresAvant.ratioVolume ?? 0) >= seuilVolume;
}

/** Le prix finit-il dans le sens de la bougie, ou contre elle ? */
export function continueOuRevient(serie, index, horizon) {
  const b = serie[index];
  const fin = serie[index + horizon];
  if (!fin) return null;
  const net = (fin.cloture - b.cloture) * signe(b);
  return { continue: net > 0, net };
}

export function resumer(cas) {
  if (!cas.length) return null;
  const avecSens = cas.filter((c) => c.suite);
  const continuent = avecSens.filter((c) => c.suite.continue).length;
  const verdicts = cas.map((c) => c.ordre).filter((v) => v === 'atteint' || v === 'perdu');
  return {
    n: cas.length,
    partContinue: avecSens.length ? (continuent / avecSens.length) * 100 : null,
    part3R: verdicts.length ? (verdicts.filter((v) => v === 'atteint').length / verdicts.length) * 100 : null,
    n3R: verdicts.length,
  };
}

async function principal() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/reaction.mjs --csv GC_2023_2024.csv --symbole GC\n');
    process.exit(1);
  }

  process.stdout.write(`\nlecture de ${o.csv}… `);
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(o.csv, 'utf8'), { unite: o.utCsv });
  console.log(`${fines.length} bougies ${o.utCsv}`);
  if (!volumeExploitable) { console.error('\nÉchec : pas de volume réel.\n'); process.exit(2); }

  const horizon = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.ut));
  const { segments } = decouperParContrat(fines);
  const evenements = [];

  for (const segment of segments) {
    const serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? segment.bougies : agregerBougies(segment.bougies, o.ut);
    const scores = scorerSegment(serie, { fenetre: o.fenetre });
    const parIndex = new Map(scores.map((s) => [s.index, s]));

    for (const s of scores) {
      if (!s.scores.picVolume) continue;
      if (!o.avecMacro && s.mesures.macro) continue;
      const suite = continueOuRevient(serie, s.index, horizon);
      if (!suite) continue;
      evenements.push({
        bougie: serie[s.index],
        avant: serie[s.index - 1],
        mesuresAvant: parIndex.get(s.index - 1)?.mesures ?? null,
        suite,
        ordre: atteintAvantDePerdre(serie, s.index, horizon, 3),
      });
    }
  }

  console.log(`${segments.length} contrat(s) · ${evenements.length} évènements · horizon ${horizon} bougies\n`);

  console.log('='.repeat(76));
  console.log('  LE PRIX CONTINUE-T-IL DANS LE SENS DE LA BOUGIE À GROS VOLUME ?');
  console.log('='.repeat(76));
  const tous = resumer(evenements);
  if (!tous) { console.log('\n  Aucun évènement mesurable.\n'); process.exit(3); }
  // Un taux peut manquer : aucun verdict tranché, ou aucun horizon complet.
  // Écrire « — » plutôt que de planter sur un null.
  const pc = (x) => (x === null ? '—' : x.toFixed(1) + ' %');
  console.log(`\n  TOUS       ${String(tous.n).padStart(5)} cas   continue ${pc(tous.partContinue)}   3R avant 1R ${pc(tous.part3R)}`);

  console.log('\n  Découpage selon ce qui précède, à plusieurs seuils :\n');
  console.log('   corps  volume │        RÉACTION         │       IMPULSION        │  écart');
  console.log('   ────────────── ┼────────────────────────┼────────────────────────┼────────');

  for (const seuilCorps of SEUILS_CORPS) {
    for (const seuilVolume of SEUILS_VOLUME) {
      const reaction = [];
      const impulsion = [];
      for (const e of evenements) {
        (estReaction(e.bougie, e.avant, e.mesuresAvant, { seuilCorps, seuilVolume }) ? reaction : impulsion).push(e);
      }
      const r = resumer(reaction);
      const i = resumer(impulsion);
      if (!r || !i || r.partContinue === null || i.partContinue === null) {
        console.log(
          `   ${String(seuilCorps).padStart(4)}× ${String(seuilVolume).padStart(5)}× │ `
          + `${String(reaction.length).padStart(5)} cas  ${'—'.padStart(18)} │ `
          + `${String(impulsion.length).padStart(5)} cas  ${'—'.padStart(18)} │   —`,
        );
        continue;
      }
      // L'écart est le seul chiffre qui porte l'hypothèse : la réaction doit
      // continuer MOINS souvent que l'impulsion.
      const ecart = i.partContinue - r.partContinue;
      const se = Math.sqrt(2500 / (r.n || 1) + 2500 / (i.n || 1));
      const etoile = Math.abs(ecart) / se >= 2 ? ' *' : '';
      console.log(
        `   ${String(seuilCorps).padStart(4)}× ${String(seuilVolume).padStart(5)}× │ `
        + `${String(r.n).padStart(5)} cas  continue ${r.partContinue.toFixed(1).padStart(5)} % │ `
        + `${String(i.n).padStart(5)} cas  continue ${i.partContinue.toFixed(1).padStart(5)} % │ `
        + `${(ecart >= 0 ? '+' : '') + ecart.toFixed(1)}${etoile}`,
      );
    }
  }

  console.log('\n  Lecture :');
  console.log('    L\'hypothèse prédit un écart POSITIF — l\'impulsion continue plus');
  console.log('    souvent que la réaction. « * » marque deux erreurs types.');
  console.log();
  console.log('    Tous les seuils sont affichés, et c\'est délibéré. Une séparation');
  console.log('    qui n\'apparaît qu\'à un réglage précis n\'est pas une séparation :');
  console.log('    c\'est le réglage qui a été choisi pour elle.');
  console.log();
  console.log('    RIEN ICI N\'EST PRÉ-ENREGISTRÉ. Ces données ont déjà été regardées,');
  console.log('    et l\'hypothèse vient de huit d\'entre elles. Ce qui sort d\'ici se');
  console.log('    gèle et s\'éprouve sur 2025, ou ne vaut rien.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
