// Les OB du moteur à un instant : la sortie que compare le contrôle visuel.
//
//   npm run ob -- --csv donnees/mt5/bougies/XAUUSD_M1.csv --a 2026-09-14T14:00:00Z
//
// Procédure « contrôle visuel des OB » (FEUILLE-DE-ROUTE.md, E4) : à un
// instant, les OB du bootcamp validés sur les 100 dernières bougies 5 min
// fermées, à comparer à ceux que l'opérateur a relevés à l'aveugle sur
// TradingView en mode Replay.
//
// Réglages FIGÉS, sans option pour les changer : ceux du détecteur contrôlé
// (5 min, mouvement ≥ 2 ATR, toujours en tendance — HYP-005) et la fenêtre de
// la procédure. Une option ici permettrait de chercher le réglage qui « colle »
// à TradingView, c'est-à-dire d'ajuster le détecteur aux instants contrôlés.
//
// AUCUNE LECTURE DU FUTUR : seules les bougies 1 min FERMÉES avant l'instant
// entrent, et une bougie 5 min encore ouverte à l'instant est écartée. Le
// moteur voit ce que montre le mode Replay, pas davantage.
//
// C'est un contrôle de DÉTECTION. Rien ici ne dit ce que rapporte un OB.

import { readFile } from 'node:fs/promises';

import { parseArgs } from './backtest.mjs';
import { serieA } from './structure.mjs';
import { analyser as analyserCsv, agreger } from '../src/lib/marche/csv.js';
import { detecterBootcamp } from '../src/lib/marche/ob-bootcamp.js';
import { atrJusqua, mitigeDepuisLaCassure } from '../src/lib/marche/etoiles.js';

export const REGLAGES_CONTROLE = Object.freeze({ unite: '5m', seuilAtr: 2, fenetre: 100 });

export function validerOptions(args) {
  const erreurs = [];
  const o = { decalageHeures: 0 };
  if (typeof args.csv !== 'string') erreurs.push('--csv manquant : un fichier de bougies 1 minute');
  else o.csv = args.csv;
  if (typeof args.a !== 'string') erreurs.push('--a manquant : l’instant du contrôle, en ISO 8601 UTC');
  else {
    o.aMs = Date.parse(args.a);
    if (Number.isNaN(o.aMs)) erreurs.push(`--a "${args.a}" n’est pas une date ISO 8601`);
  }
  if (args.decalageHeures !== undefined) {
    o.decalageHeures = Number(args.decalageHeures);
    if (!Number.isFinite(o.decalageHeures)) erreurs.push('--decalage-heures attend un nombre');
  }
  for (const cle of ['unite', 'seuilAtr', 'seuil', 'fenetre']) {
    if (args[cle] !== undefined) erreurs.push(`--${cle} n’existe pas : les réglages du contrôle sont figés (5 min, 2 ATR, 100 bougies)`);
  }
  return erreurs.length ? { erreurs } : o;
}

/**
 * Les OB du bootcamp validés dans les `fenetre` dernières bougies fermées
 * avant `aMs`, depuis des bougies 1 min d'une seule série.
 *
 * Rend aussi l'ATR 14 de la dernière bougie fermée : la tolérance de la
 * procédure (0,1 ATR) se calcule sur lui.
 */
export function obsALInstant(fines, aMs, r = REGLAGES_CONTROLE) {
  const connues = fines.filter((b) => b.fermetureMs < aMs);
  const bougies = agreger(connues, r.unite).filter((b) => b.fermetureMs < aMs);
  if (bougies.length < r.fenetre) {
    return { bougies, obs: [], atr: null, debutFenetreMs: null, manque: `${bougies.length} bougies ${r.unite} fermées avant l’instant, il en faut ${r.fenetre}` };
  }
  const debutFenetreMs = bougies[bougies.length - r.fenetre].ouvertureMs;
  const obs = detecterBootcamp(bougies, { seuilAtr: r.seuilAtr })
    .filter((ob) => ob.valideAPartirDeMs >= debutFenetreMs && ob.valideAPartirDeMs < aMs)
    .map((ob) => ({
      derniereBougieMs: bougies[ob.index].ouvertureMs,
      debutMs: ob.ms,
      bougiesAccumulation: ob.bougiesAccumulation,
      valideMs: ob.valideAPartirDeMs,
      sens: ob.sens,
      haut: ob.zone.haut,
      bas: ob.zone.bas,
      // Information pour classer un écart : l'opérateur peut ne pas relever
      // un OB déjà consommé. Ce n'est pas un filtre.
      retoucheDepuisValidation: mitigeDepuisLaCassure(bougies, ob, aMs),
    }));
  return { bougies, obs, atr: atrJusqua(bougies, bougies.length - 1), debutFenetreMs };
}

const iso = (ms) => new Date(ms).toISOString().replace('.000', '');
const prix = (x) => x.toFixed(2);

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  npm run ob -- --csv donnees/mt5/bougies/XAUUSD_M1.csv --a 2026-09-14T14:00:00Z\n');
    process.exit(1);
  }

  let bougies;
  try {
    ({ bougies } = analyserCsv(await readFile(o.csv, 'utf8'), { unite: '1m', decalageHeures: o.decalageHeures }));
  } catch (err) {
    console.error(`\nÉchec de lecture : ${err.message}\n`);
    process.exit(2);
  }
  const segment = serieA(bougies, o.aMs);
  if (!segment) { console.error(`\nAucune bougie avant ${iso(o.aMs)} : instant « absent » (procédure).\n`); process.exit(2); }

  const r = REGLAGES_CONTROLE;
  const res = obsALInstant(segment.bougies, o.aMs);
  console.log(`\nOB du moteur — ${o.csv}${segment.symbole ? ` · contrat ${segment.symbole}` : ''}`);
  console.log(`  à ${iso(o.aMs)} · OB bootcamp ${r.unite}, mouvement ≥ ${r.seuilAtr} ATR, toujours en tendance (figé, HYP-005)`);
  if (res.manque) { console.log(`\n  Instant « absent » : ${res.manque}.\n`); return; }
  console.log(`  fenêtre : ${r.fenetre} bougies ${r.unite} fermées, depuis ${iso(res.debutFenetreMs)}`);
  console.log(`  ATR 14 ${r.unite} à l’instant : ${prix(res.atr)} → tolérance 0,1 ATR = ${prix(res.atr * 0.1)}\n`);

  if (!res.obs.length) { console.log('  Aucun OB validé dans la fenêtre.\n'); return; }
  console.log(`  ${'#'.padStart(2)}  ${'Dernière bougie (UTC)'.padEnd(21)} ${'Sens'.padEnd(9)} ${'Haut'.padStart(10)} ${'Bas'.padStart(10)}  ${'Accum.'.padEnd(6)} ${'Connu à (UTC)'.padEnd(21)} Retouché depuis`);
  res.obs.forEach((ob, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${iso(ob.derniereBougieMs).padEnd(21)} ${ob.sens.padEnd(9)} ${prix(ob.haut).padStart(10)} ${prix(ob.bas).padStart(10)}  ${String(ob.bougiesAccumulation).padEnd(6)} ${iso(ob.valideMs + 1).padEnd(21)} ${ob.retoucheDepuisValidation ? 'oui' : 'non'}`);
  });
  console.log('\n  Contrôle de détection, pas un signal : HYP-005 a réfuté ce détecteur (p = 0,443).\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
