// Le carnet de trades réels.
//
//   node scripts/carnet.mjs --ouvrir --marche GC --tranche 2.4 --sens achat \
//                           --entree 4320.5 --stop 14.6 --objectif 16.8
//   node scripts/carnet.mjs --fermer 7 --sortie 4305.9 --issue stop --frais 0.4
//   node scripts/carnet.mjs --bilan
//   node scripts/carnet.mjs --liste
//
// POURQUOI CE FICHIER EXISTE. DEC-031 a établi que le volume ne dit rien de la
// direction : elle vient de toi. DEC-034 a chiffré ce que le plan coûte à
// faire tourner — 0,08 R par trade. Il manque un seul chiffre pour savoir si
// l'ensemble peut gagner : ce que vaut TA lecture. Il ne se simule pas, il se
// relève.
//
// Le fichier est en AJOUT SEUL et le script n'en réécrit jamais une ligne. Un
// carnet corrigeable enregistre ce qu'on aurait voulu faire.
//
// `carnet.jsonl` est couvert par `.gitignore` (*.jsonl) : tes positions ne
// partent pas sur GitHub, et c'est voulu — ce dépôt est public.

import { appendFile, readFile } from 'node:fs/promises';

import { parseArgs } from './backtest.mjs';
import { lireEvenements, reconstituer, bilan, BARRE, MINIMUM } from '../src/lib/carnet.js';

const FICHIER = 'carnet.jsonl';

export async function charger(chemin) {
  let texte = '';
  try { texte = await readFile(chemin, 'utf8'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const { evenements, illisibles } = lireEvenements(texte);
  return { ...reconstituer(evenements), illisibles, evenements };
}

/** Le prochain identifiant : un de plus que le plus grand déjà vu. */
export function prochainId(evenements) {
  let max = 0;
  for (const e of evenements) if (Number.isFinite(e.id) && e.id > max) max = e.id;
  return max + 1;
}

const ajouter = (chemin, objet) => appendFile(chemin, JSON.stringify(objet) + '\n', 'utf8');

const enR = (x) => (x === null ? '    —  ' : `${x >= 0 ? '+' : ''}${x.toFixed(3)}`);
const ligne = (n) => '─'.repeat(n);

function afficherBilan(etat) {
  const b = bilan(etat.fermes);
  console.log(`\n${ligne(68)}`);
  console.log(`  CARNET — ${etat.fermes.length} trade(s) fermé(s) · ${etat.ouverts.length} ouvert(s)`);
  console.log(ligne(68));

  if (!b) {
    console.log('\n  Aucun trade fermé. Ouvre-en un, puis ferme-le à sa sortie.\n');
    return;
  }

  console.log(`\n  espérance BRUTE   ${enR(b.brut.moyenne)} R   ± ${b.brut.erreurType === null ? '—' : b.brut.erreurType.toFixed(3)}`);
  console.log(`                    la barre à franchir est ${b.barre.toFixed(3)} R — la friction mesurée par DEC-034`);
  console.log(`\n  espérance NETTE   ${enR(b.net.moyenne)} R   ± ${b.net.erreurType === null ? '—' : b.net.erreurType.toFixed(3)}`);
  console.log(`                    frais réellement payés : ${b.fraisMoyens === null ? '—' : b.fraisMoyens.toFixed(3)} R par trade`);

  if (b.marge !== null) {
    const mot = b.marge >= 0 ? 'au-dessus' : 'en dessous';
    console.log(`\n  La brute est à ${Math.abs(b.marge).toFixed(1)} erreur(s) type ${mot} de la barre.`);
  }

  if (!b.assez) {
    console.log(`\n  ⚠ ${b.brut.n} trade(s) : sous ${b.minimum}, une moyenne de R ne décrit rien.`);
    console.log(`    Continue de relever. Ne tire aucune conclusion de ce chiffre.`);
  }

  const bloc = (titre, rangees) => {
    if (!rangees.length) return;
    console.log(`\n  ${titre}`);
    for (const r of rangees) {
      console.log(`    ${String(r.cle).padEnd(12)} ${String(r.n).padStart(4)}   brut ${enR(r.brut)} R   net ${enR(r.net)} R`);
    }
  };
  bloc('par issue', b.parIssue);
  bloc('par tranche', b.parTranche);
  bloc('par sens', b.parSens);

  if (etat.ouverts.length) {
    console.log('\n  encore ouverts');
    for (const o of etat.ouverts) {
      console.log(`    #${o.id}  ${o.marche ?? '—'}  ${o.sens}  entrée ${o.entree}  stop ${o.stop}  ${o.le ?? ''}`);
    }
  }
  console.log();
}

function afficherAnomalies(etat) {
  if (!etat.illisibles.length && !etat.anomalies.length) return;
  console.log(`\n  ⚠ CE QUI CLOCHE DANS LE CARNET`);
  for (const i of etat.illisibles) console.log(`    ligne ${i.ligne} illisible : ${i.raison}`);
  for (const a of etat.anomalies) console.log(`    ligne ${a.ligne} : ${a.quoi}`);
  console.log(`    Rien n'est corrigé automatiquement : le fichier est en ajout seul.`);
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  const chemin = typeof args.fichier === 'string' ? args.fichier : FICHIER;
  const etat = await charger(chemin);

  if (args.ouvrir) {
    const sens = String(args.sens ?? '');
    const entree = Number(args.entree);
    const stop = Number(args.stop);
    if (!['achat', 'vente'].includes(sens) || !Number.isFinite(entree) || !(stop > 0)) {
      console.error('\n  --ouvrir exige : --sens achat|vente  --entree <prix>  --stop <distance en prix>');
      console.error('  optionnel : --marche GC  --tranche 2.4  --objectif <distance>  --note "…"\n');
      process.exit(1);
    }
    const id = prochainId(etat.evenements);
    await ajouter(chemin, {
      t: 'ouverture', id, le: new Date().toISOString(),
      marche: args.marche ?? null,
      tranche: Number.isFinite(Number(args.tranche)) ? Number(args.tranche) : null,
      sens, entree, stop,
      objectif: Number.isFinite(Number(args.objectif)) ? Number(args.objectif) : null,
      note: args.note ?? null,
    });
    console.log(`\n  trade #${id} ouvert · ${sens} ${args.marche ?? ''} à ${entree} · stop ${stop} (1 R)`);
    console.log(`  ferme-le à sa sortie : node scripts/carnet.mjs --fermer ${id} --sortie <prix> --issue <objectif|stop|seuilNul|temps>\n`);
    return;
  }

  if (args.fermer !== undefined) {
    const id = Number(args.fermer);
    const sortie = Number(args.sortie);
    if (!Number.isFinite(id) || !Number.isFinite(sortie)) {
      console.error('\n  --fermer <id> exige : --sortie <prix>   optionnel : --issue <…>  --frais <en prix>\n');
      process.exit(1);
    }
    const ouvert = etat.ouverts.find((o) => o.id === id);
    if (!ouvert) {
      console.error(`\n  Aucun trade #${id} ouvert. Ouverts : ${etat.ouverts.map((o) => '#' + o.id).join(' ') || 'aucun'}\n`);
      process.exit(1);
    }
    await ajouter(chemin, {
      t: 'fermeture', id, le: new Date().toISOString(), sortie,
      issue: args.issue ?? null,
      frais: Number.isFinite(Number(args.frais)) ? Number(args.frais) : null,
    });
    const apres = await charger(chemin);
    const t = apres.fermes.find((x) => x.id === id);
    console.log(`\n  trade #${id} fermé · ${enR(t.brut)} R brut · ${enR(t.net)} R net`);
    console.log(`  ${apres.fermes.length} trade(s) au carnet · barre ${BARRE} R · minimum utile ${MINIMUM}\n`);
    return;
  }

  if (args.liste) {
    console.log(`\n  ${etat.ouverts.length} trade(s) ouvert(s)`);
    for (const o of etat.ouverts) {
      console.log(`    #${o.id}  ${o.marche ?? '—'}  ${o.sens}  entrée ${o.entree}  stop ${o.stop}  objectif ${o.objectif ?? '—'}  ${o.le ?? ''}`);
    }
    console.log();
    afficherAnomalies(etat);
    return;
  }

  afficherBilan(etat);
  afficherAnomalies(etat);
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
