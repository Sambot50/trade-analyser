// HYP-005 — L'order block du bootcamp, sur cinq marchés neufs. Gelée le 2026-10-07.
//
//   npm run hyp:005
//   node scripts/hyp-005.mjs --dossier donnees/marches
//
// Pré-enregistrée dans docs/DECISIONS.md AVANT toute exécution. La
// configuration vient de l'exploration sur GC 2023-2024 (`mesure:ob-bootcamp`,
// 16 configurations) : 5 min, mouvement fort ≥ 2 ATR, retenue par l'opérateur
// le 2026-10-07. Elle est figée dans `GEL` ; aucune option ne la change.
//
// Le script refuse un autre dossier, refuse de tourner si un des cinq marchés
// manque, et refuse de tourner une seconde fois : il écrit `donnees/hyp-005.json`
// et s'arrête si ce fichier existe. AUCUN résultat n'est affiché avant la fin :
// une exécution interrompue ne laisse rien voir, et peut donc se relancer sans
// qu'on ait choisi de relancer au vu d'un chiffre.
//
// Le marché est traité l'un après l'autre (mémoire) ; chaque tirage du témoin
// mélange chacun des cinq marchés, puis regroupe leurs trades, exactement comme
// le réel. Un test, un p.

import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { PARAMETRES_ETOILES } from '../src/lib/marche/etoiles.js';
import { PARAMETRES_OB_BOOTCAMP } from '../src/lib/marche/ob-bootcamp.js';
import { parseArgs, validerOptions, chaine, agreger } from './backtest.mjs';
import { optionsDeMesure, HORIZON_EN_BOUGIES } from './mesure-ob-bootcamp.mjs';
import { pasDeCotation } from './eprouver-hyp003.mjs';

export const GEL = Object.freeze({
  hypothese: 'HYP-005',
  geleLe: '2026-10-07',
  dossier: 'marches',
  // Jamais utilisés pour une question d'order block (HYP-002 et DEC-031 y ont
  // mesuré le volume). L'or est exclu : le seuil y a été choisi.
  marches: Object.freeze(['SI', 'PL', 'HG', 'CL', 'ES']),
  // La configuration retenue sur GC 2023-2024, et rien d'autre.
  unite: '5m',
  seuilAtr: 2,
  seulementEnTendance: true,
  horizonEnBougies: HORIZON_EN_BOUGIES,
  objectif: '2r',
  gain: 2,
  // Frais : 4 ticks aller-retour, pas de cotation LU dans les données (HYP-003).
  ticksAllerRetour: 4,
  tirages: 200,
  graine: 20261007,
  minimumTrades: 300,
  seuilP: 0.01,
  minimumSecondaire: 30,
  parametresOb: PARAMETRES_OB_BOOTCAMP,
  parametresEtoiles: PARAMETRES_ETOILES,
});

/**
 * Le groupe principal, qui décide, et les lectures secondaires annoncées
 * d'avance. Les secondaires ont leur propre p sur les MÊMES tirages, mais ne
 * décident de rien : un secondaire prometteur devient une hypothèse suivante,
 * testée sur d'autres données.
 */
export const GROUPES = Object.freeze({
  tous: () => true,
  cinqEtoiles: (r) => r.etoiles?.nombre === 5,
  balayageAvant: (r) => r.etoiles?.balayageAvant === true,
  methodeComplete: (r) => r.etoiles?.nombre === 5 && r.etoiles?.balayageAvant === true,
  achats: (r) => r.plan?.direction === 'BUY',
  ventes: (r) => r.plan?.direction === 'SELL',
});
const SECONDAIRES_AVEC_TEMOIN = ['cinqEtoiles', 'balayageAvant', 'methodeComplete'];

/** Ce qu'il faut garder d'un groupe pour le regrouper entre marchés. */
export function compter(resultats, o) {
  const a = agreger(resultats, o.coutEnR, o.objectif, o.ambigu);
  return { total: a.total, tranchees: a.tranchees, gagnants: a.gagnants, cout: (a.coutEnR ?? 0) * a.tranchees };
}

/** Plusieurs marchés en un : les trades mis en commun, frais compris. */
export function regrouper(comptes) {
  const t = comptes.reduce((s, c) => ({
    total: s.total + c.total, tranchees: s.tranchees + c.tranchees,
    gagnants: s.gagnants + c.gagnants, cout: s.cout + c.cout,
  }), { total: 0, tranchees: 0, gagnants: 0, cout: 0 });
  const esperance = t.tranchees
    ? (t.gagnants * GEL.gain - (t.tranchees - t.gagnants) - t.cout) / t.tranchees
    : null;
  return { ...t, taux: t.tranchees ? t.gagnants / t.tranchees : null, esperance };
}

/** Les comptes de chaque groupe, pour une série de résultats. */
export function compterGroupes(resultats, o) {
  return Object.fromEntries(Object.entries(GROUPES).map(([nom, garder]) => [nom, compter(resultats.filter(garder), o)]));
}

/**
 * La règle de décision, écrite avant les données. Trois issues.
 */
export function verdict({ tranchees, esperance, p }) {
  if (tranchees < GEL.minimumTrades) {
    return { code: 'non_concluant', texte: `Non concluant : ${tranchees} trades tranchés, il en faut au moins ${GEL.minimumTrades}.` };
  }
  const positive = esperance !== null && esperance > 0;
  const batLeHasard = p !== null && p < GEL.seuilP;
  if (positive && batLeHasard) {
    return { code: 'confirmee', texte: 'CONFIRMÉE : l\'OB du bootcamp (5 min, ≥ 2 ATR) a une espérance positive frais compris et bat le hasard sur cinq marchés neufs.' };
  }
  const raisons = [];
  if (!positive) raisons.push(`espérance non positive (${esperance === null ? '—' : esperance.toFixed(3)} R)`);
  if (!batLeHasard) raisons.push(`ne bat pas le hasard (p = ${p === null ? '—' : p.toFixed(3)}, seuil ${GEL.seuilP})`);
  return { code: 'refutee', texte: `RÉFUTÉE sur les cinq marchés : ${raisons.join(', ')}.` };
}

/** Les options de la chaîne pour un marché, frais en prix depuis son pas. */
export function optionsMarche(fichier, pas) {
  const base = validerOptions({
    csv: fichier, spread: String(Number((GEL.ticksAllerRetour * pas).toPrecision(6))), objectif: GEL.objectif, sansFiltreBiais: true,
  });
  if (base.erreurs) throw new Error(base.erreurs.join('\n'));
  const o = optionsDeMesure(base, GEL.seuilAtr, GEL.unite);
  o.uniteFine = '1m';
  return o;
}

/** Les fichiers des cinq marchés, ou la liste de ceux qui manquent. */
export function choisirFichiers(noms) {
  const parMarche = {};
  for (const f of noms.filter((n) => n.toLowerCase().endsWith('.csv')).sort()) {
    const m = f.split(/[_.-]/)[0].toUpperCase();
    if (GEL.marches.includes(m)) (parMarche[m] ??= []).push(f);
  }
  const manquants = GEL.marches.filter((m) => !parMarche[m]);
  const doublons = GEL.marches.filter((m) => (parMarche[m]?.length ?? 0) > 1);
  return { fichiers: GEL.marches.map((m) => parMarche[m]?.[0]).filter(Boolean), manquants, doublons };
}

async function existe(chemin) {
  try { await access(chemin); return true; } catch { return false; }
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);
const r3 = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)} R`);
const duree = (ms) => `${Math.floor(ms / 3_600_000)} h ${String(Math.round((ms % 3_600_000) / 60_000)).padStart(2, '0')}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inconnues = Object.keys(args).filter((k) => k !== 'dossier');
  if (inconnues.length) {
    console.error(`\n${inconnues.map((k) => `--${k}`).join(', ')} : aucune option. ${GEL.hypothese} est gelée.\n`);
    process.exit(1);
  }
  if (typeof args.dossier !== 'string' || basename(args.dossier.replace(/[\\/]+$/, '')) !== GEL.dossier) {
    console.error(`\n${GEL.hypothese} se lance sur le dossier ${GEL.dossier} et sur lui seul.\n  npm run hyp:005\n`);
    process.exit(1);
  }
  const dossier = args.dossier.replace(/[\\/]+$/, '');
  const sortie = join(dirname(dossier), 'hyp-005.json');
  if (await existe(sortie)) {
    console.error(`\n${GEL.hypothese} a déjà été lancée : ${sortie} existe. Elle ne se relance pas.\n`);
    process.exit(1);
  }
  const { fichiers, manquants, doublons } = choisirFichiers(await readdir(dossier));
  if (manquants.length || doublons.length) {
    console.error(`\n${GEL.hypothese} exige un fichier par marché (${GEL.marches.join(', ')}).`
      + `${manquants.length ? `\n  Manquants : ${manquants.join(', ')}` : ''}${doublons.length ? `\n  En double : ${doublons.join(', ')}` : ''}\n`);
    process.exit(1);
  }

  console.log(`\n${GEL.hypothese} — gelée le ${GEL.geleLe} — OB bootcamp ${GEL.unite}, ≥ ${GEL.seuilAtr} ATR, ${GEL.tirages} mélanges par marché`);
  console.log('  Aucun résultat ne s\'affiche avant la fin.\n');

  const depart = Date.now();
  const marches = [];
  const reels = [];
  // temoin[k][groupe] : les comptes des cinq marchés pour le tirage k.
  const temoin = Array.from({ length: GEL.tirages }, () => ({}));

  for (const [m, fichier] of fichiers.entries()) {
    const contenu = await readFile(join(dossier, fichier), 'utf8');
    const sha256 = createHash('sha256').update(contenu).digest('hex');
    const lecture = analyserCsv(contenu, { unite: '1m', exclureDerniere: 'auto' });
    // Arrondi à 6 chiffres significatifs : la différence de deux flottants
    // rend 0,00999999… pour un pas de 0,01.
    const brut = pasDeCotation(lecture.bougies.slice(0, 200_000).map((b) => b.cloture));
    const pas = brut ? Number(brut.toPrecision(6)) : null;
    if (!pas) { console.error(`\n${fichier} : pas de cotation illisible. Rien n'est lancé plus loin.\n`); process.exit(1); }
    const o = optionsMarche(fichier, pas);
    const marche = GEL.marches[m];
    console.log(`  ${marche.padEnd(3)} ${fichier} · ${lecture.bougies.length} bougies 1 min · pas ${pas} · frais ${Number((GEL.ticksAllerRetour * pas).toPrecision(6))} · ${sha256.slice(0, 12)}…`);
    for (const l of avertissementsLecture(lecture)) console.log(`      ⚠  ${l}`);

    const reel = compterGroupes(chaine(lecture.bougies, o).resultats, o);
    reels.push(reel);
    marches.push({ marche, fichier, sha256, bougies: lecture.bougies.length, pas, spread: Number((GEL.ticksAllerRetour * pas).toPrecision(6)) });

    const alea = generateurAleatoire(GEL.graine);
    const t0 = Date.now();
    process.stdout.write('      témoin ');
    for (let k = 0; k < GEL.tirages; k++) {
      const c = compterGroupes(chaine(melangerBougies(lecture.bougies, alea, o.controlePaquet), o).resultats, o);
      for (const [g, v] of Object.entries(c)) (temoin[k][g] ??= []).push(v);
      if ((k + 1) % 10 === 0) process.stdout.write('.');
      if (k === 4) {
        const parTirage = (Date.now() - t0) / 5;
        process.stdout.write(` (≈ ${duree(parTirage * (GEL.tirages - 5))} pour ce marché) `);
      }
    }
    console.log(` terminé · écoulé ${duree(Date.now() - depart)}`);
  }

  // Les résultats, enfin : regroupés sur les cinq marchés.
  const groupe = (nom) => regrouper(reels.map((r) => r[nom]));
  const temoinDe = (nom) => temoin.map((t) => regrouper(t[nom]).esperance);
  const principal = groupe('tous');
  const tp = temoinDe('tous');
  const p = valeurP(principal.esperance, tp)?.p ?? null;
  const v = verdict({ tranchees: principal.tranchees, esperance: principal.esperance, p });

  const lignes = {};
  for (const nom of Object.keys(GROUPES)) {
    const g = groupe(nom);
    const avecTemoin = nom === 'tous' || SECONDAIRES_AVEC_TEMOIN.includes(nom);
    const t = avecTemoin ? temoinDe(nom) : null;
    lignes[nom] = {
      ...g,
      temoinMediane: t ? resumeDistribution(t)?.mediane ?? null : null,
      p: t && g.tranchees >= GEL.minimumSecondaire ? valeurP(g.esperance, t)?.p ?? null : null,
    };
  }
  const parMarche = Object.fromEntries(marches.map((m, i) => [m.marche, regrouper([reels[i].tous])]));

  const entete = `  ${''.padEnd(18)}${'OB'.padStart(7)}${'Tranchés'.padStart(10)}${'Réussite'.padStart(11)}${'Espérance'.padStart(12)}${'Témoin'.padStart(12)}${'p'.padStart(8)}`;
  const ligne = (libelle, l) => `  ${libelle.padEnd(18)}${String(l.total).padStart(7)}${String(l.tranchees).padStart(10)}${pct(l.taux).padStart(11)}${r3(l.esperance).padStart(12)}${(l.temoinMediane === undefined ? '' : r3(l.temoinMediane)).padStart(12)}${(l.p === null || l.p === undefined ? '—' : l.p.toFixed(3)).padStart(8)}`;

  console.log(`\n  Principal — cinq marchés regroupés, frais compris\n${entete}`);
  console.log(ligne('tous les OB', lignes.tous));
  console.log(`\n  ${v.texte}\n`);
  console.log(`  Lectures secondaires — annoncées d'avance, elles ne décident de rien\n${entete}`);
  console.log(ligne('5 étoiles', lignes.cinqEtoiles));
  console.log(ligne('balayage avant', lignes.balayageAvant));
  console.log(ligne('5 ét. + balayage', lignes.methodeComplete));
  console.log(ligne('achats', { ...lignes.achats, temoinMediane: undefined }));
  console.log(ligne('ventes', { ...lignes.ventes, temoinMediane: undefined }));
  console.log('\n  Par marché (tous les OB)');
  for (const [m, l] of Object.entries(parMarche)) console.log(ligne(m, { ...l, temoinMediane: undefined, p: null }));
  console.log(`\n  Témoin = espérance médiane sur ${GEL.tirages} mélanges. p = part des mélanges qui font au moins aussi bien. À 2 R, rentabilité à 33,3 % avant frais.`);

  await writeFile(sortie, JSON.stringify({
    ...GEL, lanceLe: new Date().toISOString(), dureeMs: Date.now() - depart,
    marchesLus: marches, groupes: lignes, parMarche, verdict: v,
  }, null, 2) + '\n');
  console.log(`\n  Résultat écrit dans ${sortie}. ${GEL.hypothese} ne se relancera pas.\n`);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
