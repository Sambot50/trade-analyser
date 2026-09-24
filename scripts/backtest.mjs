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

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { recuperer, dureeUnite, nombreDeRequetes, UNITES } from '../src/lib/marche/bougies.js';
import { analyser as analyserCsv, agreger as agregerBougies, decrire } from '../src/lib/marche/csv.js';
import { coutEnRDuPlan, distributionDesStops, seuilDeRentabilite } from '../src/lib/marche/couts.js';
import { generateurAleatoire, melangerBougies, valeurP, resumeDistribution } from '../src/lib/marche/controle.js';
import { decouperParContrat, minimumPourResoudre } from '../src/lib/marche/contrats.js';
import { qualifier } from '../src/lib/marche/qualificatifs.js';
import { calculerExcursions, enUnitesDeRisque } from '../src/lib/journal/excursion.js';
import { cassures, tendanceAuFilDuTemps, tendanceA, HAUSSIER, BAISSIER, INDETERMINE } from '../src/lib/marche/structure.js';
import { detecterEnDetail, anomalieVolume } from '../src/lib/marche/orderblocks.js';
import { intervalleWilson, conclusionPossible, esperanceEnR } from '../src/lib/marche/statistiques.js';
import { resoudreIssue, gainEnR, OBJECTIFS, REMPLISSAGES, TRAITEMENTS_AMBIGU, reglageObjectif } from '../src/lib/journal/resolve.js';

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
  // Exclues par défaut : le résolveur ne sait pas l'ordre, et deviner
  // flatterait la mesure. Mais exclure est aussi une décision — d'où les deux
  // autres traitements, qui encadrent la vérité.
  ambigu: 'exclu',
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

  if (args.ambigu !== undefined) {
    if (!TRAITEMENTS_AMBIGU.includes(args.ambigu)) erreurs.push(`--ambigu "${args.ambigu}" inconnu (${TRAITEMENTS_AMBIGU.join(', ')})`);
    else o.ambigu = args.ambigu;
  }

  if (args.export !== undefined) {
    if (typeof args.export !== 'string') erreurs.push('--export attend un chemin de fichier');
    else o.export = args.export;
  }

  // Le critère de volume : ce qui fait qu'une bougie d'origine mérite le nom
  // d'order block. Inactif tant qu'aucun seuil n'est posé, pour que les
  // mesures antérieures restent comparables.
  const SEUILS_VOLUME = [
    { option: '--volume-minimum', arg: 'volumeMinimum', champ: 'rapportMinimum', plancher: 0 },
    { option: '--volume-ecarts-types', arg: 'volumeEcartsTypes', champ: 'ecartsTypesMinimum', plancher: -10 },
    { option: '--volume-absorption', arg: 'volumeAbsorption', champ: 'absorptionMinimum', plancher: -10 },
  ];
  for (const { option, arg, champ, plancher } of SEUILS_VOLUME) {
    if (args[arg] === undefined) continue;
    const n = Number(args[arg]);
    if (!Number.isFinite(n) || n < plancher) { erreurs.push(`${option} attend un nombre ≥ ${plancher}`); continue; }
    o.volume = { ...(o.volume ?? {}), [champ]: n };
  }

  if (args.volumeFenetre !== undefined) {
    const n = Number(args.volumeFenetre);
    if (!Number.isInteger(n) || n < 5) erreurs.push('--volume-fenetre attend un entier ≥ 5');
    else o.volume = { ...(o.volume ?? {}), fenetre: n };
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

    // Amplitudes maximales, en unités de risque, rapportées au prix
    // RÉELLEMENT obtenu : c'est ce qui distingue « le stop était trop serré »
    // de « la lecture était fausse ». Le module existait depuis le premier
    // jour sans que le backtest l'appelle.
    const planReel = { ...ob.plan, prixEntree: detail.prixEntreeReel ?? ob.plan.prixEntree };
    const iDeclenchement = detail.declencheLe === null || detail.declencheLe === undefined
      ? -1
      : suite.findIndex((b) => b.ouvertureMs === detail.declencheLe);
    const excursions = iDeclenchement >= 0
      ? enUnitesDeRisque(
          calculerExcursions(planReel, suite.slice(iDeclenchement, detail.bougiesExaminees)),
          planReel,
        )
      : null;

    resultats.push({
      ms: ob.ms, sens: ob.sens, typeCassure: ob.typeCassure, biais, aligne,
      plan: ob.plan, statut, detail, excursions,
      qualificatifs: qualifier(bougiesDetection, ob),
      delaiEntreeMs: detail.declencheLe ? detail.declencheLe - ob.valideAPartirDeMs : null,
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
/**
 * La chaîne entière sur UN segment homogène — un seul contrat, ou une série
 * qui n'en nomme aucun.
 */
function chaineDUnSegment(fines, o) {
  const memeUnite = (unite) => dureeUnite(unite) === dureeUnite(o.uniteFine);
  const vers = (unite) => (memeUnite(unite) ? fines : agregerBougies(fines, unite));

  const biaisBougies = vers(o.utBiais);
  const detectionBougies = vers(o.utDetection);
  const resolutionBougies = vers(o.utResolution);

  const serieBiais = tendanceAuFilDuTemps(cassures(biaisBougies, o.fenetre));
  const evenements = cassures(detectionBougies, o.fenetre);
  const { retenus: orderBlocks, rejetes } = detecterEnDetail(detectionBougies, evenements, { volume: o.volume });

  const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.utResolution));
  const resultats = evaluer({
    orderBlocks, bougiesDetection: detectionBougies, serieBiais,
    bougiesResolution: resolutionBougies, horizonBougies, sansFiltreBiais: o.sansFiltreBiais,
    objectif: o.objectif, remplissage: o.remplissage, spread: o.spread ?? 0, commission: o.commission ?? 0,
  });

  return {
    resultats,
    retenus: orderBlocks,
    rejetes,
    compteurs: {
      cassuresBiais: serieBiais.length,
      cassuresDetection: evenements.length,
      orderBlocks: orderBlocks.length,
      rejetesVolume: rejetes.length,
    },
  };
}

/**
 * La chaîne entière depuis une seule série fine, contrat par contrat.
 *
 * **Aucun recollage.** Les futures expirent ; le passage d'un contrat au
 * suivant crée un saut de prix qui n'est pas un mouvement de marché, et que le
 * détecteur lirait comme un déplacement suivi d'une cassure de structure. On
 * mesure chaque contrat séparément et on met les issues en commun. Voir
 * DEC-027 et `contrats.js`.
 *
 * Une série sans contrat nommé — Binance, HistData, un CSV de CFD — donne un
 * segment unique et se comporte exactement comme avant.
 *
 * L'agrégation se fait DANS chaque segment, jamais au travers : une bougie
 * 1 heure à cheval sur un roulement mélangerait les prix de deux contrats.
 * Elle devient deux bougies tronquées, une par contrat, ce qui est la vérité.
 *
 * Le contrôle par permutation exige que le réel et le hasard passent par
 * exactement le même chemin — y compris ce découpage. Comme le contrat est une
 * propriété de l'instant et non de la forme de la bougie, les frontières
 * tombent au même endroit dans les deux cas.
 */
export function chaine(fines, o) {
  const minimumBougies = minimumPourResoudre({
    fenetre: o.fenetre,
    dureeDetectionMs: dureeUnite(o.utDetection),
    horizonHeures: o.horizonHeures,
    dureeFineMs: dureeUnite(o.uniteFine),
  });

  const { segments, ecartes } = decouperParContrat(fines, { minimumBougies });

  const resultats = [];
  const retenus = [];
  const rejetes = [];
  const compteurs = { cassuresBiais: 0, cassuresDetection: 0, orderBlocks: 0, rejetesVolume: 0 };

  for (const segment of segments) {
    const r = chaineDUnSegment(segment.bougies, o);
    resultats.push(...r.resultats);
    retenus.push(...r.retenus);
    rejetes.push(...r.rejetes);
    for (const cle of Object.keys(compteurs)) compteurs[cle] += r.compteurs[cle];
  }

  // Les segments sont chronologiques entre eux, mais le découpage en deux
  // moitiés et l'export attendent un ordre global.
  resultats.sort((a, b) => a.ms - b.ms);

  return { resultats, retenus, rejetes, compteurs, segments, ecartes };
}

/**
 * Médianes des amplitudes maximales, en unités de risque.
 *
 * Le diagnostic qui sépare deux diagnostics très différents. Faveur ≈ contre :
 * le point d'entrée ne porte aucune information et il n'y a rien à régler.
 * Faveur > contre : l'information existe et c'est la géométrie du plan qui la
 * détruit — la distribution dit alors où poser stop et objectif.
 */
export function medianesExcursions(resultats) {
  const faveurs = resultats.map((r) => r.excursions?.faveurEnR).filter((v) => typeof v === 'number');
  const contres = resultats.map((r) => r.excursions?.contreEnR).filter((v) => typeof v === 'number');
  if (!faveurs.length || !contres.length) return null;

  return {
    nombre: faveurs.length,
    faveurMediane: mediane(faveurs),
    contreMediane: mediane(contres),
    // Au-dessus de 1, le prix va plus loin en faveur qu'à l'encontre.
    rapport: Number((mediane(faveurs) / (mediane(contres) || 1)).toFixed(3)),
  };
}

function mediane(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  const m = tri.length % 2 ? tri[milieu] : (tri[milieu - 1] + tri[milieu]) / 2;
  return Number(m.toFixed(3));
}

export function agreger(resultats, coutParDefaut, objectif = '2r', ambigu = 'exclu') {
  const reglage = reglageObjectif(objectif);
  const parStatut = {};
  for (const r of resultats) parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;

  // Un statut étranger à la règle de sortie ne se compte pas : sous « tenue
  // jusqu'à 2 R » un « tp1 » vient d'une autre règle, et le créditer de 2 R
  // réintroduirait exactement le mélange qu'on vient de supprimer.
  const tranchees = resultats.filter((r) => gainEnR(r.statut, objectif, ambigu) !== null);
  const gagnants = tranchees.filter((r) => gainEnR(r.statut, objectif, ambigu) > 0);

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
    ambigu,
    coutEnR,
    coutMesure,
    ratioMoyen,
    seuil: seuilDeRentabilite(ratioMoyen, coutEnR),
    stops: distributionDesStops(tranchees.map((r) => r.plan)),
    excursions: medianesExcursions(tranchees),
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
    console.log(`    ${s.padEnd(16)} ${String(n).padStart(5)}  ${gainEnR(s, agr.objectif, agr.ambigu) !== null ? '' : '(hors statistiques)'}`);
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

  if (agr.excursions) {
    const e = agr.excursions;
    console.log(`  amplitude max en faveur   ${e.faveurMediane} R   (médiane sur ${e.nombre} trades)`);
    console.log(`  amplitude max contre      ${e.contreMediane} R`);
    console.log(`  rapport faveur / contre   ${e.rapport}${e.rapport > 1.15 ? "   ← le prix va plus loin en faveur : géométrie à revoir" : ''}`);
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
  if (agr.ambigu === 'exclu' && agr.tauxAmbiguite > 0.15) {
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

/**
 * Un enregistrement par order block, en JSONL.
 *
 * Le backtest agrégeait puis jetait les cas individuels. Les qualificatifs
 * existaient sans que rien ne les croise avec l'issue : la consigne « mesurer
 * d'abord, filtrer ensuite » n'avait jamais atteint son second temps.
 *
 * Format de journal, une ligne indépendante par cas, pour qu'un agent comme un
 * tableur puisse le lire sans connaître le code qui l'a produit.
 */
async function ecrireExport(chemin, resultats, o) {
  const lignes = resultats.map((r) => JSON.stringify({
    horodatage: new Date(r.ms).toISOString(),
    ms: r.ms,
    symbole: o.symbole,
    utDetection: o.utDetection,
    objectif: o.objectif,
    remplissage: o.remplissage,

    sens: r.sens,
    typeCassure: r.typeCassure,
    biais: r.biais,
    aligne: r.aligne,

    statut: r.statut,
    gainEnR: gainEnR(r.statut, o.objectif, o.ambigu),
    coutEnR: r.coutEnR,
    delaiEntreeMs: r.delaiEntreeMs,
    prixEntreePlan: r.plan.prixEntree,
    prixEntreeReel: r.detail?.prixEntreeReel ?? null,
    prixStopLoss: r.plan.prixStopLoss,
    risque: r.plan.risque,
    risqueRelatif: r.plan.prixEntree ? Number((r.plan.risque / Math.abs(r.plan.prixEntree)).toFixed(6)) : null,

    faveurMaxEnR: r.excursions?.faveurEnR ?? null,
    contreMaxEnR: r.excursions?.contreEnR ?? null,

    volumeEcartsTypes: r.volume?.ecartsTypes ?? null,
    volumeRapporteALaMoyenne: r.volume?.volumeRapporteALaMoyenne ?? null,
    deltaRapporteAuMoyen: r.volume?.deltaRapporteAuMoyen ?? null,

    ...r.qualificatifs,
  }));

  await writeFile(chemin, lignes.join('\n') + '\n', 'utf8');
  console.log(`\n  ${lignes.length} enregistrements écrits dans ${chemin}`);
  console.log('  Une ligne JSON par order block, qualificatifs et issue compris.');
}

/**
 * Les contrats détectés, et ceux écartés faute de place.
 *
 * Le chiffre à regarder est le NOMBRE de contrats. Un seul, sur deux ans de
 * futures, signifierait que le découpage n'a pas fonctionné — et que la
 * mesure porte sur une série recollée, ce que DEC-027 interdit.
 */
function afficherContrats(segments, ecartes) {
  const nommes = segments.filter((s) => s.symbole !== null).length + (ecartes?.length ?? 0);
  if (!nommes) return;

  console.log(`\n  ${segments.length} contrats mesurés séparément, sans aucun recollage`);
  for (const s of segments) {
    console.log(`    ${String(s.symbole).padEnd(10)} ${String(s.nombre).padStart(7)} bougies   ${iso(s.debutMs)} → ${iso(s.finMs)}`);
  }
  if (ecartes?.length) {
    const total = ecartes.reduce((n, e) => n + e.nombre, 0);
    console.log(`    ${ecartes.length} segment(s) écarté(s), ${total} bougies — trop courts pour héberger un order block résoluble`);
  }
}

/** Le critère de volume en une ligne lisible, pour l'en-tête. */
function decrireCritereVolume(v) {
  const morceaux = [];
  if (v.rapportMinimum !== undefined) morceaux.push(`≥ ${v.rapportMinimum}× la moyenne`);
  if (v.ecartsTypesMinimum !== undefined) morceaux.push(`≥ ${v.ecartsTypesMinimum} écarts-types`);
  if (v.absorptionMinimum !== undefined) morceaux.push(`absorption ≥ ${v.absorptionMinimum}`);
  if (!morceaux.length) return 'aucun seuil posé (critère sans effet)';
  return `${morceaux.join(', ')} sur ${v.fenetre ?? 20} bougies`;
}

/**
 * La distribution du volume des order blocks détectés.
 *
 * C'est le seul moyen honnête de poser un seuil : l'agrégation écrase la
 * variance du volume, et le rapport à la moyenne qui s'étale de 0,3 à 3,4 en
 * bougies 1 minute tient dans 0,9–1,1 en bougies 1 heure. Un seuil transposé
 * d'une échelle à l'autre ne filtre pas, il rejette tout.
 */
function afficherDistributionVolume(retenus, rejetes) {
  const mesures = [
    ...retenus.map((r) => r.volumeMesure),
    ...rejetes.map((r) => r.mesure),
  ].filter(Boolean);

  const rapports = mesures.map((m) => m.volumeRapporteALaMoyenne).filter(Number.isFinite).sort((a, b) => a - b);
  if (rapports.length < 8) return;

  const q = (part) => rapports[Math.floor(part * (rapports.length - 1))];
  console.log(`\n  volume des order blocks, en multiples de la moyenne des ${rapports.length} candidats :`);
  console.log(`    min ${q(0).toFixed(2)}  ·  q1 ${q(0.25).toFixed(2)}  ·  médiane ${q(0.5).toFixed(2)}`
    + `  ·  q3 ${q(0.75).toFixed(2)}  ·  max ${q(1).toFixed(2)}`);

  const survivants = [1.1, 1.25, 1.5, 2, 3]
    .map((seuil) => `${seuil}× → ${rapports.filter((r) => r >= seuil).length}`)
    .join('   ');
  console.log(`    combien survivraient : ${survivants}`);
}

/**
 * Ce que le critère a écarté, et pourquoi.
 *
 * Un filtre dont on ne voit que ce qui passe n'est pas réglable. Les trois
 * motifs les plus fréquents suffisent à savoir si le seuil est trop haut ou si
 * c'est la donnée qui manque.
 */
function afficherRejets(retenus, rejetes) {
  if (!rejetes?.length) { console.log('  aucun candidat écarté par le volume'); return; }

  const total = retenus + rejetes.length;
  const part = ((rejetes.length / total) * 100).toFixed(1);
  console.log(`  écartés par le volume: ${rejetes.length} sur ${total} candidats (${part} %)`);

  const motifs = new Map();
  for (const r of rejetes) {
    // Le chiffre change d'un rejet à l'autre ; c'est le motif qu'on compte.
    const cle = r.raison.replace(/-?[\d.]+/g, 'N');
    motifs.set(cle, (motifs.get(cle) ?? 0) + 1);
  }
  for (const [motif, n] of [...motifs].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    console.log(`    ${String(n).padStart(5)}  ${motif}`);
  }
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
  if (o.volume) console.log(`  order block validé par le volume — ${decrireCritereVolume(o.volume)}`);

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

    let reel;
    try {
      reel = chaine(fines, o);
    } catch (err) {
      console.error(`\nÉchec : ${err.message}\n`);
      process.exit(2);
    }
    console.log(`\n  order blocks (réel): ${reel.compteurs.orderBlocks}  ·  retenus après filtre: ${reel.resultats.length}`);
    afficherContrats(reel.segments, reel.ecartes);
    if (o.volume) afficherRejets(reel.compteurs.orderBlocks, reel.rejetes);
    afficherDistributionVolume(reel.retenus ?? [], reel.rejetes ?? []);

    process.stdout.write(`  ${o.controle} tirages de contrôle… `);
    const alea = generateurAleatoire(o.graine);
    const controles = [];
    for (let i = 0; i < o.controle; i++) {
      const melangee = melangerBougies(fines, alea, o.controlePaquet);
      controles.push(agreger(chaine(melangee, o).resultats, o.coutEnR, o.objectif, o.ambigu));
      if ((i + 1) % 10 === 0) process.stdout.write('.');
    }
    console.log(' terminé');

    const agrege = agreger(reel.resultats, o.coutEnR, o.objectif, o.ambigu);
    afficherBloc('Réel — ensemble de la période', agrege);
    afficherControle(agrege, controles, o);
    if (o.export) await ecrireExport(o.export, reel.resultats, o);
    return;
  }

  if (!detectionBougies.length) { console.error('\nAucune bougie de détection.\n'); process.exit(2); }

  // Un fichier passe par `chaine`, qui découpe par contrat. Les deux chemins
  // sont équivalents sur une série à contrat unique — mais sur des futures,
  // seul `chaine` refuse de mesurer au travers d'un roulement.
  //
  // Binance garde le chemin direct : ses trois séries sont téléchargées
  // séparément plutôt que déduites de la série fine, et aucune bougie Binance
  // ne porte de contrat.
  let resultats, orderBlocks, rejetes;
  if (o.csv) {
    let r;
    try {
      r = chaine(fines, o);
    } catch (err) {
      console.error(`\nÉchec : ${err.message}\n`);
      process.exit(2);
    }
    ({ resultats, retenus: orderBlocks, rejetes } = r);
    console.log(`\n  cassures ${o.utBiais}: ${r.compteurs.cassuresBiais}  ·  cassures ${o.utDetection}: ${r.compteurs.cassuresDetection}  ·  order blocks: ${orderBlocks.length}`);
    afficherContrats(r.segments, r.ecartes);
    if (o.volume) afficherRejets(orderBlocks.length, rejetes);
    afficherDistributionVolume(orderBlocks, rejetes);
  } else {
    const serieBiais = tendanceAuFilDuTemps(cassures(biaisBougies, o.fenetre));
    const evenements = cassures(detectionBougies, o.fenetre);
    try {
      ({ retenus: orderBlocks, rejetes } = detecterEnDetail(detectionBougies, evenements, { volume: o.volume }));
    } catch (err) {
      console.error(`\nÉchec : ${err.message}\n`);
      process.exit(2);
    }

    console.log(`\n  cassures ${o.utBiais}: ${serieBiais.length}  ·  cassures ${o.utDetection}: ${evenements.length}  ·  order blocks: ${orderBlocks.length}`);
    if (o.volume) afficherRejets(orderBlocks.length, rejetes);
    afficherDistributionVolume(orderBlocks, rejetes);

    const horizonBougies = Math.round((o.horizonHeures * 3_600_000) / dureeUnite(o.utResolution));
    resultats = evaluer({
      orderBlocks, bougiesDetection: detectionBougies, serieBiais,
      bougiesResolution: resolutionBougies, horizonBougies, sansFiltreBiais: o.sansFiltreBiais,
      objectif: o.objectif, remplissage: o.remplissage, spread: o.spread ?? 0, commission: o.commission ?? 0,
    });
  }

  console.log(`  retenus après filtre de biais: ${resultats.length}`);

  // Découpage imposé : réglage sur la première moitié, vérification sur la
  // seconde, jamais l'inverse.
  const milieu = o.depuisMs + (o.jusquaMs - o.depuisMs) / 2;
  console.log(`  période couverte: ${iso(o.depuisMs)} → ${iso(o.jusquaMs)}`);
  const premiere = resultats.filter((r) => r.ms < milieu);
  const seconde = resultats.filter((r) => r.ms >= milieu);

  console.log('\n=== Résultats ===');
  afficherBloc('Ensemble de la période', agreger(resultats, o.coutEnR, o.objectif, o.ambigu));
  afficherBloc(`Première moitié — jusqu'au ${iso(milieu)} (mise au point)`, agreger(premiere, o.coutEnR, o.objectif, o.ambigu));
  afficherBloc(`Seconde moitié — à partir du ${iso(milieu)} (vérification)`, agreger(seconde, o.coutEnR, o.objectif, o.ambigu));

  if (o.baseUrl) {
    console.log('RAPPEL : données non Binance, ces chiffres ne mesurent rien.\n');
  }

  if (o.export) await ecrireExport(o.export, resultats, o);

  console.log('Lecture :');
  console.log('  Seule la seconde moitié a valeur de preuve. Si elle diffère nettement');
  console.log('  de la première, le réglage décrit le passé et non le marché.');
  console.log('  Un intervalle large signifie « on ne sait pas », pas « c’est autour de ».\n');
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
