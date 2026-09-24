// Découpage d'une série en contrats.
//
// Les futures expirent. Deux ans de GC, ce sont une douzaine de contrats qui se
// succèdent, et le passage de l'un à l'autre crée un saut de prix qui n'est pas
// un mouvement de marché.
//
// Recoller ces contrats en une série continue ferait lire ce saut comme un
// déplacement suivi d'une cassure de structure — une machine à fabriquer des
// order blocks exactement là où on en cherche des vrais. Aucun ajustement ne
// répare ça : il le déplace, et il le rend invérifiable.
//
// D'où ce module : on ne recolle rien. On découpe, on mesure chaque contrat
// séparément, on met les issues en commun à la fin. Voir DEC-027.
//
// Le découpage ne connaît aucun calendrier d'expiration. Il coupe là où le
// champ `symbole` change, c'est-à-dire là où la donnée dit qu'il a changé.

/** Étiquette de contrat d'une bougie, ou null si elle n'en porte pas. */
const etiquette = (b) => (typeof b.symbole === 'string' && b.symbole !== '' ? b.symbole : null);

function decrireSegment(symbole, bougies) {
  return {
    symbole,
    bougies,
    nombre: bougies.length,
    debutMs: bougies[0].ouvertureMs,
    finMs: bougies.at(-1).fermetureMs,
  };
}

/**
 * Découpe une série chronologique en segments contigus, un par contrat.
 *
 * Une série sans aucune étiquette — Binance, HistData, un CSV de CFD — donne un
 * segment unique de symbole `null`. Rien ne change pour elle, et c'est voulu :
 * le découpage ne doit rien coûter là où il n'a pas lieu d'être.
 *
 * @param minimumBougies segments plus courts écartés plutôt que mesurés. Un
 *   roulement au volume peut osciller entre deux contrats sur quelques bougies ;
 *   ces miettes ne peuvent héberger aucun order block résoluble, et les garder
 *   ne ferait qu'ajouter du bruit de comptage.
 */
export function decouperParContrat(bougies, { minimumBougies = 0 } = {}) {
  if (!Number.isInteger(minimumBougies) || minimumBougies < 0) {
    throw new Error('minimumBougies doit être un entier positif ou nul.');
  }
  if (!bougies.length) return { segments: [], ecartes: [] };

  // Le découpage suppose l'ordre chronologique. Une série désordonnée
  // produirait des segments plausibles et faux, que plus rien ne signalerait
  // ensuite — donc on refuse plutôt que de mesurer n'importe quoi.
  for (let i = 1; i < bougies.length; i++) {
    if (bougies[i].ouvertureMs < bougies[i - 1].ouvertureMs) {
      throw new Error(`Série non chronologique à l'indice ${i} : le découpage par contrat suppose l'ordre du temps.`);
    }
  }

  const etiquetees = bougies.reduce((n, b) => n + (etiquette(b) === null ? 0 : 1), 0);

  if (etiquetees === 0) return { segments: [decrireSegment(null, bougies)], ecartes: [] };

  if (etiquetees !== bougies.length) {
    throw new Error(
      `Série partiellement étiquetée : ${etiquetees} bougies sur ${bougies.length} portent un contrat. `
      + "Mélanger des bougies étiquetées et non étiquetées ferait couper au hasard.",
    );
  }

  const bruts = [];
  for (const b of bougies) {
    const s = etiquette(b);
    const courant = bruts.at(-1);
    if (courant && courant.symbole === s) courant.bougies.push(b);
    else bruts.push({ symbole: s, bougies: [b] });
  }

  const segments = [];
  const ecartes = [];
  for (const brut of bruts) {
    const decrit = decrireSegment(brut.symbole, brut.bougies);
    (brut.bougies.length >= minimumBougies ? segments : ecartes).push(decrit);
  }

  return { segments, ecartes };
}

/**
 * Nombre minimal de bougies fines pour qu'un segment puisse héberger un seul
 * order block résolu.
 *
 * Un pivot demande `2 × fenetre + 1` bougies de détection, la cassure au moins
 * une de plus, et la résolution tout l'horizon. En dessous, le segment ne peut
 * rien produire : le mesurer reviendrait à compter des order blocks qu'on sait
 * d'avance incapables d'aboutir.
 */
export function minimumPourResoudre({ fenetre, dureeDetectionMs, horizonHeures, dureeFineMs }) {
  if (!(dureeFineMs > 0)) throw new Error('dureeFineMs doit être strictement positive.');
  const detectionMs = (2 * fenetre + 2) * dureeDetectionMs;
  const resolutionMs = horizonHeures * 3_600_000;
  return Math.ceil((detectionMs + resolutionMs) / dureeFineMs);
}
