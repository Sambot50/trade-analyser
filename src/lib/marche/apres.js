// Ce que le prix fait APRÈS une anomalie de volume.
//
// La question posée est concrète : où poser le take profit, le break-even, le
// stop. Elle ne se devine pas en regardant quelques graphiques — elle se
// mesure sur tous les cas d'un coup.
//
// Trois grandeurs, et une unité qui les rend comparables :
//
// L'unité est la HAUTEUR DE LA BOUGIE d'anomalie. C'est la distance naturelle
// du stop — on le pose au-delà du bloc, pas ailleurs — donc tout exprimer en
// multiples de cette hauteur donne directement des R. Un déplacement de 3,2
// se lit « trois fois le risque », sur l'or à 1900 comme à 4400.
//
// Le SENS est celui du volume : une bougie acheteuse regarde vers le haut,
// une vendeuse vers le bas. « En faveur » veut dire dans le sens de celui qui
// est entré, pas dans le sens du marché.
//
// Rien ici ne mesure une stratégie. On décrit un comportement — ce que fait
// le prix après, sans qu'aucune décision d'entrée ne soit prise.

/**
 * Comportement du prix après la bougie d'indice `index`.
 *
 * @param horizonBougies nombre de bougies examinées après l'anomalie
 * @returns null si l'horizon n'est pas disponible en entier — un cas tronqué
 *          sous-estimerait systématiquement les amplitudes, et polluerait
 *          toute distribution où il entrerait.
 */
export function comportementApres(bougies, index, horizonBougies) {
  const ancre = bougies[index];
  const suite = bougies.slice(index + 1, index + 1 + horizonBougies);
  if (suite.length < horizonBougies) return null;

  const hauteur = ancre.plusHaut - ancre.plusBas;
  if (!(hauteur > 0)) return null;

  const achat = ancre.cloture > ancre.ouverture;
  if (ancre.cloture === ancre.ouverture) return null;

  const depart = ancre.cloture;

  let faveur = 0;
  let contre = 0;
  let bougiesFaveurMax = 0;
  let bougiesContreMax = 0;
  // Le retour n'a de sens qu'après un départ. Sans cette condition, la
  // bougie suivante chevauche presque toujours la précédente — le prix étant
  // continu — et le « retour » se produisait dans 100 % des cas au bout d'une
  // bougie. Ça ne mesurait rien.
  let sortiDeLaZone = false;
  let retourDansLaZone = null;

  for (const [i, b] of suite.entries()) {
    const versLeHaut = b.plusHaut - depart;
    const versLeBas = depart - b.plusBas;

    const enFaveur = achat ? versLeHaut : versLeBas;
    const aLEncontre = achat ? versLeBas : versLeHaut;

    if (enFaveur > faveur) { faveur = enFaveur; bougiesFaveurMax = i + 1; }
    if (aLEncontre > contre) { contre = aLEncontre; bougiesContreMax = i + 1; }

    // Le prix QUITTE-t-il le bloc, puis y revient-il ? C'est l'affirmation
    // centrale de la littérature SMC, et elle n'avait jamais été mesurée ici.
    const dehors = b.plusBas > ancre.plusHaut || b.plusHaut < ancre.plusBas;
    if (dehors) sortiDeLaZone = true;
    else if (sortiDeLaZone && retourDansLaZone === null) retourDansLaZone = i + 1;
  }

  return {
    sens: achat ? 'achat' : 'vente',
    hauteur: arrondir(hauteur),
    // En multiples de la hauteur du bloc, c'est-à-dire en R.
    faveurEnR: arrondir(faveur / hauteur),
    contreEnR: arrondir(contre / hauteur),
    // En pour cent du prix, pour rester lisible sans le contexte.
    faveurPct: arrondir((faveur / depart) * 100, 3),
    contrePct: arrondir((contre / depart) * 100, 3),
    bougiesFaveurMax,
    bougiesContreMax,
    sortiDeLaZone,
    retourDansLaZone,
  };
}

/**
 * Le prix atteint-il `multiple` fois le risque AVANT de perdre `multiple`
 * fois le risque à l'encontre ?
 *
 * C'est la seule façon honnête de répondre à « où mettre le take profit » :
 * comparer deux amplitudes maximales ne dit pas laquelle est arrivée en
 * premier, et un objectif atteint après le stop ne rapporte rien.
 */
export function atteintAvantDePerdre(bougies, index, horizonBougies, multiple) {
  const ancre = bougies[index];
  const suite = bougies.slice(index + 1, index + 1 + horizonBougies);
  if (suite.length < horizonBougies) return null;

  const hauteur = ancre.plusHaut - ancre.plusBas;
  if (!(hauteur > 0) || ancre.cloture === ancre.ouverture) return null;

  const achat = ancre.cloture > ancre.ouverture;
  const depart = ancre.cloture;
  const cible = multiple * hauteur;

  for (const b of suite) {
    const enFaveur = achat ? b.plusHaut - depart : depart - b.plusBas;
    const aLEncontre = achat ? depart - b.plusBas : b.plusHaut - depart;

    // Une bougie qui touche les deux ne dit pas dans quel ordre : on ne
    // devine pas, on rend `ambigu`. C'est la leçon de DEC-015.
    const touche = enFaveur >= cible;
    const perd = aLEncontre >= cible;
    if (touche && perd) return 'ambigu';
    if (touche) return 'atteint';
    if (perd) return 'perdu';
  }
  return 'ni_lun_ni_lautre';
}

const arrondir = (n, decimales = 2) => (Number.isFinite(n) ? Number(n.toFixed(decimales)) : null);
