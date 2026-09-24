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

  // « 2026-09-08 00:00:00 » — date et heure séparées par une espace, sans fuseau.
  //
  // Traité explicitement, et en UTC, parce que `Date.parse` range cette forme
  // dans son analyseur historique et l'interprète dans le fuseau de la MACHINE.
  // Le même fichier lu à Paris et à Londres donnerait deux séries décalées
  // d'une heure, sans qu'aucune erreur ne le signale. Le fuseau se corrige avec
  // `decalageHeures`, jamais par accident.
  const dateEtHeure = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(a);
  if (dateEtHeure) {
    const [, A, M, J, h, m, sec = '0'] = dateEtHeure;
    return { ms: Date.UTC(+A, +M - 1, +J, +h, +m, +sec) - decalageMs, colonnesUtilisees: 1 };
  }

  // Millisecondes ou secondes depuis l'époque
  if (/^\d{10}$/.test(a)) return { ms: Number(a) * 1000 - decalageMs, colonnesUtilisees: 1 };
  if (/^\d{13}$/.test(a)) return { ms: Number(a) - decalageMs, colonnesUtilisees: 1 };

  // ISO 8601
  const iso = Date.parse(a);
  if (!Number.isNaN(iso)) return { ms: iso - decalageMs, colonnesUtilisees: 1 };

  throw new Error(`Horodatage illisible : "${a}"${b ? ` (suivant : "${b}")` : ''}`);
}

/**
 * Noms de colonnes reconnus, par rôle. Le premier trouvé gagne.
 *
 * L'ordre n'est pas décoratif : un export MetaTrader porte `<TICKVOL>` et
 * `<VOL>`, et c'est le comptage de ticks que la lecture positionnelle prenait
 * déjà. Changer ce choix en passant à la lecture par nom aurait modifié en
 * silence toutes les mesures antérieures.
 */
const ALIAS = {
  horodatage: ['tsevent', 'timestamp', 'datetime', 'opentime', 'date', 'time', 'horodatage'],
  ouverture: ['open', 'ouverture', 'o'],
  plusHaut: ['high', 'plushaut', 'h'],
  plusBas: ['low', 'plusbas', 'l'],
  cloture: ['close', 'cloture', 'c'],
  volume: ['volume', 'tickvol', 'vol', 'v'],
  // Identifiant NUMÉRIQUE du contrat réellement coté sur la ligne.
  contrat: ['instrumentid', 'contractid'],
  // Étiquette textuelle. Voir `contratDe` : ce n'est pas forcément le contrat.
  symbole: ['symbol', 'symbole', 'ticker', 'instrument', 'contract', 'contrat'],
};

const normaliser = (nom) => String(nom).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Associe chaque rôle à un indice de colonne, depuis la ligne d'en-tête.
 *
 * Rend `null` si les quatre prix ne sont pas tous nommés : le fichier retombe
 * alors sur la lecture positionnelle, qui couvre HistData et les exports sans
 * en-tête. Un export Databento intercale `rtype`, `publisher_id` et
 * `instrument_id` entre l'horodatage et l'ouverture — seule la lecture par nom
 * le supporte.
 */
export function repererColonnes(noms) {
  const normalises = noms.map(normaliser);
  const indice = (role) => {
    for (const alias of ALIAS[role]) {
      const i = normalises.indexOf(alias);
      if (i !== -1) return i;
    }
    return null;
  };

  const colonnes = Object.fromEntries(Object.keys(ALIAS).map((role) => [role, indice(role)]));
  const prix = ['ouverture', 'plusHaut', 'plusBas', 'cloture'];
  if (prix.some((role) => colonnes[role] === null)) return null;
  if (colonnes.horodatage === null) colonnes.horodatage = 0;
  return colonnes;
}

/**
 * Le contrat d'une ligne — la clé qui décidera du découpage.
 *
 * **`instrument_id` l'emporte sur `symbol`, et ce n'est pas un détail.**
 *
 * Une requête Databento sur un contrat continu renvoie un `symbol` qui vaut
 * `GC.v.0` sur TOUTES les lignes : c'est le symbole demandé, réécrit tel quel,
 * pas le contrat coté. S'en servir pour découper donnerait un segment unique
 * couvrant deux ans — c'est-à-dire la série recollée que DEC-027 interdit,
 * obtenue sans qu'aucune erreur ne le signale.
 *
 * `instrument_id` change, lui, à chaque roulement. C'est le seul champ de cet
 * export qui dit où passe la frontière entre deux contrats.
 */
export function contratDe(champs, colonnes) {
  if (!colonnes) return null;
  for (const role of ['contrat', 'symbole']) {
    if (colonnes[role] === null) continue;
    const valeur = String(champs[colonnes[role]] ?? '').trim();
    if (valeur) return valeur;
  }
  return null;
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

  const aEntete = estEntete(lignes[0]);
  const corps = aEntete ? lignes.slice(1) : lignes;
  if (!corps.length) throw new Error("Fichier sans données : il n'y a qu'un en-tête.");

  const sep = detecterSeparateur(corps);
  const colonnes = aEntete ? repererColonnes(lignes[0].split(sep)) : null;
  const bougies = [];
  let sansVolume = 0;

  for (const [i, ligne] of corps.entries()) {
    const champs = ligne.split(sep);
    let horodatage;
    try {
      horodatage = lireHorodatage(champs.slice(colonnes ? colonnes.horodatage : 0), decalageHeures);
    } catch (err) {
      throw new Error(`Ligne ${i + 1} : ${err.message}`);
    }

    const nombre = (x) => Number(String(x ?? '').trim());
    const [o, h, l, c, v] = colonnes
      ? [colonnes.ouverture, colonnes.plusHaut, colonnes.plusBas, colonnes.cloture, colonnes.volume]
        .map((j) => (j === null ? NaN : nombre(champs[j])))
      : champs.slice(horodatage.colonnesUtilisees, horodatage.colonnesUtilisees + 5).map(nombre);

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
      // Le contrat auquel appartient la bougie, quand le fichier le nomme.
      // C'est lui, et rien d'autre, qui décidera du découpage : aucun
      // calendrier d'expiration n'est codé nulle part. Voir DEC-027.
      symbole: contratDe(champs, colonnes),
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
