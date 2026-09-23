// Récupération de bougies, toutes unités de temps.
//
// `journal/market.js` ne sait chercher qu'en 1 minute, pour résoudre l'issue
// d'un plan. Ici on a besoin de n'importe quelle unité, et de champs que
// l'autre ignore : clôture, volume, et surtout le volume acheteur agressif.
//
// AVERTISSEMENT : comme pour `journal/market.js`, l'appel réseau réel n'a pas
// pu être éprouvé dans l'environnement d'écriture — les API de marché y sont
// bloquées. Le point d'accès est paramétrable pour que le chemin soit
// testable contre un serveur simulé, et toute défaillance est bruyante.

export const BINANCE_PAR_DEFAUT = 'https://api.binance.com';
export const MAX_PAR_REQUETE = 1000;

/** Unités acceptées par Binance, avec leur durée en millisecondes. */
export const UNITES = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000, '6h': 21_600_000,
  '8h': 28_800_000, '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000,
};

export function dureeUnite(unite) {
  const ms = UNITES[unite];
  if (!ms) throw new Error(`Unité de temps inconnue : "${unite}". Attendu ${Object.keys(UNITES).join(', ')}.`);
  return ms;
}

/**
 * Format canonique d'une bougie.
 *
 * `volumeAcheteur` est le volume des ordres acheteurs agressifs — donnée
 * publique que Binance fournit dans chaque bougie, et que personne n'exploite
 * parce qu'elle est en dixième position d'un tableau sans nom de champ.
 * C'est elle qui permet de mesurer le déséquilibre acheteurs/vendeurs.
 */
export function normaliser(k) {
  const volume = Number(k[5]);
  const volumeAcheteur = Number(k[9]);
  return {
    ouvertureMs: Number(k[0]),
    ouverture: Number(k[1]),
    plusHaut: Number(k[2]),
    plusBas: Number(k[3]),
    cloture: Number(k[4]),
    volume,
    volumeAcheteur,
    volumeVendeur: volume - volumeAcheteur,
    delta: volumeAcheteur - (volume - volumeAcheteur),
    nombreTrades: Number(k[8]),
  };
}

export const estHaussiere = (b) => b.cloture >= b.ouverture;
export const estBaissiere = (b) => b.cloture < b.ouverture;

function urlKlines(baseUrl) {
  return `${(baseUrl || BINANCE_PAR_DEFAUT).replace(/\/+$/, '')}/api/v3/klines`;
}

async function unLot({ symbole, unite, depuisMs, limite, baseUrl, signal }) {
  const url = `${urlKlines(baseUrl)}?symbol=${symbole}&interval=${unite}` +
    `&startTime=${depuisMs}&limit=${Math.min(MAX_PAR_REQUETE, limite)}`;

  let reponse;
  try {
    reponse = await fetch(url, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(`Source de bougies injoignable : ${urlKlines(baseUrl)}`);
  }

  if (!reponse.ok) {
    if (reponse.status === 400) throw new Error(`Requête refusée : symbole "${symbole}" ou unité "${unite}" invalide ?`);
    if (reponse.status === 429) throw new Error('Quota Binance dépassé. Attends une minute.');
    throw new Error(`Binance a répondu ${reponse.status}.`);
  }

  const brut = await reponse.json();
  if (!Array.isArray(brut)) throw new Error('Réponse Binance inattendue.');
  return brut.map(normaliser);
}

/**
 * Toutes les bougies entre deux instants, en enchaînant les pages.
 * `surProgression` reçoit le compte courant — une récupération de plusieurs
 * mois prend des dizaines de requêtes, mieux vaut le montrer.
 */
export async function recuperer({ symbole, unite, depuisMs, jusquaMs, baseUrl, signal, surProgression }) {
  const pas = dureeUnite(unite);
  const fin = jusquaMs ?? Date.now();
  if (depuisMs >= fin) throw new Error('La date de début est postérieure à la date de fin.');

  const toutes = [];
  let curseur = depuisMs;

  while (curseur < fin) {
    const restantes = Math.ceil((fin - curseur) / pas);
    const lot = await unLot({ symbole, unite, depuisMs: curseur, limite: restantes, baseUrl, signal });
    if (!lot.length) break;

    for (const b of lot) {
      if (b.ouvertureMs < fin) toutes.push(b);
    }

    const derniere = lot[lot.length - 1].ouvertureMs;
    if (derniere <= curseur) break; // garde-fou : pas de progression
    curseur = derniere + pas;

    surProgression?.(toutes.length);
    if (lot.length < MAX_PAR_REQUETE) break; // page incomplète : plus rien après
  }

  return toutes;
}

/** Combien de requêtes une récupération demandera — pour prévenir avant de lancer. */
export function nombreDeRequetes({ unite, depuisMs, jusquaMs }) {
  const bougies = Math.ceil(((jusquaMs ?? Date.now()) - depuisMs) / dureeUnite(unite));
  return { bougies, requetes: Math.ceil(bougies / MAX_PAR_REQUETE) };
}
