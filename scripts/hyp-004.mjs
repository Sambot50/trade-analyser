// HYP-004 — Les cinq étoiles d'un order block. Gelée le 2026-10-07.
//
//   npm run hyp:004
//   node scripts/hyp-004.mjs --csv donnees/metaux-2020/GC_2020_2022.csv
//
// Pré-enregistrée dans docs/DECISIONS.md AVANT toute exécution. Tout ce qui
// décide est figé dans `GEL` ci-dessous ; aucune option ne le change. Le script
// refuse un autre fichier que celui qui est gelé, et refuse de tourner une
// seconde fois : il écrit son résultat dans `donnees/hyp-004.json` et s'arrête
// si ce fichier existe déjà. Relancer pour obtenir un autre p, c'est
// exactement ce que le pré-enregistrement interdit (DEC-018, garde-fou 7).

import { readFile, writeFile, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { PARAMETRES_ETOILES } from '../src/lib/marche/etoiles.js';
import { parseArgs, validerOptions, chaine, agreger } from './backtest.mjs';

export const GEL = Object.freeze({
  hypothese: 'HYP-004',
  geleLe: '2026-10-07',
  fichier: 'GC_2020_2022.csv',
  // Chaîne identique à DEC-041 : OB en 15 min, plan à 2 R, entrée à la mèche,
  // ambigus exclus, frais 4 ticks (0,40), sans filtre de tendance — la
  // tendance est l'étoile 2.
  spread: 0.4,
  objectif: '2r',
  tirages: 200,
  graine: 20261007,
  minimumCinqEtoiles: 30,
  seuilP: 0.05,
  parametresEtoiles: PARAMETRES_ETOILES,
});

const groupe = (resultats, garder) => resultats.filter((r) => r.etoiles && garder(r.etoiles.nombre));
export const CINQ = (n) => n === 5;
export const BASSES = (n) => n <= 2;

/**
 * La règle de décision, écrite avant les données. Les étoiles sont CONFIRMÉES
 * si et seulement si les trois conditions tiennent ; sinon RÉFUTÉES pour l'or
 * en 15 min. Moins de 30 trades à cinq étoiles : NON CONCLUANT, et on le dit.
 */
export function verdict({ cinq, basses, p }) {
  if (cinq.tranchees < GEL.minimumCinqEtoiles) {
    return { code: 'non_concluant', texte: `Non concluant : ${cinq.tranchees} trades à 5 étoiles, il en faut au moins ${GEL.minimumCinqEtoiles}.` };
  }
  const meilleur = cinq.esperance !== null && basses.esperance !== null && cinq.esperance > basses.esperance;
  const batLeHasard = p !== null && p < GEL.seuilP;
  if (meilleur && batLeHasard) return { code: 'confirmee', texte: 'CONFIRMÉE : les OB à 5 étoiles font mieux que les OB à 0-2 étoiles et battent le hasard.' };
  const raisons = [];
  if (!meilleur) raisons.push('pas mieux que les OB à 0-2 étoiles');
  if (!batLeHasard) raisons.push(`ne bat pas le hasard (p = ${p === null ? '—' : p.toFixed(3)})`);
  return { code: 'refutee', texte: `RÉFUTÉE pour l'or en 15 min : ${raisons.join(', ')}.` };
}

const resume = (a) => ({
  orderBlocks: a.total, tranchees: a.tranchees, gagnants: a.gagnants,
  taux: a.intervalle?.proportion ?? null, bas: a.intervalle?.bas ?? null, haut: a.intervalle?.haut ?? null,
  esperance: a.esperance,
});

async function existe(chemin) {
  try { await access(chemin); return true; } catch { return false; }
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);
const r3 = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)} R`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inconnues = Object.keys(args).filter((k) => k !== 'csv');
  if (inconnues.length) {
    console.error(`\n${inconnues.map((k) => `--${k}`).join(', ')} : aucune option. ${GEL.hypothese} est gelée.\n`);
    process.exit(1);
  }
  if (typeof args.csv !== 'string' || basename(args.csv) !== GEL.fichier) {
    console.error(`\n${GEL.hypothese} se lance sur ${GEL.fichier} et sur lui seul.\n  npm run hyp:004\n`);
    process.exit(1);
  }

  const sortie = join(dirname(args.csv).replace(/[\\/]metaux-2020$/, ''), 'hyp-004.json');
  if (await existe(sortie)) {
    console.error(`\n${GEL.hypothese} a déjà été lancée : ${sortie} existe. Elle ne se relance pas.\n`);
    process.exit(1);
  }

  const contenu = await readFile(args.csv, 'utf8');
  const sha256 = createHash('sha256').update(contenu).digest('hex');
  const o = validerOptions({ csv: args.csv, spread: String(GEL.spread), objectif: GEL.objectif, sansFiltreBiais: true });
  if (o.erreurs) { console.error(o.erreurs.join('\n')); process.exit(1); }
  o.uniteFine = '1m';

  console.log(`\n${GEL.hypothese} — gelée le ${GEL.geleLe} — ${GEL.fichier} · ${sha256.slice(0, 12)}…`);
  const lecture = analyserCsv(contenu, { unite: '1m', exclureDerniere: 'auto' });
  console.log(`  ${lecture.bougies.length} bougies 1 min`);
  for (const l of avertissementsLecture(lecture)) console.log(`  ⚠  ${l}`);

  const reel = chaine(lecture.bougies, o);
  const repartition = {};
  for (const r of reel.resultats) repartition[r.etoiles.nombre] = (repartition[r.etoiles.nombre] || 0) + 1;
  const cinq = resume(agreger(groupe(reel.resultats, CINQ), o.coutEnR, o.objectif, o.ambigu));
  const basses = resume(agreger(groupe(reel.resultats, BASSES), o.coutEnR, o.objectif, o.ambigu));

  process.stdout.write(`  témoin : ${GEL.tirages} mélanges `);
  const alea = generateurAleatoire(GEL.graine);
  const temoin = [];
  for (let i = 0; i < GEL.tirages; i++) {
    const melangee = melangerBougies(lecture.bougies, alea, o.controlePaquet);
    temoin.push(agreger(groupe(chaine(melangee, o).resultats, CINQ), o.coutEnR, o.objectif, o.ambigu).esperance);
    if ((i + 1) % 10 === 0) process.stdout.write('.');
  }
  console.log(' terminé');

  const p = valeurP(cinq.esperance, temoin)?.p ?? null;
  const d = resumeDistribution(temoin);
  const v = verdict({ cinq, basses, p });

  console.log(`\n  Répartition des OB par étoiles : ${[0, 1, 2, 3, 4, 5].map((n) => `${n}★ ${repartition[n] ?? 0}`).join(' · ')}`);
  console.log(`\n  ${'Groupe'.padEnd(14)}${'OB'.padStart(7)}${'Tranchés'.padStart(10)}${'Réussite'.padStart(11)}${'IC 95 %'.padStart(19)}${'Espérance'.padStart(12)}`);
  for (const [nom, g] of [['5 étoiles', cinq], ['0-2 étoiles', basses]]) {
    const ic = g.bas === null ? '—' : `${pct(g.bas)} – ${pct(g.haut)}`;
    console.log(`  ${nom.padEnd(14)}${String(g.orderBlocks).padStart(7)}${String(g.tranchees).padStart(10)}${pct(g.taux).padStart(11)}${ic.padStart(19)}${r3(g.esperance).padStart(12)}`);
  }
  console.log(`\n  Témoin (5 étoiles sur bougies mélangées) : médiane ${r3(d?.mediane)} · p = ${p === null ? '—' : p.toFixed(3)}`);
  console.log(`\n  ${v.texte}\n`);

  await writeFile(sortie, JSON.stringify({
    ...GEL, sha256, lanceLe: new Date().toISOString(), repartition, cinq, basses,
    temoin: { mediane: d?.mediane ?? null, p }, verdict: v,
  }, null, 2) + '\n');
  console.log(`  Résultat écrit dans ${sortie}. ${GEL.hypothese} ne se relancera pas.\n`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
