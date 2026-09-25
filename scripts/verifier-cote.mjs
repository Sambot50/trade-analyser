// Le proxy « clôture au-dessus de l'ouverture = achat » dit-il la vérité ?
//
//   node scripts/verifier-cote.mjs --csv trades-un-jour.csv --ut 15m
//
// Tout le scanner d'anomalies range ses évènements en achat ou en vente sur ce
// seul indice : la bougie a-t-elle clôturé plus haut qu'elle n'a ouvert. C'est
// une DEVINETTE. Une bougie qui monte de dix dollars puis en rend neuf clôture
// en hausse alors que l'agresseur dominant a vendu.
//
// Le schéma `trades` porte le côté de l'agresseur : celui qui a franchi le
// spread, qui a payé pour que ça bouge. On agrège une journée réelle, et on
// compte combien de fois le proxy se trompe.
//
// Ce script ne prouve rien sur le marché. Il mesure la fiabilité d'un de nos
// outils — et il peut très bien le condamner. C'est le but.

import { readFile } from 'node:fs/promises';

import { agregerTransactions } from '../src/lib/marche/transactions.js';
import { UNITES } from '../src/lib/marche/bougies.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '15m', decalageHeures: 0, seuilVolume: 0 };

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  if (!args.csv) throw new Error('--csv <fichier de transactions> est requis.');
  o.csv = args.csv;
  if (args.ut) {
    if (!UNITES[args.ut]) throw new Error(`--ut inconnue : ${args.ut}. Connues : ${Object.keys(UNITES).join(', ')}`);
    o.ut = args.ut;
  }
  if (args['decalage-heures'] !== undefined) o.decalageHeures = Number(args['decalage-heures']);
  // Le proxy n'a d'importance que là où le scanner s'en sert : sur les grosses
  // bougies. Un seuil permet de juger le proxy là où il est utilisé.
  if (args['seuil-volume'] !== undefined) o.seuilVolume = Number(args['seuil-volume']);
  return o;
}

/** Ce que le proxy affirme, et ce que l'agresseur a réellement fait. */
export function comparer(bougies, { seuilVolume = 0 } = {}) {
  const retenues = bougies.filter((b) => b.volume >= seuilVolume && b.volumeAcheteur + b.volumeVendeur > 0);

  let accords = 0;
  let desaccords = 0;
  let proxyMuet = 0;      // clôture = ouverture : le proxy n'a rien à dire
  let vraiMuet = 0;       // delta nul : l'agresseur non plus
  const fautes = [];

  for (const b of retenues) {
    const proxy = b.cloture > b.ouverture ? 'achat' : b.cloture < b.ouverture ? 'vente' : null;
    const vrai = b.delta > 0 ? 'achat' : b.delta < 0 ? 'vente' : null;

    if (proxy === null) { proxyMuet++; continue; }
    if (vrai === null) { vraiMuet++; continue; }

    if (proxy === vrai) accords++;
    else {
      desaccords++;
      fautes.push({
        ms: b.ouvertureMs, proxy, vrai, volume: b.volume,
        acheteur: b.volumeAcheteur, vendeur: b.volumeVendeur,
        amplitude: Number((b.cloture - b.ouverture).toFixed(2)),
        // Un désaccord sur un déséquilibre franc est bien plus grave qu'un
        // désaccord sur un delta de trois contrats.
        desequilibre: Number((Math.abs(b.delta) / (b.volumeAcheteur + b.volumeVendeur) * 100).toFixed(1)),
      });
    }
  }

  const juges = accords + desaccords;
  fautes.sort((a, b) => b.desequilibre - a.desequilibre);
  return {
    bougies: retenues.length,
    juges,
    accords,
    desaccords,
    proxyMuet,
    vraiMuet,
    tauxAccord: juges ? Number(((accords / juges) * 100).toFixed(1)) : null,
    fautes,
  };
}

/**
 * Un proxy qui tombe juste 50 % du temps vaut une pièce de monnaie ; à 95 % il
 * est utilisable. Entre les deux, tout dépend de ce qu'on en fait — et le
 * scanner en fait la séparation achat/vente de TOUS ses résultats.
 */
export function verdict(taux) {
  if (taux === null) return 'aucune bougie jugeable';
  if (taux >= 95) return 'proxy fiable — la séparation achat/vente du scanner tient';
  if (taux >= 80) return 'proxy approximatif — utilisable seulement avec la marge d’erreur affichée';
  if (taux >= 60) return 'proxy MAUVAIS — la séparation achat/vente est à refaire sur données réelles';
  return 'proxy INUTILISABLE — il ne vaut pas mieux que tirer à pile ou face';
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  const o = validerOptions(args);

  const contenu = await readFile(o.csv, 'utf8');
  const { bougies, nombreTransactions, ignorees, partSansCote } = agregerTransactions(contenu, {
    unite: o.ut, decalageHeures: o.decalageHeures,
  });

  console.log(`\n${nombreTransactions.toLocaleString('fr-FR')} transactions → ${bougies.length} bougies ${o.ut}`);
  if (ignorees) console.log(`${ignorees.toLocaleString('fr-FR')} évènements écartés (pas des transactions)`);
  console.log(`volume sans côté connu : ${partSansCote} %`);
  if (partSansCote > 5) {
    console.log('⚠  au-delà de 5 %, la ventilation acheteur/vendeur est elle-même incertaine.');
  }

  const r = comparer(bougies, { seuilVolume: o.seuilVolume });

  console.log(`\nBougies jugeables : ${r.juges} (proxy muet ${r.proxyMuet}, delta nul ${r.vraiMuet})`);
  console.log(`Accords    : ${r.accords}`);
  console.log(`Désaccords : ${r.desaccords}`);
  console.log(`\nTAUX D’ACCORD : ${r.tauxAccord} %  →  ${verdict(r.tauxAccord)}`);

  if (r.fautes.length) {
    console.log('\nLes désaccords les plus francs (le proxy s’y trompe sur un déséquilibre net) :');
    console.log('  date                 proxy   réel    acheteur   vendeur   déséq.   variation');
    for (const f of r.fautes.slice(0, 15)) {
      const d = new Date(f.ms).toISOString().slice(0, 16).replace('T', ' ');
      console.log(
        `  ${d}   ${f.proxy.padEnd(6)}  ${f.vrai.padEnd(6)}  `
        + `${String(f.acheteur).padStart(8)}  ${String(f.vendeur).padStart(8)}  `
        + `${String(f.desequilibre).padStart(5)} %  ${f.amplitude > 0 ? '+' : ''}${f.amplitude}`,
      );
    }
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
