// HYP-002 — la réplication. Gelée le 2026-09-25, voir docs/DECISIONS.md.
//
//   node scripts/eprouver-hyp002.mjs --dossier marches
//
// HYP-001 a trouvé un effet sur l'or, hors échantillon, à p = 0,0486. C'est
// exactement le profil de résultat qui ne se reproduit pas : marginal,
// sous-puissant, et issu d'un examen de vingt-quatre cellules.
//
// Une seule chose peut le départager d'un hasard : la MÊME règle, sans une
// virgule changée, sur des marchés jamais regardés.
//
// COMME HYP-001, AUCUN PARAMÈTRE N'EST RÉGLABLE. Seul le dossier varie.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { atteintAvantDePerdre } from '../src/lib/marche/apres.js';
import { GEL as GEL_001, part, phi } from './eprouver-hyp001.mjs';

/** Gelé. Hérite de HYP-001 tout ce qui définit la règle : rien n'est retouché. */
export const GEL = Object.freeze({
  enregistreLe: '2026-09-25',
  // La règle elle-même vient de HYP-001, à l'identique. C'est le sens même
  // d'une réplication : si on change un paramètre, on ne réplique plus, on
  // cherche une variante qui marche.
  regle: GEL_001,
  marches: Object.freeze(['SI', 'PL', 'HG', 'CL', 'ES']),
  debut: '2023-01-01',
  fin: '2026-09-01',
  // L'effet mesuré sur l'or hors échantillon. L'hypothèse nulle reste
  // « aucune différence » ; cette valeur sert à juger la puissance, pas à
  // servir de seuil.
  ecartDeReference: 5.11,
  alpha: 0.05,
  // En dessous de cette erreur type, le test peut détecter l'écart de
  // référence à 80 % de puissance. Au-dessus, il ne peut pas conclure, et le
  // dire est la seule honnêteté possible : HYP-001 a été décidée sur une
  // puissance annoncée de 83 % qui valait 56 %.
  erreurTypeMaximale: 2.055,
});

/** Un marché : ses cas, son témoin, sa différence et la variance de celle-ci. */
export function mesurerMarche(verdictsDetectes, verdictsTemoin) {
  const a = part(verdictsDetectes);
  const t = part(verdictsTemoin);
  if (a.part === null || t.part === null) return null;
  const ecart = a.part - t.part;
  const variance = 2500 / a.n + 2500 / t.n;
  return { ecart, variance, se: Math.sqrt(variance), nDetectes: a.n, nTemoin: t.n, partDetectes: a.part, partTemoin: t.part };
}

/**
 * Regroupement par pondération en variance inverse — une méta-analyse à
 * effets fixes.
 *
 * Concaténer les cas de tous les marchés serait plus simple et faux : un
 * marché qui fournit dix fois plus de bougies imposerait son résultat, et le
 * mélange dépendrait de la liquidité de chacun plutôt que de l'effet cherché.
 * Ici chaque marché pèse selon sa précision.
 */
export function regrouper(marches) {
  const valides = marches.filter((m) => m && Number.isFinite(m.ecart) && m.variance > 0);
  if (!valides.length) return null;
  const poidsTotal = valides.reduce((s, m) => s + 1 / m.variance, 0);
  const ecart = valides.reduce((s, m) => s + m.ecart / m.variance, 0) / poidsTotal;
  const se = Math.sqrt(1 / poidsTotal);
  return { ecart, se, z: ecart / se, p: 1 - phi(ecart / se), nMarches: valides.length };
}

/** La règle de décision, telle que pré-enregistrée. Quatre issues, pas cinq. */
export function decider(groupe) {
  if (!groupe) return { verdict: 'IMPOSSIBLE', raison: 'aucun marché exploitable' };
  // L'insuffisance de puissance se déclare AVANT de regarder le signe : sinon
  // on l'invoquerait seulement quand le résultat déplaît.
  if (groupe.se > GEL.erreurTypeMaximale) {
    return { verdict: 'NON CONCLUANTE', raison: `erreur type ${groupe.se.toFixed(3)} > ${GEL.erreurTypeMaximale} — puissance insuffisante` };
  }
  if (groupe.ecart <= 0) return { verdict: 'RÉFUTÉE' };
  return { verdict: groupe.p < GEL.alpha ? 'RÉPLIQUÉE' : 'NON RÉPLIQUÉE' };
}

async function mesurerFichier(chemin) {
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(chemin, 'utf8'), {
    unite: GEL.regle.utCsv, decalageHeures: 0,
  });
  if (!volumeExploitable) throw new Error(`${chemin} ne porte pas de volume réel`);

  const horizonBougies = Math.round((GEL.regle.horizonHeures * 3_600_000) / dureeUnite(GEL.regle.ut));
  const { segments } = decouperParContrat(fines);
  const detectes = [];
  const temoin = [];

  for (const segment of segments) {
    const serie = agregerBougies(segment.bougies, GEL.regle.ut);
    for (const s of scorerSegment(serie, { fenetre: GEL.regle.fenetre })) {
      if (s.mesures.macro) continue;
      if (s.mesures.familleSemaine !== GEL.regle.famille) continue;
      const v = atteintAvantDePerdre(serie, s.index, horizonBougies, GEL.regle.multiple);
      if (v === null) continue;
      (s.scores[GEL.regle.detecteur] > 0 ? detectes : temoin).push(v);
    }
  }
  return { mesure: mesurerMarche(detectes, temoin), bougies: fines.length, segments: segments.length };
}

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dossier');
  if (i === -1 || !args[i + 1] || args.length !== 2) {
    console.error('\nUsage : node scripts/eprouver-hyp002.mjs --dossier <dossier>');
    console.error('C\'est le SEUL argument accepté : HYP-002 est gelée.\n');
    process.exit(1);
  }
  const dossier = args[i + 1];

  const fichiers = (await readdir(dossier)).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  console.log(`\n${fichiers.length} fichier(s) dans ${dossier}`);

  const attendus = new Set(GEL.marches);
  const mesures = [];

  for (const fichier of fichiers) {
    const marche = fichier.split(/[_.-]/)[0].toUpperCase();
    if (!attendus.has(marche)) {
      console.log(`  ${fichier} — ignoré, « ${marche} » n'est pas dans la liste gelée`);
      continue;
    }
    attendus.delete(marche);
    process.stdout.write(`  ${marche.padEnd(3)} `);
    const { mesure, bougies, segments } = await mesurerFichier(join(dossier, fichier));
    if (!mesure) { console.log('aucun cas exploitable'); continue; }
    console.log(
      `${String(bougies).padStart(8)} bougies · ${String(segments).padStart(2)} contrats · `
      + `détectées ${String(mesure.nDetectes).padStart(4)} à ${mesure.partDetectes.toFixed(1)} % · `
      + `témoin ${String(mesure.nTemoin).padStart(5)} à ${mesure.partTemoin.toFixed(1)} % · `
      + `écart ${mesure.ecart >= 0 ? '+' : ''}${mesure.ecart.toFixed(2)} ± ${mesure.se.toFixed(2)}`,
    );
    mesures.push({ marche, ...mesure });
  }

  // Un marché manquant change la puissance du regroupement. Le taire
  // reviendrait à présenter un test amputé comme le test prévu.
  if (attendus.size) {
    console.log(`\n⚠  Marchés gelés absents du dossier : ${[...attendus].join(', ')}`);
    console.log('   Le regroupement porte donc sur moins de marchés que pré-enregistré.');
  }

  const groupe = regrouper(mesures);
  const d = decider(groupe);

  console.log('\n' + '='.repeat(74));
  console.log(`  HYP-002  ·  réplication de HYP-001  ·  gelée le ${GEL.enregistreLe}`);
  console.log('='.repeat(74));

  if (!groupe) { console.log(`\n  ${d.verdict} — ${d.raison}\n`); process.exit(4); }

  console.log(`\n  regroupement en variance inverse sur ${groupe.nMarches} marché(s)`);
  console.log(`\n  écart groupé     ${groupe.ecart >= 0 ? '+' : ''}${groupe.ecart.toFixed(2)} points`);
  console.log(`  référence or     +${GEL.ecartDeReference.toFixed(2)} points`);
  console.log(`  erreur type       ${groupe.se.toFixed(3)}   (maximum utile ${GEL.erreurTypeMaximale})`);
  console.log(`  z                 ${groupe.z.toFixed(2)}`);
  console.log(`  p unilatéral      ${groupe.p.toFixed(4)}`);
  console.log(`\n  >>> ${d.verdict} <<<`);
  if (d.raison) console.log(`      ${d.raison}`);

  console.log('\n  Les écarts par marché ci-dessus sont SECONDAIRES : cinq marchés');
  console.log('  regardés séparément, c\'est cinq occasions de trouver par hasard.');
  console.log('  Le regroupement est le seul chiffre qui décide.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
