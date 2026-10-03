// Lire l'axe des prix, et délimiter le tracé.
//
// Deux problèmes que l'extraction des bougies ne peut pas résoudre seule :
// où commence et finit le graphique, et quel prix correspond à quel pixel.
//
// LA SÉPARATION DÉCIMALE EST LE VRAI PIÈGE. « 4,440 » vaut 4440 chez un
// courtier anglo-saxon et 4,44 chez un français. Aucune règle locale ne tranche
// — et se tromper d'un facteur mille passerait sans bruit dans toutes les
// analyses en aval.
//
// On ne devine donc pas : on essaie LES DEUX conventions sur TOUTES les
// étiquettes, et c'est l'alignement des repères qui tranche. Un axe est une
// droite ; une convention fausse la casse. C'est la mesure qui décide, pas
// une préférence de locale.

import { chroma, teinte, ecartTeinte } from './extraction.js';
import { echelleDepuisReperes } from './extraction.js';

/** Espaces de toute sorte, y compris insécables et fines. */
const ESPACES = /[\s   ]/g;

/**
 * Un nombre lu sur l'axe, selon une convention de séparateurs.
 *
 * `convention` vaut 'point' — la virgule groupe les milliers, le point sépare
 * les décimales — ou 'virgule', l'inverse.
 *
 * Rend `null` plutôt qu'un nombre douteux : une étiquette illisible vaut mieux
 * écartée que mal lue, puisque l'alignement des autres la remplacera.
 */
export function nombreDepuisTexte(texte, convention = 'point') {
  if (typeof texte !== 'string') return null;
  let t = texte.replace(ESPACES, '').replace(/[^0-9.,\-]/g, '');
  if (!/\d/.test(t)) return null;

  t = convention === 'virgule'
    ? t.replace(/\./g, '').replace(',', '.')
    : t.replace(/,/g, '');

  // Un second séparateur décimal n'a pas de sens : l'étiquette est abîmée.
  if ((t.match(/\./g) ?? []).length > 1) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * La convention tranchée par les étiquettes elles-mêmes, ou `null`.
 *
 * Quand une étiquette porte LES DEUX séparateurs — « 4,440.00 », « 1.234,56 » —
 * il n'y a plus d'ambiguïté : un séparateur de milliers se répète et groupe
 * par trois, le décimal vient en dernier et une seule fois. Le DERNIER des
 * deux est donc le décimal, et cela fixe la convention pour tout l'axe.
 *
 * L'alignement ne sait pas trancher ce cas : « 1.234,00 · 1.230,00 · 1.226,00 »
 * est une droite sous les deux lectures — l'une vaut mille fois l'autre, et
 * les deux sont parfaitement linéaires.
 */
export function conventionTranchee(etiquettes) {
  for (const e of etiquettes ?? []) {
    const t = typeof e?.texte === 'string' ? e.texte.replace(ESPACES, '') : '';
    const dernierPoint = t.lastIndexOf('.');
    const derniereVirgule = t.lastIndexOf(',');
    if (dernierPoint === -1 || derniereVirgule === -1) continue;
    return dernierPoint > derniereVirgule ? 'point' : 'virgule';
  }
  return null;
}

/**
 * Les repères de l'axe, et l'échelle qu'ils décrivent.
 *
 * `etiquettes` sont les sorties d'un OCR : {texte, y}, où `y` est le centre
 * vertical de la boîte reconnue.
 *
 * Les deux conventions sont essayées ; celle qui aligne le mieux l'emporte.
 * Si aucune n'aligne, on rend `null` — mieux vaut pas d'échelle qu'une échelle
 * fausse d'un facteur mille.
 */
export function reperesDepuisEtiquettes(etiquettes, options = {}) {
  // Une étiquette portant les deux séparateurs fixe la convention sans appel.
  // Sinon seulement, on laisse l'alignement départager.
  const tranchee = conventionTranchee(etiquettes);
  const essais = [];
  for (const convention of tranchee ? [tranchee] : ['point', 'virgule']) {
    const reperes = (etiquettes ?? [])
      .map((e) => ({ prix: nombreDepuisTexte(e?.texte, convention), y: e?.y, texte: e?.texte }))
      .filter((r) => Number.isFinite(r.prix) && Number.isFinite(r.y));
    const echelle = echelleDepuisReperes(reperes, options);
    if (echelle) essais.push({ convention, reperes, echelle });
  }
  if (!essais.length) return null;
  essais.sort((a, b) => a.echelle.pireEcart - b.echelle.pireEcart);
  return essais[0];
}

/**
 * Où se trouve le tracé, et où le panneau de volume commence.
 *
 * Les bougies elles-mêmes bornent le graphique : rien d'autre n'a leur teinte.
 * Entre le panneau des prix et celui du volume court une bande de lignes
 * entièrement vides — c'est la plus large coupure intérieure, et elle donne la
 * frontière.
 *
 * Sans cette frontière, chaque bougie avale sa propre barre de volume et son
 * plus bas plonge de cent cinquante pixels.
 */
export function zoneTrace(données, largeur, hauteur, palette, { seuilChroma = 25, ecartTeinteMax = 25 } = {}) {
  if (!palette) return null;
  const tH = teinte(palette.hausse);
  const tB = teinte(palette.baisse);

  const colonneOccupee = new Uint8Array(largeur);
  const ligneOccupee = new Uint8Array(hauteur);
  let trouve = false;

  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      if (données[i + 3] < 128) continue;
      const p = [données[i], données[i + 1], données[i + 2]];
      if (chroma(p) < seuilChroma) continue;
      const t = teinte(p);
      if (ecartTeinte(t, tH) >= ecartTeinteMax && ecartTeinte(t, tB) >= ecartTeinteMax) continue;
      colonneOccupee[x] = 1; ligneOccupee[y] = 1; trouve = true;
    }
  }
  if (!trouve) return null;

  const premier = (tab) => tab.indexOf(1);
  const dernier = (tab) => tab.lastIndexOf(1);
  const x0 = premier(colonneOccupee);
  const x1 = dernier(colonneOccupee) + 1;
  const yDebut = premier(ligneOccupee);
  const yFin = dernier(ligneOccupee) + 1;

  // La plus large coupure INTÉRIEURE sépare les prix du volume.
  let meilleur = null; let debut = -1;
  for (let y = yDebut; y < yFin; y++) {
    if (!ligneOccupee[y]) { if (debut === -1) debut = y; continue; }
    if (debut !== -1) {
      const taille = y - debut;
      if (!meilleur || taille > meilleur.taille) meilleur = { debut, fin: y, taille };
      debut = -1;
    }
  }

  // Une coupure dérisoire n'est pas une frontière de panneau : c'est un trou
  // entre deux bougies éloignées.
  const frontiere = meilleur && meilleur.taille >= (yFin - yDebut) * 0.03 ? meilleur : null;

  return {
    x0, x1, y0: yDebut, y1: frontiere ? frontiere.debut : yFin,
    avecVolume: Boolean(frontiere),
    volumeY0: frontiere ? frontiere.fin : null,
    volumeY1: frontiere ? yFin : null,
    // La bande à droite des bougies : c'est là que l'OCR doit chercher l'axe.
    axeX0: x1,
    axeX1: largeur,
  };
}
