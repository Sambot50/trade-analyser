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

/** Ce que le hasard donne dans les mêmes conditions, sur plusieurs graines. */
export function temoin(options, { graines = 12, minutes = 40_000, sigma = 0.4 } = {}) {
  const tout = [];
  for (let g = 1; g <= graines; g++) {
    const m = mesurer(serieAleatoire({ graine: g, minutes, sigma }), options);
    tout.push(...m.issues);
  }
  return { issues: tout, stats: statistiques(tout) };
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

  if (args.csv) {
    const unite = args.ut ?? '15m';
    const { bougies: brutes } = analyserCsv(await readFile(args.csv, 'utf8'), {
      unite: args.utCsv ?? unite, decalageHeures: Number(args.decalageHeures ?? 0),
    });
    const bougies = args.utCsv && args.utCsv !== unite ? agreger(brutes, unite) : brutes;
    const m = mesurer(bougies, options);
    console.log(rendre(`réel (${unite})`, m.stats, m.ranges));
  }

  const t = temoin(options, { graines: Number(args.graines ?? 12) });
  console.log(rendre('marche aléatoire', t.stats));

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
