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
import {
  priseDeLiquidite, fvgDeLImpulsion, premiumDiscount, fraicheur, virginiteNiveau,
} from '../marche/qualificatifs.js';

const echec = (etape, probleme, suite = {}) => ({ ok: false, etape, probleme, ...suite });

/** Les figures que le dépôt sait déjà reconnaître, appliquées à la série. */
export function analyser(bougies, { fenetre = 5 } = {}) {
  if (bougies.length < fenetre * 2 + 3) {
    return { assezDeBougies: false, pivots: null, cassures: [], orderBlocks: [], rejetes: 0 };
  }
  const p = pivots(bougies, fenetre);
  const evenements = cassures(bougies, fenetre);
  const { retenus, rejetes } = detecterEnDetail(bougies, evenements);

  const orderBlocks = retenus.map((ob) => ({
    ...ob,
    // Chaque qualificatif est entouré : l'un d'eux qui lèverait sur une série
    // reconstruite ferait disparaître tous les autres de l'écran.
    qualificatifs: {
      priseDeLiquidite: sansCasse(() => priseDeLiquidite(bougies, ob)),
      fvg: sansCasse(() => fvgDeLImpulsion(bougies, ob)),
      premiumDiscount: sansCasse(() => premiumDiscount(bougies, ob)),
      fraicheur: sansCasse(() => fraicheur(bougies, ob)),
      virginite: sansCasse(() => virginiteNiveau(bougies, ob)),
    },
  }));

  return { assezDeBougies: true, pivots: p, cassures: evenements, orderBlocks, rejetes: rejetes.length };
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
  const { etiquettes = null, fenetre = 5, pasMs = 900_000, avecTitre = true, ...reste } = options;

  const palette = detecterPalette(données, largeur, hauteur);
  if (!palette) {
    return echec('palette', 'Aucune couleur de bougie trouvée. La capture est-elle bien un graphique en chandeliers ?');
  }

  const zone = zoneTrace(données, largeur, hauteur, palette);
  if (!zone || zone.x1 - zone.x0 < 10) {
    return echec('zone', 'Le tracé n’a pas pu être délimité. Recadre la capture sur le graphique seul.', { palette });
  }

  const lues = etiquettes ?? await lireBande(
    données, largeur, hauteur,
    { x0: zone.axeX0, x1: zone.axeX1, y0: zone.y0, y1: zone.y1 },
    reste,
  );
  if (!lues || lues.length < 3) {
    return echec('echelle', 'Moins de trois graduations lisibles sur l’axe. Agrandis la capture, ou saisis deux prix à la main.', { palette, zone, etiquettes: lues ?? [] });
  }

  const lu = reperesDepuisEtiquettes(lues);
  if (!lu) {
    return echec('echelle', 'Les graduations lues ne forment pas une droite : l’une est mal reconnue, ou l’axe est logarithmique.', { palette, zone, etiquettes: lues });
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
