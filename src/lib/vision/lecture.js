// De l'image aux figures, en une passe — et en disant OÙ ça a échoué.
//
// Chaque étape dépend de la précédente : sans palette pas de zone, sans zone
// pas d'échelle, sans échelle pas de bougies. Un échec rendu comme un simple
// `null` laisserait l'utilisateur devant un écran vide sans savoir s'il doit
// recadrer sa capture, changer de thème, ou dézoomer son axe.
//
// On rend donc toujours l'étape atteinte et ce qui a manqué. « L'axe n'a pas
// pu être lu » et « aucune bougie trouvée » demandent deux gestes opposés.

import { detecterPalette, bougiesDepuisImage } from './extraction.js';
import { zoneTrace, reperesDepuisEtiquettes } from './axe.js';
import { lireBande } from './ocr.js';
import { lireTitre } from './titre.js';
import { pivots, cassures } from '../marche/structure.js';
import { detecterEnDetail } from '../marche/orderblocks.js';
import { normaliser as normaliserTrouvaille, duType } from '../marche/trouvailles.js';
import {
  priseDeLiquidite, fvgDeLImpulsion, premiumDiscount, fraicheur, virginiteNiveau,
} from '../marche/qualificatifs.js';

const echec = (etape, probleme, suite = {}) => ({ ok: false, etape, probleme, ...suite });

/** Les figures que le dépôt sait déjà reconnaître, appliquées à la série. */
export function analyser(bougies, { fenetre = 5 } = {}) {
  if (bougies.length < fenetre * 2 + 3) {
    return { assezDeBougies: false, pivots: null, cassures: [], trouvailles: [], orderBlocks: [], rejetes: 0 };
  }
  const p = pivots(bougies, fenetre);
  const evenements = cassures(bougies, fenetre);
  const { retenus, rejetes } = detecterEnDetail(bougies, evenements);

  // Chaque order block devient une TROUVAILLE : même forme que toute analyse
  // à venir — un type, un rang, une zone, des qualificatifs. Ce qui change
  // d'une figure à l'autre est la façon de la trouver, pas ce qu'on en fait.
  const trouvailles = retenus.map((ob) => normaliserTrouvaille({
    ...ob,
    type: 'order_block',
    // Chaque qualificatif est entouré : l'un d'eux qui lèverait sur une série
    // reconstruite ferait disparaître tous les autres de l'écran.
    qualificatifs: {
      priseDeLiquidite: sansCasse(() => priseDeLiquidite(bougies, ob)),
      fvg: sansCasse(() => fvgDeLImpulsion(bougies, ob)),
      premiumDiscount: sansCasse(() => premiumDiscount(bougies, ob)),
      fraicheur: sansCasse(() => fraicheur(bougies, ob)),
      virginite: sansCasse(() => virginiteNiveau(bougies, ob)),
    },
  })).filter(Boolean);

  return {
    assezDeBougies: true,
    pivots: p,
    cassures: evenements,
    trouvailles,
    // Vue dérivée, pour que les lecteurs qui ne connaissent que les order
    // blocks continuent de marcher pendant qu'on les fait migrer un à un.
    orderBlocks: duType(trouvailles, 'order_block'),
    rejetes: rejetes.length,
  };
}

function sansCasse(f) {
  try { return f(); } catch { return null; }
}

/**
 * La chaîne complète : image → bougies → figures.
 *
 * `etiquettes` court-circuite l'OCR quand l'appelant connaît déjà l'axe —
 * c'est ce que fait le test, et ce que fera une saisie manuelle de secours.
 */
export async function lireGraphique(données, largeur, hauteur, options = {}) {
  const { etiquettes = null, echelleManuelle = null, fenetre = 5, pasMs = 900_000, avecTitre = true, ...reste } = options;

  const palette = detecterPalette(données, largeur, hauteur);
  if (!palette) {
    return echec('palette', 'Aucune couleur de bougie trouvée. La capture est-elle bien un graphique en chandeliers ?');
  }

  const zone = zoneTrace(données, largeur, hauteur, palette);
  if (!zone || zone.x1 - zone.x0 < 10) {
    return echec('zone', 'Le tracé n’a pas pu être délimité. Recadre la capture sur le graphique seul.', { palette });
  }

  // La soupape : deux prix saisis à la main dispensent entièrement de l'OCR.
  // Le haut et le bas du panneau des prix sont connus — `zoneTrace` les donne —
  // et deux points suffisent à poser la droite.
  //
  // `estEchelle` existe parce qu'en JSX, `onClick={f}` passe L'ÉVÈNEMENT DU
  // CLIC en premier argument. Un paramètre optionnel en première position le
  // reçoit donc comme s'il s'agissait d'une saisie, et la lecture échouait sur
  // « les deux prix doivent être des nombres » alors que l'utilisateur n'avait
  // rien saisi. Mieux vaut ignorer ce qui ne ressemble pas à une échelle que
  // dépendre d'un appel correct partout.
  const estEchelle = (v) => v && typeof v === 'object'
    && ('prixHaut' in v || 'prixBas' in v);

  let lu = null;
  if (estEchelle(echelleManuelle)) {
    const { prixHaut, prixBas } = echelleManuelle;
    if (!(Number.isFinite(prixHaut) && Number.isFinite(prixBas) && prixHaut > prixBas)) {
      return echec('echelle', 'Les deux prix saisis doivent être des nombres, le haut au-dessus du bas.', { palette, zone });
    }
    const a = (prixBas - prixHaut) / (zone.y1 - zone.y0);
    const b = prixHaut - a * zone.y0;
    lu = { convention: 'manuelle', reperes: [{ prix: prixHaut, y: zone.y0 }, { prix: prixBas, y: zone.y1 }],
      echelle: { a, b, n: 2, pireEcart: 0, prixDeY: (y) => a * y + b, yDePrix: (prix) => (prix - b) / a } };
  } else {
    let lues = null;
    try {
      lues = etiquettes ?? await lireBande(
        données, largeur, hauteur,
        { x0: zone.axeX0, x1: zone.axeX1, y0: zone.y0, y1: zone.y1 },
        reste,
      );
    } catch (err) {
      // Un moteur qui n'aboutit pas ne doit pas laisser l'écran figé : on rend
      // l'échec avec sa raison, et la saisie manuelle reste ouverte.
      return echec('echelle', `${err.message} Tu peux saisir les deux prix extrêmes de l’axe à la main.`, { palette, zone, etiquettes: [] });
    }

    if (!lues || lues.length < 3) {
      // Zéro et deux ne demandent pas le même geste. Aucune étiquette veut
      // presque toujours dire que la colonne de prix n'est pas DANS l'image —
      // une capture rognée sur le tracé seul. Une ou deux veut dire que l'axe
      // est là mais trop petit, ou masqué par l'étiquette du prix courant.
      const message = (lues?.length ?? 0) === 0
        ? 'Aucune graduation lue sur l’axe. La colonne de prix est-elle bien DANS la capture, '
          + 'à droite du graphique ? Une capture rognée sur le tracé seul ne contient aucune échelle.'
        : `Seulement ${lues.length} graduation${lues.length > 1 ? 's' : ''} lue${lues.length > 1 ? 's' : ''} sur l’axe, il en faut trois. `
          + 'Agrandis la capture, ou saisis les deux prix extrêmes à la main.';
      return echec('echelle', message, { palette, zone, etiquettes: lues ?? [] });
    }

    lu = reperesDepuisEtiquettes(lues);
    if (!lu) {
      return echec('echelle', 'Les graduations lues ne forment pas une droite : l’une est mal reconnue, ou l’axe est logarithmique.', { palette, zone, etiquettes: lues });
    }
  }

  const bougies = bougiesDepuisImage(données, largeur, hauteur, { palette, echelle: lu.echelle, zone, pasMs });
  if (!bougies || !bougies.length) {
    return echec('bougies', 'Aucune bougie reconnue dans la zone de tracé.', { palette, zone, echelle: lu.echelle });
  }

  // Le bandeau, pour que le journal sache contre quelles bougies résoudre.
  // Son échec n'empêche rien : les prix restent lisibles sans lui.
  let titre = { symbole: null, unite: null, texte: '' };
  if (avecTitre && !etiquettes) {
    try { titre = await lireTitre(données, largeur, hauteur, zone, reste); }
    catch { /* bandeau illisible : la lecture des prix vaut quand même */ }
  }

  return {
    ok: true, etape: 'fini',
    palette, zone, titre,
    echelle: lu.echelle, convention: lu.convention, reperes: lu.reperes,
    bougies,
    analyses: analyser(bougies, { fenetre }),
  };
}
