// Résout l'issue d'un plan de trade décrit en ligne de commande.
//
// Sert à rattraper un plan produit hors de l'application — noté à la main, ou
// analysé avant que le journal existe. Utilise exactement le même algorithme
// que la résolution automatique du journal : ce qu'il répond ici, l'app le
// répondrait là.
//
//   node scripts/resoudre-plan.mjs \
//     --symbole BTCUSDT --le 2026-09-22T18:48:55Z \
//     --direction SELL --entree 86523.27 --stop 86780 --tp1 86300 --tp2 86100
//
// Ou depuis un fichier de bougies — un export TradingView du graphique même
// qui a été analysé, pour résoudre sur le flux de la capture et non sur celui
// d'une autre place :
//
//   node scripts/resoudre-plan.mjs --csv "OANDA_XAUUSD, 1.csv" \
//     --le 2026-09-22T18:48:55Z --direction BUY \
//     --entree 2650 --stop 2645 --tp1 2655 --tp2 2660

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { resoudreIssue, OBJECTIFS, REMPLISSAGES } from '../src/lib/journal/resolve.js';
import { recupererBougiesPaginees, symboleResolvable, MINUTES_PAR_BOUGIE, INTERVALLE_RESOLUTION } from '../src/lib/journal/market.js';
import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { UNITES, dureeUnite } from '../src/lib/marche/bougies.js';
import { calculerExcursions, enUnitesDeRisque } from '../src/lib/journal/excursion.js';
import { computeRR, rrVerdict, breakEvenRate } from '../src/lib/analysis.js';

const LIBELLE = {
  non_declenche: "Entrée jamais atteinte — le prix n'est pas venu la chercher",
  stop: "Stop touché avant l'objectif",
  tp1: 'TP1 atteint — sortie ferme à 1 R',
  tp2: 'TP2 atteint — tenue jusqu\'à 2 R',
  ambigu: 'Ambigu — une bougie touche le stop et un objectif, son OHLC ne dit pas l’ordre',
  horizon_depasse: "Déclenché, mais ni stop ni objectif atteint dans l'horizon",
  en_cours: 'Trop tôt — pas assez de bougies pour trancher',
};

// Une option suivie d'une autre option, ou de rien, est un drapeau : sans
// cela `--garder-derniere --le …` avalerait `--le` comme valeur.
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i]?.startsWith('--')) continue;
    const suivant = argv[i + 1];
    if (suivant === undefined || suivant.startsWith('--')) out[camel(argv[i].slice(2))] = true;
    else { out[camel(argv[i].slice(2))] = suivant; i++; }
  }
  return out;
}

// Déclaration de fonction, et non constante fléchée : parseArgs s'exécute au
// chargement du module, avant qu'un `const` de fin de fichier soit initialisé.
function camel(nom) {
  return nom.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Vérifie les arguments et renvoie un plan exploitable, ou la liste des manques. */
export function construirePlan(args) {
  const erreurs = [];

  // Deux sources, exclusives : Binance par le symbole, ou un fichier.
  const csv = typeof args.csv === 'string' ? args.csv : undefined;
  if (args.csv === true) erreurs.push('--csv attend un chemin de fichier');
  if (csv && args.baseUrl) erreurs.push('--csv et --base-url désignent deux sources : choisis-en une.');

  // Avec un fichier, le symbole ne sert qu'à l'affichage : les bougies sont
  // celles du fichier, quel que soit le nom qu'on leur donne.
  const symbole = typeof args.symbole === 'string' ? args.symbole : (csv ? basename(csv).replace(/\.[^.]+$/, '') : undefined);
  if (!csv) {
    if (!symbole) erreurs.push('--symbole manquant (ou --csv pour lire un fichier)');
    else if (!symboleResolvable(symbole)) {
      erreurs.push(`--symbole "${symbole}" n’est pas une paire résolvable automatiquement (crypto cotée sur Binance). Pour un autre marché : --csv.`);
    }
  }

  const utCsv = args.utCsv ?? '1m';
  if (csv && !UNITES[utCsv]) erreurs.push(`--ut-csv "${utCsv}" inconnue (${Object.keys(UNITES).join(', ')})`);

  let decalageHeures = 0;
  if (args.decalageHeures !== undefined) {
    decalageHeures = Number(args.decalageHeures);
    if (!csv) erreurs.push('--decalage-heures ne s’applique qu’à un fichier (--csv)');
    else if (!Number.isFinite(decalageHeures) || Math.abs(decalageHeures) > 14) {
      erreurs.push('--decalage-heures doit être un nombre d’heures entre -14 et 14');
    }
  }

  const depuisMs = Date.parse(args.le ?? '');
  if (!args.le) erreurs.push('--le manquant (horodatage ISO 8601, ex. 2026-09-22T18:48:55Z)');
  else if (Number.isNaN(depuisMs)) erreurs.push(`--le "${args.le}" n’est pas une date ISO 8601 valide.`);
  else if (depuisMs > Date.now()) erreurs.push('--le est dans le futur.');

  const direction = (args.direction ?? '').toUpperCase();
  if (!['BUY', 'SELL'].includes(direction)) erreurs.push('--direction doit valoir BUY ou SELL');

  const nombres = {};
  for (const [option, champ] of [['entree', 'prixEntree'], ['stop', 'prixStopLoss'], ['tp1', 'prixTp1'], ['tp2', 'prixTp2']]) {
    const brut = args[option];
    const n = Number(brut);
    if (brut === undefined) erreurs.push(`--${option} manquant`);
    else if (!Number.isFinite(n) || n <= 0) erreurs.push(`--${option} "${brut}" n’est pas un prix valide`);
    else nombres[champ] = n;
  }

  if (erreurs.length) return { erreurs };

  const plan = { direction, ...nombres };

  // Même contrôle de cohérence que dans l'application : un plan dont
  // l'ordonnancement contredit la direction n'a pas d'issue à chercher.
  const ordonne = direction === 'BUY'
    ? plan.prixStopLoss < plan.prixEntree && plan.prixEntree < plan.prixTp1 && plan.prixTp1 < plan.prixTp2
    : plan.prixStopLoss > plan.prixEntree && plan.prixEntree > plan.prixTp1 && plan.prixTp1 > plan.prixTp2;

  if (!ordonne) {
    return { erreurs: [
      `Plan incohérent pour un ${direction} : attendu ` +
      (direction === 'BUY' ? 'stop < entrée < tp1 < tp2' : 'stop > entrée > tp1 > tp2') + '.',
    ] };
  }

  const horizonHeures = Number(args.horizonHeures ?? 24);
  if (!Number.isFinite(horizonHeures) || horizonHeures <= 0) {
    return { erreurs: ['--horizon-heures doit être un nombre d’heures positif'] };
  }

  // Règle de sortie explicite : toucher 1 R en chemin ne rapporte rien si on
  // tenait jusqu'à 2 R. Le trade doit être jugé sur la règle qu'on aurait
  // suivie, choisie avant d'ouvrir.
  const objectif = args.objectif ?? '2r';
  if (!OBJECTIFS[objectif]) {
    return { erreurs: [`--objectif "${objectif}" inconnu (${Object.keys(OBJECTIFS).join(', ')})`] };
  }

  const remplissage = args.remplissage ?? 'meche';
  if (!REMPLISSAGES.includes(remplissage)) {
    return { erreurs: [`--remplissage "${remplissage}" inconnu (${REMPLISSAGES.join(', ')})`] };
  }

  return {
    plan, symbole, depuisMs, horizonHeures, objectif, remplissage, baseUrl: args.baseUrl,
    csv, utCsv, decalageHeures, garderDerniere: args.garderDerniere === true,
  };
}

/**
 * Les bougies d'un fichier qui servent à résoudre un plan daté `depuisMs`.
 *
 * Même convention que Binance avec `startTime` : on part de la première bougie
 * qui s'OUVRE à l'instant de l'analyse ou après. Celle qui était en cours à cet
 * instant avait déjà commencé à bouger ; la compter ferait jouer au plan des
 * prix antérieurs à sa propre existence.
 *
 * Un fichier qui commence après l'analyse, ou finit avant, ne peut rien dire
 * de ce plan. Refusé plutôt que résolu sur ce qui reste.
 */
export function bougiesDepuis(bougies, depuisMs, unite) {
  if (!bougies.length) return { erreur: 'Le fichier ne contient aucune bougie.' };
  const debut = bougies[0].ouvertureMs;
  const fin = bougies.at(-1).ouvertureMs;
  const iso = (ms) => new Date(ms).toISOString();

  if (debut > depuisMs) {
    return { erreur: `Le fichier commence le ${iso(debut)}, après l'analyse (${iso(depuisMs)}) : exporte une période qui la couvre.` };
  }
  if (fin < depuisMs) {
    return { erreur: `Le fichier s'arrête le ${iso(fin)}, avant l'analyse (${iso(depuisMs)}).` };
  }

  const retenues = bougies.filter((b) => b.ouvertureMs >= depuisMs);
  // Un écart entre l'analyse et la première bougie est normal marché fermé ;
  // il est rendu pour être affiché, parce qu'il peut aussi trahir un trou.
  const attenteMs = retenues.length ? retenues[0].ouvertureMs - depuisMs : null;
  return { bougies: retenues, attenteMs, trou: attenteMs !== null && attenteMs >= dureeUnite(unite) };
}

async function chargerCsv({ csv, utCsv, decalageHeures, garderDerniere, depuisMs }) {
  const lecture = analyserCsv(await readFile(csv, 'utf8'), {
    unite: utCsv, decalageHeures, exclureDerniere: garderDerniere ? false : 'auto',
  });
  console.log(`Lecture de ${basename(csv)} : ${lecture.bougies.length} bougies ${utCsv}`);
  for (const ligne of avertissementsLecture(lecture)) console.log(`  ⚠  ${ligne}`);

  const { erreur, bougies, attenteMs, trou } = bougiesDepuis(lecture.bougies, depuisMs, utCsv);
  if (erreur) throw new Error(erreur);
  if (trou) {
    console.log(`  ⚠  première bougie ${Math.round(attenteMs / 60_000)} min après l'analyse : marché fermé, ou trou dans le fichier`);
  }
  if (utCsv !== '1m') {
    console.log(`  ⚠  résolution en ${utCsv} : une bougie qui touche stop et objectif reste ambiguë, plus souvent qu'en 1m`);
  }
  return bougies;
}

async function main() {
  const options = construirePlan(parseArgs(process.argv.slice(2)));
  const { erreurs, plan, symbole, depuisMs, horizonHeures, objectif, remplissage, baseUrl, csv, utCsv } = options;

  if (erreurs) {
    console.error('\nArguments invalides :');
    for (const e of erreurs) console.error('  - ' + e);
    console.error('\nExemple :');
    console.error('  node scripts/resoudre-plan.mjs --symbole BTCUSDT --le 2026-09-22T18:48:55Z \\');
    console.error('    --direction SELL --entree 86523.27 --stop 86780 --tp1 86300 --tp2 86100');
    console.error('  node scripts/resoudre-plan.mjs --csv "OANDA_XAUUSD, 1.csv" --le 2026-09-22T18:48:55Z \\');
    console.error('    --direction BUY --entree 2650 --stop 2645 --tp1 2655 --tp2 2660\n');
    process.exit(1);
  }

  const minutesParBougie = csv ? dureeUnite(utCsv) / 60_000 : MINUTES_PAR_BOUGIE;
  const horizonBougies = Math.round((horizonHeures * 60) / minutesParBougie);
  const rr = computeRR(plan.prixEntree, plan.prixStopLoss, plan.prixTp1);
  const risque = Math.abs(plan.prixEntree - plan.prixStopLoss);

  console.log(`\n${plan.direction === 'BUY' ? 'Long' : 'Short'} ${symbole} — ${new Date(depuisMs).toISOString()}`);
  console.log(`  entrée ${plan.prixEntree}   stop ${plan.prixStopLoss}   TP1 ${plan.prixTp1}   TP2 ${plan.prixTp2}`);
  console.log(`  risque ${arrondir(risque)}   ratio 1:${rr ?? '?'} (${rrVerdict(rr).label})`);
  console.log(`  il faudrait ${pourcent(breakEvenRate(rr))} de réussite pour être à l'équilibre`);
  console.log(`  sortie ${objectif === '1r' ? 'ferme à 1 R' : "tenue jusqu'à 2 R"} — un objectif intermédiaire frôlé ne rapporte rien\n`);

  let bougies;
  try {
    if (csv) {
      bougies = await chargerCsv({ ...options });
    } else {
      console.log(`Récupération des bougies ${INTERVALLE_RESOLUTION} sur ${horizonHeures} h…`);
      bougies = await recupererBougiesPaginees({ symbole, depuisMs, nombre: horizonBougies, baseUrl });
    }
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  console.log(`  ${Math.min(bougies.length, horizonBougies)} bougies disponibles sur ${horizonBougies} pour l'horizon\n`);

  if (!bougies.length) {
    console.error('Aucune bougie : vérifie le symbole et la date.\n');
    process.exit(2);
  }

  const { statut, detail } = resoudreIssue({ plan, bougies, horizonBougies, objectif, remplissage });

  console.log('=== Issue ===\n');
  console.log(`  ${statut.toUpperCase()} — ${LIBELLE[statut] ?? ''}\n`);

  if (detail.declencheLe) {
    console.log(`  déclenché le      ${new Date(detail.declencheLe).toISOString()}`);
    const minutes = Math.round((detail.declencheLe - depuisMs) / 60000);
    console.log(`  soit              ${minutes} min après l'analyse`);
  }
  if (detail.atteintLe) console.log(`  objectif atteint  ${new Date(detail.atteintLe).toISOString()}`);
  if (detail.bougieAmbigueMs) console.log(`  bougie ambiguë    ${new Date(detail.bougieAmbigueMs).toISOString()}`);
  console.log(`  bougies examinées ${detail.bougiesExaminees}`);

  // Les excursions ne se mesurent qu'à partir du déclenchement : avant, le
  // trade n'existe pas.
  if (detail.declencheLe) {
    const depuisDeclenchement = bougies.filter((b) => b.ouvertureMs >= detail.declencheLe).slice(0, detail.bougiesExaminees);
    const exc = calculerExcursions(plan, depuisDeclenchement);
    const enR = enUnitesDeRisque(exc, plan);

    if (exc && enR) {
      console.log('\n=== Amplitudes ===\n');
      console.log(`  en faveur   ${arrondir(exc.faveurMax).padStart(10)}  (${enR.faveurEnR} R)  jusqu'à ${exc.faveurMaxPrix}`);
      console.log(`  contre      ${arrondir(exc.contreMax).padStart(10)}  (${enR.contreEnR} R)  jusqu'à ${exc.contreMaxPrix}`);

      const lecture = [];
      if (enR.contreEnR >= 0.8 && statut !== 'stop') lecture.push('Le stop a été frôlé : il tenait de peu.');
      if (enR.faveurEnR >= (rr ?? 0) * 1.5 && statut !== 'tp2') {
        lecture.push(`Le prix est allé jusqu'à ${enR.faveurEnR} R alors que le TP1 en visait ${rr} : objectif posé trop près.`);
      }
      if (statut === 'stop' && enR.faveurEnR < 0.3) lecture.push("Le prix n'est jamais allé dans le bon sens : lecture fausse, pas stop trop serré.");
      if (lecture.length) {
        console.log('');
        for (const l of lecture) console.log('  → ' + l);
      }
    }
  }

  console.log('');
}

const arrondir = (n) => (Math.round(n * 100) / 100).toString();
const pourcent = (r) => (r === null ? '—' : `${(r * 100).toFixed(0)} %`);

// Exécuté seulement en ligne de commande : importé par les tests, ce module ne
// doit rien lancer.
if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
