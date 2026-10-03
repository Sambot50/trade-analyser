// Le volume est-il corrélé aux mouvements de la courbe ?
//
//   node scripts/correlations.mjs --dossier marches
//   node scripts/correlations.mjs --csv GC_2023_2024.csv --ut 15m
//
// La question du projet, posée directement. Pas de règle, pas d'entrée, pas
// de frais, pas de verdict : on mesure des corrélations et on les lit.
//
// SIX COUPLES, ET LA DISTINCTION QUI COMPTE
//
// Le volume peut prédire l'AMPLEUR d'un mouvement sans rien dire de sa
// DIRECTION. Ce sont deux questions différentes, et les confondre est
// l'erreur qui a coûté toute une journée : chercher une direction là où il
// n'y a peut-être qu'une agitation.
//
//   mouvement absolu   → « ça va bouger »      (exploitable autrement)
//   mouvement signé    → « ça va monter »      (ce qu'on cherchait en vain)
//
// Chaque corrélation est donnée en rang (Spearman) ET en linéaire (Pearson).
// Le volume a une queue lourde : l'écart entre les deux dit à quel point
// quelques bougies extrêmes tirent la mesure.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { mediane } from '../src/lib/marche/anomalies.js';
import { pearson, spearman, significativite } from '../src/lib/marche/correlation.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '15m', utCsv: '1m', fenetre: 60 };
const HORIZONS = [1, 4, 16, 96];          // 15 min, 1 h, 4 h, 24 h

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];
  if (typeof args.csv !== 'string' && typeof args.dossier !== 'string') {
    erreurs.push('--csv <fichier> ou --dossier <dossier> est requis');
  }
  o.csv = args.csv; o.dossier = args.dossier;
  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue`);
    else o[cle] = args[cle];
  }
  if (args.fenetre !== undefined) {
    const n = Number(args.fenetre);
    if (!Number.isFinite(n) || n < 20) erreurs.push('--fenetre attend un nombre ≥ 20');
    else o.fenetre = n;
  }
  return erreurs.length ? { erreurs } : o;
}

/**
 * Pour chaque bougie : son volume rapporté à la médiane glissante, et ce que
 * le prix fait ensuite — en valeur absolue et en signé.
 *
 * Le volume brut ne se compare pas d'un marché à l'autre ni d'une année à
 * l'autre ; le rapport à la médiane locale, si.
 */
export function extraire(serie, fenetre) {
  const lignes = [];
  for (let i = fenetre; i < serie.length; i++) {
    const b = serie[i];
    const med = mediane(serie.slice(i - fenetre, i).map((p) => p.volume || 0));
    if (!med) continue;
    const amplitude = b.plusHaut - b.plusBas;
    if (!(amplitude > 0) || !b.cloture) continue;

    const ligne = {
      ratioVolume: (b.volume || 0) / med,
      // Amplitude de LA bougie, en pour cent du prix : comparable partout.
      amplitudeRelative: (amplitude / b.cloture) * 100,
      corpsRelatif: (Math.abs(b.cloture - b.ouverture) / b.cloture) * 100,
      apres: {},
    };

    for (const h of HORIZONS) {
      const fin = serie[i + h];
      if (!fin) continue;
      const fenetreApres = serie.slice(i + 1, i + 1 + h);
      if (fenetreApres.length < h) continue;
      const variation = ((fin.cloture - b.cloture) / b.cloture) * 100;
      const haut = Math.max(...fenetreApres.map((p) => p.plusHaut));
      const bas = Math.min(...fenetreApres.map((p) => p.plusBas));
      ligne.apres[h] = {
        signe: variation,
        absolu: Math.abs(variation),
        // L'étendue parcourue, qui capte l'agitation même sans direction.
        etendue: ((haut - bas) / b.cloture) * 100,
      };
    }
    lignes.push(ligne);
  }
  return lignes;
}

const fmt = (r, seuil) => {
  if (r === null) return '     —';
  const s = (r >= 0 ? '+' : '') + r.toFixed(3);
  // Marquer ce qui dépasse une corrélation faible, pas ce qui est « significatif » :
  // sur 50 000 points, 0,02 est certain et sans intérêt.
  return Math.abs(r) >= 0.10 ? s + (Math.abs(r) >= 0.30 ? ' **' : ' *') : s + '   ';
};

export function analyser(lignes, nom) {
  const n = lignes.length;
  console.log(`\n  ${nom}  ·  ${n.toLocaleString('fr-FR')} bougies`);
  if (n < 100) { console.log('    trop peu de bougies'); return null; }

  const vol = lignes.map((l) => l.ratioVolume);
  const sig = significativite(0.1, n);
  console.log(`    seuil de bruit à 2 erreurs types : ±${sig.seuilBruit.toFixed(3)}`);
  console.log('');
  console.log('    volume contre…                        Spearman     Pearson');
  console.log('    ' + '─'.repeat(58));

  const ligne = (etiquette, ys) => {
    const paires = lignes.map((l, i) => [vol[i], ys[i]]).filter(([, y]) => Number.isFinite(y));
    if (paires.length < 100) { console.log(`    ${etiquette.padEnd(36)}      —           —`); return null; }
    const xs = paires.map((p) => p[0]); const zs = paires.map((p) => p[1]);
    const rs = spearman(xs, zs); const rp = pearson(xs, zs);
    console.log(`    ${etiquette.padEnd(36)}${fmt(rs)}   ${fmt(rp)}`);
    return rs;
  };

  const resultats = {};
  resultats.amplitude = ligne('amplitude de la MÊME bougie', lignes.map((l) => l.amplitudeRelative));
  resultats.corps = ligne('corps de la MÊME bougie', lignes.map((l) => l.corpsRelatif));
  console.log('');
  for (const h of HORIZONS) {
    const nomH = h === 1 ? '15 min' : h === 4 ? '1 h' : h === 16 ? '4 h' : '24 h';
    resultats[`etendue${h}`] = ligne(`étendue parcourue sur ${nomH}`, lignes.map((l) => l.apres[h]?.etendue));
  }
  console.log('');
  for (const h of HORIZONS) {
    const nomH = h === 1 ? '15 min' : h === 4 ? '1 h' : h === 16 ? '4 h' : '24 h';
    resultats[`absolu${h}`] = ligne(`|variation| sur ${nomH}`, lignes.map((l) => l.apres[h]?.absolu));
  }
  console.log('');
  for (const h of HORIZONS) {
    const nomH = h === 1 ? '15 min' : h === 4 ? '1 h' : h === 16 ? '4 h' : '24 h';
    resultats[`signe${h}`] = ligne(`variation SIGNÉE sur ${nomH}`, lignes.map((l) => l.apres[h]?.signe));
  }
  return resultats;
}

async function lire(chemin, o) {
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(chemin, 'utf8'), { unite: o.utCsv });
  if (!volumeExploitable) return null;
  const { segments } = decouperParContrat(fines);
  const lignes = [];
  for (const segment of segments) lignes.push(...extraire(agregerBougies(segment.bougies, o.ut), o.fenetre));
  return lignes;
}

async function principal() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('');
    process.exit(1);
  }

  const fichiers = o.csv ? [o.csv]
    : (await readdir(o.dossier)).filter((f) => f.toLowerCase().endsWith('.csv')).sort().map((f) => join(o.dossier, f));

  console.log(`\nunité ${o.ut} · volume rapporté à la médiane des ${o.fenetre} bougies précédentes`);
  console.log('=' .repeat(72));

  const tout = [];
  for (const f of fichiers) {
    const lignes = await lire(f, o);
    if (!lignes) { console.log(`\n  ${f} — pas de volume réel`); continue; }
    analyser(lignes, f.replace(/^.*[\\/]/, ''));
    tout.push(...lignes);
  }

  if (fichiers.length > 1) {
    console.log('\n' + '='.repeat(72));
    analyser(tout, 'TOUS MARCHÉS CONFONDUS');
  }

  console.log('\n  Lecture :');
  console.log('    * au-delà de 0,10  ·  ** au-delà de 0,30');
  console.log();
  console.log('    La distinction qui compte est entre AMPLEUR et DIRECTION :');
  console.log('      « étendue » et « |variation| »  →  ça va bouger');
  console.log('      « variation SIGNÉE »            →  ça va monter');
  console.log();
  console.log('    Spearman travaille sur les rangs et résiste aux pics de volume ;');
  console.log('    Pearson est tiré par eux. L\'écart entre les deux est lui-même');
  console.log('    une information.');
  console.log();
  console.log('    Sur des dizaines de milliers de bougies, presque tout est');
  console.log('    « significatif ». C\'est l\'AMPLEUR qu\'il faut lire, pas le p.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
