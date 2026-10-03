// De combien l'erreur type d'une mesure est-elle fausse quand les positions
// se chevauchent ?
//
//   node scripts/inflation.mjs
//   node scripts/inflation.mjs --graines 20 --jours 45
//
// LE PROBLÈME. Avec un horizon de 24 heures sur des bougies de 15 minutes,
// deux signaux consécutifs partagent 95 de leurs 96 bougies de résolution.
// Un mouvement de marché pousse donc TOUTES les positions de la fenêtre dans
// le même sens. La formule usuelle — racine de p(1-p)/n — les croit séparées
// et sous-estime lourdement leur dispersion commune.
//
// LA MESURE. On rejoue la règle gelée de HYP-001 sur des marches aléatoires
// indépendantes, une par graine. La vraie réponse est connue : zéro. La
// dispersion observée d'une graine à l'autre est la vraie erreur type ; le
// rapport à l'erreur type annoncée est le facteur de correction.
//
// CE QU'ELLE A DONNÉ. Le taux d'un seul bras est dispersé 3,8 fois plus que
// la formule ne l'annonce. La DIFFÉRENCE détectées − témoin, elle, ne l'est
// pas : les deux bras subissent le même marché, et il s'annule dans la
// soustraction. Voir DEC-032.
//
// CE N'EST PAS UN TEST D'HYPOTHÈSE. Rien n'est pré-enregistré ici, et aucune
// donnée réelle n'est lue. C'est un étalonnage d'instrument.

import { parseArgs } from './backtest.mjs';
import { serieAleatoire, enCsv, facteurInflation } from '../src/lib/marche/aleatoire.js';
import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment } from '../src/lib/marche/anomalies.js';
import { sortDeLaPosition } from './resolution.mjs';
import { GEL } from './eprouver-hyp001.mjs';

/** Taux de réussite sur les seules barrières, comme la mesure gelée. */
export function tauxSurBarrieres(sorts) {
  const atteint = sorts.filter((s) => s.issue === 'atteint').length;
  const perdu = sorts.filter((s) => s.issue === 'perdu').length;
  const n = atteint + perdu;
  if (!n) return null;
  return { taux: (atteint / n) * 100, n, erreurType: Math.sqrt(2500 / n) };
}

/** Erreur type de la différence de deux proportions, formule usuelle. */
export function erreurTypeDeLaDifference(a, b) {
  if (!a || !b) return null;
  return Math.sqrt(a.erreurType ** 2 + b.erreurType ** 2);
}

/** Une graine : la règle gelée jouée sur une marche sans avantage. */
export function mesurerUneGraine(graine, { jours, contrats }) {
  const csv = enCsv(serieAleatoire({ graine, minutes: jours * 1440, contrats }));
  const { bougies: fines } = analyserCsv(csv, { unite: GEL.utCsv });
  const horizon = Math.round((GEL.horizonHeures * 3_600_000) / dureeUnite(GEL.ut));
  const { segments } = decouperParContrat(fines);

  const detectees = [];
  const temoin = [];
  for (const segment of segments) {
    const serie = agregerBougies(segment.bougies, GEL.ut);
    for (const s of scorerSegment(serie, { fenetre: GEL.fenetre })) {
      if (s.mesures.macro) continue;
      if (s.mesures.familleSemaine !== GEL.famille) continue;
      const sort = sortDeLaPosition(serie, s.index, horizon, GEL.multiple);
      if (!sort) continue;
      (s.scores[GEL.detecteur] ? detectees : temoin).push(sort);
    }
  }
  return { detectees: tauxSurBarrieres(detectees), temoin: tauxSurBarrieres(temoin) };
}

const ligne = (n) => '='.repeat(n);

function afficherFacteur(titre, r, attendu) {
  if (!r) { console.log(`\n  ${titre} — trop peu de mesures`); return; }
  console.log(`\n  ${titre}`);
  console.log(`    moyenne sur bruit pur      ${r.moyenne >= 0 ? '+' : ''}${r.moyenne.toFixed(2)}   (la vraie réponse est 0)`);
  console.log(`    dispersion réelle          ${r.ecartTypeObserve.toFixed(2)}`);
  console.log(`    erreur type annoncée       ${r.erreurTypeNominale.toFixed(2)}`);
  console.log(`    FACTEUR                    × ${r.facteur.toFixed(2)}   ${attendu}`);
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  const graines = Number(args.graines ?? 12);
  const jours = Number(args.jours ?? 30);
  const contrats = Number(args.contrats ?? 3);

  console.log(`\nrègle de HYP-001 : ${GEL.ut} · ±${GEL.multiple}R · ${GEL.famille} · horizon ${GEL.horizonHeures} h`);
  console.log(`${graines} marches aléatoires · ${jours} jours × ${contrats} contrats · aucun avantage par construction\n`);

  const tauxTemoin = []; const seTemoin = [];
  const ecarts = []; const seEcarts = [];

  for (let i = 0; i < graines; i++) {
    const graine = 101 * (i + 1);
    const { detectees, temoin } = mesurerUneGraine(graine, { jours, contrats });
    if (!temoin || temoin.n < 30) { console.log(`  graine ${graine} — témoin trop petit, écartée`); continue; }
    tauxTemoin.push(temoin.taux - 50);
    seTemoin.push(temoin.erreurType);
    if (detectees && detectees.n >= 30) {
      ecarts.push(detectees.taux - temoin.taux);
      seEcarts.push(erreurTypeDeLaDifference(detectees, temoin));
      console.log(`  graine ${String(graine).padStart(5)}   détectées ${String(detectees.n).padStart(5)} à ${detectees.taux.toFixed(1)} %   témoin ${String(temoin.n).padStart(5)} à ${temoin.taux.toFixed(1)} %   écart ${(detectees.taux - temoin.taux >= 0 ? '+' : '')}${(detectees.taux - temoin.taux).toFixed(2)} pt`);
    } else {
      console.log(`  graine ${String(graine).padStart(5)}   témoin ${String(temoin.n).padStart(5)} à ${temoin.taux.toFixed(1)} %   (pas assez de détections)`);
    }
  }

  console.log('\n' + ligne(72));
  console.log('  CE QUE LA FORMULE USUELLE SOUS-ESTIME');
  console.log(ligne(72));
  afficherFacteur('TAUX D’UN SEUL BRAS (témoin)', facteurInflation(tauxTemoin, seTemoin), '← à corriger');
  afficherFacteur('DIFFÉRENCE détectées − témoin', facteurInflation(ecarts, seEcarts), '← sain si proche de 1');

  console.log('\n  Lecture :');
  console.log('    Les positions se chevauchent, donc un mouvement de marché les');
  console.log('    pousse toutes ensemble : le taux d’un bras pris seul est bien');
  console.log('    plus dispersé que la formule ne l’annonce.');
  console.log();
  console.log('    Détectées et témoin subissent LE MÊME marché. Il s’annule dans');
  console.log('    la soustraction, et l’erreur type de la différence reste juste.');
  console.log('    C’est ce qui rend un témoin tiré de la même période nécessaire,');
  console.log('    et pas seulement prudent.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
