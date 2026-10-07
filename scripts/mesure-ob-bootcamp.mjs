// Mesure de l'OB « bootcamp » : quel seuil de « fort mouvement » ?
//
//   npm run mesure:ob-bootcamp
//   node scripts/mesure-ob-bootcamp.mjs --csv donnees/GC_2023_2024.csv --spread 0.4
//
// L'OB du bootcamp (`ob-bootcamp.js`) est la dernière bougie inverse — avec
// l'accumulation qui la précède — d'un mouvement fort et IMMÉDIAT. Le seuil
// qui rend le mouvement « fort » change les OB eux-mêmes, pas un filtre posé
// après : chaque seuil est donc une détection complète, avec son propre témoin.
//
// EXPLORATION, sur GC 2023-2024 (déjà exploré) : quatre seuils figés, comptés
// d'avance, aucune option pour en ajouter. Le seuil retenu se FIGE, puis la
// méthode entière (OB bootcamp + cinq étoiles) se teste une seule fois sur
// des données jamais utilisées pour les OB (HYP-005).
//
// Chaîne : celle du backtest (15 min, plan à 2 R, entrée à la mèche, ambigus
// exclus), sans filtre de tendance, frais depuis `--spread`.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { parseArgs, validerOptions, chaine, agreger } from './backtest.mjs';

export const SEUILS_ATR = Object.freeze([1, 1.5, 2, 3]);
export const TEMOIN = Object.freeze({ tirages: 20, graine: 20261007 });

/** Une ligne de tableau pour un seuil : le réel, et l'espérance de chaque mélange. */
export function mesurerSeuil(fines, base, seuilAtr, { tirages = TEMOIN.tirages, graine = TEMOIN.graine, surTirage = () => {} } = {}) {
  const o = { ...base, detecteur: 'bootcamp', seuilAtr };
  const a = agreger(chaine(fines, o).resultats, o.coutEnR, o.objectif, o.ambigu);
  const alea = generateurAleatoire(graine);
  const temoin = [];
  for (let i = 0; i < tirages; i++) {
    const melangee = melangerBougies(fines, alea, o.controlePaquet);
    temoin.push(agreger(chaine(melangee, o).resultats, o.coutEnR, o.objectif, o.ambigu).esperance);
    surTirage(i + 1);
  }
  return {
    seuilAtr,
    orderBlocks: a.total,
    tranchees: a.tranchees,
    taux: a.intervalle?.proportion ?? null,
    bas: a.intervalle?.bas ?? null,
    haut: a.intervalle?.haut ?? null,
    esperance: a.esperance,
    temoinMediane: resumeDistribution(temoin)?.mediane ?? null,
    p: valeurP(a.esperance, temoin)?.p ?? null,
  };
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);
const r3 = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)} R`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const interdit of ['seuils', 'seuilAtr', 'detecteur', 'utDetection', 'objectif', 'remplissage', 'ambigu', 'sansFiltreBiais']) {
    if (args[interdit] !== undefined) {
      console.error(`\n--${interdit} n'existe pas ici : la mesure est figée (quatre seuils comptés d'avance).\n`);
      process.exit(1);
    }
  }
  const o = validerOptions({ ...args, sansFiltreBiais: true });
  if (o.erreurs || typeof args.csv !== 'string') {
    console.error(`\n${[...(o.erreurs ?? []), ...(typeof args.csv === 'string' ? [] : ['--csv manquant'])].join('\n')}\n\nExemple :\n  npm run mesure:ob-bootcamp\n`);
    process.exit(1);
  }
  o.uniteFine = '1m';

  process.stdout.write(`\nLecture de ${basename(o.csv)}… `);
  const lecture = analyserCsv(await readFile(o.csv, 'utf8'), { unite: '1m', exclureDerniere: 'auto' });
  console.log(`${lecture.bougies.length} bougies 1 min`);
  for (const l of avertissementsLecture(lecture)) console.log(`  ⚠  ${l}`);

  const lignes = [];
  for (const s of SEUILS_ATR) {
    process.stdout.write(`  seuil ${s} ATR : détection et ${TEMOIN.tirages} mélanges `);
    lignes.push(mesurerSeuil(lecture.bougies, o, s, { surTirage: () => process.stdout.write('.') }));
    console.log(' terminé');
  }

  console.log(`\nOB « bootcamp » — ${basename(o.csv)}`);
  console.log(`Dernière bougie inverse + accumulation, mouvement immédiat ; OB en ${o.utDetection}, plan à 2 R, entrée à la mèche, frais ${o.spread ? `${o.spread} en prix` : 'non fournis'}.\n`);
  console.log(`  ${'Seuil'.padEnd(12)}${'OB'.padStart(7)}${'Tranchés'.padStart(10)}${'Réussite'.padStart(11)}${'IC 95 %'.padStart(19)}${'Espérance'.padStart(12)}${'Témoin'.padStart(12)}${'p'.padStart(8)}`);
  for (const l of lignes) {
    const ic = l.bas === null ? '—' : `${pct(l.bas)} – ${pct(l.haut)}`;
    console.log(`  ${`≥ ${l.seuilAtr} ATR`.padEnd(12)}${String(l.orderBlocks).padStart(7)}${String(l.tranchees).padStart(10)}${pct(l.taux).padStart(11)}${ic.padStart(19)}${r3(l.esperance).padStart(12)}${r3(l.temoinMediane).padStart(12)}${(l.p === null ? '—' : l.p.toFixed(2)).padStart(8)}`);
  }
  console.log(`\n  Témoin = espérance médiane sur ${TEMOIN.tirages} mélanges des mêmes bougies. p = part des mélanges qui font au moins aussi bien.`);
  console.log('  À 2 R, le seuil de rentabilité est 33,3 % avant frais.');
  console.log('  Exploration : 4 seuils. Le seuil retenu se FIGE, puis la méthode entière se teste une seule fois (HYP-005).\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
