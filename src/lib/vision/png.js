// Encoder une image RGBA en PNG, sans dépendance.
//
// Tesseract accepte un PNG ; nos traitements rendent du RGBA à plat. Il
// manquait ce passage, et une bibliothèque entière pour trente lignes de
// format aurait été disproportionnée.
//
// PNG sans perte, sans filtrage (type 0 par ligne) : le surcoût est
// négligeable sur une bande binarisée, et le code reste lisible.

import { deflateSync } from 'node:zlib';

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(octets) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < octets.length; i++) c = TABLE[(c ^ octets[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bloc(type, données) {
  const nom = Buffer.from(type, 'ascii');
  const corps = Buffer.concat([nom, Buffer.from(données)]);
  const entete = Buffer.alloc(4);
  entete.writeUInt32BE(données.length, 0);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([entete, corps, somme]);
}

/** Un PNG RGBA 8 bits depuis des pixels à plat. */
export function enPng({ données, largeur, hauteur }) {
  if (!(largeur > 0) || !(hauteur > 0)) return null;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;      // 8 bits par canal
  ihdr[9] = 6;      // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Chaque ligne est précédée de son octet de filtre, ici toujours 0.
  const brut = Buffer.alloc(hauteur * (largeur * 4 + 1));
  for (let y = 0; y < hauteur; y++) {
    const dest = y * (largeur * 4 + 1);
    brut[dest] = 0;
    for (let i = 0; i < largeur * 4; i++) brut[dest + 1 + i] = données[y * largeur * 4 + i];
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(brut)),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

// ── Décodage ────────────────────────────────────────────────────────────────
//
// Le pendant de `enPng`, et il existe pour une raison précise : pouvoir tester
// contre de VRAIES captures. Tout le reste de ce dépôt se vérifie sur des
// images rendues par resvg, ce qui prouve la géométrie mais pas la rencontre
// avec un vrai écran — polices, lissage, thème clair, étiquette de prix. Un
// défaut n'apparaissait qu'en production, et chaque correction coûtait un
// aller-retour avec l'utilisateur.
//
// Pris en charge : 8 bits par canal, en RGB ou RGBA, non entrelacé. C'est ce
// que produisent les captures d'écran. Le reste — palette, 16 bits, Adam7 —
// est refusé explicitement plutôt que lu de travers.

import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/** Le filtre de Paeth, qui choisit le voisin le plus proche de la prédiction. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function depuisPng(octets) {
  const buf = Buffer.isBuffer(octets) ? octets : Buffer.from(octets);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('Ce fichier n’est pas un PNG.');
  }

  let largeur = 0, hauteur = 0, profondeur = 0, typeCouleur = 0, entrelace = 0;
  const morceaux = [];

  for (let i = 8; i + 8 <= buf.length;) {
    const taille = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const debut = i + 8;

    if (type === 'IHDR') {
      largeur = buf.readUInt32BE(debut);
      hauteur = buf.readUInt32BE(debut + 4);
      profondeur = buf[debut + 8];
      typeCouleur = buf[debut + 9];
      entrelace = buf[debut + 12];
    } else if (type === 'IDAT') {
      morceaux.push(buf.subarray(debut, debut + taille));
    } else if (type === 'IEND') {
      break;
    }
    i = debut + taille + 4;   // + CRC
  }

  if (profondeur !== 8) throw new Error(`PNG en ${profondeur} bits par canal : seul le 8 bits est lu.`);
  if (typeCouleur !== 2 && typeCouleur !== 6) {
    throw new Error(`PNG de type couleur ${typeCouleur} : seuls RGB (2) et RGBA (6) sont lus.`);
  }
  if (entrelace) throw new Error('PNG entrelacé (Adam7) : non pris en charge.');
  if (!morceaux.length) throw new Error('PNG sans données d’image.');

  const canaux = typeCouleur === 6 ? 4 : 3;
  const brut = inflateSync(Buffer.concat(morceaux));
  const parLigne = largeur * canaux;

  // Le déchiffrement des filtres se fait EN PLACE sur la ligne courante, parce
  // que chaque filtre se réfère aux octets déjà déchiffrés — de la ligne même
  // et de la précédente. Les traiter dans le désordre donnerait du bruit.
  const sortie = new Uint8ClampedArray(largeur * hauteur * 4);
  let precedente = new Uint8Array(parLigne);

  for (let y = 0; y < hauteur; y++) {
    const depart = y * (parLigne + 1);
    const filtre = brut[depart];
    const ligne = new Uint8Array(brut.subarray(depart + 1, depart + 1 + parLigne));

    for (let x = 0; x < parLigne; x++) {
      const a = x >= canaux ? ligne[x - canaux] : 0;
      const b = precedente[x];
      const c = x >= canaux ? precedente[x - canaux] : 0;
      switch (filtre) {
        case 0: break;
        case 1: ligne[x] = (ligne[x] + a) & 255; break;
        case 2: ligne[x] = (ligne[x] + b) & 255; break;
        case 3: ligne[x] = (ligne[x] + ((a + b) >> 1)) & 255; break;
        case 4: ligne[x] = (ligne[x] + paeth(a, b, c)) & 255; break;
        default: throw new Error(`Filtre PNG inconnu : ${filtre}.`);
      }
    }

    for (let x = 0; x < largeur; x++) {
      const s = (y * largeur + x) * 4;
      const e = x * canaux;
      sortie[s] = ligne[e]; sortie[s + 1] = ligne[e + 1]; sortie[s + 2] = ligne[e + 2];
      sortie[s + 3] = canaux === 4 ? ligne[e + 3] : 255;
    }
    precedente = ligne;
  }

  return { données: sortie, largeur, hauteur };
}
