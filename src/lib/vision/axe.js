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
export function zoneTrace(données, largeur, hauteur, palette, { seuilChroma = 25, ecartTeinteMax = 25, ecartTolere = 60, largeurPanneau = 110, largeurBlocPlein = 20 } = {}) {
  if (!palette) return null;
  const tH = teinte(palette.hausse);
  const tB = teinte(palette.baisse);

  // Première passe : la hauteur couverte par chaque colonne.
  const hautCol = new Int32Array(largeur).fill(-1);
  const basCol = new Int32Array(largeur).fill(-1);

  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = (y * largeur + x) * 4;
      if (données[i + 3] < 128) continue;
      const p = [données[i], données[i + 1], données[i + 2]];
      if (chroma(p) < seuilChroma) continue;
      const t = teinte(p);
      if (ecartTeinte(t, tH) >= ecartTeinteMax && ecartTeinte(t, tB) >= ecartTeinteMax) continue;
      if (hautCol[x] === -1) hautCol[x] = y;
      basCol[x] = y;
    }
  }

  // C'EST LA HAUTEUR QUI SÉPARE UNE BOUGIE DU DÉCOR, pas l'écart horizontal.
  //
  // Une étiquette de prix, une variation de watchlist, un bouton coloré : tout
  // cela tient sur une ligne de texte, une vingtaine de pixels. Une colonne de
  // bougie, mèche comprise, en couvre des centaines. Le rapport est franc, et
  // il ne dépend ni du zoom ni du nombre de bougies affichées — contrairement
  // à l'écart entre deux bougies, qui m'avait fait prendre chaque bougie pour
  // un bloc séparé.
  const hauteurs = [];
  for (let x = 0; x < largeur; x++) if (hautCol[x] !== -1) hauteurs.push(basCol[x] - hautCol[x]);
  if (!hauteurs.length) return null;
  hauteurs.sort((a, b) => a - b);
  const medianeHauteur = hauteurs[hauteurs.length >> 1];
  const seuilHauteur = Math.max(6, medianeHauteur * 0.2);

  // UN BLOC PLEIN DE HAUTEUR RIGOUREUSEMENT CONSTANTE N'EST PAS DES BOUGIES.
  //
  // C'est ce qui a fini par trancher, après deux tentatives fausses. L'étiquette
  // du prix courant, mesurée sur une capture réelle, fait 18 pixels de haut —
  // exactement la MÉDIANE des colonnes de bougies du même graphique. Aucun
  // seuil de hauteur ne peut donc les séparer, et l'écart horizontal non plus
  // puisqu'elle touche presque la dernière bougie.
  //
  // Ce qui la distingue vraiment, c'est l'uniformité : cinquante-huit colonnes
  // consécutives au même haut et au même bas. Des bougies voisines, elles, ne
  // partagent jamais leurs extrémités plus de quelques colonnes — la largeur
  // d'un corps.
  const uniforme = new Uint8Array(largeur);
  let debutRun = 0;
  for (let x = 1; x <= largeur; x++) {
    const rompu = x === largeur || hautCol[x] === -1
      || hautCol[x] !== hautCol[debutRun] || basCol[x] !== basCol[debutRun];
    if (!rompu) continue;
    if (hautCol[debutRun] !== -1 && x - debutRun >= largeurBlocPlein) {
      for (let k = debutRun; k < x; k++) uniforme[k] = 1;
    }
    debutRun = x;
  }

  const colonneOccupee = new Uint8Array(largeur);
  let trouve = false;
  for (let x = 0; x < largeur; x++) {
    if (uniforme[x]) continue;
    if (hautCol[x] === -1 || basCol[x] - hautCol[x] < seuilHauteur) continue;
    colonneOccupee[x] = 1;
    trouve = true;
  }
  if (!trouve) return null;

  // Seconde passe pour les LIGNES, sur les pixels réellement colorés.
  //
  // Les marquer sur toute l'étendue d'une colonne boucherait le vide entre le
  // panneau des prix et celui du volume : une même colonne porte la bougie ET
  // sa barre, donc son étendue couvre la coupure qu'on cherche justement à
  // trouver.
  const ligneOccupee = new Uint8Array(hauteur);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (!colonneOccupee[x]) continue;
      const i = (y * largeur + x) * 4;
      if (données[i + 3] < 128) continue;
      const p = [données[i], données[i + 1], données[i + 2]];
      if (chroma(p) < seuilChroma) continue;
      const t = teinte(p);
      if (ecartTeinte(t, tH) >= ecartTeinteMax && ecartTeinte(t, tB) >= ecartTeinteMax) continue;
      ligneOccupee[y] = 1;
      break;
    }
  }

  // Le tracé est le BLOC de colonnes le plus fourni, pas l'étendue totale.
  //
  // TradingView pose l'étiquette du prix courant sur l'axe, et elle a la teinte
  // exacte d'une bougie — rouge quand le prix baisse. Prendre la dernière
  // colonne colorée ferait donc sauter la bordure droite jusqu'à cette
  // étiquette : la bande d'axe deviendrait large de quelques pixels, et il n'y
  // aurait plus rien à lire dedans. Une watchlist, dont les variations sont
  // écrites en vert et en rouge, produit le même effet en pire.
  //
  // Après le filtre de hauteur, on regroupe encore en blocs : un panneau
  // latéral peut porter des barres assez hautes pour passer. La tolérance est
  // large, car l'écart entre deux bougies grandit quand on dézoome.
  const blocs = [];
  let debutBloc = -1; let vide = 0; let occupees = 0;
  for (let x = 0; x <= largeur; x++) {
    if (x < largeur && colonneOccupee[x]) {
      if (debutBloc === -1) debutBloc = x;
      vide = 0; occupees++;
      continue;
    }
    if (debutBloc === -1) continue;
    vide++;
    if (vide > ecartTolere || x === largeur) {
      blocs.push({ x0: debutBloc, x1: x - vide + 1, occupees });
      debutBloc = -1; vide = 0; occupees = 0;
    }
  }
  if (!blocs.length) return null;
  blocs.sort((a, b) => b.occupees - a.occupees);
  const trace = blocs[0];

  // À droite du tracé il y a deux choses très différentes.
  //
  // L'étiquette du prix courant est DANS la bande d'axe, posée par-dessus les
  // graduations. S'arrêter avant elle reviendrait à vider la bande — c'est
  // justement ce qu'on cherche à éviter.
  //
  // Un panneau latéral — watchlist, liste de valeurs — est une autre affaire :
  // ses variations en vert et en rouge n'ont rien à voir avec l'axe, et la
  // bande doit s'arrêter avant.
  //
  // La largeur les sépare : une étiquette fait quelques dizaines de pixels, un
  // panneau plusieurs centaines. Le seuil est un réglage, pas une vérité.
  const suivant = blocs
    .filter((b) => b.x0 >= trace.x1 && b.x1 - b.x0 >= largeurPanneau)
    .sort((a, b) => a.x0 - b.x0)[0];

  const premier = (tab) => tab.indexOf(1);
  const dernier = (tab) => tab.lastIndexOf(1);
  const x0 = trace.x0;
  const x1 = trace.x1;
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
    axeX1: suivant ? suivant.x0 : largeur,
    blocs: blocs.length,
  };
}
