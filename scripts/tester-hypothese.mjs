// Teste UNE hypothèse pré-enregistrée, sur des données jamais regardées.
//
//   node scripts/tester-hypothese.mjs cas-2022-2023.jsonl zoneSurAtr 1.1915
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Délibérément séparé de `analyser-export.mjs`.                           │
// │                                                                         │
// │ Celui-là EXPLORE : il teste une vingtaine de variables et corrige pour  │
// │ la recherche. Celui-ci CONFIRME : une hypothèse, un seuil, écrits       │
// │ d'avance. Le `p` n'est donc pas corrigé — la correction paie une        │
// │ recherche, et il n'y a plus de recherche.                               │
// │                                                                         │
// │ Deux scripts plutôt qu'une option, pour qu'on ne puisse pas lancer      │
// │ l'exploration et lire sa sortie comme une confirmation.                 │
// └─────────────────────────────────────────────────────────────────────────┘

import { readFile } from 'node:fs/promises';
import { intervalleWilson } from '../src/lib/marche/statistiques.js';
import { generateurAleatoire, melanger } from '../src/lib/marche/controle.js';
import { lireJsonl, gagnant, comparerGroupes } from './analyser-export.mjs';

/** Minimum de cas au-dessus du seuil pour que le test conclue (DEC-024). */
export const MINIMUM_AU_DESSUS = 40;

export function separer(cas, champ, seuil) {
  const utilisables = cas.filter((c) => typeof c[champ] === 'number' && Number.isFinite(c[champ]));
  return {
    utilisables,
    auDessus: utilisables.filter((c) => c[champ] >= seuil),
    enDessous: utilisables.filter((c) => c[champ] < seuil),
  };
}

/**
 * `p` unilatéral d'un test de permutation sur UNE statistique.
 *
 * On mélange les issues et on recalcule le même z, sans jamais regarder une
 * autre variable. Comme pour le contrôle du backtest, `(k+1)/(N+1)` : cent
 * tirages tous battus ne prouvent pas une impossibilité.
 */
export function pDeLHypothese(cas, champ, seuil, zObserve, tirages = 2000, graine = 1) {
  const alea = generateurAleatoire(graine);
  const { utilisables } = separer(cas, champ, seuil);
  const issues = utilisables.map((c) => c.gagne);
  let auMoinsAussiBons = 0;

  for (let i = 0; i < tirages; i++) {
    const melangees = melanger([...issues], alea);
    const permutes = utilisables.map((c, j) => ({ ...c, gagne: melangees[j] }));
    const { auDessus, enDessous } = separer(permutes, champ, seuil);
    const r = comparerGroupes(auDessus, enDessous, 'au-dessus', 'en-dessous', 1);
    if (r && r.z >= zObserve) auMoinsAussiBons++;
  }

  return {
    p: Number(((auMoinsAussiBons + 1) / (tirages + 1)).toFixed(5)),
    auMoinsAussiBons,
    tirages,
  };
}

/** Le verdict de DEC-024, appliqué sans négociation. */
export function verdict({ comparaison, p, nAuDessus }) {
  if (nAuDessus < MINIMUM_AU_DESSUS) {
    return { issue: 'non_concluant', texte: `Moins de ${MINIMUM_AU_DESSUS} cas au-dessus du seuil : ni abandon ni confirmation.` };
  }
  if (comparaison.ecart <= 0) {
    return { issue: 'abandon', texte: "Écart nul ou inversé. Un effet de signe opposé n'est pas une confirmation." };
  }
  if (p < 0.05) {
    return { issue: 'survit', texte: 'La piste survit. Mesurer les coûts réels avant toute autre chose.' };
  }
  return { issue: 'abandon', texte: "Abandon. C'étaient les tirages du hasard." };
}

const pc = (v) => `${(v * 100).toFixed(1)} %`;

async function main() {
  const [chemin, champ, seuilBrut, tiragesBrut] = process.argv.slice(2);
  const seuil = Number(seuilBrut);
  const tirages = Number(tiragesBrut ?? 2000);

  if (!chemin || !champ || !Number.isFinite(seuil)) {
    console.error('\nUsage :\n  node scripts/tester-hypothese.mjs <fichier.jsonl> <champ> <seuil> [tirages]\n');
    console.error('Exemple, la règle gelée par DEC-024 :');
    console.error('  node scripts/tester-hypothese.mjs cas-2022-2023.jsonl zoneSurAtr 1.1915\n');
    process.exit(1);
  }

  let tous;
  try {
    tous = lireJsonl(await readFile(chemin, 'utf8'));
  } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  const cas = tous.map((c) => ({ ...c, gagne: gagnant(c) })).filter((c) => c.gagne !== null);
  const { auDessus, enDessous } = separer(cas, champ, seuil);

  if (!auDessus.length || !enDessous.length) {
    console.error(`\nUn des deux groupes est vide au seuil ${seuil}. Rien à tester.\n`);
    process.exit(2);
  }

  const comparaison = comparerGroupes(auDessus, enDessous, 'au-dessus', 'en-dessous', 1);

  console.log(`\n=== Test d'une hypothèse pré-enregistrée ===\n`);
  console.log(`  fichier   ${chemin}`);
  console.log(`  règle     ${champ} >= ${seuil}`);
  console.log(`  cas       ${cas.length} tranchés sur ${tous.length} enregistrés\n`);

  const base = intervalleWilson(cas.filter((c) => c.gagne).length, cas.length);
  console.log(`  taux global        ${pc(base.proportion)} [${pc(base.bas)} – ${pc(base.haut)}]`);
  console.log(`  au-dessus du seuil ${pc(comparaison.groupeA.taux)} [${pc(comparaison.groupeA.bas)} – ${pc(comparaison.groupeA.haut)}]   n = ${comparaison.groupeA.n}`);
  console.log(`  en-dessous         ${pc(comparaison.groupeB.taux)} [${pc(comparaison.groupeB.bas)} – ${pc(comparaison.groupeB.haut)}]   n = ${comparaison.groupeB.n}`);
  console.log(`  écart              ${(comparaison.ecart * 100).toFixed(1)} pts   (z = ${comparaison.z})\n`);

  process.stdout.write(`  ${tirages} permutations… `);
  const resultat = pDeLHypothese(cas, champ, seuil, comparaison.z, tirages);
  console.log('terminé\n');

  console.log(`  p (non corrigé, une seule hypothèse)   ${resultat.p}`);
  console.log(`  ${resultat.auMoinsAussiBons}/${resultat.tirages} permutations font aussi bien\n`);

  const v = verdict({ comparaison, p: resultat.p, nAuDessus: auDessus.length });
  const marque = { survit: '✓', abandon: '✗', non_concluant: '—' }[v.issue];
  console.log(`=== Verdict DEC-024 ===\n`);
  console.log(`  ${marque} ${v.texte}\n`);

  if (v.issue === 'abandon') {
    console.log('  Rappel de DEC-024 : on ne rejoue pas sur l’or, ni sur ETH, ni sur');
    console.log('  une autre période. La cartouche est dépensée.\n');
  }
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
