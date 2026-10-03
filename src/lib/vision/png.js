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
