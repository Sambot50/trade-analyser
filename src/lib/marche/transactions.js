// Transactions → bougies portant le volume ACHETEUR et VENDEUR séparés.
//
// C'est la pièce qui manque depuis le début. Le schéma `ohlcv-1m` ne donne
// qu'un volume total : impossible d'y distinguer un gros achat d'une grosse
// vente. Tout ce que le scanner appelle « achat » repose sur un proxy — la
// bougie clôture au-dessus de son ouverture — qui se trompe sur une bougie
// qui monte puis redescend.
//
// Le schéma `trades` de Databento porte une ligne par transaction, avec le
// CÔTÉ DE L'AGRESSEUR : celui qui a franchi le spread. C'est la seule vérité
// disponible sur qui a voulu, et payé pour, que ça bouge.
//
// Écrit contre le schéma documenté, en lecture par NOM de colonne : l'ordre
// des champs peut changer sans rien casser. Reste à confirmer sur un
// échantillon réel — l'importateur OHLCV avait dû être réécrit une fois pour
// avoir été composé avant d'avoir vu le format.

import { dureeUnite } from './bougies.js';
import { detecterSeparateur, lireHorodatage } from './csv.js';

/**
 * Noms de colonnes reconnus. `side` porte le côté de l'agresseur :
 * `B` acheteur, `A` vendeur (ask), `N` indéterminé.
 */
const ALIAS = {
  horodatage: ['tsevent', 'tsrecv', 'timestamp', 'time'],
  prix: ['price', 'prix', 'p'],
  taille: ['size', 'quantity', 'qty', 'volume', 'taille'],
  cote: ['side', 'cote', 'aggressor', 'aggressorside'],
  action: ['action'],
  contrat: ['instrumentid', 'contractid'],
};

const normaliser = (nom) => String(nom).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export function repererColonnesTransactions(noms) {
  const normalises = noms.map(normaliser);
  const indice = (role) => {
    for (const alias of ALIAS[role]) {
      const i = normalises.indexOf(alias);
      if (i !== -1) return i;
    }
    return null;
  };

  const colonnes = Object.fromEntries(Object.keys(ALIAS).map((role) => [role, indice(role)]));
  for (const requis of ['horodatage', 'prix', 'taille', 'cote']) {
    if (colonnes[requis] === null) {
      throw new Error(
        `Colonne "${requis}" introuvable dans l'en-tête. `
        + `Un export de transactions doit porter au moins un horodatage, un prix, une taille et un côté. `
        + `Colonnes vues : ${noms.join(', ')}`,
      );
    }
  }
  return colonnes;
}

/** `B` = acheteur agresseur, `A` = vendeur agresseur, tout le reste inconnu. */
export function lireCote(brut) {
  const c = String(brut ?? '').trim().toUpperCase();
  if (c === 'B' || c === 'BID' || c === 'BUY') return 'acheteur';
  if (c === 'A' || c === 'ASK' || c === 'S' || c === 'SELL') return 'vendeur';
  return null;
}

/**
 * Agrège des transactions en bougies, avec le détail acheteur/vendeur.
 *
 * Les bornes sont alignées sur l'époque, comme l'agrégation des bougies : une
 * bougie 15 minutes commence toujours à :00, :15, :30 ou :45. Un créneau sans
 * aucune transaction ne produit rien — pas de bougie fantôme.
 *
 * Les transactions dont le côté est inconnu comptent dans le volume total
 * mais dans aucun des deux camps. Les répartir au prorata inventerait une
 * information : c'est exactement ce que le proxy fait déjà, et ce qu'on
 * cherche à remplacer.
 */
export function agregerTransactions(contenu, { unite, decalageHeures = 0 } = {}) {
  const duree = dureeUnite(unite);

  const lignes = contenu.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lignes.length < 2) throw new Error('Fichier vide ou sans en-tête.');

  const sep = detecterSeparateur(lignes.slice(1));
  const colonnes = repererColonnesTransactions(lignes[0].split(sep));

  const groupes = new Map();
  let sansCote = 0;
  let ignorees = 0;

  for (const [i, ligne] of lignes.slice(1).entries()) {
    const champs = ligne.split(sep);

    // Un export peut mêler d'autres évènements aux transactions.
    if (colonnes.action !== null && String(champs[colonnes.action]).trim().toUpperCase() !== 'T') {
      ignorees++;
      continue;
    }

    const prix = Number(String(champs[colonnes.prix]).trim());
    const taille = Number(String(champs[colonnes.taille]).trim());
    if (!Number.isFinite(prix) || !Number.isFinite(taille) || taille <= 0) {
      throw new Error(`Ligne ${i + 2} : prix ou taille illisible dans "${ligne.slice(0, 80)}"`);
    }

    let ms;
    try {
      ({ ms } = lireHorodatage(champs.slice(colonnes.horodatage), decalageHeures));
    } catch (err) {
      throw new Error(`Ligne ${i + 2} : ${err.message}`);
    }

    const debut = Math.floor(ms / duree) * duree;
    let g = groupes.get(debut);
    if (!g) {
      g = {
        ouvertureMs: debut, fermetureMs: debut + duree - 1,
        ouverture: prix, plusHaut: prix, plusBas: prix, cloture: prix,
        volume: 0, volumeAcheteur: 0, volumeVendeur: 0,
        nombreTrades: 0,
        symbole: colonnes.contrat === null ? null : String(champs[colonnes.contrat] ?? '').trim() || null,
      };
      groupes.set(debut, g);
    }

    if (prix > g.plusHaut) g.plusHaut = prix;
    if (prix < g.plusBas) g.plusBas = prix;
    g.cloture = prix;
    g.volume += taille;
    g.nombreTrades++;

    const cote = lireCote(champs[colonnes.cote]);
    if (cote === 'acheteur') g.volumeAcheteur += taille;
    else if (cote === 'vendeur') g.volumeVendeur += taille;
    else sansCote += taille;
  }

  const bougies = [...groupes.values()].sort((a, b) => a.ouvertureMs - b.ouvertureMs);
  // Le déséquilibre, enfin mesuré plutôt que deviné.
  for (const b of bougies) b.delta = b.volumeAcheteur - b.volumeVendeur;

  const total = bougies.reduce((n, b) => n + b.volume, 0);
  return {
    bougies,
    nombreTransactions: bougies.reduce((n, b) => n + b.nombreTrades, 0),
    ignorees,
    // Au-delà de quelques pour cent sans côté, la ventilation n'est pas
    // fiable et l'appelant doit le savoir.
    partSansCote: total ? Number(((sansCote / total) * 100).toFixed(2)) : 0,
  };
}
