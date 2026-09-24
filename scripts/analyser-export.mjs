// Quelle variable sépare les gagnants des perdants ?
//
//   node scripts/analyser-export.mjs cas-btc-2024-2025.jsonl
//
// Lit le JSONL produit par `backtest.mjs --export` et croise chaque
// qualificatif avec l'issue. Le backtest agrégeait puis jetait les cas
// individuels ; la consigne « mesurer d'abord, filtrer ensuite » n'avait
// jamais atteint son second temps.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Ce script teste une vingtaine de variables d'un coup. Sous l'hypothèse  │
// │ nulle, la meilleure paraîtra significative — c'est arithmétique, pas   │
// │ du pessimisme. D'où la correction par permutation : on mélange les     │
// │ ISSUES, on recalcule le MEILLEUR écart parmi toutes les variables, et  │
// │ on recommence. La distribution obtenue dit ce que le hasard produit de │
// │ mieux quand on cherche partout à la fois.                              │
// │                                                                         │
// │ Un p corrigé de 0,30 signifie que trois recherches sur dix trouvent    │
// │ aussi bien dans du bruit pur.                                          │
// └─────────────────────────────────────────────────────────────────────────┘

import { readFile } from 'node:fs/promises';
import { intervalleWilson } from '../src/lib/marche/statistiques.js';
import { generateurAleatoire, melanger } from '../src/lib/marche/controle.js';

/**
 * Variables exclues d'office, et pourquoi.
 *
 * `faveurMaxEnR` et `contreMaxEnR` sont mesurées APRÈS l'entrée : un trade
 * gagnant a forcément une excursion favorable élevée. Les traiter comme
 * prédicteurs reviendrait à prédire l'issue par elle-même. Elles sont
 * rapportées à part, comme diagnostic.
 */
export const EXCLUES = ['faveurMaxEnR', 'contreMaxEnR', 'gainEnR', 'statut', 'coutEnR', 'ms', 'horodatage'];

export const BINAIRES = [
  'fvgPresente', 'fvgChevauchante', 'liquiditePrise',
  'aucunRetourPendantImpulsion', 'niveauVierge',
  'ote', 'enZoneFavorable', 'aligne', 'definitionAlternativeIdentique',
];

export const CONTINUES = [
  'fvgTailleRelative', 'liquiditeProfondeur', 'deplacementAmpleur',
  'deplacementCorpsMoyen', 'deplacementBougies', 'significativiteNiveau',
  'positionDansLaJambe', 'zoneSurAtr', 'risqueRelatif', 'delaiEntreeMs',
  'definitionAlternativeEcart', 'impulsionEnBougies',
  'bougiesRevenuesPendantImpulsion', 'visitesAnterieures', 'bougiesDepuisDerniereVisite',
  'volumeEcartsTypes', 'volumeRapporteALaMoyenne', 'deltaRapporteAuMoyen',
];

/** Catégorielles à peu de niveaux, traitées comme des binaires nommées. */
export const CATEGORIELLES = { typeCassure: ['BOS', 'CHoCH'], sens: ['haussier', 'baissier'] };

/** Quatre blocs de six heures : à 318 cas, l'heure par heure ne dit rien. */
export function blocHoraire(heure) {
  if (heure < 6) return '00-05';
  if (heure < 12) return '06-11';
  if (heure < 18) return '12-17';
  return '18-23';
}

/** Un cas est-il gagnant ? `null` s'il ne compte pas dans les statistiques. */
export const gagnant = (cas) => (typeof cas.gainEnR === 'number' ? cas.gainEnR > 0 : null);

/** Taille minimale d'un groupe comparé. En deçà, l'écart n'est que du bruit. */
export const MINIMUM_PAR_GROUPE = 20;

/**
 * Écart de taux de réussite entre deux groupes.
 *
 * L'écart brut est rendu pour la lecture, mais le CLASSEMENT se fait sur
 * `z`, l'écart rapporté à son erreur-type. Sans ça, un groupe de 14 bat
 * systématiquement un groupe de 48 : son erreur-type est deux fois plus
 * grande, donc ses écarts fortuits deux fois plus gros. Trier sur l'écart
 * brut, c'est trier les variables par la petitesse de leur échantillon.
 */
export function comparerGroupes(casA, casB, nomA, nomB, minimum = MINIMUM_PAR_GROUPE) {
  if (casA.length < minimum || casB.length < minimum) return null;

  const succesA = casA.filter((c) => c.gagne).length;
  const succesB = casB.filter((c) => c.gagne).length;
  const iA = intervalleWilson(succesA, casA.length);
  const iB = intervalleWilson(succesB, casB.length);
  if (!iA || !iB) return null;

  const groupee = (succesA + succesB) / (casA.length + casB.length);
  const erreurType = Math.sqrt(groupee * (1 - groupee) * (1 / casA.length + 1 / casB.length));
  const ecart = iA.proportion - iB.proportion;

  return {
    groupeA: { nom: nomA, n: casA.length, taux: iA.proportion, bas: iA.bas, haut: iA.haut },
    groupeB: { nom: nomB, n: casB.length, taux: iB.proportion, bas: iB.bas, haut: iB.haut },
    ecart: Number(ecart.toFixed(4)),
    z: erreurType > 0 ? Number((ecart / erreurType).toFixed(3)) : 0,
  };
}

/** Bornes de quartiles d'un échantillon de valeurs numériques. */
export function quartiles(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b);
  if (tri.length < 8) return null;
  const a = (q) => tri[Math.min(tri.length - 1, Math.floor((tri.length - 1) * q))];
  const bornes = { q1: a(0.25), q2: a(0.5), q3: a(0.75) };

  // Bornes confondues : la variable est quasi constante et le découpage en
  // quartiles ne découpe rien. `bougiesDansLaZone` valait 0 pour 188 cas sur
  // 191, produisant des « quartiles » de 188/0/0/3 — et le plus gros écart
  // du classement.
  return bornes.q1 === bornes.q3 ? null : bornes;
}

/**
 * Sépare une variable continue en quartiles et compare le dernier au premier.
 *
 * Les quatre quartiles sont rendus pour la forme de la relation : un effet en
 * cloche ne se verrait pas sur le seul écart des extrêmes.
 */
export function analyserContinue(cas, champ) {
  const utilisables = cas.filter((c) => typeof c[champ] === 'number' && Number.isFinite(c[champ]));
  const bornes = quartiles(utilisables.map((c) => c[champ]));
  if (!bornes) return null;

  const paniers = [[], [], [], []];
  for (const c of utilisables) {
    const v = c[champ];
    paniers[v <= bornes.q1 ? 0 : v <= bornes.q2 ? 1 : v <= bornes.q3 ? 2 : 3].push(c);
  }

  const parQuartile = paniers.map((panier, i) => {
    const intervalle = intervalleWilson(panier.filter((c) => c.gagne).length, panier.length);
    return { quartile: i + 1, n: panier.length, taux: intervalle?.proportion ?? null,
             bas: intervalle?.bas ?? null, haut: intervalle?.haut ?? null };
  });

  const comparaison = comparerGroupes(paniers[3], paniers[0], 'Q4 (haut)', 'Q1 (bas)');
  if (!comparaison) return null;

  return { champ, type: 'continue', n: utilisables.length, bornes, parQuartile, ...comparaison };
}

export function analyserBinaire(cas, champ) {
  const utilisables = cas.filter((c) => typeof c[champ] === 'boolean');
  const vrais = utilisables.filter((c) => c[champ]);
  const faux = utilisables.filter((c) => !c[champ]);

  const comparaison = comparerGroupes(vrais, faux, 'vrai', 'faux');
  return comparaison && { champ, type: 'binaire', n: utilisables.length, ...comparaison };
}

export function analyserCategorielle(cas, champ, niveaux) {
  const a = cas.filter((c) => c[champ] === niveaux[0]);
  const b = cas.filter((c) => c[champ] === niveaux[1]);

  const comparaison = comparerGroupes(a, b, niveaux[0], niveaux[1]);
  return comparaison && { champ, type: 'categorielle', n: a.length + b.length, ...comparaison };
}

/** Tous les écarts, du plus grand au plus petit, en valeur absolue. */
export function analyserTout(cas) {
  const resultats = [];

  for (const champ of BINAIRES) {
    const r = analyserBinaire(cas, champ);
    if (r) resultats.push(r);
  }
  for (const [champ, niveaux] of Object.entries(CATEGORIELLES)) {
    const r = analyserCategorielle(cas, champ, niveaux);
    if (r) resultats.push(r);
  }
  for (const champ of CONTINUES) {
    const r = analyserContinue(cas, champ);
    if (r) resultats.push(r);
  }

  const parBloc = analyserCategorielle(
    cas.map((c) => ({ ...c, bloc: blocHoraire(c.heureUtc) })),
    'bloc', ['06-11', '12-17'],
  );
  if (parBloc) resultats.push({ ...parBloc, champ: 'blocHoraire (06-11 vs 12-17)' });

  return resultats.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}

/**
 * p corrigé pour la recherche elle-même.
 *
 * On mélange les issues, on relance TOUTE l'analyse, on retient le meilleur
 * écart. Répété N fois, ça donne ce que le hasard produit de mieux quand on
 * cherche parmi une vingtaine de variables — la seule comparaison honnête
 * pour un écart trouvé en cherchant partout.
 */
export function pFamilial(cas, zObserve, tirages = 200, graine = 1) {
  const alea = generateurAleatoire(graine);
  const issues = cas.map((c) => c.gagne);
  let auMoinsAussiBons = 0;

  for (let i = 0; i < tirages; i++) {
    const melangees = melanger([...issues], alea);
    const permutes = cas.map((c, j) => ({ ...c, gagne: melangees[j] }));
    const meilleur = analyserTout(permutes).reduce((max, r) => Math.max(max, Math.abs(r.z)), 0);
    if (meilleur >= Math.abs(zObserve)) auMoinsAussiBons++;
  }

  return {
    p: Number(((auMoinsAussiBons + 1) / (tirages + 1)).toFixed(4)),
    auMoinsAussiBons,
    tirages,
  };
}

const pc = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)} %`);

function afficher(cas, resultats, familial, diagnostic) {
  const base = intervalleWilson(cas.filter((c) => c.gagne).length, cas.length);

  console.log(`\n${cas.length} cas tranchés · taux global ${pc(base.proportion)} [${pc(base.bas)} – ${pc(base.haut)}]`);
  console.log(`  amplitude max en faveur   ${diagnostic.faveur} R   (médiane)`);
  console.log(`  amplitude max contre      ${diagnostic.contre} R`);
  console.log(`  rapport                   ${diagnostic.rapport}`);
  console.log(diagnostic.rapport > 1.15
    ? "  → Le prix va plus loin en faveur qu'à l'encontre : l'information existe,\n    et c'est la géométrie du plan qui la détruit."
    : "  → Faveur et contre s'équivalent : le point d'entrée ne porte pas\n    d'information directionnelle à cette distance.");

  console.log('\n=== Variables, classées par écart rapporté à son erreur-type ===\n');
  console.log(`  ${'variable'.padEnd(34)} ${'groupe haut'.padStart(22)}   ${'groupe bas'.padStart(22)}   écart       z`);

  for (const r of resultats) {
    const a = `${r.groupeA.nom} ${pc(r.groupeA.taux)} (${r.groupeA.n})`;
    const b = `${r.groupeB.nom} ${pc(r.groupeB.taux)} (${r.groupeB.n})`;
    console.log(`  ${r.champ.padEnd(34)} ${a.padStart(22)}   ${b.padStart(22)}   ${`${(r.ecart * 100).toFixed(1)} pts`.padStart(9)}   ${String(r.z).padStart(6)}`);
  }

  const meilleur = resultats[0];
  console.log(`\n=== Correction pour la recherche elle-même ===\n`);
  console.log(`  meilleur z observé        ${Math.abs(meilleur.z)}  (${meilleur.champ}, écart ${(meilleur.ecart * 100).toFixed(1)} pts)`);
  console.log(`  p corrigé                 ${familial.p}   ${familial.auMoinsAussiBons}/${familial.tirages} recherches dans du bruit font aussi bien`);
  console.log('');

  if (familial.p <= 0.05) {
    console.log('  ✓ Le hasard reproduit rarement un écart pareil, même en cherchant');
    console.log('    parmi toutes ces variables. Candidat à pré-enregistrer (DEC-018).');
  } else {
    console.log('  ✗ Chercher dans du bruit pur produit aussi bien. Le classement');
    console.log("    ci-dessus n'est pas un classement de pertinence, c'est du tri de bruit.");
  }

  const continues = resultats.filter((r) => r.type === 'continue').slice(0, 3);
  if (continues.length) {
    console.log('\n=== Forme de la relation, trois premières continues ===');
    for (const r of continues) {
      const ligne = r.parQuartile.map((q) => `Q${q.quartile} ${pc(q.taux)}`).join('  ');
      console.log(`\n  ${r.champ}\n    ${ligne}`);
    }
  }
  console.log('');
}

function mediane(valeurs) {
  const tri = [...valeurs].sort((a, b) => a - b);
  if (!tri.length) return null;
  const m = Math.floor(tri.length / 2);
  return Number((tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2).toFixed(3));
}

export function lireJsonl(contenu) {
  return contenu.split('\n').filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      throw new Error(`Ligne ${i + 1} illisible : ce fichier n'est pas un JSONL du backtest.`);
    }
  });
}

async function main() {
  const chemin = process.argv[2];
  const tirages = Number(process.argv[3] ?? 200);

  if (!chemin) {
    console.error('\nUsage :\n  node scripts/analyser-export.mjs <fichier.jsonl> [tirages]\n');
    console.error("Le fichier est produit par `backtest.mjs --export`.\n");
    process.exit(1);
  }

  let tous;
  try {
    tous = lireJsonl(await readFile(chemin, 'utf8'));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  const cas = tous
    .map((c) => ({ ...c, gagne: gagnant(c) }))
    .filter((c) => c.gagne !== null);

  if (cas.length < 30) {
    console.error(`\n${cas.length} cas tranchés sur ${tous.length} : trop peu pour séparer quoi que ce soit.\n`);
    process.exit(2);
  }

  const diagnostic = {
    faveur: mediane(tous.map((c) => c.faveurMaxEnR).filter((v) => typeof v === 'number')),
    contre: mediane(tous.map((c) => c.contreMaxEnR).filter((v) => typeof v === 'number')),
  };
  diagnostic.rapport = diagnostic.contre ? Number((diagnostic.faveur / diagnostic.contre).toFixed(3)) : null;

  const resultats = analyserTout(cas);
  if (!resultats.length) {
    console.error('\nAucune variable exploitable : tous les champs sont vides ou constants.\n');
    process.exit(2);
  }

  process.stdout.write(`\n  ${tirages} recherches de contrôle… `);
  const familial = pFamilial(cas, resultats[0].z, tirages);
  console.log('terminé');

  afficher(cas, resultats, familial, diagnostic);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
