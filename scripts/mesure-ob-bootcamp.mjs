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
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { parseArgs, validerOptions, chaine, agreger } from './backtest.mjs';

export const SEUILS_ATR = Object.freeze([1, 1.5, 2, 3]);

/**
 * Les unités demandées par l'opérateur : 1 min, 5 min, 15 min, 1 h, 4 h,
 * jour, semaine. Quatre se mesurent ici ; trois ne le peuvent pas, et on dit
 * pourquoi au lieu de rendre un chiffre creux.
 */
export const UNITES_MESUREES = Object.freeze(['5m', '15m', '1h', '4h']);
export const UNITES_NON_MESURABLES = Object.freeze({
  '1m': "le fichier n'a rien de plus fin qu'une minute : impossible de savoir si le stop ou l'objectif a été touché en premier dans la bougie",
  '1d': 'les contrats GC changent tous les deux mois environ : chaque contrat ne porte que quelques dizaines de bougies journalières, trop peu pour une structure, un ATR et un horizon de sortie',
  '1w': 'deux ans font cent semaines, coupées par les changements de contrat : aucune mesure possible',
});

/** Horizon de sortie : 192 bougies de l'unité de détection (48 h en 15 min, comme avant). */
export const HORIZON_EN_BOUGIES = 192;
export const TEMOIN = Object.freeze({ tirages: 20, graine: 20261007 });

/** Une ligne de tableau pour un seuil : le réel, et l'espérance de chaque mélange. */
export function mesurerSeuil(fines, base, seuilAtr, { unite = '15m', tirages = TEMOIN.tirages, graine = TEMOIN.graine, surTirage = () => {} } = {}) {
  const o = {
    ...base, detecteur: 'bootcamp', seuilAtr,
    utDetection: unite, utResolution: '1m',
    horizonHeures: (HORIZON_EN_BOUGIES * dureeUnite(unite)) / 3_600_000,
  };
  const a = agreger(chaine(fines, o).resultats, o.coutEnR, o.objectif, o.ambigu);
  const alea = generateurAleatoire(graine);
  const temoin = [];
  for (let i = 0; i < tirages; i++) {
    const melangee = melangerBougies(fines, alea, o.controlePaquet);
    temoin.push(agreger(chaine(melangee, o).resultats, o.coutEnR, o.objectif, o.ambigu).esperance);
    surTirage(i + 1);
  }
  return {
    unite,
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
  for (const interdit of ['seuils', 'seuilAtr', 'detecteur', 'utDetection', 'utResolution', 'horizonHeures', 'objectif', 'remplissage', 'ambigu', 'sansFiltreBiais']) {
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

  const entete = `  ${'Unité'.padEnd(7)}${'Seuil'.padEnd(12)}${'OB'.padStart(7)}${'Tranchés'.padStart(10)}${'Réussite'.padStart(11)}${'IC 95 %'.padStart(19)}${'Espérance'.padStart(12)}${'Témoin'.padStart(12)}${'p'.padStart(8)}`;
  const ligneTexte = (l) => {
    const ic = l.bas === null ? '—' : `${pct(l.bas)} – ${pct(l.haut)}`;
    return `  ${l.unite.padEnd(7)}${`≥ ${l.seuilAtr} ATR`.padEnd(12)}${String(l.orderBlocks).padStart(7)}${String(l.tranchees).padStart(10)}${pct(l.taux).padStart(11)}${ic.padStart(19)}${r3(l.esperance).padStart(12)}${r3(l.temoinMediane).padStart(12)}${(l.p === null ? '—' : l.p.toFixed(2)).padStart(8)}`;
  };

  const lignes = [];
  for (const unite of UNITES_MESUREES) {
    for (const s of SEUILS_ATR) {
      process.stdout.write(`  ${unite}, seuil ${s} ATR : détection et ${TEMOIN.tirages} mélanges `);
      lignes.push(mesurerSeuil(lecture.bougies, o, s, { unite, surTirage: () => process.stdout.write('.') }));
      console.log(' terminé');
    }
  }

  console.log(`\nOB « bootcamp » — ${basename(o.csv)}`);
  console.log(`Dernière bougie inverse + accumulation, toujours en tendance, mouvement immédiat ; plan à 2 R, entrée à la mèche, issue lue en 1 min, horizon ${HORIZON_EN_BOUGIES} bougies, frais ${o.spread ? `${o.spread} en prix` : 'non fournis'}.\n`);
  console.log(entete);
  let precedente = null;
  for (const l of lignes) {
    if (precedente && precedente !== l.unite) console.log('');
    console.log(ligneTexte(l));
    precedente = l.unite;
  }
  console.log('\n  Non mesurables ici :');
  for (const [u, raison] of Object.entries(UNITES_NON_MESURABLES)) console.log(`    ${u.padEnd(4)} ${raison}.`);
  console.log('    Le jour et la semaine se mesureront sur la série continue de MT5.');
  console.log(`\n  Témoin = espérance médiane sur ${TEMOIN.tirages} mélanges des mêmes bougies. p = part des mélanges qui font au moins aussi bien.`);
  console.log('  À 2 R, le seuil de rentabilité est 33,3 % avant frais.');
  console.log(`  Exploration : ${UNITES_MESUREES.length * SEUILS_ATR.length} configurations essayées. Sur autant d'essais, un p de 0,05 sort par hasard une fois sur vingt :`);
  console.log('  la configuration retenue se FIGE, puis se teste une seule fois sur des données neuves (HYP-005).\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
