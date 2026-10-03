// Corrélations — rang et linéaire.
//
// Le volume est une grandeur à queue lourde : quelques bougies pèsent mille
// fois la médiane. Un coefficient de Pearson y est dominé par ces quelques
// points, au point de mesurer surtout leur présence.
//
// Spearman travaille sur les RANGS. Il répond à « quand le volume est plus
// haut, le mouvement l'est-il aussi », sans qu'un seul pic de 40 000 contrats
// impose sa réponse. C'est celui qu'il faut lire en premier ici ; Pearson est
// affiché à côté, et l'écart entre les deux est lui-même une information.

/** Rangs moyens, ex æquo partagés — sans quoi les paliers de volume biaisent. */
export function rangs(valeurs) {
  const indices = valeurs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const sortie = new Array(valeurs.length);
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1][0] === indices[i][0]) j++;
    const rangMoyen = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) sortie[indices[k][1]] = rangMoyen;
    i = j + 1;
  }
  return sortie;
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx; const b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : null;
}

export const spearman = (xs, ys) => pearson(rangs(xs), rangs(ys));

/**
 * L'erreur type d'un coefficient, et le seuil au-dessous duquel il n'est
 * qu'un artefact d'échantillon.
 *
 * Sur des dizaines de milliers de bougies, 1/√n vaut quelques millièmes :
 * presque tout devient « significatif ». C'est pourquoi l'AMPLEUR compte ici
 * bien plus que la significativité — un r de 0,02 sur 50 000 points est
 * certain et sans intérêt.
 */
export function significativite(r, n) {
  if (r === null || n < 4) return null;
  const se = 1 / Math.sqrt(n - 3);          // erreur type de la transformée de Fisher
  const z = 0.5 * Math.log((1 + r) / (1 - r));
  return { se, z: z / se, seuilBruit: 2 * se };
}
