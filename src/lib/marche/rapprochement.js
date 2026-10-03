// Les prix lus sur l'image, confrontés aux prix réels.
//
// C'est la vérification que rien d'autre ne fait. L'aller-retour du module de
// vision prouve que l'extraction retrouve ce que le dépôt a dessiné : elle se
// compare à son propre moteur de rendu, et une erreur partagée par les deux
// resterait invisible. Ici, la référence vient d'ailleurs.
//
// La question n'est pas rhétorique. Un graphique porte une résolution finie :
// sur une étendue de 4 000 points affichée sur 780 pixels, un pixel vaut cinq
// points. Savoir si l'erreur réelle tient dans ce pixel, ou s'il s'y ajoute un
// biais, décide de ce qu'on peut faire des mesures — placer un stop à deux
// points près n'a aucun sens si la lecture en coûte dix.

/** Les quatre prix d'une bougie, et ce qu'ils valent à la lecture. */
export const CHAMPS = ['ouverture', 'cloture', 'plusHaut', 'plusBas'];

const mediane = (xs) => {
  if (!xs.length) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

/**
 * L'instant de chaque bougie mesurée, déduit de l'instant de la capture.
 *
 * Une bougie lue sur une image ne porte AUCUN horodatage : elle n'a qu'un rang.
 * Le seul point d'ancrage est le moment où la capture a été prise, où la
 * dernière bougie est celle en cours. D'où un décalage résiduel d'au plus une
 * bougie, que l'alignement ci-dessous mesure au lieu de le supposer.
 */
export function horodatagesSupposes(nombre, finMs, uniteMinutes) {
  if (!(nombre > 0) || !Number.isFinite(finMs) || !(uniteMinutes > 0)) return [];
  const pas = uniteMinutes * 60_000;
  return Array.from({ length: nombre }, (_, i) => finMs - (nombre - 1 - i) * pas);
}

/**
 * L'écart entre deux séries, une fois chacune RECENTRÉE sur sa médiane.
 *
 * Comparer les niveaux bruts ne marche pas, et l'erreur est instructive : sur
 * une série qui tend, un biais de prix constant se fait absorber par un
 * décalage temporel. Avec une tendance de trois points par bougie, une échelle
 * fausse de douze points s'annule en reculant de quatre rangs — l'alignement
 * « réussit », et le biais disparaît des résultats. C'est exactement le défaut
 * qu'on cherche : une échelle légèrement fausse est le risque le plus réel de
 * toute la chaîne, et un aligneur qui la masque est pire qu'inutile.
 *
 * Recentrer l'empêche : la constante part avec la médiane, donc le décalage ne
 * peut plus l'imiter. La forme décide de l'alignement, le niveau du biais.
 *
 * Les variations feraient le même office et ont été écartées : une erreur de
 * lecture d'un pixel sur deux bougies voisines se retrouve DOUBLÉE dans leur
 * différence, et le bruit finit par couvrir la forme sur un graphique calme.
 * Le niveau recentré garde tout le signal.
 */
function ecartRecentre(mesurees, auRang) {
  const m = [], r = [];
  for (let i = 0; i < mesurees.length; i++) {
    const reel = auRang(i);
    if (!Number.isFinite(reel) || !Number.isFinite(mesurees[i])) continue;
    m.push(mesurees[i]); r.push(reel);
  }
  if (!m.length) return null;
  const centreM = mediane(m), centreR = mediane(r);
  const ecarts = m.map((v, i) => Math.abs((v - centreM) - (r[i] - centreR)));
  return { valeur: mediane(ecarts), n: m.length };
}

/**
 * Le décalage de rang qui fait le mieux coïncider les deux séries.
 *
 * Cherché plutôt que supposé, et c'est nécessaire : l'instant de la capture
 * n'est connu qu'à la seconde où elle a été ENREGISTRÉE, pas prise, et la
 * dernière bougie d'un graphique est en cours de formation. Un décalage d'une
 * ou deux bougies est la règle, pas l'exception.
 *
 * La médiane sert de critère, pas la moyenne : une seule bougie mal extraite
 * — un doji avalé, une mèche coupée par le bord — déplacerait l'alignement
 * entier si elle pesait au carré.
 */
export function meilleurDecalage(mesurees, reellesParRang, { fenetre = 5 } = {}) {
  let meilleur = null;
  for (let d = -fenetre; d <= fenetre; d++) {
    const e = ecartRecentre(mesurees, (i) => reellesParRang(i + d));
    // Un alignement qui ne recouvre qu'une poignée de bougies n'est pas un
    // alignement : il gagnerait par manque de contre-exemples.
    if (!e || e.n < mesurees.length / 2) continue;
    if (!meilleur || e.valeur < meilleur.ecart) meilleur = { decalage: d, ecart: e.valeur, n: e.n };
  }
  return meilleur;
}

/**
 * Confronte les bougies mesurées aux bougies réelles.
 *
 * Les quatre prix sont rapportés SÉPARÉMENT, et ce n'est pas du zèle. Une
 * ouverture et une clôture sont les bords d'un rectangle large de plusieurs
 * pixels ; un plus haut et un plus bas sont les extrémités d'un trait d'un
 * pixel, là où le lissage est le plus fort et le bord de l'image le plus
 * proche. S'il existe un prix moins fiable que les autres, ce sont ceux-là —
 * et ce sont précisément ceux sur lesquels on place un stop.
 *
 * @param mesurees  [{ ouverture, cloture, plusHaut, plusBas }] dans l'ordre du tracé
 * @param reelles   [{ ouvertureMs, ouverture, cloture, plusHaut, plusBas }] triées
 * @param finMs     instant supposé de la dernière bougie mesurée
 * @param uniteMinutes durée d'une bougie, en minutes
 */
export function rapprocher({ mesurees, reelles, finMs, uniteMinutes, fenetre = 5 }) {
  if (!Array.isArray(mesurees) || !Array.isArray(reelles) || !mesurees.length || !reelles.length) {
    return { ok: false, probleme: 'Il faut des bougies des deux côtés pour comparer quoi que ce soit.' };
  }
  if (!(uniteMinutes > 0)) {
    return { ok: false, probleme: 'Sans unité de temps, aucun rang mesuré ne correspond à un instant.' };
  }

  const pas = uniteMinutes * 60_000;
  const parInstant = new Map(reelles.map((b) => [b.ouvertureMs, b]));
  const instants = horodatagesSupposes(mesurees.length, finMs, uniteMinutes);

  // Les instants réels ne tombent pas forcément sur nos suppositions : on
  // arrondit au pas, ce que fait n'importe quelle bourse.
  const auRang = (i) => {
    const t = instants[0] + i * pas;
    const b = parInstant.get(Math.round(t / pas) * pas);
    return b ? b.cloture : NaN;
  };

  const align = meilleurDecalage(mesurees.map((b) => b.cloture), auRang, { fenetre });
  if (!align) {
    return {
      ok: false,
      probleme:
        'Aucun décalage ne fait coïncider les deux séries. L’unité de temps est probablement '
        + 'fausse, ou les bougies réelles ne couvrent pas la période de la capture.',
    };
  }

  const paires = [];
  for (let i = 0; i < mesurees.length; i++) {
    const t = instants[0] + (i + align.decalage) * pas;
    const reelle = parInstant.get(Math.round(t / pas) * pas);
    if (reelle) paires.push({ index: i, mesuree: mesurees[i], reelle, instantMs: reelle.ouvertureMs });
  }

  const parChamp = {};
  for (const champ of CHAMPS) {
    const ecarts = [];
    const signes = [];
    for (const { mesuree, reelle } of paires) {
      const m = mesuree?.[champ], r = reelle?.[champ];
      if (!Number.isFinite(m) || !Number.isFinite(r)) continue;
      ecarts.push(Math.abs(m - r));
      signes.push(m - r);
    }
    if (!ecarts.length) { parChamp[champ] = null; continue; }
    parChamp[champ] = {
      n: ecarts.length,
      ecartMedian: mediane(ecarts),
      ecartPire: Math.max(...ecarts),
      // Le biais dit s'il s'agit d'un bruit de lecture ou d'un décalage
      // systématique — une échelle légèrement fausse déplace TOUT dans le même
      // sens, et seule la médiane signée le révèle.
      biaisMedian: mediane(signes),
    };
  }

  const niveauMedian = mediane(paires.map((p) => p.reelle.cloture)) ?? null;
  return {
    ok: true,
    decalage: align.decalage,
    nombreApparie: paires.length,
    niveauMedian,
    parChamp,
    enPourcent: Object.fromEntries(
      CHAMPS.map((c) => [c, parChamp[c] && niveauMedian ? (parChamp[c].ecartMedian / niveauMedian) * 100 : null]),
    ),
    premierInstantMs: paires[0]?.instantMs ?? null,
    dernierInstantMs: paires[paires.length - 1]?.instantMs ?? null,
  };
}

/**
 * Ce que vaut un pixel, en prix.
 *
 * C'est l'étalon devant lequel toute erreur doit être lue : une erreur plus
 * petite qu'un pixel n'est pas une erreur de lecture, c'est la limite de ce
 * que l'image porte. Une erreur de plusieurs pixels, elle, est à expliquer.
 */
export function prixParPixel(etendue, hauteurEnPixels) {
  if (!(etendue > 0) || !(hauteurEnPixels > 0)) return null;
  return etendue / hauteurEnPixels;
}
