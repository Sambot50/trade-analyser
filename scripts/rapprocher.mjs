// Ce que l'image a mesuré, confronté à ce que le marché a fait.
//
//   node scripts/rapprocher.mjs --mesure "chemin/mesure.json" --csv BTCUSD_15.csv --ut 15m
//
// C'est la seule vérification de la chaîne de vision qui ne soit pas
// circulaire. L'aller-retour du module prouve que l'extraction retrouve ce que
// ce dépôt a DESSINÉ : elle se compare à son propre moteur de rendu, et une
// erreur partagée par les deux resterait invisible pour toujours. Ici, la
// référence vient d'ailleurs.
//
// Le CSV vient de TradingView — « Export chart data » — et pas d'une bourse
// tierce, délibérément. Comparer une capture TradingView à des bougies Binance
// additionnerait deux choses sans permettre de les séparer : l'erreur de
// lecture de l'image, et l'écart entre deux places de marché. Le BTCUSD
// affiché n'est pas forcément le BTCUSDT coté ailleurs.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { analyser as analyserCsv, agreger } from '../src/lib/marche/csv.js';
import { dureeUnite } from '../src/lib/marche/bougies.js';
import { rapprocher, prixParPixel, CHAMPS } from '../src/lib/marche/rapprochement.js';
import { parseArgs } from './backtest.mjs';

const LIBELLES = {
  ouverture: 'ouverture', cloture: 'clôture', plusHaut: 'plus haut', plusBas: 'plus bas',
};

export function minutesDeLUnite(unite) {
  // `dureeUnite` lève sur une unité inconnue. Ici l'unité vient d'un
  // enregistrement ou d'un argument : une saisie, pas une constante du code.
  // Elle mérite un message à elle, pas une pile d'appels.
  try {
    const ms = dureeUnite(unite);
    return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : null;
  } catch {
    return null;
  }
}

/**
 * L'instant de la dernière bougie mesurée.
 *
 * L'horodatage du journal est celui de l'ENREGISTREMENT, pas de la capture :
 * quelques secondes à quelques minutes plus tard. L'alignement rattrape ce
 * décalage, à condition qu'on parte d'un point de départ plausible — d'où ce
 * repli explicite plutôt qu'une valeur devinée en silence.
 */
export function finSupposee(record, surcharge) {
  if (surcharge) {
    const t = Date.parse(surcharge);
    if (Number.isFinite(t)) return t;
    throw new Error(`--fin n'est pas une date lisible : ${surcharge}`);
  }
  const t = Date.parse(record?.horodatage);
  if (!Number.isFinite(t)) throw new Error("L'enregistrement ne porte pas d'horodatage lisible.");
  return t;
}

export function rendreRapport(resultat, { mesure, unite, parPixel }) {
  const out = [];
  if (!resultat.ok) {
    out.push(`ÉCHEC — ${resultat.probleme}`);
    return out.join('\n');
  }

  out.push(`${resultat.nombreApparie} bougies appariées sur ${mesure.nombreDeBougies}`
    + ` · décalage ${resultat.decalage > 0 ? '+' : ''}${resultat.decalage} bougie(s) de ${unite}`);
  out.push(`niveau médian ${resultat.niveauMedian.toFixed(2)}`
    + (parPixel ? ` · un pixel vaut ${parPixel.toFixed(2)}` : ''));
  out.push('');
  out.push('prix         écart médian   en pixels   pire écart    biais médian');
  out.push('─────────────────────────────────────────────────────────────────');
  for (const champ of CHAMPS) {
    const c = resultat.parChamp[champ];
    if (!c) { out.push(`${LIBELLES[champ].padEnd(13)}non mesurable`); continue; }
    const px = parPixel ? (c.ecartMedian / parPixel).toFixed(2) : '—';
    // Le signe fait partie du nombre : le coller APRÈS le remplissage le
    // pousserait dans la colonne voisine, et un tableau qui ne s'aligne pas
    // ne se lit pas.
    const biais = (c.biaisMedian >= 0 ? '+' : '') + c.biaisMedian.toFixed(2);
    out.push(
      LIBELLES[champ].padEnd(13)
      + c.ecartMedian.toFixed(2).padStart(12)
      + px.padStart(12)
      + c.ecartPire.toFixed(2).padStart(13)
      + biais.padStart(16),
    );
  }
  out.push('');
  out.push('Lire l’écart en PIXELS, pas en points : une erreur plus petite qu’un pixel');
  out.push('n’est pas une erreur de lecture, c’est la limite de ce que l’image porte.');
  out.push('');
  out.push('Le biais médian est le chiffre qui compte. Un écart sans biais est du bruit');
  out.push('de quadrillage, et il ne se corrige pas. Un biais est une échelle fausse, et');
  out.push('il déplace TOUT dans le même sens — y compris les niveaux d’un plan.');

  const suspects = CHAMPS.filter((c) => {
    const x = resultat.parChamp[c];
    return x && parPixel && Math.abs(x.biaisMedian) > 1.5 * parPixel;
  });
  if (suspects.length) {
    out.push('');
    out.push(`ATTENTION — biais supérieur à un pixel et demi sur : ${suspects.map((c) => LIBELLES[c]).join(', ')}.`);
    out.push('L’échelle lue sur l’axe est probablement décalée. Vérifier les graduations.');
  }
  return out.join('\n');
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mesure || !args.csv) {
    console.error('Usage : node scripts/rapprocher.mjs --mesure <mesure.json> --csv <export.csv> [--ut 15m] [--fin <ISO>] [--ut-csv 1m] [--decalage-heures 0]');
    process.exit(2);
  }

  const record = JSON.parse(await readFile(args.mesure, 'utf8'));
  const mesure = record.mesure ?? record;
  if (!Array.isArray(mesure?.bougies)) throw new Error("Ce fichier ne contient pas de bougies mesurées.");

  const unite = args.ut ?? record.marche?.uniteTemps;
  if (!unite) throw new Error("Aucune unité de temps : ni dans l'enregistrement, ni en --ut.");
  const minutes = minutesDeLUnite(unite);
  if (!minutes) throw new Error(`Unité de temps non reconnue : ${unite}`);

  const contenu = await readFile(args.csv, 'utf8');
  // `analyser` rend un objet, pas un tableau : il porte aussi de quoi dire si
  // le volume est exploitable, dont on n'a pas l'usage ici.
  const { bougies: brutes } = analyserCsv(contenu, {
    unite: args.utCsv ?? unite,
    decalageHeures: Number(args.decalageHeures ?? 0),
  });
  const reelles = args.utCsv && args.utCsv !== unite ? agreger(brutes, unite) : brutes;

  const parPixel = prixParPixel(
    Math.abs(mesure.echelleDesPrix?.prixEnHautDuTrace - mesure.echelleDesPrix?.prixEnBasDuTrace),
    mesure.echelleDesPrix?.hauteurTraceEnPixels,
  );

  const resultat = rapprocher({
    mesurees: mesure.bougies,
    reelles,
    finMs: finSupposee(record, args.fin),
    uniteMinutes: minutes,
    fenetre: Number(args.fenetre ?? 5),
  });

  console.log(`\n${record.marche?.symbole ?? 'symbole inconnu'} · ${unite} · ${reelles.length} bougies réelles lues\n`);
  console.log(rendreRapport(resultat, { mesure, unite, parPixel }));
  console.log('');
  if (!resultat.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((err) => { console.error(err.message); process.exit(1); });
}
