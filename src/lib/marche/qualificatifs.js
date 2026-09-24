// Ce qui distingue un order block d'un autre.
//
// Le détecteur ne connaît qu'une définition mécanique : la dernière bougie de
// couleur opposée avant l'impulsion. Mesurée telle quelle sur BTCUSDT, cette
// population rend 50,0 % de réussite sur 318 cas — un tirage à pile ou face
// (DEC-019). Reste la question que personne n'a posée : la population est-elle
// homogène, ou mélange-t-elle des cas qui n'ont rien à voir ?
//
// Ce module calcule, pour chaque order block, les qualificatifs que les
// praticiens invoquent — FVG, prise de liquidité, déplacement, premium/
// discount, OTE, fraîcheur — plus ceux que la littérature ne cite pas mais que
// notre propre code rend disponibles. On ne décide pas lesquels comptent : on
// les enregistre, et la mesure tranchera.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ INVARIANT : aucune fonction d'ici ne lit `bougies[i]` pour i >           │
// │ `ob.indexCassure`. Un qualificatif qui regarderait après la cassure      │
// │ prédirait l'issue au lieu de la qualifier. Un test le vérifie sur        │
// │ l'ensemble des qualificatifs, en tronquant la série.                     │
// └─────────────────────────────────────────────────────────────────────────┘

import { estHaussiere, estBaissiere } from './bougies.js';
import { HAUSSIER } from './structure.js';

/** Bougies sur lesquelles un qualificatif a le droit de travailler. */
function fenetreAutorisee(bougies, ob) {
  return bougies.slice(0, ob.indexCassure + 1);
}

/**
 * Déséquilibre à trois bougies laissé par l'impulsion.
 *
 * Haussier : le plus haut de i−1 reste sous le plus bas de i+1, la bougie i
 * étant haussière. Le vide entre les deux n'a pas été négocié — c'est ce que
 * les praticiens appellent l'inefficience, et ils tiennent un order block
 * accompagné d'une FVG pour plus solide qu'un autre.
 *
 * On ne retient que les FVG nées DANS l'impulsion, entre l'order block et la
 * cassure : celles d'avant ne doivent rien à ce mouvement.
 */
export function fvgDeLImpulsion(bougies, ob) {
  const haussier = ob.sens === HAUSSIER;
  const debut = Math.max(1, ob.index);
  const fin = Math.min(ob.indexCassure - 1, bougies.length - 2);

  let meilleure = null;

  for (let i = debut; i <= fin; i++) {
    const avant = bougies[i - 1];
    const apres = bougies[i + 1];
    const b = bougies[i];

    const estFvg = haussier
      ? avant.plusHaut < apres.plusBas && estHaussiere(b)
      : avant.plusBas > apres.plusHaut && estBaissiere(b);
    if (!estFvg) continue;

    const haut = haussier ? apres.plusBas : avant.plusBas;
    const bas = haussier ? avant.plusHaut : apres.plusHaut;
    const taille = Math.abs(haut - bas);
    if (!(taille > 0)) continue;

    // Chevauche la zone, ou la touche à un cheveu près : c'est la
    // configuration que les praticiens exigent.
    const chevauche = haut >= ob.zone.bas && bas <= ob.zone.haut;

    if (!meilleure || taille > meilleure.taille) {
      meilleure = { taille, chevauche, index: i };
    }
  }

  return {
    presente: Boolean(meilleure),
    chevauchante: meilleure?.chevauche ?? false,
    tailleRelative: meilleure ? arrondir(meilleure.taille / ob.zone.hauteur) : null,
  };
}

/**
 * Prise de liquidité avant l'impulsion.
 *
 * C'est le seul élément du vocabulaire SMC qui s'appuie sur quelque chose de
 * documenté : les ordres stop se regroupent à des niveaux visibles, et un
 * mouvement qui va les chercher avant de repartir se constate.
 *
 * Mesure retenue : sur les `fenetre` bougies précédant l'order block, le prix
 * est-il allé sous le plus bas de la période antérieure (au-dessus du plus
 * haut, en baissier) pour refermer du bon côté ?
 */
export function priseDeLiquidite(bougies, ob, fenetre = 20) {
  const haussier = ob.sens === HAUSSIER;
  const finBalayage = ob.index;
  const debutBalayage = Math.max(1, finBalayage - fenetre);
  const debutReference = Math.max(0, debutBalayage - fenetre);
  if (debutBalayage <= debutReference) return { presente: false, profondeurRelative: null };

  const reference = bougies.slice(debutReference, debutBalayage);
  if (!reference.length) return { presente: false, profondeurRelative: null };

  const niveau = haussier
    ? Math.min(...reference.map((b) => b.plusBas))
    : Math.max(...reference.map((b) => b.plusHaut));

  let profondeur = 0;
  let balaye = false;

  for (let i = debutBalayage; i <= finBalayage; i++) {
    const b = bougies[i];
    const depasse = haussier ? b.plusBas < niveau : b.plusHaut > niveau;
    if (!depasse) continue;
    // Refermer du bon côté distingue le balayage de la cassure pure.
    const refermee = haussier ? b.cloture > niveau : b.cloture < niveau;
    if (!refermee) continue;
    balaye = true;
    profondeur = Math.max(profondeur, haussier ? niveau - b.plusBas : b.plusHaut - niveau);
  }

  return {
    presente: balaye,
    profondeurRelative: balaye && ob.zone.hauteur ? arrondir(profondeur / ob.zone.hauteur) : null,
  };
}

/**
 * Force du déplacement qui a cassé la structure.
 *
 * « Le mouvement doit être décisif, à corps pleins » est la formulation
 * courante. `corpsMoyen` la chiffre : 1 signifie des bougies sans mèche, 0 des
 * bougies qui n'ont fait qu'osciller.
 */
export function deplacement(bougies, ob) {
  const haussier = ob.sens === HAUSSIER;
  const depart = haussier ? ob.zone.haut : ob.zone.bas;
  const arrivee = bougies[ob.indexCassure].cloture;

  const impulsion = bougies.slice(ob.index + 1, ob.indexCassure + 1);
  const corps = impulsion
    .map((b) => {
      const amplitude = b.plusHaut - b.plusBas;
      return amplitude > 0 ? Math.abs(b.cloture - b.ouverture) / amplitude : null;
    })
    .filter((v) => v !== null);

  return {
    ampleurEnZones: ob.zone.hauteur ? arrondir(Math.abs(arrivee - depart) / ob.zone.hauteur) : null,
    corpsMoyen: corps.length ? arrondir(corps.reduce((a, v) => a + v, 0) / corps.length) : null,
    nombreBougies: ob.indexCassure - ob.index,
  };
}

/**
 * Significativité du niveau cassé.
 *
 * La question que notre `fenetre = 5` rend urgente : casse-t-on un sommet
 * majeur ou un micro-pivot ? L'implémentation de référence la plus répandue
 * cherche ses pivots sur 50 bougies de chaque côté, dix fois notre fenêtre.
 *
 * Mesure : proportion des `profondeur` bougies PRÉCÉDANT l'order block dont
 * l'extrême reste en deçà du niveau cassé. 1 signifie que rien n'était allé
 * aussi loin.
 *
 * La fenêtre s'arrête à l'order block et n'inclut pas l'impulsion : celle-ci
 * franchit le niveau par construction, souvent d'une mèche avant la clôture
 * qui acte la cassure. L'y laisser ferait baisser la significativité des
 * mouvements les plus francs — exactement l'inverse de ce qu'on veut mesurer.
 */
export function significativiteDuNiveau(bougies, ob, profondeur = 100) {
  if (typeof ob.prixCasse !== 'number') return null;

  const haussier = ob.sens === HAUSSIER;
  const debut = Math.max(0, ob.index - profondeur);
  const precedentes = bougies.slice(debut, ob.index + 1);
  if (!precedentes.length) return null;

  const enDeca = precedentes.filter((b) => (haussier ? b.plusHaut < ob.prixCasse : b.plusBas > ob.prixCasse));
  return arrondir(enDeca.length / precedentes.length);
}

/**
 * Position de l'order block dans la jambe qui l'a produit.
 *
 * 0 = bas de la jambe, 1 = haut. Les praticiens veulent acheter en bas
 * (discount) et vendre en haut (premium) ; `enZoneFavorable` le résume.
 */
export function premiumDiscount(bougies, ob) {
  const jambe = bougies.slice(ob.indexOrigine, ob.indexCassure + 1);
  if (!jambe.length) return null;

  const bas = Math.min(...jambe.map((b) => b.plusBas));
  const haut = Math.max(...jambe.map((b) => b.plusHaut));
  const amplitude = haut - bas;
  if (!(amplitude > 0)) return null;

  const haussier = ob.sens === HAUSSIER;
  const entree = haussier ? ob.zone.haut : ob.zone.bas;
  const position = (entree - bas) / amplitude;

  return {
    position: arrondir(position),
    enZoneFavorable: haussier ? position <= 0.5 : position >= 0.5,
    // Fenêtre 62–79 % de retracement, l'« entrée optimale » du vocabulaire ICT.
    ote: (() => {
      const retracement = haussier ? (haut - entree) / amplitude : (entree - bas) / amplitude;
      return retracement >= 0.62 && retracement <= 0.79;
    })(),
  };
}

/**
 * Le prix est-il revenu dans la zone PENDANT l'impulsion, avant la cassure ?
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ À ne pas confondre avec la « virginité » du vocabulaire SMC, qui      │
 * │ demande si le NIVEAU avait déjà été travaillé AVANT que l'order block │
 * │ se forme. Ce sont deux fenêtres disjointes, et deux questions         │
 * │ différentes — `virginiteNiveau` répond à la seconde.                  │
 * │                                                                       │
 * │ La confusion a existé : ce qualificatif a longtemps porté le nom de   │
 * │ « fraîcheur » en laissant croire que le critère SMC était couvert.    │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * On ne compte qu'un RETOUR : la bougie qui suit l'order block démarre dans la
 * zone par construction, puisque l'impulsion en part. Compter celle-là
 * déclarerait toute zone entamée et le qualificatif ne séparerait rien.
 */
export function fraicheur(bougies, ob) {
  let sorti = false;
  let retours = 0;

  for (let i = ob.index + 1; i <= ob.indexCassure; i++) {
    const b = bougies[i];
    const chevauche = b.plusBas <= ob.zone.haut && b.plusHaut >= ob.zone.bas;
    if (!chevauche) { sorti = true; continue; }
    if (sorti) retours++;
  }

  return { intacte: retours === 0, bougiesDansLaZone: retours };
}

/**
 * Le niveau avait-il déjà été travaillé avant que l'order block se forme ?
 *
 * C'est le quatrième critère de validation du vocabulaire SMC, et celui que
 * `fraicheur` ne couvrait pas : une zone posée sur un palier que le prix a
 * traversé vingt fois en deux mois n'a rien à voir avec une zone sur un niveau
 * jamais visité.
 *
 * Difficulté : les bougies qui précèdent immédiatement l'order block
 * chevauchent la zone par continuité — le prix est bien arrivé là. Cette
 * approche finale est donc SAUTÉE avant de compter quoi que ce soit, faute de
 * quoi toute zone paraîtrait visitée au moins une fois et le qualificatif ne
 * séparerait rien. Même piège que pour `fraicheur`, à l'autre bout.
 */
export function virginiteNiveau(bougies, ob, profondeur = 200) {
  const debut = Math.max(0, ob.index - profondeur);
  const precedentes = bougies.slice(debut, ob.index);
  if (!precedentes.length) return null;

  const chevauche = (b) => b.plusBas <= ob.zone.haut && b.plusHaut >= ob.zone.bas;

  // Remonter le temps, en sautant l'approche finale.
  let i = precedentes.length - 1;
  while (i >= 0 && chevauche(precedentes[i])) i--;

  let visites = 0;
  let dedans = false;
  let bougiesDedans = 0;
  let indexDerniereVisite = null;

  for (; i >= 0; i--) {
    if (chevauche(precedentes[i])) {
      bougiesDedans++;
      if (!dedans) {
        visites++;
        if (indexDerniereVisite === null) indexDerniereVisite = i;
      }
      dedans = true;
    } else {
      dedans = false;
    }
  }

  return {
    vierge: visites === 0,
    visites,
    bougiesDedans,
    examinees: precedentes.length,
    // Distance à la visite la plus récente : un niveau intouché depuis cent
    // bougies n'a pas le même statut qu'un niveau quitté il y a dix.
    bougiesDepuisDerniereVisite: indexDerniereVisite === null
      ? null
      : precedentes.length - indexDerniereVisite,
  };
}

/** Hauteur de zone rapportée à la volatilité ambiante (ATR sur `periode`). */
export function zoneSurAtr(bougies, ob, periode = 14) {
  const debut = Math.max(1, ob.indexCassure - periode + 1);
  let somme = 0;
  let n = 0;

  for (let i = debut; i <= ob.indexCassure; i++) {
    const b = bougies[i];
    const precedente = bougies[i - 1];
    somme += Math.max(
      b.plusHaut - b.plusBas,
      Math.abs(b.plusHaut - precedente.cloture),
      Math.abs(b.plusBas - precedente.cloture),
    );
    n++;
  }

  if (!n) return null;
  const atr = somme / n;
  return atr > 0 ? arrondir(ob.zone.hauteur / atr) : null;
}

/**
 * L'order block selon la définition concurrente : la bougie du plus bas de
 * l'impulsion, et non la dernière bougie opposée.
 *
 * C'est celle qu'emploie l'implémentation Python la plus utilisée. Les deux
 * coïncident souvent, pas toujours — et rien ne dit laquelle vaut mieux. On
 * enregistre l'écart plutôt que de trancher.
 */
export function definitionAlternative(bougies, ob) {
  const haussier = ob.sens === HAUSSIER;
  let indexExtreme = null;
  let extreme = null;

  for (let i = ob.indexOrigine; i < ob.indexCassure; i++) {
    const valeur = haussier ? bougies[i].plusBas : bougies[i].plusHaut;
    if (extreme === null || (haussier ? valeur <= extreme : valeur >= extreme)) {
      extreme = valeur;
      indexExtreme = i;
    }
  }

  return {
    index: indexExtreme,
    identique: indexExtreme === ob.index,
    ecartEnBougies: indexExtreme === null ? null : ob.index - indexExtreme,
  };
}

/** Tous les qualificatifs d'un order block, en un seul objet plat. */
export function qualifier(bougies, ob) {
  const visibles = fenetreAutorisee(bougies, ob);
  const ouverture = new Date(bougies[ob.indexCassure].fermetureMs);

  const gap = fvgDeLImpulsion(visibles, ob);
  const liquidite = priseDeLiquidite(visibles, ob);
  const impulsion = deplacement(visibles, ob);
  const zone = premiumDiscount(visibles, ob);
  const neuve = fraicheur(visibles, ob);
  const vierge = virginiteNiveau(visibles, ob);
  const alternative = definitionAlternative(visibles, ob);

  return {
    fvgPresente: gap.presente,
    fvgChevauchante: gap.chevauchante,
    fvgTailleRelative: gap.tailleRelative,

    liquiditePrise: liquidite.presente,
    liquiditeProfondeur: liquidite.profondeurRelative,

    deplacementAmpleur: impulsion.ampleurEnZones,
    deplacementCorpsMoyen: impulsion.corpsMoyen,
    deplacementBougies: impulsion.nombreBougies,

    significativiteNiveau: significativiteDuNiveau(visibles, ob),

    positionDansLaJambe: zone?.position ?? null,
    enZoneFavorable: zone?.enZoneFavorable ?? null,
    ote: zone?.ote ?? null,

    // Retour dans la zone PENDANT l'impulsion — à ne pas confondre avec la
    // virginité du niveau, qui regarde ce qui s'est passé AVANT.
    aucunRetourPendantImpulsion: neuve.intacte,
    bougiesRevenuesPendantImpulsion: neuve.bougiesDansLaZone,

    niveauVierge: vierge?.vierge ?? null,
    visitesAnterieures: vierge?.visites ?? null,
    bougiesDepuisDerniereVisite: vierge?.bougiesDepuisDerniereVisite ?? null,

    zoneSurAtr: zoneSurAtr(visibles, ob),

    definitionAlternativeIdentique: alternative.identique,
    definitionAlternativeEcart: alternative.ecartEnBougies,

    // Longueur de la fenêtre où l'order block a été cherché. `cassures` pose
    // `indexOrigine` à `index − 50` quand aucun pivot d'origine n'existe :
    // l'écart entre les deux définitions n'y veut alors plus dire grand-chose,
    // et l'analyse doit pouvoir écarter ces cas.
    impulsionEnBougies: ob.indexCassure - ob.indexOrigine,

    // Horodatage brut plutôt qu'une session nommée : les bornes de « Londres »
    // varient d'une source à l'autre, et un découpage inventé ici se
    // retrouverait dans les conclusions.
    heureUtc: ouverture.getUTCHours(),
    jourSemaine: ouverture.getUTCDay(),
  };
}

function arrondir(n, decimales = 4) {
  return Number.isFinite(n) ? Number(n.toFixed(decimales)) : null;
}
