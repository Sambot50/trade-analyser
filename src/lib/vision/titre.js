// Lire le symbole et l'unité de temps sur le bandeau du graphique.
//
// POURQUOI CE FICHIER EXISTE. Le modèle de vision a rendu `UNKNOWN` et
// `intraday` devant un graphique qui affichait « Bitcoin / U.S. Dollar · 15 ·
// CRYPTO » en toutes lettres. Ce n'est pas un détail d'affichage : sans
// symbole reconnaissable, le journal ne peut pas aller chercher les bougies
// suivantes, l'issue n'est jamais constatée, et le plan reste « en cours »
// pour toujours. Un journal qui ne tranche aucune issue ne mesure rien — il
// collectionne des opinions.
//
// C'est le même problème que l'axe, et le même outil le résout : de l'OCR sur
// une bande précise, puis une reconnaissance stricte.
//
// LA RECONNAISSANCE EST STRICTE EXPRÈS. Un bandeau contient aussi « CRYPTO »,
// « TradingView », des prix et des pourcentages. Accepter « toute suite de
// majuscules » les ramasserait tous. On exige donc qu'un symbole porte une
// devise de cotation connue, ou la marque d'un contrat à terme.

import { UNITES } from '../marche/bougies.js';
import { lireBande } from './ocr.js';

/** Devises de cotation qui terminent un symbole affichable. */
const COTATIONS = ['USDT', 'USDC', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'BTC', 'ETH'];

/** Mots d'un bandeau qui ressemblent à un symbole sans en être un. */
const INTRUS = new Set([
  'CRYPTO', 'FOREX', 'INDEX', 'STOCKS', 'FUTURES', 'TRADINGVIEW', 'NASDAQ',
  'COMEX', 'NYMEX', 'BINANCE', 'OANDA', 'SPOT', 'PERP', 'CHART', 'VOL',
]);

/**
 * Le symbole, s'il est reconnaissable sans ambiguïté.
 *
 * Accepte `BTCUSD`, `BINANCE:BTCUSDT`, `XAUUSD`, et les continus à terme comme
 * `GC1!`. Rend `null` sur tout le reste — mieux vaut une saisie manuelle qu'un
 * symbole inventé qui ferait résoudre le plan contre les mauvaises bougies.
 */
export function symboleDepuisTexte(texte) {
  if (typeof texte !== 'string') return null;
  const majuscules = texte.toUpperCase();

  for (const brut of majuscules.split(/[^A-Z0-9:!]+/)) {
    if (!brut) continue;
    const jeton = brut.includes(':') ? brut.slice(brut.lastIndexOf(':') + 1) : brut;
    if (jeton.length < 3 || jeton.length > 15) continue;
    if (INTRUS.has(jeton)) continue;

    // Un continu à terme : `GC1!`, `ES1!`.
    if (/^[A-Z]{1,4}[0-9]?!$/.test(jeton)) return jeton;

    // Sinon il faut une devise de cotation, ET quelque chose devant.
    if (!/^[A-Z0-9]+$/.test(jeton)) continue;
    for (const cot of COTATIONS) {
      if (jeton.endsWith(cot) && jeton.length > cot.length + 1) return jeton;
    }
  }
  return null;
}

/**
 * L'unité de temps, ramenée au format du dépôt.
 *
 * TradingView l'écrit de plusieurs façons — `15`, `15m`, `M15`, `1h`, `H1`,
 * `D`, `1D`. Un nombre nu vaut des minutes, c'est sa convention.
 */
export function uniteDepuisTexte(texte) {
  if (typeof texte !== 'string') return null;
  const t = texte.toUpperCase();

  const normaliser = (n, lettre) => {
    const u = lettre === 'D' ? `${n}d` : lettre === 'W' ? `${n}w` : lettre === 'H' ? `${n}h` : `${n}m`;
    return UNITES[u] ? u : null;
  };

  // `15m`, `4H`, `1D` — et les formes inversées `M15`, `H4`, `D1`.
  for (const m of t.matchAll(/\b(\d{1,3})\s*([MHDW])\b/g)) {
    const u = normaliser(Number(m[1]), m[2]);
    if (u) return u;
  }
  for (const m of t.matchAll(/\b([MHDW])\s*(\d{1,3})\b/g)) {
    const u = normaliser(Number(m[2]), m[1]);
    if (u) return u;
  }
  // `D`, `W` seuls.
  if (/\bD\b/.test(t) && UNITES['1d']) return '1d';
  if (/\bW\b/.test(t) && UNITES['1w']) return '1w';
  // Un nombre nu : des minutes, convention TradingView.
  for (const m of t.matchAll(/\b(\d{1,3})\b/g)) {
    const u = normaliser(Number(m[1]), 'M');
    if (u) return u;
  }
  return null;
}

/**
 * La bande du bandeau : au-dessus du tracé, sur sa largeur.
 *
 * `zone` vient de `zoneTrace`. Une marge généreuse vers le haut : le titre
 * peut tenir sur deux lignes, et les onglets du navigateur sont au-dessus.
 */
export function bandeDuTitre(zone, hauteur, { marge = 90 } = {}) {
  if (!zone) return null;
  const y1 = Math.max(0, zone.y0 - 2);
  const y0 = Math.max(0, y1 - marge);
  if (y1 - y0 < 8) return null;
  return { x0: zone.x0, x1: Math.max(zone.x1, zone.x0 + 1), y0, y1 };
}

/**
 * Lit le bandeau, et rend ce qu'il a compris — ainsi que le texte brut.
 *
 * Le texte brut est rendu même en cas d'échec : c'est ce qui permet à
 * l'utilisateur de voir POURQUOI rien n'a été reconnu, au lieu d'un champ vide.
 */
export async function lireTitre(données, largeur, hauteur, zone, options = {}) {
  const bande = bandeDuTitre(zone, hauteur, options);
  if (!bande) return { symbole: null, unite: null, texte: '' };

  const etiquettes = await lireBande(données, largeur, hauteur, bande, {
    ...options,
    // Un bandeau porte des lettres, pas seulement des chiffres.
    caracteres: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:!/.,- ',
  });

  const texte = (etiquettes ?? []).map((e) => e.texte).join(' ');
  return { symbole: symboleDepuisTexte(texte), unite: uniteDepuisTexte(texte), texte, etiquettes: etiquettes ?? [] };
}
