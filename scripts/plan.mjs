// La fiche de dimensionnement, jouée pour de vrai.
//
//   node scripts/plan.mjs --csv GC_2023_2024.csv
//   node scripts/plan.mjs --dossier marches --historique 3000
//
// LA QUESTION. La fiche pose trois distances — stop au q90 de l'excursion
// contraire à 1 h, objectif au q75 de la favorable à 4 h, seuil nul à la
// médiane 1 h. Elles sont mesurées séparément, sur trois distributions.
// Personne n'a jamais mesuré ce qu'elles donnent ENSEMBLE. Le « il te faut
// 41 % de gagnants » est de l'arithmétique sur le rapport gain/risque ; ce
// n'est pas un taux observé.
//
// PAS D'AJUSTEMENT SUR SOI-MÊME. Les quantiles de la fiche ont été calculés
// sur 2023-2024 ; les rejouer sur 2023-2024 rendrait un chiffre flatteur et
// faux. Ici, à chaque bougie, ils sont recalculés sur les seules ancres dont
// l'horizon de 4 heures S'EST DÉJÀ REFERMÉ. Aucune lecture du futur : c'est
// la règle telle qu'un compte pourrait l'appliquer, pas telle qu'on la
// reconstruit après coup.
//
// 1 R VAUT LA DISTANCE DU STOP, la définition d'un opérateur — et non la
// hauteur de la bougie d'ancrage qu'utilisait HYP-001. DEC-033 a montré ce
// qu'une unité changeant à chaque trade fait à un chiffre : les deux ne se
// comparent pas.
//
// CE N'EST PAS UN TEST PRÉ-ENREGISTRÉ. C'est la mesure de ce que la fiche
// aurait rendu. Elle dit ce qu'un plan vaut, jamais s'il vaudra.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseArgs } from './backtest.mjs';
import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { excursions, jouerLePlan, distancesDuPlan, trancheDe, TRANCHES } from '../src/lib/marche/plan.js';
import { pasDeCotation } from './eprouver-hyp003.mjs';

const UNITE = '15m';
const FENETRE = 60;
const TICKS = 4;

/** Volume de la bougie ÷ médiane des `fenetre` précédentes. Rien du futur. */
export function rapportDeVolume(serie, index, fenetre) {
  if (index < fenetre) return null;
  const passes = [];
  for (let i = index - fenetre; i < index; i++) passes.push(serie[i].volume);
  passes.sort((a, b) => a - b);
  const milieu = passes.length >> 1;
  const mediane = passes.length % 2
    ? passes[milieu]
    : (passes[milieu - 1] + passes[milieu]) / 2;
  if (!(mediane > 0)) return null;
  return serie[index].volume / mediane;
}

const nouveauSeau = () => ({
  n: 0, objectif: 0, stop: 0, seuilNul: 0, temps: 0, ambigu: 0,
  R: [], couts: [], stops: [], objectifs: [],
});

/**
 * Parcourt un segment une seule fois.
 *
 * À l'indice `i`, l'ancre `i − h4` vient de voir son horizon se refermer :
 * elle entre alors, et alors seulement, dans l'historique qui servira à fixer
 * les distances. C'est ce décalage qui interdit la lecture du futur.
 */
export function parcourir(serie, seaux, { h1, h4, fenetre, taille, minimum, pas }) {
  const historique = new Map();

  for (let i = 0; i < serie.length; i++) {
    const j = i - h4;
    if (j >= 0) {
      const r = rapportDeVolume(serie, j, fenetre);
      const tranche = r === null ? null : trancheDe(r);
      if (tranche) {
        const e1 = excursions(serie, j, h1);
        const e4 = excursions(serie, j, h4);
        if (e1 && e4) {
          if (!historique.has(tranche)) historique.set(tranche, []);
          const h = historique.get(tranche);
          h.push({ monteeH1: e1.montee, baisseH1: e1.baisse, monteeH4: e4.montee, baisseH4: e4.baisse });
          if (h.length > taille) h.shift();
        }
      }
    }

    const r = rapportDeVolume(serie, i, fenetre);
    const tranche = r === null ? null : trancheDe(r);
    if (!tranche) continue;
    const h = historique.get(tranche);
    if (!h) continue;

    for (const sens of [1, -1]) {
      const d = distancesDuPlan(h, sens, serie[i].cloture, minimum);
      if (!d) continue;
      const sort = jouerLePlan(serie, i, { sens, ...d, horizon: h4 });
      if (!sort || sort.issue === 'ambigu') {
        if (sort) {
          const cle = `${tranche}|${sens}`;
          if (!seaux.has(cle)) seaux.set(cle, nouveauSeau());
          const s = seaux.get(cle); s.n++; s.ambigu++;
        }
        continue;
      }
      const cle = `${tranche}|${sens}`;
      if (!seaux.has(cle)) seaux.set(cle, nouveauSeau());
      const s = seaux.get(cle);
      s.n++; s[sort.issue]++;
      s.R.push(sort.R);
      s.couts.push(pas ? (TICKS * pas) / d.stop : 0);
      s.stops.push((d.stop / serie[i].cloture) * 100);
      s.objectifs.push((d.objectif / serie[i].cloture) * 100);
    }
  }
}

const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function resumerSeau(s) {
  if (!s || !s.R.length) return null;
  const ev = moyenne(s.R);
  const cout = moyenne(s.couts);
  const sd = s.R.length > 1
    ? Math.sqrt(s.R.reduce((a, x) => a + (x - ev) ** 2, 0) / (s.R.length - 1))
    : null;
  return {
    n: s.n,
    resolus: s.R.length,
    partObjectif: (s.objectif / s.n) * 100,
    partStop: (s.stop / s.n) * 100,
    partSeuilNul: (s.seuilNul / s.n) * 100,
    partTemps: (s.temps / s.n) * 100,
    partAmbigu: (s.ambigu / s.n) * 100,
    ev, cout, evNette: ev - cout,
    erreurType: sd === null ? null : sd / Math.sqrt(s.R.length),
    stopPct: moyenne(s.stops),
    objectifPct: moyenne(s.objectifs),
  };
}

const pc = (x) => `${x.toFixed(1).padStart(5)} %`;
const enR = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`;

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

  const taille = Number(args.historique ?? 2000);
  const minimum = Number(args.minimum ?? 150);
  const duree = dureeUnite(UNITE);
  const h1 = Math.round(3_600_000 / duree);
  const h4 = Math.round((4 * 3_600_000) / duree);

  console.log(`\nfiche jouée : ${UNITE} · stop q90 à 1 h · objectif q75 à 4 h · seuil nul médiane 1 h`);
  console.log(`quantiles glissants sur ${taille} ancres résolues, ${minimum} minimum · frais ${TICKS} ticks`);
  console.log(`1 R = la distance du stop\n`);

  const seaux = new Map();
  for (const f of fichiers) {
    process.stdout.write(`  ${f} … `);
    const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(f, 'utf8'), { unite: '1m' });
    if (!volumeExploitable) { console.log('pas de volume réel'); continue; }
    const pas = pasDeCotation(fines.slice(0, 200_000).map((b) => b.cloture));
    const { segments } = decouperParContrat(fines);
    let total = 0;
    for (const segment of segments) {
      const serie = agregerBougies(segment.bougies, UNITE);
      total += serie.length;
      parcourir(serie, seaux, { h1, h4, fenetre: FENETRE, taille, minimum, pas });
    }
    console.log(`${total} bougies ${UNITE} · ${segments.length} contrats · pas ${pas}`);
  }

  for (const sens of [1, -1]) {
    console.log('\n' + '='.repeat(96));
    console.log(`  ${sens > 0 ? 'ACHAT' : 'VENTE'}`);
    console.log('='.repeat(96));
    console.log('  tranche      n   objectif    stop   seuil0    temps    stop%   cible%      brut       net       ±');
    for (let k = 0; k < TRANCHES.length; k++) {
      const tranche = k === TRANCHES.length - 1
        ? `≥ ${TRANCHES[k]}×` : `${TRANCHES[k]}–${TRANCHES[k + 1]}×`;
      const r = resumerSeau(seaux.get(`${tranche}|${sens}`));
      if (!r) { console.log(`  ${tranche.padEnd(9)}    — historique trop court`); continue; }
      console.log(
        `  ${tranche.padEnd(9)}${String(r.n).padStart(6)}  ${pc(r.partObjectif)} ${pc(r.partStop)} `
        + `${pc(r.partSeuilNul)} ${pc(r.partTemps)}  ${r.stopPct.toFixed(2)} % ${r.objectifPct.toFixed(2)} %  `
        + `${enR(r.ev)} R ${enR(r.evNette)} R  ${r.erreurType === null ? '—' : r.erreurType.toFixed(3)}`,
      );
    }
  }

  console.log('\n  Lecture :');
  console.log('    « net » retranche les frais, qui pèsent d’autant plus que le stop');
  console.log('    est serré — c’est ce que DEC-033 a mis au jour.');
  console.log();
  console.log('    Les quantiles sont recalculés à chaque bougie sur les seules ancres');
  console.log('    dont l’horizon s’est refermé : aucune lecture du futur, donc aucun');
  console.log('    ajustement sur les données qu’on mesure.');
  console.log();
  console.log('    L’erreur type vaut pour une DIFFÉRENCE entre deux sens contemporains');
  console.log('    (DEC-032). Pour une case prise seule, la multiplier par ~3,7.');
  console.log();
  console.log('    RIEN ICI N’EST PRÉ-ENREGISTRÉ. Ces données ont déjà été regardées.');
  console.log('    Ceci dit ce que la fiche aurait rendu, jamais ce qu’elle rendra.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
