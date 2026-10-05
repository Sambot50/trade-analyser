// Le rejeu du modèle sur des jours passés, tirés d'avance. Voir DEC-036.
//
//   node scripts/rejouer.mjs --csv GC_2023_2024.csv --symbole GC --sortie rejeu-gc
//   node scripts/rejouer.mjs --csv GC_2023_2024.csv --symbole GC --sortie rejeu-gc --limite 3
//
// Puis, une fois les plans réunis :
//
//   node scripts/temoin.mjs --journal rejeu-gc --symbole GC --csv GC_2023_2024.csv
//
// Le script s'interrompt et reprend sans rien refaire : chaque jour traité est
// écrit avant de passer au suivant. Une panne du modèle ARRÊTE le rejeu au
// lieu de sauter le jour — un jour sauté pour une raison technique serait un
// trou dans la liste tirée, et rien ne garantirait qu'il soit neutre.
//
// TOUT EST FIGÉ PAR DEC-036 : modèle, invite, heure, graine, nombre de plans,
// graphique. Aucune option ne les change. `--limite` ne fait que s'arrêter
// plus tôt, pour un essai : la reprise continue ensuite la même liste.
//
// Le rejeu ne résout AUCUNE issue et n'en affiche aucune. Il produit des plans,
// le témoin les jugera une seule fois, à la fin.

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parseArgs } from './backtest.mjs';
import { GEL as GEL_TEMOIN } from './temoin.mjs';
import {
  joursDuRejeu, facteurDeguisement, deguiserBougies, bougiesDuGraphique, ramenerPlan, idRejeu,
} from '../src/lib/journal/rejeu.js';
import { OBJECTIF_JOURNAL } from '../src/lib/journal/schema.js';
import { analyser as analyserCsv } from '../src/lib/marche/csv.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { UNITES, dureeUnite } from '../src/lib/marche/bougies.js';
import { tracerGraphique } from '../src/lib/marche/graphique.js';
import { validateAnalysis, validateScale } from '../src/lib/analysis.js';
import { analyzeChart } from '../src/lib/providers/ollama.js';
import { ANALYSIS_PROMPT } from '../src/lib/providers/schema.js';

/** Figés par DEC-036. Exportés pour être affichés et testés, jamais réglés. */
export const GEL = Object.freeze({
  nombre: 100,
  heure: '15:30',
  fuseau: 'Europe/Paris',
  graine: 20261005,
  uniteGraphique: '15m',
  bougiesGraphique: 150,
  modele: 'qwen3.8:27b',
  libelle: 'INSTRUMENT',
  essaisParJour: 3,
});

/**
 * Les protocoles qu'un rejeu peut servir. Le rejeu lui-même est identique de
 * l'un à l'autre ; seul change le fichier, et donc la question. Le nom du
 * protocole est écrit dans `rejeu.json` : c'est lui qui dit au témoin quels
 * réglages de lecture appliquer.
 *
 *   DEC-036 — GC 2023-2024, l'épreuve.
 *   DEC-037 — GC 2025-2026, la réplication, sur des jours jamais montrés.
 */
export const PROTOCOLES = Object.freeze(['DEC-036', 'DEC-037']);

const empreinte = (texte) => createHash('sha256').update(texte).digest('hex');

export function validerOptions(args) {
  const erreurs = [];
  const o = {};

  for (const [cle, message] of [['csv', 'le fichier de bougies 1 minute'], ['symbole', 'le nom de l’instrument au journal, ex. GC'], ['sortie', 'le dossier du journal de rejeu']]) {
    if (typeof args[cle] !== 'string') erreurs.push(`--${cle} manquant : ${message}`);
    else o[cle] = args[cle];
  }

  o.utCsv = args.utCsv ?? '1m';
  if (o.utCsv !== '1m') erreurs.push('--ut-csv doit valoir 1m : la résolution du témoin se fait en 1 minute.');
  if (!UNITES[o.utCsv]) erreurs.push(`--ut-csv "${o.utCsv}" inconnue`);

  o.decalageHeures = 0;
  if (args.decalageHeures !== undefined) {
    o.decalageHeures = Number(args.decalageHeures);
    if (!Number.isFinite(o.decalageHeures) || Math.abs(o.decalageHeures) > 14) erreurs.push('--decalage-heures doit être un nombre d’heures entre -14 et 14');
  }

  if (args.limite !== undefined) {
    o.limite = Number(args.limite);
    if (!Number.isInteger(o.limite) || o.limite < 1) erreurs.push('--limite attend un entier ≥ 1');
  }
  o.baseUrl = typeof args.baseUrl === 'string' ? args.baseUrl : undefined;

  o.protocole = args.protocole ?? 'DEC-036';
  if (!PROTOCOLES.includes(o.protocole)) erreurs.push(`--protocole "${o.protocole}" inconnu (${PROTOCOLES.join(', ')})`);

  for (const interdit of ['modele', 'graine', 'heure', 'nombre', 'bougies', 'ut', 'fuseau']) {
    if (args[interdit] !== undefined) erreurs.push(`--${interdit} n’existe pas : ce réglage est figé par DEC-036 et DEC-037.`);
  }

  return erreurs.length ? { erreurs } : o;
}

/** Ce qui identifie un rejeu. Deux rejeux qui diffèrent ici ne se mélangent pas. */
export function signature({ contenuCsv, o }) {
  return {
    protocole: o.protocole,
    fichier: basename(o.csv),
    sha256Fichier: empreinte(contenuCsv),
    sha256Invite: empreinte(ANALYSIS_PROMPT),
    symbole: o.symbole,
    decalageHeures: o.decalageHeures,
    ...GEL,
    objectifDeSortie: OBJECTIF_JOURNAL,
    fenetreJours: GEL_TEMOIN.fenetreJours,
    horizonMinutes: GEL_TEMOIN.horizonMinutes,
  };
}

async function lireJsonl(chemin) {
  let texte = '';
  try { texte = await readFile(chemin, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  return texte.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function rendrePng(svg) {
  let Resvg;
  try { ({ Resvg } = await import('@resvg/resvg-js')); } catch {
    throw new Error('@resvg/resvg-js introuvable : lance `npm ci` (dépendance de développement).');
  }
  return new Resvg(svg).render().asPng();
}

async function analyserAvecReprise(dataUrl, o) {
  let derniere;
  for (let essai = 1; essai <= GEL.essaisParJour; essai++) {
    try {
      return await analyzeChart(dataUrl, { model: GEL.modele, baseUrl: o.baseUrl });
    } catch (err) {
      derniere = err;
      // Un JSON illisible est une réponse du modèle, pas une panne : on la
      // consigne comme un rejet, sans réessayer jusqu'à obtenir mieux.
      if (/JSON|Réponse vide/.test(err.message)) return { illisible: err.message };
    }
  }
  throw derniere;
}

async function main() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/rejouer.mjs --csv GC_2023_2024.csv --symbole GC --sortie rejeu-gc\n');
    process.exit(1);
  }

  await mkdir(o.sortie, { recursive: true });
  const contenuCsv = await readFile(o.csv, 'utf8');
  const sig = signature({ contenuCsv, o });

  // Un dossier ne sert qu'à un rejeu. Reprendre avec un autre fichier, une
  // autre invite ou un autre modèle mélangerait deux protocoles.
  const cheminSig = join(o.sortie, 'rejeu.json');
  let existante = null;
  try { existante = JSON.parse(await readFile(cheminSig, 'utf8')); } catch { /* premier lancement */ }
  if (existante) {
    const differences = Object.keys(sig).filter((k) => JSON.stringify(sig[k]) !== JSON.stringify(existante[k]));
    if (differences.length) {
      console.error(`\nCe dossier contient un autre rejeu (différences : ${differences.join(', ')}). Choisis un autre --sortie.\n`);
      process.exit(2);
    }
  } else {
    await writeFile(cheminSig, JSON.stringify({ ...sig, commenceLe: new Date().toISOString() }, null, 2) + '\n');
  }

  const { bougies } = analyserCsv(contenuCsv, { unite: o.utCsv, decalageHeures: o.decalageHeures, exclureDerniere: false });
  const series = new Map(decouperParContrat(bougies).segments.map((s) => [s.symbole, s.bougies]));

  const jours = joursDuRejeu(bougies, {
    heure: GEL.heure, fuseau: GEL.fuseau, graine: GEL.graine,
    horizonBougies: Math.round((GEL_TEMOIN.horizonMinutes * 60_000) / dureeUnite(o.utCsv)),
    fenetreJours: GEL_TEMOIN.fenetreJours,
    bougiesGraphique: GEL.bougiesGraphique, uniteGraphiqueMs: dureeUnite(GEL.uniteGraphique),
  });

  const index = await lireJsonl(join(o.sortie, 'index.jsonl'));
  const rejets = await lireJsonl(join(o.sortie, 'rejets.jsonl'));
  const faits = new Set([...index.map((l) => l.id), ...rejets.map((l) => l.id)]);
  let plans = index.length;

  console.log(`\nRejeu ${o.protocole} — ${basename(o.csv)} · ${sig.sha256Fichier.slice(0, 12)}…`);
  console.log(`  ${jours.length} jours éligibles tirés · ${plans} plans et ${rejets.length} rejets déjà faits · objectif ${GEL.nombre} plans`);
  console.log(`  modèle ${GEL.modele} · invite ${sig.sha256Invite.slice(0, 12)}… · ${GEL.heure} ${GEL.fuseau}\n`);

  let traites = 0;
  let nouveauxRejets = 0;
  for (const { instantMs, contrat } of jours) {
    if (plans >= GEL.nombre) break;
    if (o.limite !== undefined && traites >= o.limite) break;
    const id = idRejeu(instantMs);
    if (faits.has(id)) continue;

    const horodatage = new Date(instantMs).toISOString();
    const k = facteurDeguisement(GEL.graine, instantMs);
    const graphique = deguiserBougies(
      bougiesDuGraphique(series.get(contrat), instantMs, { unite: GEL.uniteGraphique, nombre: GEL.bougiesGraphique }), k,
    );
    const trace = tracerGraphique(graphique, { libelle: GEL.libelle, unite: GEL.uniteGraphique });
    const png = await rendrePng(trace.svg);

    const debut = Date.now();
    let analyse;
    try {
      analyse = await analyserAvecReprise(`data:image/png;base64,${png.toString('base64')}`, o);
    } catch (err) {
      console.error(`\n  ${id} : le modèle ne répond pas (${err.message}).`);
      console.error('  Rejeu arrêté ici, rien n’est perdu : relance la même commande pour reprendre.\n');
      process.exit(2);
    }
    const dureeMs = Date.now() - debut;

    const dossier = join(o.sortie, id);
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, 'graphique.png'), png);
    await writeFile(join(dossier, 'reponse.json'), JSON.stringify({ facteurDeguisement: k, echelleTracee: trace.echelle, analyse }, null, 2) + '\n');

    const verdict = analyse.illisible ? { ok: false, errors: [analyse.illisible] } : validateAnalysis(analyse);
    if (!verdict.ok) {
      // Rejeté AVANT toute issue : l'écarter ne biaise rien. Compté à part.
      await appendFile(join(o.sortie, 'rejets.jsonl'), JSON.stringify({ id, horodatage, contrat, erreurs: verdict.errors }) + '\n');
      nouveauxRejets++;
      console.log(`  ${id}  rejeté : ${verdict.errors.join(' ')}`);
    } else {
      const plan = ramenerPlan(analyse, k);
      await appendFile(join(o.sortie, 'index.jsonl'), JSON.stringify({
        schemaVersion: 2, type: 'rejeu', id, horodatage, dossier: id,
        symbole: o.symbole, contrat,
        modele: GEL.modele, dureeMs,
        ...plan,
        objectifDeSortie: OBJECTIF_JOURNAL,
        facteurDeguisement: k,
        confianceDeclareeParLeModele: analyse.confidence ?? null,
        repereLuValide: validateScale(analyse.scale)?.ok ?? null,
      }) + '\n');
      plans++;
      console.log(`  ${id}  plan ${plans}/${GEL.nombre}  ${plan.direction}  (${(dureeMs / 1000).toFixed(0)} s)`);
    }
    traites++;
  }

  console.log(`\n  ${plans} plan(s) au journal, ${rejets.length + nouveauxRejets} rejet(s).`);
  if (plans >= GEL.nombre) {
    console.log(`  Objectif atteint. Le témoin se lance UNE fois :`);
    console.log(`    node scripts/temoin.mjs --journal ${o.sortie} --symbole ${o.symbole} --csv ${o.csv}\n`);
  } else if (o.limite === undefined) {
    console.log(`  ⚠  Liste épuisée avant ${GEL.nombre} plans : ${o.protocole} prévoit de tester ce qui a été obtenu, en le disant.\n`);
  } else {
    console.log('  Arrêt sur --limite. Relance sans --limite pour continuer la même liste.\n');
  }
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  await main();
}
