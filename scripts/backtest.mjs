// Mesure la fréquence d'aboutissement des order blocks sur l'historique.
//
//   node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01
//   node scripts/backtest.mjs --csv XAUUSD_M1_2025.csv --spread 0.25
//   node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01 --controle 100
//
// Deux sources, une seule chaîne : Binance pour ce qu'il cote, un fichier CSV
// pour le reste — or, forex, indices. Les détecteurs ne savent pas d'où
// viennent les bougies, et n'ont pas à le savoir.
//
// Chaîne : bougies → pivots → cassures de structure → order blocks
// → plan hypothétique par order block → résolution par le MÊME algorithme que
// le journal → fréquence observée avec son intervalle de confiance.
//
// Le découpage en deux moitiés est imposé, pas optionnel. Un réglage mis au
// point sur la totalité d'un historique décrit ce passé-là et rien d'autre ;
// la seconde moitié est la seule chose qui ressemble à l'avenir.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { recuperer, dureeUnite, nombreDeRequetes, UNITES } from '../src/lib/marche/bougies.js';
import { analyser as analyserCsv, agreger as agregerBougies, decrire } from '../src/lib/marche/csv.js';
import { coutEnRDuPlan, distributionDesStops, seuilDeRentabilite } from '../src/lib/marche/couts.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { cassures, tendanceAuFilDuTemps, tendanceA, HAUSSIER, BAISSIER, INDETERMINE } from '../src/lib/marche/structure.js';
import { detecter, anomalieVolume } from '../src/lib/marche/orderblocks.js';
import { intervalleWilson, conclusionPossible, esperanceEnR } from '../src/lib/marche/statistiques.js';
import { resoudreIssue, gainEnR, OBJECTIFS, REMPLISSAGES, reglageObjectif } from '../src/lib/journal/resolve.js';

const DEFAUTS = {
  utBiais: '1h', utDetection: '15m', utResolution: '5m',
  fenetre: 5, horizonHeures: 48, coutEnR: 0.05,
  utCsv: '1m', decalageHeures: 0,
  graine: 1, controlePaquet: 1,
  // Remplissage à la mèche par défaut, pour rester comparable aux mesures
  // antérieures — mais c'est l'hypothèse la plus favorable qui existe.
  remplissage: 'meche',
  // Tenue jusqu'à 2 R par défaut. Toucher 1 R en chemin ne rapporte rien :
  // on n'y était pas sorti.
  objectif: '2r',
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

  o.csv = typeof args.csv === 'string' ? args.csv : undefined;
  if (args.csv === true) erreurs.push('--csv attend un chemin de fichier');

  if (args.symbole) o.symbole = args.symbole.toUpperCase();
  else if (o.csv) o.symbole = basename(o.csv).replace(/\.[^.]+$/, '').toUpperCase();
  else erreurs.push('--symbole manquant (ex. BTCUSDT)');

  // Avec un fichier, les bornes sont celles des données : --depuis et --jusqua
  // ne servent plus qu'à restreindre, et rien n'oblige à les fournir.
  const depuis = Date.parse(args.depuis ?? '');
  if (!args.depuis) { if (!o.csv) erreurs.push('--depuis manquant (ex. 2026-06-01)'); }
  else if (Number.isNaN(depuis)) erreurs.push(`--depuis "${args.depuis}" n’est pas une date valide`);
  else o.depuisMs = depuis;

  if (args.jusqua) {
    o.jusquaMs = Date.parse(args.jusqua);
    if (Number.isNaN(o.jusquaMs)) erreurs.push(`--jusqua "${args.jusqua}" n’est pas une date valide`);
  } else if (!o.csv) {
    o.jusquaMs = Date.now();
  }

  if (o.depuisMs && o.jusquaMs && o.jusquaMs <= o.depuisMs) {
    erreurs.push('--jusqua doit être postérieur à --depuis');
  }

  if (args.utCsv !== undefined) {
    if (!UNITES[args.utCsv]) erreurs.push(`--ut-csv "${args.utCsv}" inconnue (${Object.keys(UNITES).join(', ')})`);
    else o.utCsv = args.utCsv;
  }

  // HistData horodate en EST sans heure d'été : --decalage-heures -5 ramène en
  // UTC. Une erreur ici décale toute la série sans jamais lever d'exception,
  // d'où le contrôle strict.
  if (args.decalageHeures !== undefined) {
    const n = Number(args.decalageHeures);
    if (!Number.isFinite(n) || Math.abs(n) > 14) erreurs.push('--decalage-heures doit être un nombre d’heures entre -14 et 14');
    else o.decalageHeures = n;
  }

  for (const [cle, option] of [['spread', '--spread'], ['commission', '--commission']]) {
    if (args[cle] === undefined) continue;
    const n = Number(args[cle]);
    if (!Number.isFinite(n) || n < 0) erreurs.push(`${option} doit être un nombre positif, en unités de prix`);
    else o[cle] = n;
  }

  if (args.coutEnR !== undefined) {
    const n = Number(args.coutEnR);
    if (!Number.isFinite(n) || n < 0) erreurs.push('--cout-en-r doit être un nombre positif');
    else o.coutEnR = n;
  }

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

  if (args.controle !== undefined) {
    const n = args.controle === true ? 100 : Number(args.controle);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) erreurs.push('--controle doit être un entier entre 1 et 10000 (défaut 100)');
    else o.controle = n;
  }

  if (args.graine !== undefined) {
    const n = Number(args.graine);
    if (!Number.isInteger(n) || n < 0) erreurs.push('--graine doit être un entier positif');
    else o.graine = n;
  }

  if (args.controlePaquet !== undefined) {
    const n = Number(args.controlePaquet);
    if (!Number.isInteger(n) || n < 1) erreurs.push('--controle-paquet doit être un entier positif');
    else o.controlePaquet = n;
  }

  if (args.objectif !== undefined) {
    if (!OBJECTIFS[args.objectif]) erreurs.push(`--objectif "${args.objectif}" inconnu (${Object.keys(OBJECTIFS).join(', ')})`);
    else o.objectif = args.objectif;
  }

  if (args.remplissage !== undefined) {
    if (!REMPLISSAGES.includes(args.remplissage)) erreurs.push(`--remplissage "${args.remplissage}" inconnu (${REMPLISSAGES.join(', ')})`);
    else o.remplissage = args.remplissage;
  }

  o.sansFiltreBiais = Boolean(args.sansFiltreBiais);
  o.baseUrl = typeof args.baseUrl === 'string' ? args.baseUrl : undefined;
  if (o.csv && o.baseUrl) erreurs.push('--csv et --base-url désignent deux sources : choisis-en une.');

  if (dureeUnite(o.utResolution) >= dureeUnite(o.utDetection)) {
    erreurs.push(`--ut-resolution (${o.utResolution}) doit être plus fine que --ut-detection (${o.utDetection}), sinon toute issue devient ambiguë.`);
  }

  // On agrège, on ne subdivise jamais : un fichier 15 minutes ne produira pas
  // de bougies 5 minutes, et prétendre le contraire inventerait des prix.
  if (o.csv && dureeUnite(o.utCsv) > dureeUnite(o.utResolution)) {
    erreurs.push(`--ut-csv (${o.utCsv}) est plus grossière que --ut-resolution (${o.utResolution}) : il faudrait fabriquer des bougies qui n’existent pas dans le fichier.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/** Applique le filtre de biais et résout chaque order block. */
export function evaluer({ orderBlocks, bougiesDetection, serieBiais, bougiesResolution, horizonBougies, sansFiltreBiais, objectif, remplissage, spread = 0, commission = 0 }) {
  const resultats = [];

  for (const ob of orderBlocks) {
    // Le biais s'apprécie à l'instant où l'on pourrait agir — la cassure
    // connue — et non à la formation de l'order block, antérieure.
    const biais = tendanceA(serieBiais, ob.valideAPartirDeMs);
    const aligne = biais === ob.sens;
    if (!sansFiltreBiais && !aligne) continue;

    // Le prix ne peut revenir chercher l'order block qu'après la cassure.
    const depart = bougiesResolution.findIndex((b) => b.ouvertureMs >= ob.valideAPartirDeMs);
    if (depart === -1) continue;

    const suite = bougiesResolution.slice(depart, depart + horizonBougies);
    const { statut, detail } = resoudreIssue({ plan: ob.plan, bougies: suite, horizonBougies, objectif, remplissage });

    resultats.push({
      ms: ob.ms, sens: ob.sens, typeCassure: ob.typeCassure, biais, aligne,
      plan: ob.plan, statut, detail,
      volume: anomalieVolume(bougiesDetection, ob.index, 20),
      // Le coût dépend du plan : un stop serré paie le même spread sur un
      // risque plus petit, donc plus cher en R. Il se calcule ici, trade par
      // trade, et non en moyenne à la fin.
      coutEnR: spread || commission ? coutEnRDuPlan(ob.plan, { spread, commission }) : null,
    });
  }

  return resultats;
}

/**
 * La chaîne entière depuis une seule série fine.
 *
 * Le contrôle par permutation exige que le réel et le hasard passent par
 * exactement le même chemin — y compris l'agrégation. Deux chemins distincts
 * introduiraient une différence sans rapport avec ce qu'on mesure.
 */
export function chaine(fines, o) {
  const memeUnite = (unite) => dureeUnite(unite) === dureeUnite(o.uniteFine);
  const vers = (unite) => (memeUnite(unite) ? fines : agregerBougies(fines, unite));

  const biaisBougies = vers(o.utBiais);
  const detectionBougies = vers(o.utDetection);
  const resolutionBougies = vers(o.utResolution);

  const serieBiais = tendanceAuFilDuTemps(cassures(biaisBougies, o.fenetre));
  const evenements = cassures(detectionBougies, o.fenetre);
  const orderBlocks = detecter(detectionBougies, evenements);

  const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.utResolution));
  const resultats = evaluer({
    orderBlocks, bougiesDetection: detectionBougies, serieBiais,
    bougiesResolution: resolutionBougies, horizonBougies, sansFiltreBiais: o.sansFiltreBiais,
    objectif: o.objectif, remplissage: o.remplissage, spread: o.spread ?? 0, commission: o.commission ?? 0,
  });

  return {
    resultats,
    compteurs: {
      cassuresBiais: serieBiais.length,
      cassuresDetection: evenements.length,
      orderBlocks: orderBlocks.length,
    },
  };
}

export function agreger(resultats, coutParDefaut, objectif = '2r') {
  const reglage = reglageObjectif(objectif);
  const parStatut = {};
  for (const r of resultats) parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;

  // Un statut étranger à la règle de sortie ne se compte pas : sous « tenue
  // jusqu'à 2 R » un « tp1 » vient d'une autre règle, et le créditer de 2 R
  // réintroduirait exactement le mélange qu'on vient de supprimer.
  const tranchees = resultats.filter((r) => gainEnR(r.statut, objectif) !== null);
  const gagnants = tranchees.filter((r) => r.statut === reglage.statut);

  const intervalle = intervalleWilson(gagnants.length, tranchees.length);
  const ambigus = parStatut.ambigu || 0;

  // Coût mesuré quand le spread est connu, constante supposée sinon. La
  // moyenne suffit : l'espérance est linéaire en coût.
  const couts = tranchees.map((r) => r.coutEnR).filter((c) => typeof c === 'number');
  const coutEnR = couts.length === tranchees.length && couts.length
    ? Number((couts.reduce((a, c) => a + c, 0) / couts.length).toFixed(4))
    : coutParDefaut;
  const coutMesure = couts.length === tranchees.length && couts.length > 0;

  // Sous une règle de sortie unique, tous les gagnants valent le même
  // multiple : il n'y a plus de ratio moyen à calculer, seulement celui de
  // la règle choisie. C'est le mélange des deux qui fabriquait du rendement.
  const ratioMoyen = reglage.gain;

  return {
    objectif,
    coutEnR,
    coutMesure,
    ratioMoyen,
    seuil: seuilDeRentabilite(ratioMoyen, coutEnR),
    stops: distributionDesStops(tranchees.map((r) => r.plan)),
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
      ratioMoyen,
      coutEnR,
    }),
  };
}

function afficherBloc(titre, agr) {
  console.log(`\n--- ${titre} ---\n`);

  if (!agr.total) { console.log('  aucun order block retenu\n'); return; }

  console.log(`  order blocks retenus  ${agr.total}`);
  for (const [s, n] of Object.entries(agr.parStatut).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(16)} ${String(n).padStart(5)}  ${gainEnR(s, agr.objectif) !== null ? '' : '(hors statistiques)'}`);
  }

  if (!agr.intervalle) { console.log('\n  aucune issue tranchée\n'); return; }

  const i = agr.intervalle;
  console.log(`\n  atteint 1 R avant le stop  ${(i.proportion * 100).toFixed(1)} %  (${i.succes}/${i.total})`);
  console.log(`  intervalle de confiance    [${(i.bas * 100).toFixed(1)} %, ${(i.haut * 100).toFixed(1)} %]`);
  console.log(`  gain d'un trade gagnant    ${agr.ratioMoyen} R  (sortie ${agr.objectif})`);
  console.log(`  coût par trade            ${agr.coutEnR} R  ${agr.coutMesure ? '(mesuré sur le spread)' : '(supposé — donne --spread)'}`);

  if (agr.stops) {
    console.log(`  stop médian               ${agr.stops.medianePrix} (${(agr.stops.medianeRelative * 100).toFixed(3)} % du prix)`);
  }

  // Le chiffre qui tranche : la borne basse de l'intervalle contre le seuil.
  // Au-dessus, le système gagne même dans l'hypothèse défavorable ; entre les
  // deux bornes, on ne sait pas ; au-dessous, il perd.
  if (agr.seuil !== null) {
    const seuilPct = (agr.seuil * 100).toFixed(1);
    const verdict = i.bas > agr.seuil ? '✓ gagnant même au pire de l’intervalle'
      : i.haut < agr.seuil ? '✗ perdant même au mieux de l’intervalle'
      : '— indécidable : le seuil tombe dans l’intervalle';
    console.log(`  seuil de rentabilité      ${seuilPct} %   ${verdict}`);
  }

  console.log(`  espérance par trade        ${agr.esperance} R`);

  if (!agr.conclusion.possible) console.log(`  ⚠  ${agr.conclusion.raison}`);
  if (agr.tauxAmbiguite > 0.15) {
    console.log(`  ⚠  ${(agr.tauxAmbiguite * 100).toFixed(0)} % d'issues ambiguës — resserre --ut-resolution`);
  }
  console.log('');
}

/** Les trois séries depuis Binance, une requête par tranche de 1000 bougies. */
async function chargerBinance(o) {
  o.uniteFine = o.utResolution;

  const charger = async (unite) => {
    process.stdout.write(`  ${unite}… `);
    const bs = await recuperer({ symbole: o.symbole, unite, depuisMs: o.depuisMs, jusquaMs: o.jusquaMs, baseUrl: o.baseUrl });
    console.log(`${bs.length} bougies`);
    return bs;
  };

  // En mode contrôle, seule la série fine est chargée : les unités supérieures
  // en découlent par agrégation exacte, et le hasard doit être tiré sur la même
  // série que le réel.
  if (o.controle) {
    const { requetes } = nombreDeRequetes({ unite: o.utResolution, depuisMs: o.depuisMs, jusquaMs: o.jusquaMs });
    console.log(`\n  ${requetes} requêtes à envoyer (série ${o.utResolution} seule, les autres s'en déduisent)\n`);
    const fines = await charger(o.utResolution);
    return { fines };
  }

  const plan = ['utBiais', 'utDetection', 'utResolution'].map((k) => ({
    unite: o[k], ...nombreDeRequetes({ unite: o[k], depuisMs: o.depuisMs, jusquaMs: o.jusquaMs }),
  }));
  console.log(`\n  ${plan.map((p) => `${p.unite}: ${p.bougies} bougies`).join('  ·  ')}`);
  console.log(`  ${plan.reduce((a, p) => a + p.requetes, 0)} requêtes à envoyer\n`);

  const biaisBougies = await charger(o.utBiais);
  const detectionBougies = await charger(o.utDetection);
  const resolutionBougies = await charger(o.utResolution);
  return { biaisBougies, detectionBougies, resolutionBougies, fines: resolutionBougies };
}

/**
 * Les trois séries depuis un seul fichier, par agrégation.
 *
 * Un fichier 1 minute porte tout ce qu'il faut : les bougies 5 minutes,
 * 15 minutes et 1 heure s'en déduisent exactement. Télécharger trois fichiers
 * exposerait à trois périodes qui ne se recouvrent pas.
 *
 * Fixe au passage `o.depuisMs` et `o.jusquaMs` sur ce que le fichier contient
 * réellement : le découpage en deux moitiés doit porter sur les données, pas
 * sur une intention.
 */
async function chargerFichier(o) {
  o.uniteFine = o.utCsv;
  process.stdout.write(`\n  lecture de ${basename(o.csv)}… `);
  const contenu = await readFile(o.csv, 'utf8');
  const { bougies, volumeExploitable, separateur } = analyserCsv(contenu, {
    unite: o.utCsv, decalageHeures: o.decalageHeures,
  });
  console.log(`${bougies.length} bougies ${o.utCsv} (séparateur "${separateur === '\t' ? '\\t' : separateur}")`);

  const retenues = bougies.filter((b) =>
    (o.depuisMs === undefined || b.ouvertureMs >= o.depuisMs)
    && (o.jusquaMs === undefined || b.ouvertureMs < o.jusquaMs));

  if (!retenues.length) {
    throw new Error(bougies.length
      ? `aucune bougie entre les bornes demandées ; le fichier couvre ${iso(bougies[0].ouvertureMs)} → ${iso(bougies.at(-1).ouvertureMs)}`
      : 'fichier sans bougie exploitable');
  }

  const bornes = decrire(retenues, o.utCsv);
  o.depuisMs = bornes.debutMs;
  o.jusquaMs = bornes.finMs + dureeUnite(o.utCsv);

  // Le forex ferme le week-end : un taux de remplissage autour de 70 % est
  // normal, beaucoup plus bas signale un fichier troué.
  console.log(`  couverture ${(bornes.tauxDeRemplissage * 100).toFixed(1)} % des ${o.utCsv} de la période`);
  if (bornes.tauxDeRemplissage < 0.5) {
    console.log("  ⚠  moins d'une bougie sur deux : vérifie que le fichier est complet");
  }

  if (!volumeExploitable) {
    console.log('  ⚠  fichier sans volume réel — aucune analyse de volume ne sera produite');
  }

  const vers = (unite) => (dureeUnite(unite) === dureeUnite(o.utCsv) ? retenues : agregerBougies(retenues, unite));
  const biaisBougies = vers(o.utBiais);
  const detectionBougies = vers(o.utDetection);
  const resolutionBougies = vers(o.utResolution);

  console.log(`  ${o.utBiais}: ${biaisBougies.length}  ·  ${o.utDetection}: ${detectionBougies.length}  ·  ${o.utResolution}: ${resolutionBougies.length} bougies`);
  return { biaisBougies, detectionBougies, resolutionBougies, fines: retenues };
}

/**
 * Affiche le réel face à la distribution des tirages de contrôle.
 *
 * Un seul chiffre compte vraiment ici : la proportion de tirages qui font
 * aussi bien que le réel SANS RIEN EXPLOITER. Tout le reste est du décor
 * destiné à rendre ce chiffre interprétable.
 */
function afficherControle(reel, controles, o) {
  const ligne = (nom, valeurReelle, echantillon, format) => {
    const d = resumeDistribution(echantillon);
    if (!d) { console.log(`  ${nom.padEnd(22)} ${format(valeurReelle).padStart(9)}   (aucun tirage exploitable)`); return; }
    console.log(
      `  ${nom.padEnd(22)} ${format(valeurReelle).padStart(9)}   ${format(d.mediane).padStart(9)}   `
      + `[${format(d.minimum)} – ${format(d.maximum)}]`,
    );
  };

  const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);
  const enR = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(3)} R`);
  const nb = (v) => String(v ?? '—');

  console.log('\n=== Contrôle par permutation ===\n');
  console.log(`  ${o.controle} tirages · graine ${o.graine} · mélange par paquets de ${o.controlePaquet} bougie${o.controlePaquet > 1 ? 's' : ''}`);
  console.log('  Les mêmes bougies, remises dans un ordre tiré au sort : chaque bougie');
  console.log("  reste elle-même, seule la suite est détruite. Tout ce que la règle tire");
  console.log('  de la structure temporelle doit disparaître.\n');

  console.log(`  ${''.padEnd(22)} ${'réel'.padStart(9)}   ${'médiane'.padStart(9)}   [min – max]`);
  ligne('order blocks', reel.total, controles.map((c) => c.total), nb);
  ligne('issues tranchées', reel.tranchees, controles.map((c) => c.tranchees), nb);
  ligne('taux de réussite', reel.intervalle?.proportion, controles.map((c) => c.intervalle?.proportion), pct);
  ligne('espérance', reel.esperance, controles.map((c) => c.esperance), enR);

  // L'espérance décide, pas le taux : un taux élevé à ratio défavorable perd.
  const pEsperance = valeurP(reel.esperance, controles.map((c) => c.esperance));
  const pTaux = valeurP(reel.intervalle?.proportion, controles.map((c) => c.intervalle?.proportion));

  console.log('');
  if (!pEsperance) {
    console.log('  Aucun tirage n’a produit d’espérance exploitable — période trop courte.');
    return;
  }

  console.log(`  p (espérance)          ${pEsperance.p.toFixed(3)}   ${pEsperance.auMoinsAussiBons}/${pEsperance.tirages} tirages font aussi bien`);
  if (pTaux) console.log(`  p (taux)               ${pTaux.p.toFixed(3)}   ${pTaux.auMoinsAussiBons}/${pTaux.tirages} tirages font aussi bien`);

  console.log('');
  if (pEsperance.p <= 0.05) {
    console.log('  ✓ Le hasard reproduit rarement ce résultat. La règle lit quelque chose');
    console.log('    dans la structure. À confirmer sur une autre période avant d’y croire.');
  } else if (pEsperance.p <= 0.2) {
    console.log('  ~ Indice faible. Le hasard y arrive une fois sur cinq ou mieux : c’est');
    console.log('    trop souvent pour conclure, trop rare pour écarter. Allonge la période.');
  } else {
    console.log('  ✗ Le hasard fait aussi bien sans rien exploiter. En l’état, rien ne');
    console.log('    distingue cette règle d’un tirage au sort sur les mêmes bougies.');
  }

  if (pEsperance.p === pEsperance.plancher) {
    console.log(`\n  ⚠  p est au plancher (1/${pEsperance.tirages + 1}) : aucun tirage n’a fait aussi bien,`);
    console.log('     donc le vrai p est peut-être plus petit. Augmente --controle pour le voir.');
  }
  console.log('');
}

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));

  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemples :');
    console.error('  node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01');
    console.error('  node scripts/backtest.mjs --csv XAUUSD_M1_2025.csv --decalage-heures -5 --spread 0.25');
    console.error('  node scripts/backtest.mjs --symbole BTCUSDT --depuis 2026-06-01 --controle 100\n');
    process.exit(1);
  }

  if (o.baseUrl) {
    console.log('\n' + '='.repeat(70));
    console.log("  DONNÉES NON BINANCE — source remplacée par --base-url.");
    console.log('  Les chiffres ci-dessous ne décrivent pas le marché réel et');
    console.log("  n'ont aucune valeur de mesure. Usage de test uniquement.");
    console.log('='.repeat(70));
  }

  console.log(`\n${o.symbole}  — source ${o.csv ? `fichier ${basename(o.csv)}` : 'Binance'}`);
  console.log(`  biais ${o.utBiais}  ·  détection ${o.utDetection}  ·  résolution ${o.utResolution}`);
  console.log(`  pivots sur ${o.fenetre} bougies  ·  horizon ${o.horizonHeures} h`);
  console.log(`  sortie ${o.objectif === '1r' ? 'ferme à 1 R' : "tenue jusqu'à 2 R"}  ·  seuil hors coûts ${(reglageObjectif(o.objectif).seuil * 100).toFixed(1)} %`);
  if (o.spread || o.commission) console.log(`  spread ${o.spread ?? 0}  ·  commission ${o.commission ?? 0}  (unités de prix, aller-retour)`);
  else console.log(`  coûts ${o.coutEnR} R — valeur supposée, à remplacer par --spread`);
  if (o.sansFiltreBiais) console.log('  filtre de biais DÉSACTIVÉ');

  let biaisBougies, detectionBougies, resolutionBougies, fines;
  try {
    ({ biaisBougies, detectionBougies, resolutionBougies, fines } = o.csv
      ? await chargerFichier(o)
      : await chargerBinance(o));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  if (o.controle) {
    if (!fines.length) { console.error('\nAucune bougie.\n'); process.exit(2); }

    const reel = chaine(fines, o);
    console.log(`\n  order blocks (réel): ${reel.compteurs.orderBlocks}  ·  retenus après filtre: ${reel.resultats.length}`);

    process.stdout.write(`  ${o.controle} tirages de contrôle… `);
    const alea = generateurAleatoire(o.graine);
    const controles = [];
    for (let i = 0; i < o.controle; i++) {
      const melangee = melangerBougies(fines, alea, o.controlePaquet);
      controles.push(agreger(chaine(melangee, o).resultats, o.coutEnR, o.objectif));
      if ((i + 1) % 10 === 0) process.stdout.write('.');
    }
    console.log(' terminé');

    const agrege = agreger(reel.resultats, o.coutEnR, o.objectif);
    afficherBloc('Réel — ensemble de la période', agrege);
    afficherControle(agrege, controles, o);
    return;
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
    objectif: o.objectif, remplissage: o.remplissage, spread: o.spread ?? 0, commission: o.commission ?? 0,
  });

  console.log(`  retenus après filtre de biais: ${resultats.length}`);

  // Découpage imposé : réglage sur la première moitié, vérification sur la
  // seconde, jamais l'inverse.
  const milieu = o.depuisMs + (o.jusquaMs - o.depuisMs) / 2;
  console.log(`  période couverte: ${iso(o.depuisMs)} → ${iso(o.jusquaMs)}`);
  const premiere = resultats.filter((r) => r.ms < milieu);
  const seconde = resultats.filter((r) => r.ms >= milieu);

  console.log('\n=== Résultats ===');
  afficherBloc('Ensemble de la période', agreger(resultats, o.coutEnR, o.objectif));
  afficherBloc(`Première moitié — jusqu'au ${iso(milieu)} (mise au point)`, agreger(premiere, o.coutEnR, o.objectif));
  afficherBloc(`Seconde moitié — à partir du ${iso(milieu)} (vérification)`, agreger(seconde, o.coutEnR, o.objectif));

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
