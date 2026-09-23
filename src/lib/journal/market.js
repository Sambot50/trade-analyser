// Récupération des bougies publiques.
//
// Binance expose /api/v3/klines sans clé ni compte, avec les en-têtes CORS
// nécessaires à un appel depuis le navigateur.
//
// AVERTISSEMENT : cet appel réseau n'a pas pu être éprouvé dans
// l'environnement où ce fichier a été écrit, toutes les API de marché y étant
// bloquées. L'algorithme de résolution, lui, est testé exhaustivement contre
// des jeux de bougies fabriqués. Toute défaillance ici doit donc être bruyante.

const BINANCE = 'https://api.binance.com/api/v3/klines';

// Résoudre sur des bougies d'une minute, quelle que soit l'unité de temps de
// l'analyse : plus la bougie est fine, moins le cas ambigu se produit.
export const INTERVALLE_RESOLUTION = '1m';
export const MINUTES_PAR_BOUGIE = 1;

/** Symboles que Binance peut résoudre. Le reste reste à saisir à la main. */
export function symboleResolvable(symbole) {
  if (typeof symbole !== 'string') return null;
  const nettoye = symbole.toUpperCase().replace(/[\s/\-_]/g, '');
  // Base de 2 à 15 caractères, suivie d'une devise de cotation Binance.
  return /^[A-Z0-9]{2,15}(USDT|USDC|BUSD|BTC|ETH|BNB)$/.test(nettoye) ? nettoye : null;
}

/**
 * Bougies à partir d'un horodatage, au pas d'une minute.
 * @returns [{ ouvertureMs, plusHaut, plusBas }]
 */
export async function recupererBougies({ symbole, depuisMs, nombre, signal }) {
  const pair = symboleResolvable(symbole);
  if (!pair) throw new Error(`Symbole non résolvable automatiquement : ${symbole}`);

  const url = `${BINANCE}?symbol=${pair}&interval=${INTERVALLE_RESOLUTION}` +
    `&startTime=${depuisMs}&limit=${Math.min(1000, nombre)}`;

  let reponse;
  try {
    reponse = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Binance injoignable. Vérifie ta connexion réseau.');
  }

  if (!reponse.ok) {
    throw new Error(`Binance a répondu ${reponse.status} pour ${pair}.`);
  }

  const brut = await reponse.json();
  if (!Array.isArray(brut)) throw new Error('Réponse Binance inattendue.');

  return brut.map(normaliserBougie);
}

/** Format Binance : [ouverture, open, high, low, close, ...]. */
export function normaliserBougie(k) {
  return {
    ouvertureMs: Number(k[0]),
    plusHaut: Number(k[2]),
    plusBas: Number(k[3]),
  };
}

/**
 * Récupère jusqu'à `nombre` bougies, en enchaînant les pages de 1000.
 * Un horizon de 24 h au pas d'une minute fait 1440 bougies.
 */
export async function recupererBougiesPaginees({ symbole, depuisMs, nombre, signal }) {
  const toutes = [];
  let curseur = depuisMs;

  while (toutes.length < nombre) {
    const lot = await recupererBougies({
      symbole, depuisMs: curseur, nombre: nombre - toutes.length, signal,
    });
    if (!lot.length) break;

    toutes.push(...lot);
    const derniere = lot[lot.length - 1].ouvertureMs;
    if (derniere <= curseur) break; // garde-fou : pas de progression, on arrête
    curseur = derniere + MINUTES_PAR_BOUGIE * 60_000;

    if (lot.length < 1000) break; // page incomplète : il n'y a plus rien après
  }

  return toutes.slice(0, nombre);
}
