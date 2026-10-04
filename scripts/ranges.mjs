// Quand le prix sort d'un range, continue-t-il ou revient-il ?
//
//   node scripts/ranges.mjs --csv GC_2023_2024.csv --ut 15m
//   node scripts/ranges.mjs --temoin            (marche aléatoire seule)
//
// C'est la seule question qu'on se pose ici, et elle a été écrite AVANT de
// regarder les données. Sa réponse décide de l'usage : si les sorties
// échouent, le range est une zone de retour à la moyenne et on joue ses
// bornes ; si elles continuent, c'est une compression et on joue la sortie.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ LE TÉMOIN N'EST PAS UN ORNEMENT.                                        │
// │                                                                         │
// │ Une marche aléatoire produit elle aussi des ranges, et des sorties qui  │
// │ continuent. Un taux de continuation de 55 % ne dit rien tant qu'on ne   │
// │ sait pas ce que donne le hasard dans les mêmes conditions. Seul l'ÉCART │
// │ entre les deux porte une information.                                   │
// └─────────────────────────────────────────────────────────────────────────┘

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { analyser as analyserCsv, agreger } from '../src/lib/marche/csv.js';
import { serieAleatoire } from '../src/lib/marche/aleatoire.js';
import { detecterRanges, issueDeLaSortie, statistiques, FENETRE, SEUIL_COMPRESSION } from '../src/lib/marche/range.js';
import { intervalleWilson } from '../src/lib/marche/statistiques.js';
import { parseArgs } from './backtest.mjs';

const pc = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)} %`);

/** Mesure une série : ses ranges, leurs sorties, ce qui a suivi. */
export function mesurer(bougies, { fenetre = FENETRE, seuil = SEUIL_COMPRESSION, horizon = 20, multiple = 1 } = {}) {
  const ranges = detecterRanges(bougies, { fenetre, seuil });
  const sortis = ranges.filter((r) => !r.enCours && r.indexSortie !== null);
  const issues = sortis.map((r) => ({ range: r, ...issueDeLaSortie(bougies, r, { horizon, multiple }) }));
  return { bougies: bougies.length, ranges: ranges.length, sortis: sortis.length, issues, stats: statistiques(issues) };
}

/**
 * Ce que le hasard donne DANS LES MÊMES CONDITIONS, sur plusieurs graines.
 *
 * « Les mêmes conditions » inclut l'unité de temps, et ce n'était pas le cas
 * au départ. Le générateur produit des bougies d'une MINUTE ; les données
 * réelles étaient en quinze. Le taux de continuation dépend de cette unité —
 * mesuré, 36,7 % en une minute contre 28,3 % en quinze, sur le même hasard.
 *
 * La conséquence a été spectaculaire et instructive. Contre le témoin d'une
 * minute, le réel ressortait à −4,70 points, z = −1,99, p = 0,023. Contre le
 * témoin de quinze minutes, il ressort à +3,70 points, z = +1,89, p = 0,029.
 * Le SIGNE s'inverse, et les deux paraissent significatifs.
 *
 * Un témoin mal construit ne rend pas un résultat faible : il en fabrique un
 * faux, aussi convaincant que le vrai. L'agrégation est donc faite ici, et
 * l'unité est rendue avec le résultat pour qu'un désaccord se voie.
 */
export function temoin(options, { graines = 12, minutes = 220_000, sigma = 0.4, unite = null } = {}) {
  const tout = [];
  const parGraine = [];
  for (let g = 1; g <= graines; g++) {
    const brut = serieAleatoire({ graine: g, minutes, sigma });
    const bougies = unite && unite !== '1m' ? agreger(brut, unite) : brut;
    const m = mesurer(bougies, options);
    tout.push(...m.issues);
    parGraine.push(m.stats);
  }
  return { issues: tout, stats: statistiques(tout), parGraine, unite: unite ?? '1m' };
}

/**
 * De combien l'erreur type annoncée est-elle fausse ?
 *
 * La formule usuelle √(p(1−p)/n) suppose les observations INDÉPENDANTES. Ici
 * elles ne le sont pas : avec une fenêtre de 20 bougies et un horizon de 20,
 * deux ranges voisins partagent presque toutes leurs bougies, et un même
 * mouvement de marché pousse toute une grappe d'issues dans le même sens. La
 * formule croit compter mille observations là où il y en a peut-être cent.
 *
 * On ne SUPPOSE donc pas le facteur — on le mesure. Des échantillons qu'on
 * sait indépendants (des blocs de temps disjoints, ou des graines distinctes)
 * donnent une dispersion observée ; son rapport à la dispersion annoncée est
 * le facteur de correction.
 *
 * Ce dépôt l'a déjà fait une fois, sur une autre règle, et a trouvé 3,8
 * (DEC-032). Rien ne dit que ce soit le même ici.
 */
export function facteurDeDispersion(groupes) {
  const utiles = groupes.filter((g) => g && g.tranches > 0 && g.tauxContinuation !== null);
  if (utiles.length < 3) return null;

  const taux = utiles.map((g) => g.tauxContinuation);
  const moyenne = taux.reduce((a, b) => a + b, 0) / taux.length;
  const variance = taux.reduce((s, t) => s + (t - moyenne) ** 2, 0) / (taux.length - 1);
  const seObservee = Math.sqrt(variance / taux.length);

  // L'erreur type que la formule annoncerait sur l'ensemble mis bout à bout.
  const total = utiles.reduce((s, g) => s + g.tranches, 0);
  const succes = utiles.reduce((s, g) => s + g.continuation, 0);
  const p = succes / total;
  const seAnnoncee = Math.sqrt((p * (1 - p)) / total);

  return {
    groupes: utiles.length,
    total,
    taux: moyenne,
    tauxGroupe: taux,
    seObservee,
    seAnnoncee,
    facteur: seAnnoncee > 0 ? seObservee / seAnnoncee : null,
  };
}

/**
 * Découpe la série en blocs de temps DISJOINTS, et mesure chacun seul.
 *
 * Disjoints et contigus : c'est ce qui les rend à peu près indépendants. Des
 * blocs qui se chevaucheraient reproduiraient le défaut qu'on cherche à
 * mesurer, et le facteur trouvé serait de un par construction.
 *
 * Un range à cheval sur deux blocs est perdu — la détection repart de zéro à
 * chaque bloc. C'est le prix de l'indépendance, et il est faible : avec huit
 * blocs on perd au plus sept ranges.
 */
export function parBlocs(bougies, options, nombre = 8) {
  const taille = Math.floor(bougies.length / nombre);
  if (taille < 100) return null;

  const blocs = [];
  for (let k = 0; k < nombre; k++) {
    const debut = k * taille;
    const fin = k === nombre - 1 ? bougies.length : debut + taille;
    blocs.push(mesurer(bougies.slice(debut, fin), options).stats);
  }
  return { blocs, dispersion: facteurDeDispersion(blocs) };
}

export function rendre(nom, s, n) {
  const i = s.tauxContinuation === null ? null : intervalleWilson(s.continuation, s.tranches);
  return `${nom.padEnd(22)}${String(s.tranches).padStart(6)}   ${pc(s.tauxContinuation).padStart(8)}`
    + (i ? `   [${pc(i.bas)} – ${pc(i.haut)}]` : '   —')
    + `   ${String(s.indecis).padStart(5)} indécis`
    + (n !== undefined ? `   ${n} ranges` : '');
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    fenetre: Number(args.fenetre ?? FENETRE),
    seuil: Number(args.seuil ?? SEUIL_COMPRESSION),
    horizon: Number(args.horizon ?? 20),
    multiple: Number(args.multiple ?? 1),
  };

  console.log(`\nfenêtre ${options.fenetre} · seuil de compression ${options.seuil}`
    + ` · horizon ${options.horizon} bougies · cible ${options.multiple}× la hauteur\n`);
  console.log('série                 tranchés   continuation   intervalle à 95 %');
  console.log('─'.repeat(78));

  // L'unité gouverne LES DEUX séries. La fixer une seule fois, au même
  // endroit, est ce qui empêche le témoin de dériver loin du réel.
  const unite = args.ut ?? '15m';

  let reel = null;
  let bougies = null;
  if (args.csv) {
    const { bougies: brutes } = analyserCsv(await readFile(args.csv, 'utf8'), {
      unite: args.utCsv ?? unite, decalageHeures: Number(args.decalageHeures ?? 0),
    });
    bougies = args.utCsv && args.utCsv !== unite ? agreger(brutes, unite) : brutes;
    reel = mesurer(bougies, options);
    console.log(rendre(`réel (${unite})`, reel.stats, reel.ranges));
  }

  const t = temoin(options, { graines: Number(args.graines ?? 12), unite });
  console.log(rendre(`marche aléatoire (${t.unite})`, t.stats));
  if (t.unite !== unite) {
    console.log(`\nATTENTION : le témoin est en ${t.unite} et le réel en ${unite}.`);
    console.log('Le taux dépend de l’unité — les comparer n’a aucun sens.');
  }

  const nBlocs = Number(args.blocs ?? 0);
  if (nBlocs >= 3) {
    console.log('\n' + '═'.repeat(78));
    console.log(`L'ERREUR TYPE EST-ELLE CELLE QU'ON CROIT ? — ${nBlocs} blocs disjoints\n`);
    console.log('échantillon           groupes   taux      é.t. annoncée   é.t. observée   facteur');
    console.log('─'.repeat(78));

    const lignes = [];
    if (bougies) {
      const b = parBlocs(bougies, options, nBlocs);
      if (b?.dispersion) lignes.push(['réel, par blocs', b.dispersion, b.blocs]);
      else console.log('réel : série trop courte pour être découpée en blocs utilisables.');
    }
    const d = facteurDeDispersion(t.parGraine);
    if (d) lignes.push(['témoin, par graines', d, t.parGraine]);

    for (const [nom, x] of lignes) {
      console.log(`${nom.padEnd(22)}${String(x.groupes).padStart(7)}`
        + `${(100 * x.taux).toFixed(1).padStart(8)} %`
        + `${(100 * x.seAnnoncee).toFixed(2).padStart(14)} pts`
        + `${(100 * x.seObservee).toFixed(2).padStart(14)} pts`
        + `${x.facteur === null ? '—' : '×' + x.facteur.toFixed(2)}`.padStart(10));
    }
    for (const [nom, x] of lignes) {
      console.log(`\n  ${nom} : ${x.tauxGroupe.map((v) => (100 * v).toFixed(1)).join(' · ')}`);
    }

    console.log('\nUn facteur proche de 1 dirait que la formule a raison et que les');
    console.log('observations sont bien indépendantes. Au-delà, elle compte des');
    console.log('observations qui n’en sont pas, et tout écart jugé significatif avec');
    console.log('elle doit être relu en divisant son z par ce facteur.');
    console.log('\nAvec huit groupes, le facteur lui-même est imprécis : il repose sur une');
    console.log('variance estimée sur sept degrés de liberté. Le lire comme un ordre de');
    console.log('grandeur, pas comme une décimale.');
  }

  console.log('');
  console.log('Un taux de continuation ne dit rien seul : une marche sans structure');
  console.log('produit elle aussi des ranges et des sorties qui continuent. Seul l’écart');
  console.log('entre les deux lignes porte une information — et seulement si leurs');
  console.log('intervalles ne se recouvrent pas.');
  if (!args.csv) {
    console.log('\nAucun CSV fourni : seul le témoin a été mesuré. Il n’y a rien à conclure');
    console.log('d’un témoin seul, c’est la référence, pas le résultat.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((err) => { console.error(err.message); process.exit(1); });
}
