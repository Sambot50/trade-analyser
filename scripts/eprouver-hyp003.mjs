// HYP-003 — le système, frais compris. Gelée le 2026-09-25.
//
//   node scripts/eprouver-hyp003.mjs --dossier metaux-2020
//
// HYP-001 puis HYP-002 ont établi qu'un effet existe sur les métaux : environ
// trois points de taux de réussite au-dessus d'une bougie ordinaire. Ce n'est
// pas une stratégie — aucune entrée n'était décidée, aucun coût compté, et le
// témoin rapportait déjà +1,12 R par la seule hausse des métaux.
//
// Ici, tout est compté : une entrée précise, un stop, un objectif, les frais
// à chaque passage, et les positions qui n'atteignent rien sont fermées au
// marché à la fin de l'horizon plutôt qu'écartées du calcul.
//
// LA PÉRIODE EST CHOISIE CONTRE L'HYPOTHÈSE. 2020-2022 : choc du COVID, puis
// deux ans de stagnation et de baisse sur l'or. Si l'effet n'était que la
// hausse de 2023-2026 déguisée, il doit disparaître ici.
//
// AUCUN PARAMÈTRE N'EST RÉGLABLE. Seul le dossier varie.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { GEL as GEL_001, phi } from './eprouver-hyp001.mjs';

export const GEL = Object.freeze({
  enregistreLe: '2026-09-25',
  regle: GEL_001,                       // la détection, inchangée depuis HYP-001
  marches: Object.freeze(['GC', 'SI', 'PL', 'HG']),
  debut: '2020-01-01',
  fin: '2023-01-01',
  // Entrée à la CLÔTURE de la bougie signalée : le premier prix auquel on
  // aurait pu agir en la voyant. Toute autre entrée suppose de savoir ce qui
  // va se passer.
  entree: 'cloture',
  objectifR: 3,
  stopR: 1,
  // Quatre ticks aller-retour : deux de spread, deux de glissement. Prudent
  // pour un contrat à terme liquide, et le pas de cotation est LU DANS LES
  // DONNÉES, jamais supposé de mémoire.
  ticksAllerRetour: 4,
  // Une position qui n'a touché ni l'objectif ni le stop est fermée au marché
  // à la fin de l'horizon. L'écarter du calcul retirerait précisément les cas
  // où il ne s'est rien passé, et gonflerait l'espérance.
  sortieFinHorizon: true,
  alpha: 0.05,
  // Au-delà, le test ne peut pas distinguer une espérance de +0,25 R de zéro
  // à 80 % de puissance. En dessous de +0,25 R, rien n'est tradable une fois
  // les frictions réelles ajoutées : c'est donc le seuil qui compte.
  erreurTypeMaximale: 0.10,
});

/** Le pas de cotation, lu dans les prix plutôt que supposé. */
export function pasDeCotation(prix) {
  const uniques = [...new Set(prix)].sort((a, b) => a - b);
  let pas = Infinity;
  for (let i = 1; i < uniques.length; i++) {
    const d = uniques[i] - uniques[i - 1];
    if (d > 1e-9 && d < pas) pas = d;
  }
  return Number.isFinite(pas) ? pas : null;
}

/**
 * Le résultat d'une position, en R, frais déduits.
 *
 * Parcourt les bougies dans l'ordre. `ambigu` quand une seule bougie touche
 * l'objectif ET le stop : on ne sait pas lequel est arrivé en premier, et
 * supposer fabriquerait du rendement — c'est la leçon de DEC-015.
 */
export function resultatEnR(serie, index, horizon, { objectifR, stopR, coutEnR }) {
  const b = serie[index];
  const sens = Math.sign(b.cloture - b.ouverture);
  if (sens === 0) return null;
  const R = b.plusHaut - b.plusBas;
  if (!(R > 0)) return null;

  const entree = b.cloture;
  const objectif = entree + sens * objectifR * R;
  const stop = entree - sens * stopR * R;

  for (let i = index + 1; i <= index + horizon && i < serie.length; i++) {
    const c = serie[i];
    const toucheObjectif = sens > 0 ? c.plusHaut >= objectif : c.plusBas <= objectif;
    const toucheStop = sens > 0 ? c.plusBas <= stop : c.plusHaut >= stop;
    if (toucheObjectif && toucheStop) return { verdict: 'ambigu', R: null };
    if (toucheObjectif) return { verdict: 'objectif', R: objectifR - coutEnR };
    if (toucheStop) return { verdict: 'stop', R: -stopR - coutEnR };
  }

  const fin = serie[Math.min(index + horizon, serie.length - 1)];
  if (fin === b) return null;
  return { verdict: 'horizon', R: ((fin.cloture - entree) * sens) / R - coutEnR };
}

/** Espérance moyenne et son erreur type. */
export function esperance(resultats) {
  const r = resultats.filter((x) => x && x.R !== null).map((x) => x.R);
  if (r.length < 2) return null;
  const moyenne = r.reduce((s, x) => s + x, 0) / r.length;
  const variance = r.reduce((s, x) => s + (x - moyenne) ** 2, 0) / (r.length - 1);
  return { n: r.length, moyenne, ecartType: Math.sqrt(variance), se: Math.sqrt(variance / r.length) };
}

/** La règle de décision, telle que pré-enregistrée. */
export function decider(e) {
  if (!e) return { verdict: 'IMPOSSIBLE', raison: 'trop peu de positions' };
  if (e.se > GEL.erreurTypeMaximale) {
    return { verdict: 'NON CONCLUANTE', raison: `erreur type ${e.se.toFixed(3)} R > ${GEL.erreurTypeMaximale} R — puissance insuffisante` };
  }
  if (e.moyenne <= 0) return { verdict: 'NON RENTABLE' };
  const p = 1 - phi(e.moyenne / e.se);
  return { verdict: p < GEL.alpha ? 'RENTABLE' : 'NON CONCLUANTE SUR LE SIGNE', p };
}

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--dossier');
  if (i === -1 || !args[i + 1] || args.length !== 2) {
    console.error('\nUsage : node scripts/eprouver-hyp003.mjs --dossier <dossier>');
    console.error('C\'est le SEUL argument accepté : HYP-003 est gelée.\n');
    process.exit(1);
  }

  const fichiers = (await readdir(args[i + 1])).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  const horizon = Math.round((GEL.regle.horizonHeures * 3_600_000) / dureeUnite(GEL.regle.ut));
  const attendus = new Set(GEL.marches);
  const tous = [];

  console.log(`\n${fichiers.length} fichier(s) · horizon ${horizon} bougies · ${GEL.ticksAllerRetour} ticks A/R\n`);

  for (const fichier of fichiers) {
    const marche = fichier.split(/[_.-]/)[0].toUpperCase();
    if (!attendus.has(marche)) { console.log(`  ${fichier} — ignoré, hors liste gelée`); continue; }
    attendus.delete(marche);

    const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(join(args[i + 1], fichier), 'utf8'), {
      unite: GEL.regle.utCsv, decalageHeures: 0,
    });
    if (!volumeExploitable) { console.log(`  ${marche} — pas de volume réel, écarté`); continue; }

    const pas = pasDeCotation(fines.slice(0, 200000).map((b) => b.cloture));
    const { segments } = decouperParContrat(fines);
    const resultats = [];

    for (const segment of segments) {
      const serie = agregerBougies(segment.bougies, GEL.regle.ut);
      for (const s of scorerSegment(serie, { fenetre: GEL.regle.fenetre })) {
        if (s.mesures.macro) continue;
        if (s.mesures.familleSemaine !== GEL.regle.famille) continue;
        if (!s.scores[GEL.regle.detecteur]) continue;
        const b = serie[s.index];
        const R = b.plusHaut - b.plusBas;
        if (!(R > 0) || !pas) continue;
        const coutEnR = (GEL.ticksAllerRetour * pas) / R;
        const r = resultatEnR(serie, s.index, horizon, { objectifR: GEL.objectifR, stopR: GEL.stopR, coutEnR });
        if (r) resultats.push(r);
      }
    }

    const e = esperance(resultats);
    const parVerdict = resultats.reduce((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] ?? 0) + 1 }), {});
    console.log(
      `  ${marche.padEnd(3)} pas ${String(pas).padEnd(8)} ${String(e?.n ?? 0).padStart(5)} positions  `
      + `espérance ${e ? (e.moyenne >= 0 ? '+' : '') + e.moyenne.toFixed(3) : '—'} R ± ${e ? e.se.toFixed(3) : '—'}  `
      + `│ objectif ${parVerdict.objectif ?? 0} · stop ${parVerdict.stop ?? 0} · horizon ${parVerdict.horizon ?? 0} · ambigu ${parVerdict.ambigu ?? 0}`,
    );
    tous.push(...resultats);
  }

  if (attendus.size) {
    console.log(`\n⚠  Marchés gelés absents : ${[...attendus].join(', ')} — le test porte sur moins que prévu.`);
  }

  const e = esperance(tous);
  const d = decider(e);

  console.log('\n' + '='.repeat(74));
  console.log(`  HYP-003  ·  le système, frais compris  ·  gelée le ${GEL.enregistreLe}`);
  console.log('='.repeat(74));
  if (!e) { console.log(`\n  ${d.verdict} — ${d.raison}\n`); process.exit(4); }

  console.log(`\n  positions        ${e.n}`);
  console.log(`  espérance nette  ${e.moyenne >= 0 ? '+' : ''}${e.moyenne.toFixed(4)} R par passage`);
  console.log(`  écart type        ${e.ecartType.toFixed(3)} R`);
  console.log(`  erreur type       ${e.se.toFixed(4)} R   (maximum utile ${GEL.erreurTypeMaximale})`);
  if (d.p !== undefined) console.log(`  p unilatéral      ${d.p.toFixed(4)}`);
  console.log(`\n  >>> ${d.verdict} <<<`);
  if (d.raison) console.log(`      ${d.raison}`);
  console.log('\n  Les frais sont comptés à chaque passage, le pas de cotation est lu');
  console.log('  dans les données, et les positions qui n\'atteignent rien sont fermées');
  console.log('  au marché plutôt qu\'écartées du calcul.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
