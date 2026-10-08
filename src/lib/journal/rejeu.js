// Le rejeu : faire analyser au modèle des graphiques du passé, comme s'il les
// voyait en direct, pour obtenir en quelques heures les plans qu'un protocole
// en direct mettrait des mois à réunir. Voir DEC-036.
//
// Trois invariants, chacun gardé par un test :
//
//   1. LE MODÈLE NE VOIT QUE LE PASSÉ. Le graphique s'arrête à la dernière
//      bougie de 15 minutes FERMÉE avant l'instant de l'analyse.
//
//   2. IL NE PEUT PAS RECONNAÎTRE LA PÉRIODE. Un modèle entraîné sur Internet a
//      pu voir les cours de l'or. Lu à 1 950 $, un graphique de mars 2023 lui
//      rappellerait peut-être la suite : une lecture du futur par la mémoire.
//      Les prix sont donc multipliés par un facteur secret, tiré par jour, et
//      aucune date n'est tracée. Les variations en pourcentage — tout ce que le
//      témoin mesure — restent identiques.
//
//   3. LES JOURS SONT TIRÉS D'AVANCE. La liste est entièrement déterminée par
//      le fichier et la graine : ni l'opérateur ni le modèle ne choisissent le
//      moment. Elle est parcourue dans l'ordre jusqu'au nombre de plans fixé.

import { generateurAleatoire, melanger } from '../marche/controle.js';
import { decouperParContrat } from '../marche/contrats.js';
import { agreger } from '../marche/csv.js';
import { prixDeReference, decalageFuseau, FRAICHEUR_MAX_MS, FUSEAU_PAR_DEFAUT } from './temoin.js';

const JOUR = 86_400_000;

/** L'instant `hh:mm` heure locale du jour civil qui contient `ms`. */
export function instantDuJour(ms, heure, fuseau = FUSEAU_PAR_DEFAUT) {
  const [h, m] = heure.split(':').map(Number);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  // L'heure voulue, écrite comme si elle était UTC, puis corrigée du décalage
  // du fuseau — deux fois, car le décalage dépend de l'instant qu'on cherche.
  const commeUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, m);
  let utc = commeUtc - decalageFuseau(commeUtc, fuseau);
  utc = commeUtc - decalageFuseau(utc, fuseau);
  return utc;
}

/**
 * Les jours du rejeu, dans l'ordre où ils seront analysés.
 *
 * Un jour est éligible si, à `heure` locale :
 *   - le marché est ouvert : une bougie a fermé moins de 15 minutes avant ;
 *   - le contrat coté porte assez d'historique pour tracer le graphique ET
 *     pour couvrir la fenêtre du témoin ;
 *   - le contrat porte encore un horizon complet après lui.
 *
 * Les éligibles sont mélangés par la graine, puis retenus dans cet ordre en
 * écartant tout jour dont l'horizon chevaucherait celui d'un jour déjà retenu
 * dans le même contrat — la règle du témoin, appliquée dès le tirage pour ne
 * pas faire analyser au modèle des jours qui seraient écartés ensuite.
 *
 * @param bougies série 1 minute, éventuellement plusieurs contrats
 * @returns [{ instantMs, contrat }] — la liste complète, à parcourir dans l'ordre
 */
export function joursDuRejeu(bougies, {
  heure, fuseau = FUSEAU_PAR_DEFAUT, graine, horizonBougies, fenetreJours, bougiesGraphique, uniteGraphiqueMs,
}) {
  const { segments } = decouperParContrat(bougies);
  const eligibles = [];

  for (const segment of segments) {
    const serie = segment.bougies;
    const debutMs = serie[0].ouvertureMs;
    // Le premier jour possible : fenêtre du témoin couverte, et assez de
    // bougies de 15 minutes pour remplir le graphique — prises large.
    const premier = debutMs + Math.max(fenetreJours * JOUR, bougiesGraphique * uniteGraphiqueMs * 2);

    for (let jour = premier; jour <= serie.at(-1).ouvertureMs; jour += JOUR) {
      const instantMs = instantDuJour(jour, heure, fuseau);
      if (instantMs - fenetreJours * JOUR < debutMs) continue;

      const reference = prixDeReference(serie, instantMs);
      if (!reference || instantMs - serie[reference.indice].fermetureMs > FRAICHEUR_MAX_MS) continue;

      const finIndice = reference.indice + horizonBougies;
      if (finIndice >= serie.length) continue;
      eligibles.push({ instantMs, contrat: segment.symbole, finHorizonMs: serie[finIndice].fermetureMs });
    }
  }

  // Un même jour peut apparaître deux fois si deux contrats le couvrent — au
  // roulement. On garde le premier rencontré, soit le contrat le plus ancien.
  const vus = new Set();
  const uniques = eligibles.filter((e) => (vus.has(e.instantMs) ? false : vus.add(e.instantMs)));

  melanger(uniques, generateurAleatoire(graine));

  const retenus = [];
  for (const e of uniques) {
    const chevauche = retenus.some((r) => r.contrat === e.contrat
      && e.instantMs < r.finHorizonMs && r.instantMs < e.finHorizonMs);
    if (!chevauche) retenus.push(e);
  }
  return retenus.map(({ instantMs, contrat }) => ({ instantMs, contrat }));
}

/**
 * Le facteur de déguisement d'un jour : log-uniforme entre 0,2 et 5.
 *
 * Log-uniforme pour qu'aucune échelle ne domine. Entre 0,2 et 5 : l'or de
 * 2023-2024, entre 1 800 et 2 800 $, s'affiche entre 360 et 14 000 — rien qui
 * ressemble à un cours connu, et toujours des prix plausibles pour un actif.
 */
export function facteurDeguisement(graine, instantMs) {
  const alea = generateurAleatoire((graine ^ Math.floor(instantMs / 60_000)) >>> 0);
  return Math.exp(Math.log(0.2) + alea() * (Math.log(5) - Math.log(0.2)));
}

/** Les bougies, prix multipliés par `k`, volume retiré, rien d'autre. */
export function deguiserBougies(bougies, k) {
  return bougies.map((b) => ({
    ouvertureMs: b.ouvertureMs, fermetureMs: b.fermetureMs,
    ouverture: b.ouverture * k, plusHaut: b.plusHaut * k, plusBas: b.plusBas * k, cloture: b.cloture * k,
    // Le volume n'est pas tracé : une capture TradingView par défaut ne le
    // montre pas, et le test en direct portera sur de telles captures.
    volume: null,
  }));
}

/**
 * Les bougies du graphique montré au modèle : les `nombre` dernières bougies
 * de l'unité du graphique, toutes FERMÉES avant l'instant.
 *
 * L'agrégation se fait sur les bougies 1 minute antérieures à l'instant
 * seulement : une bougie de 15 minutes à cheval sur l'instant serait
 * incomplète, et la compléter avec la suite montrerait l'avenir.
 */
export function bougiesDuGraphique(serie1m, instantMs, { unite, nombre }) {
  const passees = serie1m.filter((b) => b.fermetureMs < instantMs);
  const agregees = agreger(passees, unite).filter((b) => b.fermetureMs < instantMs);
  if (agregees.length < nombre) {
    throw new Error(`Seulement ${agregees.length} bougies ${unite} avant ${new Date(instantMs).toISOString()}, ${nombre} attendues.`);
  }
  return agregees.slice(-nombre);
}

/** Les niveaux d'une analyse, ramenés de l'échelle déguisée à l'échelle réelle. */
export function ramenerPlan(analyse, k) {
  return {
    direction: analyse.direction,
    prixEntree: analyse.entry / k,
    prixStopLoss: analyse.stopLoss / k,
    prixTp1: analyse.tp1 / k,
    prixTp2: analyse.tp2 / k,
  };
}

/** Identifiant stable d'un jour de rejeu : la reprise s'appuie dessus. */
export const idRejeu = (instantMs) => `rejeu-${new Date(instantMs).toISOString().slice(0, 16).replace(':', 'h')}`;
