// Import de bougies depuis un fichier CSV.
//
// Ouvre le backtest aux marchés que Binance ne cote pas : or, forex, indices.
// Les détecteurs étant des fonctions pures sur un tableau de bougies, seule la
// source change — rien d'autre dans la chaîne n'a besoin de savoir d'où
// viennent les données.
//
// Formats reconnus, sans configuration :
//   HistData M1   20240102 000000;2062.51;2063.11;2062.19;2062.65;0
//   MetaTrader    2024.01.02,00:00,2062.51,2063.11,2062.19,2062.65,12
//   générique     2024-01-02T00:00:00Z,2062.51,2063.11,2062.19,2062.65,12

import { dureeUnite } from './bougies.js';

const SEPARATEURS = [';', '\t', ','];

/** Sépare en repérant le caractère qui découpe le plus régulièrement. */
export function detecterSeparateur(lignes) {
  let meilleur = ',';
  let meilleurScore = 0;

  for (const sep of SEPARATEURS) {
    const comptes = lignes.slice(0, 20).map((l) => l.split(sep).length);
    const premier = comptes[0];
    if (premier < 5) continue; // il faut au moins date + OHLC
    const regulier = comptes.every((c) => c === premier);
    if (regulier && premier > meilleurScore) { meilleur = sep; meilleurScore = premier; }
  }

  if (!meilleurScore) throw new Error("Séparateur indétectable : le fichier n'a pas l'air d'être un CSV de bougies.");
  return meilleur;
}

/**
 * Horodatage d'une ligne. Trois formes, distinguées sans ambiguïté :
 *   « 20240102 000000 »      HistData, date et heure collées
 *   « 2024.01.02 » + « 00:00 »  MetaTrader, en deux colonnes
 *   ISO 8601 ou millisecondes
 */
export function lireHorodatage(champs, decalageHeures = 0) {
  const a = champs[0].trim();
  const b = champs[1]?.trim() ?? '';
  const decalageMs = decalageHeures * 3_600_000;

  // HistData : AAAAMMJJ HHMMSS dans un seul champ
  const histData = /^(\d{4})(\d{2})(\d{2})[ T](\d{2})(\d{2})(\d{2})$/.exec(a);
  if (histData) {
    const [, A, M, J, h, m, s] = histData;
    return { ms: Date.UTC(+A, +M - 1, +J, +h, +m, +s) - decalageMs, colonnesUtilisees: 1 };
  }

  // MetaTrader : date et heure dans deux champs
  const dateSeule = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(a);
  const heureSeule = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(b);
  if (dateSeule && heureSeule) {
    const [, A, M, J] = dateSeule;
    const [, h, m, s = '0'] = heureSeule;
    return { ms: Date.UTC(+A, +M - 1, +J, +h, +m, +s) - decalageMs, colonnesUtilisees: 2 };
  }

  // Millisecondes ou secondes depuis l'époque
  if (/^\d{10}$/.test(a)) return { ms: Number(a) * 1000 - decalageMs, colonnesUtilisees: 1 };
  if (/^\d{13}$/.test(a)) return { ms: Number(a) - decalageMs, colonnesUtilisees: 1 };

  // ISO 8601
  const iso = Date.parse(a);
  if (!Number.isNaN(iso)) return { ms: iso - decalageMs, colonnesUtilisees: 1 };

  throw new Error(`Horodatage illisible : "${a}"${b ? ` (suivant : "${b}")` : ''}`);
}

const estEntete = (ligne) => /[a-zA-Z<]/.test(ligne.split(/[;,\t]/)[0]?.replace(/[TZ:.\- ]/g, '') ?? '');

/**
 * Analyse un contenu CSV en bougies canoniques.
 *
 * @param unite unité de temps des lignes, pour calculer l'heure de fermeture —
 *              information indispensable, faute de quoi toute la chaîne
 *              daterait les évènements à l'ouverture et lirait le futur.
 */
export function analyser(contenu, { unite, decalageHeures = 0 } = {}) {
  const duree = dureeUnite(unite);

  const lignes = contenu.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) throw new Error('Fichier vide.');

  const corps = estEntete(lignes[0]) ? lignes.slice(1) : lignes;
  if (!corps.length) throw new Error("Fichier sans données : il n'y a qu'un en-tête.");

  const sep = detecterSeparateur(corps);
  const bougies = [];
  let sansVolume = 0;

  for (const [i, ligne] of corps.entries()) {
    const champs = ligne.split(sep);
    let horodatage;
    try {
      horodatage = lireHorodatage(champs, decalageHeures);
    } catch (err) {
      throw new Error(`Ligne ${i + 1} : ${err.message}`);
    }

    const d = horodatage.colonnesUtilisees;
    const [o, h, l, c, v] = champs.slice(d, d + 5).map((x) => Number(String(x).trim()));

    if (![o, h, l, c].every(Number.isFinite)) {
      throw new Error(`Ligne ${i + 1} : OHLC illisible dans "${ligne.slice(0, 60)}"`);
    }
    if (h < l) throw new Error(`Ligne ${i + 1} : plus haut (${h}) sous le plus bas (${l})`);

    const volume = Number.isFinite(v) ? v : 0;
    if (!volume) sansVolume++;

    bougies.push({
      ouvertureMs: horodatage.ms,
      fermetureMs: horodatage.ms + duree - 1,
      ouverture: o, plusHaut: h, plusBas: l, cloture: c,
      volume,
      // Un CSV de CFD ne porte jamais le détail acheteur/vendeur : le
      // déséquilibre est indisponible, et doit rester null plutôt que d'être
      // inventé à partir du sens de la bougie.
      volumeAcheteur: null,
      volumeVendeur: null,
      delta: null,
      nombreTrades: null,
    });
  }

  bougies.sort((a, b) => a.ouvertureMs - b.ouvertureMs);

  return {
    bougies,
    // Proportion de lignes sans volume : au-delà de la moitié, toute analyse
    // de volume est sans objet et l'appelant doit le dire.
    volumeExploitable: sansVolume / bougies.length < 0.5,
    separateur: sep,
  };
}

/**
 * Regroupe des bougies fines en bougies plus larges.
 *
 * Les bornes sont alignées sur l'époque : une bougie 15 minutes commence
 * toujours à :00, :15, :30 ou :45. Un groupe sans aucune bougie source ne
 * produit rien — les week-ends du forex ne doivent pas devenir des bougies
 * fantômes.
 */
export function agreger(bougies, uniteCible) {
  const duree = dureeUnite(uniteCible);
  const groupes = new Map();

  for (const b of bougies) {
    const debut = Math.floor(b.ouvertureMs / duree) * duree;
    const g = groupes.get(debut);

    if (!g) {
      groupes.set(debut, {
        ouvertureMs: debut, fermetureMs: debut + duree - 1,
        ouverture: b.ouverture, plusHaut: b.plusHaut, plusBas: b.plusBas, cloture: b.cloture,
        volume: b.volume,
        // Sommés quand ils existent : une bougie Binance agrégée doit garder
        // son détail acheteur/vendeur, sinon l'agrégation ferait disparaître
        // une donnée réelle au passage.
        volumeAcheteur: b.volumeAcheteur, nombreTrades: b.nombreTrades,
      });
    } else {
      g.plusHaut = Math.max(g.plusHaut, b.plusHaut);
      g.plusBas = Math.min(g.plusBas, b.plusBas);
      g.cloture = b.cloture;
      g.volume += b.volume;
      g.volumeAcheteur = somme(g.volumeAcheteur, b.volumeAcheteur);
      g.nombreTrades = somme(g.nombreTrades, b.nombreTrades);
    }
  }

  const agregees = [...groupes.values()].sort((a, b) => a.ouvertureMs - b.ouvertureMs);

  for (const g of agregees) {
    g.volumeVendeur = typeof g.volumeAcheteur === 'number' ? g.volume - g.volumeAcheteur : null;
    g.delta = typeof g.volumeAcheteur === 'number' ? g.volumeAcheteur - g.volumeVendeur : null;
  }

  return agregees;
}

/** Une somme dont un seul terme manquant suffit à rendre le total inconnu. */
function somme(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? a + b : null;
}

/** Bornes et continuité d'une série, pour prévenir de ce qui manque. */
export function decrire(bougies, unite) {
  if (!bougies.length) return null;
  const duree = dureeUnite(unite);
  const attendues = Math.round((bougies[bougies.length - 1].ouvertureMs - bougies[0].ouvertureMs) / duree) + 1;

  return {
    nombre: bougies.length,
    debutMs: bougies[0].ouvertureMs,
    finMs: bougies[bougies.length - 1].ouvertureMs,
    // Le forex ferme le week-end : des trous sont normaux, mais leur ampleur
    // mérite d'être affichée.
    tauxDeRemplissage: Number((bougies.length / attendues).toFixed(3)),
  };
}
