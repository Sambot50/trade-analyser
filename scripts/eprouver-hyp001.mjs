// HYP-001 — l'épreuve. Gelée le 2026-09-25, voir docs/DECISIONS.md.
//
//   node scripts/eprouver-hyp001.mjs --csv GC_2025_2026.csv
//
// TOUS LES PARAMÈTRES SONT DES CONSTANTES. C'est délibéré et ce n'est pas
// négociable : la seule chose qui varie est le fichier. Une option qui
// permettrait de régler la fenêtre, le seuil ou le multiple transformerait
// cette épreuve en recherche — on tournerait les boutons jusqu'à ce que le
// résultat plaise, et on appellerait ça une confirmation.
//
// Six hypothèses ont déjà été réfutées dans ce projet. Celle-ci est la
// septième, et la première à frôler le seuil. Si elle tombe, elle tombe.
//
// N'AJOUTEZ PAS D'OPTIONS À CE FICHIER. Pour explorer autre chose, écrivez un
// autre script et pré-enregistrez-le.

import { readFile } from 'node:fs/promises';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { atteintAvantDePerdre } from '../src/lib/marche/apres.js';
import { parseArgs } from './backtest.mjs';

/** Gelé. Toute modification annule l'épreuve. */
export const GEL = Object.freeze({
  enregistreLe: '2026-09-25',
  ut: '15m',
  utCsv: '1m',
  fenetre: 60,
  detecteur: 'picVolume',
  famille: 'hausse-achat',
  horizonHeures: 24,
  multiple: 3,
  avecMacro: false,
  ecartAttendu: 5.5,
  alpha: 0.05,
  // Unilatéral : la direction était prédite. Une seule comparaison, donc
  // aucune correction de multiplicité — c'est tout l'intérêt d'avoir gelé.
  unilateral: true,
  debutAttendu: '2025-01-01',
  finAttendue: '2026-09-01',
});

/** Loi normale centrée réduite, P(Z ≤ z). */
export function phi(z) {
  // Abramowitz & Stegun 7.1.26, appliquée à erf.
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

/**
 * La part d'objectifs atteints avant le stop, et son effectif.
 * `ambigu` est exclu du dénominateur : une bougie qui touche l'objectif ET le
 * stop ne dit pas lequel est arrivé en premier. DEC-015 est née d'une
 * supposition de ce genre.
 */
export function part(verdicts) {
  const tranches = verdicts.filter((v) => v === 'atteint' || v === 'perdu');
  if (!tranches.length) return { part: null, n: 0 };
  return { part: (tranches.filter((v) => v === 'atteint').length / tranches.length) * 100, n: tranches.length };
}

/** Le test, tel qu'il a été pré-enregistré. Rien d'autre n'est calculé. */
export function eprouver(cas, temoin) {
  const a = part(cas);
  const t = part(temoin);
  if (a.part === null || t.part === null) {
    return { verdict: 'IMPOSSIBLE', raison: 'effectif nul dans un des deux groupes', a, t };
  }

  const ecart = a.part - t.part;
  const se = Math.sqrt(2500 / a.n + 2500 / t.n);
  const z = ecart / se;
  // Unilatéral dans la direction prédite : un écart négatif ne peut pas
  // devenir significatif en changeant de côté.
  const p = 1 - phi(z);

  let verdict;
  if (ecart <= 0) verdict = 'RÉFUTÉE';
  else if (p < GEL.alpha) verdict = 'CONFIRMÉE';
  else verdict = 'NON CONFIRMÉE';

  return { verdict, ecart, se, z, p, a, t };
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.csv !== 'string') {
    console.error('\n--csv <fichier> est requis. C\'est le SEUL argument accepté.\n');
    process.exit(1);
  }
  for (const inattendu of Object.keys(args).filter((k) => k !== 'csv')) {
    console.error(`\nArgument "--${inattendu}" refusé : HYP-001 est gelée, aucun paramètre n'est réglable.`);
    console.error('Pour explorer autre chose, écris un autre script et pré-enregistre-le.\n');
    process.exit(1);
  }

  process.stdout.write(`\nlecture de ${args.csv}… `);
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(args.csv, 'utf8'), {
    unite: GEL.utCsv, decalageHeures: 0,
  });
  console.log(`${fines.length} bougies ${GEL.utCsv}`);
  if (!volumeExploitable) {
    console.error('\nÉchec : ce fichier ne porte pas de volume réel.\n');
    process.exit(2);
  }

  // Une épreuve lancée sur la période d'entraînement ne prouverait rien, et
  // rien dans la sortie ne le dirait. Le vérifier ici, pas dans la tête.
  const premier = new Date(fines[0].ouvertureMs).toISOString().slice(0, 10);
  const dernier = new Date(fines.at(-1).ouvertureMs).toISOString().slice(0, 10);
  console.log(`période du fichier : ${premier} → ${dernier}`);
  if (premier < GEL.debutAttendu) {
    console.error(`\n⛔ REFUS — ce fichier commence le ${premier}, avant le ${GEL.debutAttendu}.`);
    console.error('   HYP-001 a été formée sur 2023-2024. L\'éprouver sur ces données');
    console.error('   reviendrait à vérifier une hypothèse sur ce qui l\'a inspirée.\n');
    process.exit(3);
  }

  const horizonBougies = Math.round((GEL.horizonHeures * 3_600_000) / dureeUnite(GEL.ut));
  const { segments } = decouperParContrat(fines);
  console.log(`${segments.length} contrat(s) · horizon ${horizonBougies} bougies\n`);

  const cas = [];
  const temoin = [];
  let tronques = 0;

  for (const segment of segments) {
    const serie = agregerBougies(segment.bougies, GEL.ut);
    for (const s of scorerSegment(serie, { fenetre: GEL.fenetre })) {
      if (s.mesures.macro) continue;                              // gelé : macro exclues
      if (s.mesures.familleSemaine !== GEL.famille) continue;     // gelé : hausse-achat
      const verdict = atteintAvantDePerdre(serie, s.index, horizonBougies, GEL.multiple);
      if (verdict === null) { tronques++; continue; }
      (s.scores[GEL.detecteur] > 0 ? cas : temoin).push(verdict);
    }
  }
  if (tronques) console.log(`${tronques} bougies écartées : horizon incomplet en fin de contrat`);

  const r = eprouver(cas, temoin);

  console.log('\n' + '='.repeat(74));
  // ERRATUM-001 : la mesure est SYMÉTRIQUE. `atteintAvantDePerdre` applique
  // la même cible des deux côtés, donc +3R contre −3R. L'étiquette annonçait
  // « 3R avant 1R » — une chaîne fausse, corrigée ici. Aucune valeur gelée
  // n'est touchée, et les tests d'immuabilité continuent de le vérifier.
  console.log(`  HYP-001  ·  gelée le ${GEL.enregistreLe}  ·  ${GEL.famille}  ·  +${GEL.multiple}R avant −${GEL.multiple}R`);
  console.log('='.repeat(74));

  if (r.verdict === 'IMPOSSIBLE') {
    console.log(`\n  ÉPREUVE IMPOSSIBLE — ${r.raison}\n`);
    process.exit(4);
  }

  console.log(`\n  détectées   ${String(r.a.n).padStart(6)} cas    ${r.a.part.toFixed(1)} %`);
  console.log(`  témoin      ${String(r.t.n).padStart(6)} cas    ${r.t.part.toFixed(1)} %`);
  console.log(`\n  écart observé   ${r.ecart >= 0 ? '+' : ''}${r.ecart.toFixed(2)} points`);
  console.log(`  écart attendu   +${GEL.ecartAttendu.toFixed(2)} points  (mesuré sur 2023-2024)`);
  console.log(`  erreur type      ${r.se.toFixed(3)}`);
  console.log(`  z                ${r.z.toFixed(2)}`);
  console.log(`  p unilatéral     ${r.p.toFixed(4)}`);
  console.log(`\n  >>> ${r.verdict} <<<\n`);

  if (r.verdict === 'CONFIRMÉE') {
    console.log('  Un effet a survécu à une période jamais ouverte. C\'est la première fois.');
    console.log('  Ce n\'est toujours PAS une stratégie : aucun coût n\'est compté, aucune');
    console.log('  entrée n\'est décidée. L\'étape suivante est un système complet, avec');
    console.log('  spread et glissement, pré-enregistré lui aussi.\n');
  } else if (r.verdict === 'RÉFUTÉE') {
    console.log('  L\'écart est nul ou inversé. Les vingt-quatre cellules de 2023-2024');
    console.log('  parlaient, pas le marché. Septième réfutation — à consigner et à clore.\n');
  } else {
    console.log('  L\'écart va dans le sens prédit mais ne dépasse pas le bruit. Ce n\'est');
    console.log('  pas une confirmation, et ce n\'est pas une invitation à rallonger la');
    console.log('  période jusqu\'à ce que ça passe : la période était gelée d\'avance.\n');
  }
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
