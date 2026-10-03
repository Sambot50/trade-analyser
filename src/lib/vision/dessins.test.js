// Ce que l'utilisateur dessine PAR-DESSUS son graphique.
//
// Un graphique nu est un cas de laboratoire. Un graphique réel porte des
// lignes de tendance, des niveaux, des moyennes mobiles, la ligne pointillée
// du prix courant — tout cela tracé dans les mêmes couleurs vives que les
// bougies, et parfois plus franches qu'elles.
//
// Les deux défauts figés ici ont été trouvés sur une capture d'utilisateur, et
// aucun test ne les voyait parce que tous dessinaient des graphiques nus.

import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';

import { tracerGraphique, GEOMETRIE } from '../marche/graphique.js';
import { detecterPalette, colonnesDeBougies, bougieDeColonnes, teinte, ecartTeinte } from './extraction.js';
import { zoneTrace } from './axe.js';

const bougies = Array.from({ length: 40 }, (_, i) => {
  const o = 4380 + i * 1.6;
  const c = o + 11 * Math.sin(i / 3.1);
  return {
    ouvertureMs: i * 900_000, fermetureMs: i * 900_000 + 899_999,
    ouverture: o, cloture: c,
    plusHaut: Math.max(o, c) + 5, plusBas: Math.min(o, c) - 5, volume: 100 + i,
  };
});

/** Le graphique du dépôt, avec quelque chose dessiné par-dessus. */
function rendre(dessin = '') {
  const { svg, echelle } = tracerGraphique(bougies, { libelle: 'GC', unite: '15m' });
  const avec = svg.replace('</svg>', `${dessin}</svg>`);
  const r = new Resvg(avec, { fitTo: { mode: 'width', value: GEOMETRIE.largeur } }).render();
  return { données: r.pixels, largeur: r.width, hauteur: r.height, echelle };
}

describe('une ligne de tendance tracée à la main', () => {
  // Un trait bleu vif porte plus de chroma que des bougies vertes, et son
  // canal vert dépasse son canal rouge : il était élu « couleur de hausse ».
  // Comme il traverse le graphique sans interruption, l'extraction n'y voyait
  // plus qu'UNE bougie, haute de toute la zone de tracé.
  const TRAIT = '<line x1="60" y1="620" x2="1140" y2="90" stroke="#485FF6" stroke-width="3"/>';

  it('n’usurpe pas la couleur des bougies', () => {
    const nu = rendre();
    const avec = rendre(TRAIT);
    const paletteNue = detecterPalette(nu.données, nu.largeur, nu.hauteur);
    const paletteAvec = detecterPalette(avec.données, avec.largeur, avec.hauteur);

    expect(paletteAvec).not.toBeNull();
    // La teinte du bleu tracé est à 232° ; celle des bougies, au vert.
    expect(ecartTeinte(teinte(paletteAvec.hausse), teinte(paletteNue.hausse))).toBeLessThan(10);
    expect(ecartTeinte(teinte(paletteAvec.baisse), teinte(paletteNue.baisse))).toBeLessThan(10);
  });

  it('laisse l’extraction compter les bougies, pas une seule', () => {
    const { données, largeur, hauteur } = rendre(TRAIT);
    const palette = detecterPalette(données, largeur, hauteur);
    const zone = zoneTrace(données, largeur, hauteur, palette);
    const groupes = colonnesDeBougies(données, largeur, hauteur, palette, zone);
    expect(groupes.length).toBeGreaterThanOrEqual(35);
  });
});

describe('un trait horizontal qui traverse une bougie', () => {
  // La ligne pointillée du prix courant, une moyenne mobile, un niveau tracé
  // à la main : tous passent à la teinte exacte des bougies. En prenant le
  // premier et le dernier pixel coloré d'une colonne, la mèche s'étirait
  // jusqu'au trait. Sur la capture qui a révélé le défaut, le « plus haut » de
  // dix bougies de suite valait exactement le prix courant.
  it('ne déplace pas sa mèche', () => {
    const nu = rendre();
    const palette = detecterPalette(nu.données, nu.largeur, nu.hauteur);
    const zone = zoneTrace(nu.données, nu.largeur, nu.hauteur, palette);
    const extraire = (img) => colonnesDeBougies(img.données, img.largeur, img.hauteur, palette, zone)
      .map(bougieDeColonnes).filter(Boolean);

    const sans = extraire(nu);
    const cible = sans[20];
    const demi = cible.largeur / 2;
    // Le trait couvre EXACTEMENT les colonnes de cette bougie, et passe bien
    // au-dessus de sa mèche.
    const y = cible.hautMèche - 40;
    const avec = rendre(
      `<line x1="${Math.round(cible.centreX - demi)}" y1="${y}" `
      + `x2="${Math.round(cible.centreX + demi)}" y2="${y}" stroke="#10B981" stroke-width="2"/>`,
    );

    const apres = extraire(avec);
    expect(apres.length).toBe(sans.length);
    expect(apres[20].hautMèche).toBeGreaterThan(y + 4);
    expect(Math.abs(apres[20].hautMèche - cible.hautMèche)).toBeLessThanOrEqual(2);
    expect(Math.abs(apres[20].basMèche - cible.basMèche)).toBeLessThanOrEqual(2);
  });

  it('ne soude pas deux bougies quand il passe ENTRE elles', () => {
    // Le défaut le plus grave qu'ait produit ce module, et le plus discret.
    // Un trait qui passe dans une colonne vide la fait paraître occupée ; elle
    // touche la bougie voisine, entre dans son groupe, et la mèche du groupe
    // s'étire jusqu'au trait. Relevé sur une capture réelle, à six colonnes
    // d'intervalle : un pixel de ligne à y=462, une bougie à y=150-183. La
    // bougie obtenue avait quinze points de corps et mille cinq cent
    // quatre-vingt-douze de mèche.
    //
    // Rien ne le signalait. La bougie restait une bougie, ses quatre prix
    // restaient ordonnés entre eux. Seul l'order block bâti dessus — quarante
    // pour cent du graphique — finissait par se voir à l'œil nu.
    const nu = rendre();
    const palette = detecterPalette(nu.données, nu.largeur, nu.hauteur);
    const zone = zoneTrace(nu.données, nu.largeur, nu.hauteur, palette);
    const extraire = (img) => colonnesDeBougies(img.données, img.largeur, img.hauteur, palette, zone)
      .map(bougieDeColonnes).filter(Boolean);

    const sans = extraire(nu);
    const y = Math.round((zone.y0 + zone.y1) / 2);
    const avec = extraire(rendre(
      `<line x1="${zone.x0}" y1="${y}" x2="${zone.x1}" y2="${y}" `
      + 'stroke="#10B981" stroke-width="1" stroke-dasharray="4 4"/>',
    ));

    expect(avec.length).toBe(sans.length);

    // Quatre pixels, et pas deux, parce qu'un résidu subsiste et qu'il est
    // légitime : là où le trait tombe juste au bord d'une mèche, il touche sa
    // plage et s'y fond. Aucune règle de regroupement ne peut distinguer ce
    // cas — deux objets qui se touchent se touchent.
    //
    // Ce qui compte est l'ordre de grandeur. Le défaut corrigé étirait une
    // mèche de trois cents pixels à travers le graphique ; il en reste quatre,
    // soit un demi pour cent de la hauteur du tracé.
    const ecarts = sans.map((b, i) => Math.max(
      Math.abs(avec[i].hautMèche - b.hautMèche),
      Math.abs(avec[i].basMèche - b.basMèche),
    ));
    expect(Math.max(...ecarts)).toBeLessThanOrEqual(4);
    expect(Math.max(...ecarts) / (zone.y1 - zone.y0)).toBeLessThan(0.01);
    // Et il reste l'exception, pas la règle.
    expect(ecarts.filter((e) => e > 2).length).toBeLessThanOrEqual(2);
  });
});
