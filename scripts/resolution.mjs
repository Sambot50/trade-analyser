// Combien de positions atteignent RÉELLEMENT une barrière — et que valent les
// autres ?
//
//   node scripts/resolution.mjs --dossier marches
//   node scripts/resolution.mjs --csv GC_2023_2024.csv
//
// ERRATUM-001 a établi que la mesure de HYP-001 et HYP-002 est symétrique :
// +3R contre −3R. Elle rend `ni_lun_ni_lautre` quand ni l'une ni l'autre n'est
// touchée dans l'horizon, et ces cas sont SORTIS DU DÉNOMINATEUR.
//
// Avec des barrières à trois fois la hauteur d'une bougie déjà grosse, il se
// peut que la majorité des positions n'atteigne rien. Alors l'avantage de
// +3 points ne porterait que sur une fraction des signaux, et le reste
// sortirait au marché à un prix que personne n'a mesuré.
//
// Ce script comble ce trou. Il calcule l'espérance de DEUX façons :
//   — en écartant les non-résolues, comme le faisait la mesure gelée
//   — en les fermant au marché, ce qu'un compte réel subirait
//
// CE N'EST PAS UN TEST. Les données ont déjà été regardées, rien n'est
// pré-enregistré, et aucun verdict n'en sort. C'est un diagnostic : il dit si
// une hypothèse mérite d'être gelée, pas si elle est vraie.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { GEL } from './eprouver-hyp001.mjs';
import { pasDeCotation } from './eprouver-hyp003.mjs';
import { parseArgs } from './backtest.mjs';

const TICKS = 4;

/**
 * Le sort d'une position sous barrières SYMÉTRIQUES, sans rien écarter.
 *
 * Rend le gain en R dans tous les cas : à la barrière si elle est touchée, au
 * marché sinon. `ambigu` reste le seul cas sans réponse — une bougie qui
 * touche les deux ne dit pas dans quel ordre, et supposer fabriquerait du
 * rendement.
 */
export function sortDeLaPosition(serie, index, horizon, multiple) {
  const ancre = serie[index];
  const sens = Math.sign(ancre.cloture - ancre.ouverture);
  if (sens === 0) return null;
  const hauteur = ancre.plusHaut - ancre.plusBas;
  if (!(hauteur > 0)) return null;

  const depart = ancre.cloture;
  const cible = multiple * hauteur;
  const suite = serie.slice(index + 1, index + 1 + horizon);
  if (suite.length < horizon) return null;

  for (const b of suite) {
    const enFaveur = sens > 0 ? b.plusHaut - depart : depart - b.plusBas;
    const aLEncontre = sens > 0 ? depart - b.plusBas : b.plusHaut - depart;
    if (enFaveur >= cible && aLEncontre >= cible) return { issue: 'ambigu', R: null };
    if (enFaveur >= cible) return { issue: 'atteint', R: multiple };
    if (aLEncontre >= cible) return { issue: 'perdu', R: -multiple };
  }
  const fin = suite.at(-1);
  return { issue: 'horizon', R: ((fin.cloture - depart) * sens) / hauteur };
}

const moyenne = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1).padStart(5) + ' %' : '    — ');

export function resumer(sorts, coutMoyenEnR) {
  const n = sorts.length;
  if (!n) return null;
  const par = (issue) => sorts.filter((s) => s.issue === issue);
  const barrieres = [...par('atteint'), ...par('perdu')];
  const horizon = par('horizon');
  const tous = [...barrieres, ...horizon].map((s) => s.R);

  return {
    n,
    atteint: par('atteint').length,
    perdu: par('perdu').length,
    ambigu: par('ambigu').length,
    horizon: horizon.length,
    // Comme la mesure gelée : seules les barrières comptent.
    tauxBarriere: barrieres.length ? (par('atteint').length / barrieres.length) * 100 : null,
    evBarrieresSeules: moyenne(barrieres.map((s) => s.R)),
    // Ce qu'un compte subirait : les sorties au marché comprises.
    evComplete: moyenne(tous),
    evNette: tous.length ? moyenne(tous) - coutMoyenEnR : null,
    evHorizon: moyenne(horizon.map((s) => s.R)),
  };
}

function afficher(nom, r) {
  if (!r) { console.log(`\n  ${nom} — aucun cas`); return; }
  console.log(`\n  ${nom}  ·  ${r.n} positions`);
  console.log(`    atteint ${pct(r.atteint, r.n)}   perdu ${pct(r.perdu, r.n)}   `
    + `SANS RÉSOLUTION ${pct(r.horizon, r.n)}   ambigu ${pct(r.ambigu, r.n)}`);
  console.log(`    taux sur barrières seules   ${r.tauxBarriere === null ? '—' : r.tauxBarriere.toFixed(1) + ' %'}`
    + `   (ce que mesurait la règle gelée)`);
  console.log(`    espérance, barrières seules ${r.evBarrieresSeules === null ? '—' : (r.evBarrieresSeules >= 0 ? '+' : '') + r.evBarrieresSeules.toFixed(3)} R`);
  console.log(`    espérance des sorties au marché ${r.evHorizon === null ? '—' : (r.evHorizon >= 0 ? '+' : '') + r.evHorizon.toFixed(3)} R`);
  console.log(`    ESPÉRANCE COMPLÈTE          ${r.evComplete === null ? '—' : (r.evComplete >= 0 ? '+' : '') + r.evComplete.toFixed(3)} R`);
  console.log(`    ESPÉRANCE NETTE (frais)     ${r.evNette === null ? '—' : (r.evNette >= 0 ? '+' : '') + r.evNette.toFixed(3)} R`);
}

async function mesurer(chemin) {
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(chemin, 'utf8'), { unite: GEL.utCsv });
  if (!volumeExploitable) return null;
  const pas = pasDeCotation(fines.slice(0, 200000).map((b) => b.cloture));
  const horizon = Math.round((GEL.horizonHeures * 3_600_000) / dureeUnite(GEL.ut));
  const { segments } = decouperParContrat(fines);

  const detectees = []; const temoin = []; const couts = [];
  for (const segment of segments) {
    const serie = agregerBougies(segment.bougies, GEL.ut);
    for (const s of scorerSegment(serie, { fenetre: GEL.fenetre })) {
      if (s.mesures.macro) continue;
      if (s.mesures.familleSemaine !== GEL.famille) continue;
      const sort = sortDeLaPosition(serie, s.index, horizon, GEL.multiple);
      if (!sort) continue;
      const b = serie[s.index];
      if (s.scores[GEL.detecteur]) {
        detectees.push(sort);
        if (pas) couts.push((TICKS * pas) / (b.plusHaut - b.plusBas));
      } else temoin.push(sort);
    }
  }
  return { detectees, temoin, coutMoyen: moyenne(couts) ?? 0, pas };
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  let fichiers = [];
  if (typeof args.csv === 'string') fichiers = [args.csv];
  else if (typeof args.dossier === 'string') {
    fichiers = (await readdir(args.dossier)).filter((f) => f.toLowerCase().endsWith('.csv')).sort()
      .map((f) => join(args.dossier, f));
  } else {
    console.error('\nUsage : --csv <fichier>  ou  --dossier <dossier>\n');
    process.exit(1);
  }

  console.log(`\nrègle de HYP-001 : ${GEL.ut} · ±${GEL.multiple}R · ${GEL.famille} · horizon ${GEL.horizonHeures} h`);
  console.log(`frais : ${TICKS} ticks aller-retour, pas lu dans les données\n`);

  const toutesDetectees = []; const toutTemoin = []; let coutTotal = 0; let nFichiers = 0;

  for (const f of fichiers) {
    process.stdout.write(`  ${f} … `);
    const m = await mesurer(f);
    if (!m) { console.log('pas de volume réel'); continue; }
    console.log(`${m.detectees.length} détectées · ${m.temoin.length} témoin · pas ${m.pas} · frais moyens ${(m.coutMoyen * 100).toFixed(2)} % de R`);
    toutesDetectees.push(...m.detectees); toutTemoin.push(...m.temoin);
    coutTotal += m.coutMoyen; nFichiers++;
  }

  const coutMoyen = nFichiers ? coutTotal / nFichiers : 0;
  console.log('\n' + '='.repeat(76));
  console.log('  CE QUE LA RÈGLE GELÉE ÉCARTAIT');
  console.log('='.repeat(76));
  afficher('DÉTECTÉES', resumer(toutesDetectees, coutMoyen));
  afficher('TÉMOIN   ', resumer(toutTemoin, coutMoyen));

  const d = resumer(toutesDetectees, coutMoyen);
  const t = resumer(toutTemoin, coutMoyen);
  if (d && t && d.evComplete !== null && t.evComplete !== null) {
    console.log(`\n  APPORT DU DÉTECTEUR, espérance complète : ${(d.evComplete - t.evComplete >= 0 ? '+' : '')}${(d.evComplete - t.evComplete).toFixed(3)} R`);
  }

  console.log('\n  Lecture :');
  console.log('    « SANS RÉSOLUTION » est la part que la règle gelée sortait du');
  console.log('    dénominateur. Plus elle est grande, moins le taux de réussite');
  console.log('    mesuré décrit ce qu\'un compte aurait vécu.');
  console.log();
  console.log('    RIEN ICI N\'EST PRÉ-ENREGISTRÉ. Ces données ont déjà été regardées.');
  console.log('    Ce diagnostic dit si une hypothèse mérite d\'être gelée — jamais');
  console.log('    si elle est vraie.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
