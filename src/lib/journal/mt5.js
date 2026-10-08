// Les trades réels, reconstitués depuis l'export MT5 (pont-mt5/exporter.py).
//
// MT5 ne connaît pas de « trade » : il connaît des TRANSACTIONS (deals) —
// une ouverture, une ou plusieurs clôtures partielles — rattachées à une
// POSITION par `position_id`. Le journal reconstitue chaque position à partir
// de ses transactions, et rien d'autre : aucune saisie, aucun chiffre recopié.
//
// LE R SE CALCULE SUR LE STOP POSÉ À L'OUVERTURE, lu dans l'ORDRE qui a ouvert
// la position. Un stop ajouté après coup n'y figure pas : le R est alors
// inconnu, et le journal le dit plutôt que de l'inventer. C'est la règle du
// carnet (ERRATUM-001) : un stop retrouvé après coup n'est pas le stop pris.

// Constantes du paquet MetaTrader5.
const DEAL_ACHAT = 0;
const DEAL_VENTE = 1;
const DEAL_SOLDE = 2;
const ENTREE = 0;
const SORTIE = 1;
const RETOURNEMENT = 2;
const SORTIE_PAR = 3;

const somme = (xs) => xs.reduce((a, x) => a + x, 0);
const moyennePonderee = (deals) => {
  const v = somme(deals.map((d) => d.volume));
  return v > 0 ? somme(deals.map((d) => d.price * d.volume)) / v : null;
};

/** Lit un fichier JSONL ; les lignes illisibles sont rendues, jamais avalées. */
export function lireJsonl(texte) {
  const lignes = [];
  const illisibles = [];
  String(texte ?? '').split('\n').forEach((brut, i) => {
    if (!brut.trim()) return;
    try { lignes.push(JSON.parse(brut)); } catch { illisibles.push(i + 1); }
  });
  return { lignes, illisibles };
}

/**
 * @param deals  lignes de deals.jsonl
 * @param ordres lignes de ordres.jsonl
 * @returns { positions, mouvements, anomalies }
 */
export function positionsDepuisDeals(deals, ordres = []) {
  const ordreParTicket = new Map(ordres.map((o) => [o.ticket, o]));
  const parPosition = new Map();
  const mouvements = [];
  const anomalies = [];

  for (const d of deals) {
    if (d.type === DEAL_SOLDE) {
      mouvements.push({ heureUtc: d.heureUtc, montant: d.profit, commentaire: d.comment || '' });
      continue;
    }
    // Crédits, bonus, frais de compte : rien qui appartienne à un trade.
    if (d.type !== DEAL_ACHAT && d.type !== DEAL_VENTE) continue;
    if (!parPosition.has(d.position_id)) parPosition.set(d.position_id, []);
    parPosition.get(d.position_id).push(d);
  }

  const positions = [];
  for (const [position, ds] of parPosition) {
    ds.sort((a, b) => (a.heureUtc < b.heureUtc ? -1 : a.heureUtc > b.heureUtc ? 1 : a.ticket - b.ticket));
    const entrees = ds.filter((d) => d.entry === ENTREE);
    const sorties = ds.filter((d) => d.entry === SORTIE || d.entry === SORTIE_PAR);

    if (ds.some((d) => d.entry === RETOURNEMENT)) {
      anomalies.push({ position, quoi: 'retournement de position (entrée et sortie dans une même transaction) : non géré, écarté' });
      continue;
    }
    if (!entrees.length) {
      anomalies.push({ position, quoi: 'clôture sans ouverture dans la période exportée : élargis --depuis' });
      continue;
    }

    const sens = entrees[0].type === DEAL_ACHAT ? 'achat' : 'vente';
    const volume = somme(entrees.map((d) => d.volume));
    const volumeSorti = somme(sorties.map((d) => d.volume));
    const fermee = volumeSorti >= volume - 1e-9;

    const prixEntree = moyennePonderee(entrees);
    const prixSortie = sorties.length ? moyennePonderee(sorties) : null;
    const brut = somme(ds.map((d) => d.profit ?? 0));
    const commission = somme(ds.map((d) => d.commission ?? 0));
    const swap = somme(ds.map((d) => d.swap ?? 0));
    const frais = somme(ds.map((d) => d.fee ?? 0));
    const net = brut + commission + swap + frais;

    const ordre = ordreParTicket.get(entrees[0].order);
    const stop = ordre && ordre.sl > 0 ? ordre.sl : null;
    const objectif = ordre && ordre.tp > 0 ? ordre.tp : null;

    // Le risque en argent : la distance du stop, convertie par ce que ce trade
    // a réellement payé par unité de prix. La taille du contrat, la devise et
    // le levier sont ainsi pris en compte sans être connus.
    let rBrut = null;
    let rNet = null;
    if (fermee && stop !== null && prixSortie !== null && prixSortie !== prixEntree && brut !== 0) {
      const parUnite = Math.abs(brut / (prixSortie - prixEntree));
      const risque = Math.abs(prixEntree - stop) * parUnite;
      if (risque > 0) { rBrut = brut / risque; rNet = net / risque; }
    }

    const ouverture = entrees[0].heureUtc;
    const fermeture = fermee ? sorties.at(-1).heureUtc : null;

    positions.push({
      position, symbole: entrees[0].symbol, sens, volume,
      ouverture, fermeture, statut: fermee ? 'fermee' : 'ouverte',
      prixEntree, prixSortie, stop, objectif,
      brut, commission, swap, frais, net,
      rBrut, rNet,
      dureeMin: fermeture ? (Date.parse(fermeture) - Date.parse(ouverture)) / 60_000 : null,
      // Le « setup » : le commentaire posé sur l'ordre d'ouverture. MT5 n'a pas
      // d'autre champ libre. Sans commentaire, il reste inconnu.
      setup: (entrees[0].comment || ordre?.comment || '').trim() || null,
      magic: entrees[0].magic || 0,
    });
  }

  positions.sort((a, b) => (a.ouverture < b.ouverture ? -1 : 1));
  return { positions, mouvements, anomalies };
}
