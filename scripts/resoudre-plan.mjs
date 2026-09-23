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

import { resoudreIssue, OBJECTIFS, REMPLISSAGES } from '../src/lib/journal/resolve.js';
import { recupererBougiesPaginees, symboleResolvable, MINUTES_PAR_BOUGIE, INTERVALLE_RESOLUTION } from '../src/lib/journal/market.js';
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

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[camel(argv[i].slice(2))] = argv[i + 1];
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

  const symbole = args.symbole;
  if (!symbole) erreurs.push('--symbole manquant');
  else if (!symboleResolvable(symbole)) {
    erreurs.push(`--symbole "${symbole}" n’est pas une paire résolvable automatiquement (crypto cotée sur Binance).`);
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

  return { plan, symbole, depuisMs, horizonHeures, objectif, remplissage, baseUrl: args.baseUrl };
}

async function main() {
  const { erreurs, plan, symbole, depuisMs, horizonHeures, objectif, remplissage, baseUrl } = construirePlan(parseArgs(process.argv.slice(2)));

  if (erreurs) {
    console.error('\nArguments invalides :');
    for (const e of erreurs) console.error('  - ' + e);
    console.error('\nExemple :');
    console.error('  node scripts/resoudre-plan.mjs --symbole BTCUSDT --le 2026-09-22T18:48:55Z \\');
    console.error('    --direction SELL --entree 86523.27 --stop 86780 --tp1 86300 --tp2 86100\n');
    process.exit(1);
  }

  const horizonBougies = Math.round((horizonHeures * 60) / MINUTES_PAR_BOUGIE);
  const rr = computeRR(plan.prixEntree, plan.prixStopLoss, plan.prixTp1);
  const risque = Math.abs(plan.prixEntree - plan.prixStopLoss);

  console.log(`\n${plan.direction === 'BUY' ? 'Long' : 'Short'} ${symbole} — ${new Date(depuisMs).toISOString()}`);
  console.log(`  entrée ${plan.prixEntree}   stop ${plan.prixStopLoss}   TP1 ${plan.prixTp1}   TP2 ${plan.prixTp2}`);
  console.log(`  risque ${arrondir(risque)}   ratio 1:${rr ?? '?'} (${rrVerdict(rr).label})`);
  console.log(`  il faudrait ${pourcent(breakEvenRate(rr))} de réussite pour être à l'équilibre`);
  console.log(`  sortie ${objectif === '1r' ? 'ferme à 1 R' : "tenue jusqu'à 2 R"} — un objectif intermédiaire frôlé ne rapporte rien\n`);

  console.log(`Récupération des bougies ${INTERVALLE_RESOLUTION} sur ${horizonHeures} h…`);

  let bougies;
  try {
    bougies = await recupererBougiesPaginees({ symbole, depuisMs, nombre: horizonBougies, baseUrl });
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  console.log(`  ${bougies.length} bougies reçues sur ${horizonBougies} demandées\n`);

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
