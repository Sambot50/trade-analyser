// Le témoin des plans du journal : le modèle choisit-il mieux ses moments que
// le hasard ? Voir src/lib/journal/temoin.js et DEC-035.
//
//   node scripts/temoin.mjs --journal <dossier du journal> --symbole XAUUSD \
//                           --csv XAUUSD_M1.csv --decalage-heures -3
//   node scripts/temoin.mjs --journal <dossier> --symbole BTCUSDT
//
// Le dossier du journal est celui que l'application a rempli : il contient
// `index.jsonl`. Un fichier de bougies ne porte qu'un instrument, d'où
// `--symbole`, qui choisit les plans à tester.
//
// LES RÉGLAGES SONT FIGÉS PAR DEC-035. Aucune option ne permet de changer la
// fenêtre, la statistique, le traitement des ambigus ou le nombre de tirages :
// une option qui le permettrait transformerait le témoin en recherche, et on
// tournerait les boutons jusqu'à obtenir le p voulu (garde-fou 7).
//
// NON VÉRIFIÉ : la source Binance. Elle passe par `journal/market.js`, dont
// l'appel réseau n'a jamais pu être éprouvé depuis l'environnement d'écriture.
// La source fichier est testée de bout en bout.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseArgs } from './backtest.mjs';
import { controlerParTemoinGroupes } from '../src/lib/journal/temoin.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { reduireIndex, HORIZON_RESOLUTION_MINUTES, OBJECTIF_JOURNAL } from '../src/lib/journal/schema.js';
import { OBJECTIFS } from '../src/lib/journal/resolve.js';
import { recupererBougiesPaginees, versPaireBinance, MINUTES_PAR_BOUGIE } from '../src/lib/journal/market.js';
import { analyser as analyserCsv, avertissementsLecture } from '../src/lib/marche/csv.js';
import { UNITES, dureeUnite } from '../src/lib/marche/bougies.js';

/** Figés par DEC-035. Exportés pour être affichés et testés, jamais réglés. */
export const GEL = Object.freeze({
  fenetreJours: 30,
  horizonMinutes: HORIZON_RESOLUTION_MINUTES,
  remplissage: 'meche',
  ambigu: 'perdant',
  ambiguSensibilite: 'gagnant',
  tirages: 1000,
  graine: 1,
});

const JOUR = 86_400_000;

/**
 * Les lectures pré-enregistrées. Un journal produit par `rejouer.mjs` porte
 * son protocole dans `rejeu.json` ; le témoin applique alors CELUI-LÀ, sans
 * option pour en changer.
 *
 *   DEC-036 — 1 000 tirages : le réglage sous lequel le résultat a été lu.
 *   DEC-037 — 10 000 tirages : à 1 000, p porte lui-même ±0,007 de bruit, de
 *             la taille de la marge de DEC-036. Plus une ventilation par
 *             trimestre, descriptive.
 */
export const LECTURES = Object.freeze({
  'DEC-036': Object.freeze({ tirages: 1000, seuil: 0.05, trimestres: false }),
  'DEC-037': Object.freeze({ tirages: 10_000, seuil: 0.05, trimestres: true }),
});

/** La lecture à appliquer à un journal, d'après sa signature de rejeu. */
export function lectureDuJournal(signature) {
  if (!signature) return null;
  const lecture = LECTURES[signature.protocole];
  if (!lecture) throw new Error(`Protocole inconnu dans rejeu.json : "${signature.protocole}".`);
  return { protocole: signature.protocole, ...lecture };
}

/**
 * L'écart réel − témoin, trimestre par trimestre. Descriptif seulement : il dit
 * si l'écart se répartit sur la période ou tient à quelques mois — par exemple
 * à un changement de volatilité que la fenêtre du témoin, toujours ANTÉRIEURE
 * au plan, ne verrait pas de la même façon.
 */
export function parTrimestre(retenus) {
  const groupes = new Map();
  for (const e of retenus) {
    const d = new Date(e.instantMs);
    const cle = `${d.getUTCFullYear()}-T${Math.floor(d.getUTCMonth() / 3) + 1}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(e);
  }
  const moyenne = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  return [...groupes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([trimestre, es]) => ({
    trimestre, n: es.length,
    reel: moyenne(es.map((e) => e.r)),
    temoin: moyenne(es.map((e) => e.temoinMoyen)),
  }));
}

const normaliserSymbole = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function validerOptions(args) {
  const erreurs = [];
  const o = {};

  if (typeof args.journal !== 'string') erreurs.push('--journal manquant : le dossier qui contient index.jsonl');
  else o.journal = args.journal;

  if (typeof args.symbole !== 'string') erreurs.push('--symbole manquant : les plans de quel instrument tester ?');
  else o.symbole = args.symbole;

  o.csv = typeof args.csv === 'string' ? args.csv : undefined;
  if (args.csv === true) erreurs.push('--csv attend un chemin de fichier');

  o.utCsv = args.utCsv ?? '1m';
  if (!UNITES[o.utCsv]) erreurs.push(`--ut-csv "${o.utCsv}" inconnue (${Object.keys(UNITES).join(', ')})`);

  o.decalageHeures = 0;
  if (args.decalageHeures !== undefined) {
    o.decalageHeures = Number(args.decalageHeures);
    if (!o.csv) erreurs.push('--decalage-heures ne s’applique qu’à un fichier (--csv)');
    else if (!Number.isFinite(o.decalageHeures) || Math.abs(o.decalageHeures) > 14) {
      erreurs.push('--decalage-heures doit être un nombre d’heures entre -14 et 14');
    }
  }
  o.garderDerniere = args.garderDerniere === true;

  if (!o.csv && o.symbole && !versPaireBinance(o.symbole)) {
    erreurs.push(`"${o.symbole}" n’est pas une paire Binance : fournis ses bougies avec --csv.`);
  }

  for (const interdit of ['fenetre', 'tirages', 'graine', 'ambigu', 'remplissage', 'horizon', 'objectif']) {
    if (args[interdit] !== undefined) erreurs.push(`--${interdit} n’existe pas : ce réglage est figé par DEC-035.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/**
 * Les plans du journal pour un instrument, et le compte de tout ce qui a été
 * laissé de côté. Une ligne illisible n'est pas ignorée en silence : elle
 * pourrait être un plan perdant (même règle que le carnet).
 */
export function plansDuJournal(texte, symbole) {
  const lignes = [];
  let illisibles = 0;
  for (const brute of texte.split('\n')) {
    if (!brute.trim()) continue;
    try { lignes.push(JSON.parse(brute)); } catch { illisibles++; }
  }

  // L'index mêle analyses, mesures géométriques et trouvailles jugées. Seules
  // les analyses portent un plan.
  const analyses = reduireIndex(lignes)
    .filter((l) => l.type !== 'mesure' && l.direction && Number.isFinite(l.prixEntree));

  const cible = normaliserSymbole(symbole);
  const retenues = analyses.filter((l) => normaliserSymbole(l.symbole) === cible);

  const objectifs = [...new Set(retenues.map((l) => l.objectifDeSortie ?? OBJECTIF_JOURNAL))];
  if (objectifs.length > 1) {
    return { erreur: `Règles de sortie mêlées (${objectifs.join(', ')}) : un témoin ne compare qu’une règle à la fois.` };
  }
  const objectif = objectifs[0] ?? OBJECTIF_JOURNAL;
  if (!OBJECTIFS[objectif]) return { erreur: `Règle de sortie inconnue dans le journal : "${objectif}".` };

  return {
    objectif,
    entrees: retenues.map((l) => ({
      id: l.id,
      instantMs: Date.parse(l.horodatage),
      plan: {
        direction: l.direction,
        prixEntree: l.prixEntree, prixStopLoss: l.prixStopLoss, prixTp1: l.prixTp1, prixTp2: l.prixTp2,
      },
    })),
    ignorees: { illisibles, autresSymboles: analyses.length - retenues.length },
  };
}

async function chargerBougies(o, entrees) {
  if (o.csv) {
    const lecture = analyserCsv(await readFile(o.csv, 'utf8'), {
      unite: o.utCsv, decalageHeures: o.decalageHeures, exclureDerniere: o.garderDerniere ? false : 'auto',
    });
    console.log(`  ${lecture.bougies.length} bougies ${o.utCsv} lues dans ${o.csv}`);
    for (const ligne of avertissementsLecture(lecture)) console.log(`  ⚠  ${ligne}`);
    return { bougies: lecture.bougies, uniteMs: dureeUnite(o.utCsv) };
  }

  // Binance : toute la plage d'un coup, de la fenêtre du plus ancien plan à
  // l'horizon du plus récent. Non vérifié, voir l'en-tête.
  const debut = Math.min(...entrees.map((e) => e.instantMs)) - GEL.fenetreJours * JOUR;
  const fin = Math.max(...entrees.map((e) => e.instantMs)) + GEL.horizonMinutes * 60_000;
  const nombre = Math.ceil((fin - debut) / (MINUTES_PAR_BOUGIE * 60_000));
  console.log(`  ${nombre} bougies à récupérer sur Binance (${versPaireBinance(o.symbole)})…`);
  const bougies = await recupererBougiesPaginees({ symbole: versPaireBinance(o.symbole), depuisMs: debut, nombre });
  return { bougies, uniteMs: MINUTES_PAR_BOUGIE * 60_000 };
}

/**
 * Range chaque plan dans la série du contrat coté à son instant.
 *
 * Un fichier de contrats à terme en enchaîne une douzaine ; les recoller
 * créerait un saut de prix à chaque roulement (DEC-027). Une série sans
 * étiquette de contrat — Binance, CFD — reste une série unique.
 */
export function grouperParContrat(bougies, entrees) {
  const { segments } = decouperParContrat(bougies);
  const groupes = segments.map((s) => ({ symbole: s.symbole, bougies: s.bougies, entrees: [] }));
  const horsSerie = [];
  for (const e of entrees) {
    const g = groupes.find((x) => x.bougies[0].ouvertureMs <= e.instantMs && e.instantMs <= x.bougies.at(-1).fermetureMs);
    if (g) g.entrees.push(e);
    else horsSerie.push({ id: e.id, raison: 'aucune bougie du fichier ne couvre l’instant de l’analyse' });
  }
  return { groupes: groupes.filter((g) => g.entrees.length), horsSerie };
}

const r = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(3)} R`);

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/temoin.mjs --journal ./journal --symbole XAUUSD --csv XAUUSD_M1.csv --decalage-heures -3\n');
    process.exit(1);
  }

  let texte;
  try { texte = await readFile(join(o.journal, 'index.jsonl'), 'utf8'); } catch (err) {
    console.error(`\nIndex illisible dans ${o.journal} : ${err.message}\n`);
    process.exit(2);
  }

  const journal = plansDuJournal(texte, o.symbole);
  if (journal.erreur) { console.error(`\n${journal.erreur}\n`); process.exit(2); }

  // Un journal de rejeu dit sous quel protocole il doit être lu, et sur quel
  // fichier exactement : un autre fichier jugerait des plans qu'il n'a pas vus
  // naître.
  let signature = null;
  try { signature = JSON.parse(await readFile(join(o.journal, 'rejeu.json'), 'utf8')); } catch { /* journal ordinaire */ }
  let lecture;
  try { lecture = lectureDuJournal(signature); } catch (err) { console.error(`\n${err.message}\n`); process.exit(2); }
  if (signature && o.csv) {
    const sha = createHash('sha256').update(await readFile(o.csv, 'utf8')).digest('hex');
    if (sha !== signature.sha256Fichier) {
      console.error(`\nCe fichier n'est pas celui du rejeu (${signature.fichier}, ${signature.sha256Fichier.slice(0, 12)}…). Refusé.\n`);
      process.exit(2);
    }
  }
  const tirages = lecture?.tirages ?? GEL.tirages;

  console.log(`\nTémoin — ${o.symbole}, règle de sortie ${journal.objectif}, ` +
    (lecture ? `lecture pré-enregistrée ${lecture.protocole}` : 'réglages figés par DEC-035'));
  console.log(`  fenêtre ${GEL.fenetreJours} j avant chaque analyse · horizon ${GEL.horizonMinutes / 60} h · ` +
    `remplissage ${GEL.remplissage} · ambigu ${GEL.ambigu} · ${tirages} tirages · graine ${GEL.graine}`);
  console.log(`  ${journal.entrees.length} plan(s) pour ${o.symbole} · ${journal.ignorees.autresSymboles} d’autres instruments` +
    (journal.ignorees.illisibles ? ` · ⚠  ${journal.ignorees.illisibles} ligne(s) d’index illisible(s)` : ''));

  if (!journal.entrees.length) { console.log('\nAucun plan à tester.\n'); return; }

  let bougies, uniteMs;
  try { ({ bougies, uniteMs } = await chargerBougies(o, journal.entrees)); } catch (err) {
    console.error(`\nÉchec : ${err.message}\n`);
    process.exit(2);
  }

  const reglages = {
    horizonBougies: Math.round((GEL.horizonMinutes * 60_000) / uniteMs),
    objectif: journal.objectif, remplissage: GEL.remplissage,
    fenetreMs: GEL.fenetreJours * JOUR, tirages, graine: GEL.graine,
  };
  const { groupes, horsSerie } = grouperParContrat(bougies, journal.entrees);
  if (groupes.length > 1 || groupes[0]?.symbole) {
    console.log(`  ${groupes.length} contrat(s) concerné(s) : ${groupes.map((g) => `${g.symbole} (${g.entrees.length})`).join(', ')}`);
  }
  const res = controlerParTemoinGroupes(groupes, { ...reglages, ambigu: GEL.ambigu });
  const sens = controlerParTemoinGroupes(groupes, { ...reglages, ambigu: GEL.ambiguSensibilite });
  res.exclus.push(...horsSerie);

  console.log('\n=== Plans ===\n');
  for (const e of res.retenus) {
    console.log(`  ${e.id.padEnd(40)} ${e.plan.direction.padEnd(4)} ${e.statut.padEnd(16)} ${r(e.r).padStart(9)}   ${e.candidats} instants de témoin`);
  }
  for (const e of res.exclus) console.log(`  ${String(e.id).padEnd(40)} écarté : ${e.raison}`);

  if (!res.retenus.length) { console.log('\nAucun plan exploitable.\n'); return; }

  const t = res.temoin;
  console.log('\n=== Réel contre témoin ===\n');
  console.log(`  ${`réel, moyenne sur ${res.retenus.length} plan(s)`.padEnd(34)}${r(res.reel)}`);
  console.log(`  témoin, médiane des tirages       ${r(t.mediane)}   [${r(t.minimum)} … ${r(t.maximum)}]`);
  console.log(`  p                                 ${res.p.p}   (${res.p.auMoinsAussiBons}/${res.p.tirages} tirages font au moins aussi bien ; plancher ${res.p.plancher})`);
  console.log(`  sensibilité, ambigus gagnants     réel ${r(sens.reel)} · médiane témoin ${r(sens.temoin.mediane)} · p ${sens.p.p}`);

  if (lecture?.trimestres) {
    console.log('\n=== Par trimestre — descriptif, ne décide rien ===\n');
    for (const q of parTrimestre(res.retenus)) {
      console.log(`  ${q.trimestre}   n ${String(q.n).padStart(3)}   réel ${r(q.reel).padStart(9)}   témoin ${r(q.temoin).padStart(9)}   écart ${r(q.reel - q.temoin).padStart(9)}`);
    }
  }

  if (lecture) {
    const passe = res.p.p < lecture.seuil;
    console.log(`\n  Règle de ${lecture.protocole}, écrite d'avance : p < ${lecture.seuil} → ${passe ? 'PASSE' : 'NE PASSE PAS'}.`);
    console.log('  À appliquer telle quelle. Relancer ce témoin ou ce rejeu ne produit pas un second essai.\n');
  } else {
    console.log('\n  Ce chiffre ne décide rien sans pré-enregistrement de l’effectif et du seuil');
    console.log('  (voir DEC-036 pour un exemple). Lu en cours de route, il ne sert qu’à');
    console.log('  vérifier que la chaîne tourne.\n');
  }
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
