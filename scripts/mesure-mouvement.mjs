// Mesure du « fort mouvement » : à partir de quelle force l'impulsion qui suit
// un order block en fait-elle un OB qui réagit ?
//
//   npm run mesure:mouvement
//   node scripts/mesure-mouvement.mjs --csv donnees/GC_2023_2024.csv --spread 0.4
//
// C'est une EXPLORATION, pas une preuve (feuille de route, E4) :
//
//   1. Régler — ce script, sur un fichier déjà exploré (GC 2023-2024).
//   2. Figer — le seuil retenu s'écrit dans la feuille de route et le code.
//   3. Confirmer — une seule fois, sur des données jamais utilisées pour les OB.
//
// Les seuils essayés sont FIGÉS ici et ne s'ouvrent à aucune option : quatre
// essais, comptés d'avance. En ajouter après avoir vu le tableau, c'est
// fabriquer le résultat (DEC-018, garde-fou 7).
//
// Chaîne : celle du backtest, inchangée (15 min, plan à 2 R, entrée à la
// mèche, ambigus exclus), SANS le filtre de tendance : la tendance est
// l'étoile 2 et se mesurera à part. Frais en R, trade par trade, depuis
// `--spread` (4 ticks aller-retour sur GC = 0,40, convention de HYP-003).

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { parseArgs, validerOptions, chaine, agreger } from './backtest.mjs';

export const SEUILS_ATR = Object.freeze([1, 1.5, 2, 3]);

/**
 * Le témoin, figé lui aussi : les mêmes bougies mélangées, passées par la même
 * chaîne. Sur une marche aléatoire, « ≥ 2 ATR » sort +0,23 R sur 9 trades :
 * sans témoin, ce chiffre se lirait comme un avantage (garde-fou 8).
 */
export const TEMOIN = Object.freeze({ tirages: 20, graine: 20261007 });

/**
 * Une ligne par seuil, plus la référence sans seuil.
 *
 * Un OB dont la force n'a pas pu se calculer (début de série) est écarté de
 * TOUTES les lignes, référence comprise : sinon la référence et les seuils ne
 * porteraient pas sur la même population.
 */
export function tableauDesSeuils(resultats, { seuils = SEUILS_ATR, coutEnR = 0, objectif = '2r', ambigu = 'exclu' } = {}) {
  const mesurables = resultats.filter((r) => typeof r.qualificatifs?.mouvementEnAtr === 'number');
  const ligne = (libelle, population) => {
    const a = agreger(population, coutEnR, objectif, ambigu);
    return {
      libelle,
      orderBlocks: population.length,
      tranchees: a.tranchees,
      gagnants: a.gagnants,
      taux: a.intervalle?.proportion ?? null,
      bas: a.intervalle?.bas ?? null,
      haut: a.intervalle?.haut ?? null,
      esperance: a.esperance,
      coutEnR: a.coutEnR,
    };
  };
  return [
    ligne('tous (référence)', mesurables),
    ...seuils.map((s) => ligne(`≥ ${s} ATR`, mesurables.filter((r) => r.qualificatifs.mouvementEnAtr >= s))),
  ];
}

/** Pour chaque ligne du tableau, l'espérance obtenue sur chaque tirage mélangé. */
export function temoinDesSeuils(fines, o, { tirages = TEMOIN.tirages, graine = TEMOIN.graine, surTirage = () => {} } = {}) {
  const alea = generateurAleatoire(graine);
  const parLigne = [];
  for (let i = 0; i < tirages; i++) {
    const melangee = melangerBougies(fines, alea, o.controlePaquet);
    const lignes = tableauDesSeuils(chaine(melangee, o).resultats, { coutEnR: o.coutEnR, objectif: o.objectif, ambigu: o.ambigu });
    lignes.forEach((l, k) => { (parLigne[k] ??= []).push(l.esperance); });
    surTirage(i + 1);
  }
  return parLigne;
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);
const r3 = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)} R`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const interdit of ['seuils', 'utDetection', 'objectif', 'remplissage', 'ambigu', 'sansFiltreBiais']) {
    if (args[interdit] !== undefined) {
      console.error(`\n--${interdit} n'existe pas ici : la mesure est figée (quatre essais comptés d'avance).\n`);
      process.exit(1);
    }
  }
  const valide = validerOptions({ ...args, sansFiltreBiais: true });
  const erreurs = valide.erreurs ? [...valide.erreurs] : [];
  if (typeof args.csv !== 'string') erreurs.push('--csv manquant (ex. donnees/GC_2023_2024.csv)');
  if (erreurs.length) {
    console.error(`\n${erreurs.join('\n')}\n\nExemple :\n  node scripts/mesure-mouvement.mjs --csv donnees/GC_2023_2024.csv --spread 0.4\n`);
    process.exit(1);
  }
  const o = valide;

  process.stdout.write(`\nLecture de ${basename(o.csv)}… `);
  const lecture = analyserCsv(await readFile(o.csv, 'utf8'), { unite: '1m', exclureDerniere: 'auto' });
  console.log(`${lecture.bougies.length} bougies 1 min`);
  for (const l of avertissementsLecture(lecture)) console.log(`  ⚠  ${l}`);
  o.uniteFine = '1m';

  const { resultats, segments } = chaine(lecture.bougies, o);
  const lignes = tableauDesSeuils(resultats, { coutEnR: o.coutEnR, objectif: o.objectif, ambigu: o.ambigu });

  process.stdout.write(`Témoin : ${TEMOIN.tirages} tirages mélangés `);
  const temoin = temoinDesSeuils(lecture.bougies, o, { surTirage: () => process.stdout.write('.') });
  console.log(' terminé');

  console.log(`\nMesure du « fort mouvement » — ${basename(o.csv)}, ${segments.length} contrat(s)`);
  console.log(`OB en ${o.utDetection}, plan à 2 R, entrée à la mèche, sans filtre de tendance, frais ${o.spread ? `${o.spread} en prix` : 'non fournis'}.\n`);
  console.log(`  ${'Seuil'.padEnd(18)}${'OB'.padStart(7)}${'Tranchés'.padStart(10)}${'Réussite'.padStart(11)}${'IC 95 %'.padStart(19)}${'Espérance'.padStart(12)}${'Témoin'.padStart(12)}${'p'.padStart(8)}`);
  lignes.forEach((l, k) => {
    const ic = l.bas === null ? '—' : `${pct(l.bas)} – ${pct(l.haut)}`;
    const t = resumeDistribution(temoin[k] ?? []);
    const p = valeurP(l.esperance, temoin[k] ?? []);
    console.log(`  ${l.libelle.padEnd(18)}${String(l.orderBlocks).padStart(7)}${String(l.tranchees).padStart(10)}${pct(l.taux).padStart(11)}${ic.padStart(19)}${r3(l.esperance).padStart(12)}${r3(t?.mediane).padStart(12)}${(p ? p.p.toFixed(2) : '—').padStart(8)}`);
  });
  console.log(`\n  Témoin = espérance médiane sur ${TEMOIN.tirages} mélanges des mêmes bougies. p = part des mélanges qui font au moins aussi bien.`);
  console.log('\nÀ plan 2 R, le seuil de rentabilité est 33,3 % avant frais.');
  console.log('Exploration : 4 seuils essayés. Le seuil retenu se FIGE, puis se confirme une seule fois sur des données jamais vues.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
