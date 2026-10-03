// Extraire les BOUGIES d'une image de graphique.
//
// C'est le maillon qui manquait. Une fois la série reconstruite, tout ce que
// ce dépôt sait déjà faire s'applique sans rien changer : `pivots` et
// `cassures` pour la structure, `orderBlockDe` et `detecter` pour les order
// blocks, `priseDeLiquidite`, `fvgDeLImpulsion`, `premiumDiscount`,
// `virginiteNiveau` pour les qualificatifs, `scorerSegment` pour les
// anomalies de volume.
//
// AUCUN MODÈLE DE VISION ICI. Un modèle devine ; la géométrie, elle, mesure.
// Une bougie est un objet simple à l'écran : une mèche fine et verticale, un
// corps plus large, et une couleur qui dit le sens. Le reste est de
// l'arithmétique sur des pixels.
//
// Les couleurs ne sont PAS codées en dur. Elles sont relevées sur l'image :
// une capture TradingView, un thème clair, un graphique tracé par cette
// application — aucun n'emploie les mêmes. Ce qui est constant, c'est la
// forme.

/** Un pixel RGBA, à plat, comme le rend un canvas ou un décodeur PNG. */
const pixel = (données, largeur, x, y) => {
  const i = (y * largeur + x) * 4;
  return [données[i], données[i + 1], données[i + 2], données[i + 3]];
};

/** Distance entre deux couleurs, somme des écarts par canal. */
export const ecartCouleur = (a, b) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/**
 * Chroma : l'écart entre le canal le plus fort et le plus faible.
 *
 * C'est le critère qui sépare une bougie du décor, et il est ABSOLU — pas
 * relatif comme la saturation HSV. Un fond bleu nuit `#0B1120` a une
 * saturation de 0,66 et passerait pour une couleur vive ; son chroma vaut 21,
 * contre 169 pour le vert de hausse. La grille, l'axe et le texte restent
 * eux aussi sous 40.
 */
export const chroma = ([r, v, b]) => Math.max(r, v, b) - Math.min(r, v, b);

/**
 * Teinte en degrés, ou `null` pour un gris.
 *
 * C'est elle qui identifie une bougie, PAS la distance RVB.
 *
 * Un trait de mèche fait 1,5 px et un corps de doji peut faire 1 px : le
 * rendu les étale en transparence partielle, et le pixel obtenu est un
 * mélange de la couleur et du fond. Sa distance RVB à la couleur pure explose
 * — 200 pour un vert à 30 % — alors que sa TEINTE ne bouge pas : 161° contre
 * 160°. Mélanger avec un fond neutre déplace la clarté, pas la teinte.
 */
export function teinte([r, v, b]) {
  const max = Math.max(r, v, b);
  const d = max - Math.min(r, v, b);
  if (d === 0) return null;
  let h;
  if (max === r) h = ((v - b) / d) % 6;
  else if (max === v) h = (b - r) / d + 2;
  else h = (r - v) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Écart angulaire entre deux teintes, de 0 à 180. */
export function ecartTeinte(a, b) {
  if (a === null || b === null) return 180;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Saturation au sens HSV. Gardée pour l'inspection, pas pour décider. */
export function saturation([r, v, b]) {
  const max = Math.max(r, v, b);
  if (max === 0) return 0;
  return (max - Math.min(r, v, b)) / max;
}

/**
 * Les deux couleurs de bougie et la couleur de fond, relevées sur l'image.
 *
 * Les pixels saturés sont regroupés par teinte ; les deux groupes les plus
 * fournis sont la hausse et la baisse. Le vert est reconnu par sa composante
 * verte dominante — c'est la seule convention qu'on suppose, et elle n'a pas
 * d'exception connue sur un graphique financier.
 */
export function detecterPalette(données, largeur, hauteur, { seuilChroma = 40 } = {}) {
  const groupes = new Map();
  let fond = null;
  const fonds = new Map();

  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const p = pixel(données, largeur, x, y);
      if (p[3] < 128) continue;
      if (chroma(p) >= seuilChroma) {
        // Regroupement grossier : 32 niveaux par canal suffisent à réunir les
        // pixels d'une même bougie malgré l'anticrénelage.
        const clé = `${p[0] >> 5},${p[1] >> 5},${p[2] >> 5}`;
        const g = groupes.get(clé) ?? { n: 0, r: 0, v: 0, b: 0 };
        g.n++; g.r += p[0]; g.v += p[1]; g.b += p[2];
        groupes.set(clé, g);
      } else {
        const clé = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
        const f = fonds.get(clé) ?? { n: 0, r: 0, v: 0, b: 0 };
        f.n++; f.r += p[0]; f.v += p[1]; f.b += p[2];
        fonds.set(clé, f);
      }
    }
  }

  const moyenne = (g) => [Math.round(g.r / g.n), Math.round(g.v / g.n), Math.round(g.b / g.n)];

  // On ne prend PAS simplement les deux groupes les plus fournis.
  //
  // Le panneau de volume trace les mêmes bougies en transparence : même
  // teinte, mais mélangée au fond. Ces pixels-là sont nombreux et formeraient
  // un groupe à eux seuls, qui ferait passer la vraie couleur en troisième.
  //
  // Le mélange a toujours un chroma PLUS FAIBLE que la couleur pure dont il
  // vient. On garde donc, de chaque côté, le groupe au chroma le plus franc.
  const retenus = [...groupes.values()]
    .filter((g) => g.n * 20 >= Math.max(...[...groupes.values()].map((x) => x.n)))
    .map((g) => ({ couleur: moyenne(g), n: g.n }));

  const meilleur = (predicat) => retenus
    .filter((r) => predicat(r.couleur))
    .sort((a, b) => chroma(b.couleur) - chroma(a.couleur))[0]?.couleur ?? null;

  const verte = meilleur((c) => c[1] > c[0]);
  const rouge = meilleur((c) => c[0] >= c[1]);
  const classés = [verte, rouge].filter(Boolean);
  const plusGrosFond = [...fonds.values()].sort((a, b) => b.n - a.n)[0];
  fond = plusGrosFond ? moyenne(plusGrosFond) : [0, 0, 0];

  if (classés.length < 2) return null;
  // Le vert monte, le rouge baisse. Seule convention supposée.
  return { hausse: verte, baisse: rouge, fond };
}

/**
 * Les colonnes de pixels appartenant à une bougie, regroupées par bougie.
 *
 * Une colonne vide sépare deux bougies. Les groupes d'une seule colonne sont
 * écartés : c'est du bruit, de la grille ou un bord, jamais une bougie.
 */
export function colonnesDeBougies(données, largeur, hauteur, palette, zone = null) {
  const { x0 = 0, x1 = largeur, y0 = 0, y1 = hauteur } = zone ?? {};
  const tHausse = teinte(palette.hausse);
  const tBaisse = teinte(palette.baisse);
  const appartient = (p) => {
    if (p[3] < 128 || chroma(p) < 25) return false;
    const t = teinte(p);
    return ecartTeinte(t, tHausse) < 25 || ecartTeinte(t, tBaisse) < 25;
  };

  const colonnes = [];
  for (let x = x0; x < x1; x++) {
    let haut = -1; let bas = -1; let n = 0; let nHausse = 0;
    for (let y = y0; y < y1; y++) {
      const p = pixel(données, largeur, x, y);
      if (!appartient(p)) continue;
      if (haut === -1) haut = y;
      bas = y; n++;
      if (ecartTeinte(teinte(p), tHausse) < ecartTeinte(teinte(p), tBaisse)) nHausse++;
    }
    colonnes.push(n ? { x, haut, bas, n, nHausse } : null);
  }

  const groupes = [];
  let courant = [];
  for (const c of colonnes) {
    if (c) { courant.push(c); continue; }
    if (courant.length) { groupes.push(courant); courant = []; }
  }
  if (courant.length) groupes.push(courant);

  // Le filtre porte sur la HAUTEUR, pas sur le nombre de colonnes.
  //
  // Un doji dont le corps ne couvre qu'un pixel ne laisse que sa mèche, large
  // d'une seule colonne. Exiger deux colonnes le ferait disparaître de la
  // série — une bougie manquante décale tout ce qui suit.
  return groupes.filter((g) => Math.max(...g.map((c) => c.bas)) - Math.min(...g.map((c) => c.haut)) >= 2);
}

/**
 * Une bougie, en pixels, depuis son groupe de colonnes.
 *
 * La mèche court sur toute la hauteur du groupe : elle donne le plus haut et
 * le plus bas. Le corps est la partie LARGE — les colonnes dont la hauteur
 * colorée dépasse nettement celle des colonnes de mèche. Ses bords donnent
 * ouverture et clôture, que la couleur ordonne ensuite.
 *
 * Rend `null` plutôt qu'une bougie douteuse : un chiffre faux se propagerait
 * dans toutes les analyses en aval sans que rien ne le signale.
 */
export function bougieDeColonnes(groupe) {
  if (!groupe || !groupe.length) return null;

  const hautMèche = Math.min(...groupe.map((c) => c.haut));
  const basMèche = Math.max(...groupe.map((c) => c.bas));
  if (!(basMèche > hautMèche) && basMèche !== hautMèche) return null;

  // Le corps, c'est la MÉDIANE des colonnes — pas les plus hautes.
  //
  // La mèche est tracée au centre du corps, à l'intérieur de sa largeur. Les
  // colonnes centrales sont donc les PLUS hautes : y chercher le corps
  // reviendrait à mesurer la mèche. La grande majorité des colonnes ne montre
  // que le corps, et c'est ce que la médiane retient.
  const médiane = (xs) => { const t = [...xs].sort((a, b) => a - b); return t[t.length >> 1]; };
  const hautCorps = médiane(groupe.map((c) => c.haut));
  const basCorps = médiane(groupe.map((c) => c.bas));

  const total = groupe.reduce((s, c) => s + c.n, 0);
  const hausse = groupe.reduce((s, c) => s + c.nHausse, 0) * 2 >= total;

  return {
    centreX: (groupe[0].x + groupe.at(-1).x) / 2,
    largeur: groupe.length,
    hautMèche, basMèche, hautCorps, basCorps, hausse,
  };
}

/**
 * La droite prix ↔ pixel, et ce qui dit qu'elle est fiable.
 *
 * `reperes` sont des couples {prix, y} relevés sur l'axe. Trois au moins : avec
 * deux, aucune incohérence n'est détectable, et une étiquette mal lue — 4 440
 * compris 4.440 — passerait sans bruit.
 *
 * Rend `null` si les repères ne sont pas alignés. Un axe logarithmique, ou un
 * chiffre mal lu, casse l'alignement et doit faire échouer la lecture plutôt
 * que produire une échelle fausse.
 */
export function echelleDepuisReperes(reperes, { ecartMaximal = 0.01 } = {}) {
  const points = (reperes ?? [])
    .filter((r) => Number.isFinite(r?.prix) && Number.isFinite(r?.y))
    .sort((a, b) => a.y - b.y);
  if (points.length < 3) return null;

  // Moindres carrés : prix = a·y + b.
  const n = points.length;
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sp = points.reduce((s, p) => s + p.prix, 0);
  const syy = points.reduce((s, p) => s + p.y * p.y, 0);
  const syp = points.reduce((s, p) => s + p.y * p.prix, 0);
  const dénom = n * syy - sy * sy;
  if (dénom === 0) return null;
  const a = (n * syp - sy * sp) / dénom;
  const b = (sp - a * sy) / n;
  if (!(a < 0)) return null;        // en pixels, le prix décroît vers le bas

  const etendue = Math.abs(points[0].prix - points.at(-1).prix);
  if (!(etendue > 0)) return null;
  const residus = points.map((p) => Math.abs(p.prix - (a * p.y + b)) / etendue);
  const pire = Math.max(...residus);
  if (pire > ecartMaximal) return null;

  return { a, b, n, pireEcart: pire, prixDeY: (y) => a * y + b };
}

/** La série de bougies, en prix, prête pour toutes les analyses du dépôt. */
export function bougiesDepuisImage(données, largeur, hauteur, { palette, echelle, zone, departMs = 0, pasMs = 900_000 } = {}) {
  const p = palette ?? detecterPalette(données, largeur, hauteur);
  if (!p || !echelle) return null;

  const groupes = colonnesDeBougies(données, largeur, hauteur, p, zone);
  const bougies = [];
  for (let i = 0; i < groupes.length; i++) {
    const g = bougieDeColonnes(groupes[i]);
    if (!g) continue;
    const plusHaut = echelle.prixDeY(g.hautMèche);
    const plusBas = echelle.prixDeY(g.basMèche);
    const hautCorps = echelle.prixDeY(g.hautCorps);
    const basCorps = echelle.prixDeY(g.basCorps);
    bougies.push({
      ouvertureMs: departMs + bougies.length * pasMs,
      fermetureMs: departMs + (bougies.length + 1) * pasMs - 1,
      ouverture: g.hausse ? basCorps : hautCorps,
      cloture: g.hausse ? hautCorps : basCorps,
      plusHaut, plusBas, volume: null, centreX: g.centreX,
    });
  }
  return bougies;
}
