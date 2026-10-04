// Les ranges, détectés sans jamais lire le futur.
//
// Un range n'est pas une figure, c'est une ABSENCE de direction mesurable sur
// une fenêtre. Et le piège qui compte est là : on ne sait qu'un range était un
// range qu'une fois qu'il est fini. Toute règle disant « le prix est dans le
// range » utilise, si l'on n'y prend garde, une information qui n'existait pas
// au moment où elle prétend servir.
//
// Tout ce fichier est donc écrit à l'envers de l'intuition : à chaque bougie,
// on ne regarde QUE les bougies précédentes. Un test le prouve en remplaçant
// tout le futur par des prix absurdes et en vérifiant que rien ne bouge. Ce
// dépôt a déjà eu ce défaut une fois — la branche `fix/lecture-du-futur` est
// dans son historique.

/**
 * La compression : ce que le prix a couvert, rapporté à ce qu'une marche
 * aléatoire couvrirait.
 *
 * C'est le point de conception du fichier. Comparer une hauteur de range à
 * l'ATR seul ne dit rien : sur une fenêtre de 20 bougies, une marche sans
 * aucune structure couvre déjà environ ATR × √20. La seule référence qui ne
 * suppose rien est donc celle-là.
 *
 * Le rapport est SANS DIMENSION : il se compare d'un instrument à l'autre,
 * d'une unité de temps à l'autre, et d'un niveau de prix à l'autre. Un seuil
 * exprimé en points ne le permettrait pas.
 *
 *   ≈ 1   le prix a couvert ce qu'il couvrirait par hasard
 *   < 1   il a couvert MOINS — c'est une compression
 *   > 1   il a tendance
 */
export function compression(bougies, i, fenetre) {
  if (!Array.isArray(bougies) || i < fenetre - 1 || fenetre < 2) return null;

  let haut = -Infinity; let bas = Infinity; let sommeAmplitudes = 0; let n = 0;
  for (let k = i - fenetre + 1; k <= i; k++) {
    const b = bougies[k];
    if (!b || !Number.isFinite(b.plusHaut) || !Number.isFinite(b.plusBas)) return null;
    if (b.plusHaut > haut) haut = b.plusHaut;
    if (b.plusBas < bas) bas = b.plusBas;
    sommeAmplitudes += b.plusHaut - b.plusBas;
    n++;
  }
  const moyenne = sommeAmplitudes / n;
  if (!(moyenne > 0)) return null;

  const attendu = moyenne * Math.sqrt(fenetre);
  return { haut, bas, hauteur: haut - bas, amplitudeMoyenne: moyenne, rapport: (haut - bas) / attendu };
}

/** En deçà de ce rapport, le prix a couvert nettement moins que le hasard. */
export const SEUIL_COMPRESSION = 0.6;

/** Fenêtre par défaut : assez longue pour que √n ait du sens, assez courte pour réagir. */
export const FENETRE = 20;

/**
 * Les ranges d'une série, chacun avec sa sortie et ce qui a suivi.
 *
 * Un range s'ouvre à la première bougie dont la compression passe sous le
 * seuil. Ses bornes sont celles de la fenêtre à CET instant, et elles ne
 * bougent plus : les élargir au fil des bougies suivantes ferait qu'une sortie
 * n'arriverait jamais, le range avalant sa propre cassure.
 *
 * Il se ferme à la première CLÔTURE au-delà d'une borne — sur clôture et non
 * sur mèche, comme les cassures de structure de ce dépôt : une mèche qui
 * dépasse puis revient n'est pas une sortie.
 */
export function detecterRanges(bougies, { fenetre = FENETRE, seuil = SEUIL_COMPRESSION } = {}) {
  const ranges = [];
  if (!Array.isArray(bougies)) return ranges;

  let courant = null;

  for (let i = 0; i < bougies.length; i++) {
    const b = bougies[i];
    if (!b || !Number.isFinite(b.cloture)) continue;

    if (courant) {
      if (b.cloture > courant.haut || b.cloture < courant.bas) {
        courant.indexSortie = i;
        courant.msSortie = b.fermetureMs ?? b.ouvertureMs ?? null;
        courant.sensSortie = b.cloture > courant.haut ? 'haussier' : 'baissier';
        courant.prixSortie = b.cloture;
        courant.duree = i - courant.index;
        ranges.push(courant);
        courant = null;
      } else {
        courant.touchesHaut += b.plusHaut >= courant.haut ? 1 : 0;
        courant.touchesBas += b.plusBas <= courant.bas ? 1 : 0;
      }
      continue;
    }

    const c = compression(bougies, i, fenetre);
    if (!c || c.rapport > seuil) continue;

    courant = {
      index: i,
      ms: b.fermetureMs ?? b.ouvertureMs ?? null,
      haut: c.haut,
      bas: c.bas,
      hauteur: c.hauteur,
      rapport: c.rapport,
      amplitudeMoyenne: c.amplitudeMoyenne,
      fenetre,
      touchesHaut: 0,
      touchesBas: 0,
      indexSortie: null,
      sensSortie: null,
      duree: null,
    };
  }

  // Un range encore ouvert à la fin de la série n'a pas d'issue : le rendre
  // sans sortie serait exact, mais le compter dans une statistique de sortie
  // le ferait passer pour un échec. Il est rendu à part.
  return courant ? [...ranges, { ...courant, enCours: true }] : ranges;
}

/** Les issues possibles d'une sortie de range. */
export const ISSUES = ['continuation', 'retour', 'indecis'];

/**
 * Ce que le prix fait APRÈS être sorti du range.
 *
 * Les deux bornes ne sont PAS équidistantes, et il faut le dire parce que
 * c'est contre-intuitif. La continuation demande d'aller chercher une hauteur
 * de range au-delà ; le retour demande seulement de refermer à l'intérieur,
 * et la bougie de sortie clôture déjà à quelques points de la borne. Le
 * retour est donc beaucoup plus proche.
 *
 * On aurait pu rendre la règle symétrique. On ne l'a pas fait, parce que la
 * question posée est celle-là : « est-ce que ça va vraiment quelque part ? »
 * — pas « est-ce que ça monte plus souvent que ça ne descend ».
 *
 * La conséquence est qu'un taux de continuation ne se lit PAS contre 50 %.
 * Mesuré sur marche aléatoire, le hasard donne environ 35 %. C'est ce chiffre
 * qui est la référence, et c'est pourquoi le témoin n'est pas un ornement :
 * sans lui, on lirait 40 % comme un échec alors que ce serait un écart.
 *
 * `indecis` quand l'horizon s'épuise sans que rien ne soit atteint. Le compter
 * comme un échec gonflerait artificiellement les retours.
 */
export function issueDeLaSortie(bougies, range, { horizon = 20, multiple = 1 } = {}) {
  if (!range || range.indexSortie === null || !(range.hauteur > 0)) return null;

  const haussier = range.sensSortie === 'haussier';
  const cible = haussier
    ? range.haut + range.hauteur * multiple
    : range.bas - range.hauteur * multiple;

  for (let i = range.indexSortie + 1; i <= range.indexSortie + horizon && i < bougies.length; i++) {
    const b = bougies[i];
    if (!b) continue;

    const atteint = haussier ? b.plusHaut >= cible : b.plusBas <= cible;
    const rentre = b.cloture <= range.haut && b.cloture >= range.bas;

    // L'ordre compte : une bougie qui fait les deux est ambiguë, et la compter
    // en continuation reviendrait à supposer qu'elle est allée chercher la
    // cible AVANT de refermer. On ne peut pas le savoir à cette résolution.
    if (atteint && rentre) return { issue: 'indecis', index: i, ambigu: true };
    if (atteint) return { issue: 'continuation', index: i, ambigu: false };
    if (rentre) return { issue: 'retour', index: i, ambigu: false };
  }
  return { issue: 'indecis', index: null, ambigu: false };
}

/** Le compte des issues, et le taux de continuation sur ce qui est tranché. */
export function statistiques(issues) {
  const compte = { continuation: 0, retour: 0, indecis: 0, ambigus: 0 };
  for (const r of issues ?? []) {
    if (!r) continue;
    compte[r.issue] = (compte[r.issue] ?? 0) + 1;
    if (r.ambigu) compte.ambigus++;
  }
  const tranches = compte.continuation + compte.retour;
  return {
    ...compte,
    tranches,
    // null plutôt que zéro quand rien n'est tranché : zéro dirait « jamais de
    // continuation », null dit « on ne sait pas ».
    tauxContinuation: tranches ? compte.continuation / tranches : null,
  };
}
