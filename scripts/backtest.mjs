// Mesure la fréquence d'aboutissement des order blocks sur l'historique.
//
//   node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01
//
// Chaîne : bougies Binance → pivots → cassures de structure → order blocks
// → plan hypothétique par order block → résolution par le MÊME algorithme que
// le journal → fréquence observée avec son intervalle de confiance.
//
// Le découpage en deux moitiés est imposé, pas optionnel. Un réglage mis au
// point sur la totalité d'un historique décrit ce passé-là et rien d'autre ;
// la seconde moitié est la seule chose qui ressemble à l'avenir.

import { recuperer, dureeUnite, nombreDeRequetes, UNITES } from '../src/lib/marche/bougies.js';
import { cassures, tendanceAuFilDuTemps, tendanceA, HAUSSIER, BAISSIER, INDETERMINE } from '../src/lib/marche/structure.js';
import { detecter, anomalieVolume } from '../src/lib/marche/orderblocks.js';
import { intervalleWilson, conclusionPossible, esperanceEnR } from '../src/lib/marche/statistiques.js';
import { resoudreIssue, compteDansLesStats, estGagnant } from '../src/lib/journal/resolve.js';

const DEFAUTS = {
  utBiais: '1h', utDetection: '15m', utResolution: '5m',
  fenetre: 5, horizonHeures: 48, coutEnR: 0.05,
};

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const cle = camel(argv[i].slice(2));
    const suivant = argv[i + 1];
    if (suivant === undefined || suivant.startsWith('--')) out[cle] = true;
    else { out[cle] = suivant; i++; }
  }
  return out;
}

function camel(nom) {
  return nom.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function validerOptions(args) {
  const erreurs = [];
  const o = { ...DEFAUTS };

  if (!args.symbole) erreurs.push('--symbole manquant (ex. BTCUSDT)');
  else o.symbole = args.symbole.toUpperCase();

  const depuis = Date.parse(args.depuis ?? '');
  if (!args.depuis) erreurs.push('--depuis manquant (ex. 2026-06-01)');
  else if (Number.isNaN(depuis)) erreurs.push(`--depuis "${args.depuis}" n’est pas une date valide`);
  else o.depuisMs = depuis;

  o.jusquaMs = args.jusqua ? Date.parse(args.jusqua) : Date.now();
  if (args.jusqua && Number.isNaN(o.jusquaMs)) erreurs.push(`--jusqua "${args.jusqua}" n’est pas une date valide`);
  else if (o.depuisMs && o.jusquaMs <= o.depuisMs) erreurs.push('--jusqua doit être postérieur à --depuis');

  for (const [cle, option] of [['utBiais', '--ut-biais'], ['utDetection', '--ut-detection'], ['utResolution', '--ut-resolution']]) {
    if (args[cle] !== undefined) {
      if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue (${Object.keys(UNITES).join(', ')})`);
      else o[cle] = args[cle];
    }
  }

  if (args.fenetre !== undefined) {
    const n = Number(args.fenetre);
    if (!Number.isInteger(n) || n < 1) erreurs.push('--fenetre doit être un entier positif');
    else o.fenetre = n;
  }

  if (args.horizonHeures !== undefined) {
    const n = Number(args.horizonHeures);
    if (!Number.isFinite(n) || n <= 0) erreurs.push('--horizon-heures doit être positif');
    else o.horizonHeures = n;
  }

  o.sansFiltreBiais = Boolean(args.sansFiltreBiais);
  o.baseUrl = typeof args.baseUrl === 'string' ? args.baseUrl : undefined;

  if (dureeUnite(o.utResolution) >= dureeUnite(o.utDetection)) {
    erreurs.push(`--ut-resolution (${o.utResolution}) doit être plus fine que --ut-detection (${o.utDetection}), sinon toute issue devient ambiguë.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/** Applique le filtre de biais et résout chaque order block. */
export function evaluer({ orderBlocks, bougiesDetection, serieBiais, bougiesResolution, horizonBougies, sansFiltreBiais }) {
  const resultats = [];

  for (const ob of orderBlocks) {
    const biais = tendanceA(serieBiais, ob.ms);
    const aligne = biais === ob.sens;
    if (!sansFiltreBiais && !aligne) continue;

    // Le prix ne peut revenir chercher l'order block qu'après la cassure.
    const depart = bougiesResolution.findIndex((b) => b.ouvertureMs >= ob.valideAPartirDeMs);
    if (depart === -1) continue;

    const suite = bougiesResolution.slice(depart, depart + horizonBougies);
    const { statut, detail } = resoudreIssue({ plan: ob.plan, bougies: suite, horizonBougies });

    resultats.push({
      ms: ob.ms, sens: ob.sens, typeCassure: ob.typeCassure, biais, aligne,
      plan: ob.plan, statut, detail,
      volume: anomalieVolume(bougiesDetection, ob.index, 20),
    });
  }

  return resultats;
}

export function agreger(resultats, coutEnR) {
  const parStatut = {};
  for (const r of resultats) parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;

  const tranchees = resultats.filter((r) => compteDansLesStats(r.statut));
  const gagnants = tranchees.filter((r) => estGagnant(r.statut));

  const intervalle = intervalleWilson(gagnants.length, tranchees.length);
  const ambigus = parStatut.ambigu || 0;

  return {
    total: resultats.length,
    parStatut,
    tranchees: tranchees.length,
    gagnants: gagnants.length,
    intervalle,
    conclusion: conclusionPossible(intervalle),
    tauxAmbiguite: resultats.length ? ambigus / resultats.length : 0,
    // Les objectifs sont posés à 1 R : le ratio moyen des gagnants vaut donc
    // 1 pour un tp1 et 2 pour un tp2.
    esperance: esperanceEnR({
      gagnants: gagnants.length,
      perdants: tranchees.length - gagnants.length,
      ratioMoyen: gagnants.length
        ? gagnants.reduce((a, r) => a + (r.statut === 'tp2' ? 2 : 1), 0) / gagnants.length
        : 1,
      coutEnR,
    }),
  };
}

function afficherBloc(titre, agr, coutEnR) {
  console.log(`\n--- ${titre} ---\n`);

  if (!agr.total) { console.log('  aucun order block retenu\n'); return; }

  console.log(`  order blocks retenus  ${agr.total}`);
  for (const [s, n] of Object.entries(agr.parStatut).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(16)} ${String(n).padStart(5)}  ${compteDansLesStats(s) ? '' : '(hors statistiques)'}`);
  }

  if (!agr.intervalle) { console.log('\n  aucune issue tranchée\n'); return; }

  const i = agr.intervalle;
  console.log(`\n  atteint 1 R avant le stop  ${(i.proportion * 100).toFixed(1)} %  (${i.succes}/${i.total})`);
  console.log(`  intervalle de confiance    [${(i.bas * 100).toFixed(1)} %, ${(i.haut * 100).toFixed(1)} %]`);
  console.log(`  espérance par trade        ${agr.esperance} R  (coûts ${coutEnR} R inclus)`);

  if (!agr.conclusion.possible) console.log(`  ⚠  ${agr.conclusion.raison}`);
  if (agr.tauxAmbiguite > 0.15) {
    console.log(`  ⚠  ${(agr.tauxAmbiguite * 100).toFixed(0)} % d'issues ambiguës — resserre --ut-resolution`);
  }
  console.log('');
}

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01\n');
    process.exit(1);
  }

  if (o.baseUrl) {
    console.log('\n' + '='.repeat(70));
    console.log("  DONNÉES NON BINANCE — source remplacée par --base-url.");
    console.log('  Les chiffres ci-dessous ne décrivent pas le marché réel et');
    console.log("  n'ont aucune valeur de mesure. Usage de test uniquement.");
    console.log('='.repeat(70));
  }

  console.log(`\n${o.symbole}  du ${iso(o.depuisMs)} au ${iso(o.jusquaMs)}`);
  console.log(`  biais ${o.utBiais}  ·  détection ${o.utDetection}  ·  résolution ${o.utResolution}`);
  console.log(`  pivots sur ${o.fenetre} bougies  ·  horizon ${o.horizonHeures} h  ·  coûts ${o.coutEnR} R`);
  if (o.sansFiltreBiais) console.log('  filtre de biais DÉSACTIVÉ');

  const plan = ['utBiais', 'utDetection', 'utResolution'].map((k) => ({
    unite: o[k], ...nombreDeRequetes({ unite: o[k], depuisMs: o.depuisMs, jusquaMs: o.jusquaMs }),
  }));
  const total = plan.reduce((a, p) => a + p.requetes, 0);
  console.log(`\n  ${plan.map((p) => `${p.unite}: ${p.bougies} bougies`).join('  ·  ')}`);
  console.log(`  ${total} requêtes à envoyer\n`);

  const charger = async (unite) => {
    process.stdout.write(`  ${unite}… `);
    const bs = await recuperer({ symbole: o.symbole, unite, depuisMs: o.depuisMs, jusquaMs: o.jusquaMs, baseUrl: o.baseUrl });
    console.log(`${bs.length} bougies`);
    return bs;
  };

  let biaisBougies, detectionBougies, resolutionBougies;
  try {
    biaisBougies = await charger(o.utBiais);
    detectionBougies = await charger(o.utDetection);
    resolutionBougies = await charger(o.utResolution);
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  if (!detectionBougies.length) { console.error('\nAucune bougie de détection.\n'); process.exit(2); }

  const serieBiais = tendanceAuFilDuTemps(cassures(biaisBougies, o.fenetre));
  const evenements = cassures(detectionBougies, o.fenetre);
  const orderBlocks = detecter(detectionBougies, evenements);

  console.log(`\n  cassures ${o.utBiais}: ${serieBiais.length}  ·  cassures ${o.utDetection}: ${evenements.length}  ·  order blocks: ${orderBlocks.length}`);

  const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.utResolution));
  const resultats = evaluer({
    orderBlocks, bougiesDetection: detectionBougies, serieBiais,
    bougiesResolution: resolutionBougies, horizonBougies, sansFiltreBiais: o.sansFiltreBiais,
  });

  console.log(`  retenus après filtre de biais: ${resultats.length}`);

  // Découpage imposé : réglage sur la première moitié, vérification sur la
  // seconde, jamais l'inverse.
  const milieu = o.depuisMs + (o.jusquaMs - o.depuisMs) / 2;
  const premiere = resultats.filter((r) => r.ms < milieu);
  const seconde = resultats.filter((r) => r.ms >= milieu);

  console.log('\n=== Résultats ===');
  afficherBloc('Ensemble de la période', agreger(resultats, o.coutEnR), o.coutEnR);
  afficherBloc(`Première moitié — jusqu'au ${iso(milieu)} (mise au point)`, agreger(premiere, o.coutEnR), o.coutEnR);
  afficherBloc(`Seconde moitié — à partir du ${iso(milieu)} (vérification)`, agreger(seconde, o.coutEnR), o.coutEnR);

  if (o.baseUrl) {
    console.log('RAPPEL : données non Binance, ces chiffres ne mesurent rien.\n');
  }

  console.log('Lecture :');
  console.log('  Seule la seconde moitié a valeur de preuve. Si elle diffère nettement');
  console.log('  de la première, le réglage décrit le passé et non le marché.');
  console.log('  Un intervalle large signifie « on ne sait pas », pas « c’est autour de ».\n');
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
