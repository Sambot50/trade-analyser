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
 * Part de l'épaisseur dominante en deçà de laquelle une couleur trace un trait.
 *
 * Le seuil est RELATIF, et il doit l'être. Un seuil absolu ne peut pas marcher :
 * une ligne de tendance tracée à la main fait trois à cinq pixels, soit
 * l'épaisseur d'un corps de bougie sur un graphique très dézoomé. Aucun nombre
 * fixe ne sépare les deux.
 *
 * Ce qui les sépare, c'est le RAPPORT. Sur la capture qui a révélé le défaut :
 * bougies à 25 et 32 pixels, ligne de tendance à 5. Un tiers de l'épaisseur
 * dominante de son côté écarte la ligne sans jamais menacer des bougies, qui
 * sont par construction les plus épaisses de leur couleur.
 */
export const PART_EPAISSEUR_MINIMALE = 1 / 3;

/**
 * Trou toléré dans une colonne avant de la couper en deux segments.
 *
 * L'anticrénelage éclaircit parfois la jonction entre une mèche d'un pixel et
 * son corps, au point de la faire passer sous le seuil de chroma. Deux pixels
 * absorbent ce cas sans rapprocher pour autant un trait isolé du corps.
 */
export const TROU_TOLERE = 2;

/**
 * Décalage vertical toléré entre deux colonnes d'une même bougie.
 *
 * L'anticrénelage peut décaler d'un rang le premier pixel coloré d'une colonne
 * par rapport à sa voisine. Un pixel l'absorbe, et reste très loin de
 * rapprocher un pixel de trait isolé du corps d'une bougie.
 */
export const RECOUVREMENT_TOLERE = 1;

/**
 * Combien de pixels chaque couleur occupe dans une colonne, en médiane.
 *
 * Toutes les candidates en UNE passe, et ce n'est pas une optimisation de
 * confort : une passe par couleur sur une capture plein écran demandait
 * dix-neuf secondes, parce que la teinte de chaque pixel était recalculée
 * autant de fois qu'il y a de candidates. Elle l'est maintenant une fois,
 * puis comparée à chacune — le coût retombe à celui d'une seule lecture.
 *
 * Ne comptent que les colonnes où la couleur est présente : une couleur
 * absente des trois quarts de l'image n'en est pas plus fine là où elle est.
 * La médiane, et non la moyenne, pour qu'une bougie de forte amplitude ne
 * fasse pas passer un trait pour un corps.
 */
export function epaisseursMedianes(données, largeur, hauteur, couleurs, { colonnesVisees = 500 } = {}) {
  const teintes = couleurs.map((c) => teinte(c));
  const comptes = couleurs.map(() => new Int32Array(largeur));

  // Une colonne sur N suffit. On cherche une MÉDIANE sur des centaines de
  // colonnes : en échantillonner cinq cents donne le même verdict que les
  // mille neuf cent vingt d'une capture plein écran, pour un quart du temps.
  // Et le temps compte ici : cette passe s'ajoute à chaque lecture.
  const pas = Math.max(1, Math.floor(largeur / colonnesVisees));

  for (let x = 0; x < largeur; x += pas) {
    for (let y = 0; y < hauteur; y++) {
      const p = pixel(données, largeur, x, y);
      if (p[3] < 128 || chroma(p) < 25) continue;
      const t = teinte(p);
      if (t === null) continue;
      // Un pixel compte pour TOUTES les candidates dont il est proche, et
      // s'arrêter à la première serait faux : la version d'une couleur
      // mélangée au fond — le panneau de volume en transparence — garde la
      // teinte de la couleur pure à quelques degrés près. Sortir plus tôt
      // donnait zéro d'épaisseur aux vraies couleurs de bougie, absorbées par
      // leur propre reflet.
      for (let k = 0; k < teintes.length; k++) {
        if (teintes[k] !== null && ecartTeinte(t, teintes[k]) < 25) comptes[k][x]++;
      }
    }
  }

  return comptes.map((parColonne) => {
    const n = [];
    for (const v of parColonne) if (v) n.push(v);
    if (!n.length) return 0;
    n.sort((a, b) => a - b);
    return n[n.length >> 1];
  });
}

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
  // Le maximum se calcule UNE fois.
  //
  // Le recalculer dans le filtre, en reconstruisant le tableau à chaque
  // groupe, rendait la fonction quadratique : une capture plein écran porte
  // des milliers de teintes distinctes, et `Math.max(...)` sur un tableau de
  // cette taille peut en plus faire déborder la pile d'appels. La lecture ne
  // rendait jamais la main.
  let plusGros = 0;
  for (const g of groupes.values()) if (g.n > plusGros) plusGros = g.n;

  const retenus = [];
  for (const g of groupes.values()) {
    if (g.n * 20 >= plusGros) retenus.push({ couleur: moyenne(g), n: g.n });
  }

  // Puis on écarte ce qui n'a PAS la forme d'une bougie.
  //
  // Le chroma seul ne suffit pas, et le cas qui l'a montré est banal : une
  // ligne de tendance tracée à la main. Un trait bleu vif porte plus de pixels
  // et plus de chroma que les bougies vertes d'un thème clair, et son canal
  // vert dépasse son canal rouge — il était donc élu « couleur de hausse ».
  // Comme il traverse le graphique sans interruption, l'extraction n'y voyait
  // plus qu'UNE bougie, haute de six cents pixels.
  //
  // Ce qui sépare les deux n'est pas la couleur, c'est l'épaisseur. Un trait
  // occupe un ou deux pixels dans chaque colonne qu'il croise ; un corps de
  // bougie en occupe des dizaines. Mesuré sur la capture en cause : médiane
  // de 1 pour le trait, de 32 pour les bougies.
  const epaisseurs = epaisseursMedianes(données, largeur, hauteur, retenus.map((r) => r.couleur));
  retenus.forEach((r, i) => { r.epaisseur = epaisseurs[i]; });

  const meilleur = (predicat) => {
    const candidats = retenus.filter((r) => predicat(r.couleur));
    // L'épaisseur FILTRE, elle ne classe pas, et la distinction est
    // essentielle : une barre de volume est plus épaisse qu'une bougie, et
    // classer par épaisseur la ferait gagner — ramenant le défaut que le
    // chroma avait justement résolu, celui du reflet en transparence dans le
    // panneau de volume.
    //
    // Deux questions, deux critères. L'épaisseur répond « trait ou surface ».
    // Le chroma répond « couleur pure ou mélangée au fond ». Les confondre
    // revient à perdre une des deux réponses.
    const plusEpaisse = Math.max(0, ...candidats.map((r) => r.epaisseur));
    const bougies = candidats.filter((r) => r.epaisseur >= plusEpaisse * PART_EPAISSEUR_MINIMALE);
    const lot = bougies.length ? bougies : candidats;
    return lot.sort((a, b) => chroma(b.couleur) - chroma(a.couleur))[0]?.couleur ?? null;
  };

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
    // Les pixels d'une bougie SE TOUCHENT : la mèche prolonge le corps, sans
    // interruption. Un pixel isolé à la bonne teinte, loin du reste, vient
    // d'ailleurs — la ligne pointillée du prix courant, une moyenne mobile,
    // un niveau tracé à la main. Prendre le premier et le dernier pixel de la
    // colonne, comme on le faisait, laissait n'importe lequel de ces traits
    // étirer la mèche jusqu'à lui : sur une capture où la ligne du prix
    // courant croise le tracé, le « plus haut » de dix bougies de suite
    // valait exactement le prix courant.
    //
    // On ne retient donc que le segment continu le plus fourni. La tolérance
    // d'un trou de deux pixels couvre l'anticrénelage, qui éclaircit parfois
    // la jonction entre une mèche fine et son corps au point de la faire
    // passer sous le seuil de chroma.
    let meilleur = null;
    let debut = -1; let fin = -1; let n = 0; let nHausse = 0;

    const fermer = () => {
      if (debut === -1) return;
      if (!meilleur || n > meilleur.n) meilleur = { haut: debut, bas: fin, n, nHausse };
      debut = -1; n = 0; nHausse = 0;
    };

    for (let y = y0; y < y1; y++) {
      const p = pixel(données, largeur, x, y);
      if (!appartient(p)) {
        if (debut !== -1 && y - fin > TROU_TOLERE) fermer();
        continue;
      }
      if (debut === -1) debut = y;
      fin = y; n++;
      if (ecartTeinte(teinte(p), tHausse) < ecartTeinte(teinte(p), tBaisse)) nHausse++;
    }
    fermer();

    colonnes.push(meilleur ? { x, ...meilleur } : null);
  }

  // Deux colonnes voisines appartiennent à la même bougie si elles SE
  // RECOUVRENT verticalement.
  //
  // La contiguïté seule ne suffit pas, et le défaut qu'elle cause est le plus
  // grave que ce module ait produit. La ligne pointillée du prix courant pose
  // un pixel isolé dans une colonne par ailleurs vide ; cette colonne touche
  // la bougie voisine, entre dans son groupe, et la mèche du groupe s'étend
  // jusqu'au trait. Relevé sur une capture réelle :
  //
  //     x=789 : un seul pixel à y=462   ← la ligne du prix courant
  //     x=790 : 162-165                 ← la vraie bougie
  //     x=792 : 150-183                 ← sa mèche
  //
  // La bougie obtenue avait quinze points de corps et mille cinq cent
  // quatre-vingt-douze de mèche, et l'order block construit dessus couvrait
  // quarante pour cent du graphique. Rien ne le signalait : la bougie restait
  // une bougie, avec quatre prix cohérents entre eux.
  //
  // Filtrer sur la hauteur de colonne ne marche pas — un doji dont le corps
  // couvre un pixel a des colonnes aussi courtes qu'un pixel de trait, et les
  // écarter le ferait disparaître, décalant toute la série.
  //
  // Le recouvrement les sépare sans rien supposer : les colonnes d'une même
  // bougie partagent son corps ou sa mèche, donc une plage commune. Un pixel
  // posé à l'écart n'en partage aucune.
  const groupes = [];
  let courant = [];
  let hautGroupe = 0; let basGroupe = 0;

  for (const c of colonnes) {
    if (!c) {
      if (courant.length) { groupes.push(courant); courant = []; }
      continue;
    }
    const recouvre = courant.length
      && c.haut <= basGroupe + RECOUVREMENT_TOLERE
      && c.bas >= hautGroupe - RECOUVREMENT_TOLERE;

    if (courant.length && !recouvre) { groupes.push(courant); courant = []; }
    if (!courant.length) { hautGroupe = c.haut; basGroupe = c.bas; }
    else { hautGroupe = Math.min(hautGroupe, c.haut); basGroupe = Math.max(basGroupe, c.bas); }
    courant.push(c);
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
export function echelleDepuisReperes(reperes, { ecartMaximal = 0.01, minimum = 3 } = {}) {
  const points = (reperes ?? [])
    .filter((r) => Number.isFinite(r?.prix) && Number.isFinite(r?.y))
    .sort((a, b) => a.y - b.y);
  if (points.length < minimum) return null;

  const droiteEntre = (p, q) => {
    if (p.y === q.y) return null;
    const a = (q.prix - p.prix) / (q.y - p.y);
    return a < 0 ? { a, b: p.prix - a * p.y } : null;   // le prix décroît vers le bas
  };

  // CONSENSUS plutôt qu'ajustement global.
  //
  // Un seul chiffre mal lu faisait auparavant tout rejeter. Or il y a toujours
  // un intrus sur une capture réelle : l'étiquette du prix courant posée sur
  // l'axe, un chiffre de watchlist, un « 15 » du bandeau. Exiger que TOUT
  // s'aligne, c'est renoncer dès qu'une seule graduation est abîmée.
  //
  // On cherche donc la droite sur laquelle le PLUS de repères tombent, et on
  // écarte le reste. Trois points alignés suffisent à décrire un axe ; les
  // intrus, eux, ne s'alignent sur rien.
  let meilleur = null;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = droiteEntre(points[i], points[j]);
      if (!d) continue;
      const dedans = points.filter((p) => Math.abs(p.prix - (d.a * p.y + d.b))
        <= ecartMaximal * Math.abs(points.at(-1).prix - points[0].prix || 1));
      if (!meilleur || dedans.length > meilleur.length) meilleur = dedans;
    }
  }
  if (!meilleur || meilleur.length < minimum) return null;

  // Réajustement par moindres carrés sur les seuls repères retenus.
  const n = meilleur.length;
  const sy = meilleur.reduce((s, p) => s + p.y, 0);
  const sp = meilleur.reduce((s, p) => s + p.prix, 0);
  const syy = meilleur.reduce((s, p) => s + p.y * p.y, 0);
  const syp = meilleur.reduce((s, p) => s + p.y * p.prix, 0);
  const denom = n * syy - sy * sy;
  if (denom === 0) return null;
  const a = (n * syp - sy * sp) / denom;
  const b = (sp - a * sy) / n;
  if (!(a < 0)) return null;

  const etendue = Math.abs(meilleur[0].prix - meilleur.at(-1).prix);
  if (!(etendue > 0)) return null;
  const pireEcart = Math.max(...meilleur.map((p) => Math.abs(p.prix - (a * p.y + b)) / etendue));
  if (pireEcart > ecartMaximal) return null;

  return {
    a, b, n, pireEcart,
    retenus: meilleur,
    rejetes: points.filter((p) => !meilleur.includes(p)),
    prixDeY: (y) => a * y + b,
    // L'inverse, pour reporter une zone mesurée SUR l'image.
    yDePrix: (prix) => (prix - b) / a,
  };
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
