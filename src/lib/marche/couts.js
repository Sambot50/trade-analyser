// Coûts de transaction, exprimés en unités de risque.
//
// Le backtest utilisait jusqu'ici une constante — 0,05 R — posée faute de
// mieux. Elle ne mesure rien : le même système paie 0,80 R par trade sur du
// BTC spot et 0,02 R sur l'or chez un courtier CFD. Entre les deux, la
// conclusion s'inverse.
//
// Le coût réel est une distance en prix (spread, commission convertie), et le
// risque est lui aussi une distance en prix. Leur rapport est le coût en R,
// exact, trade par trade.

/**
 * Coût d'un aller-retour rapporté au risque du plan.
 *
 * @param spread      écart achat/vente en unités de prix (0.25 pour l'or à
 *                    25 cents, 0.00012 pour EURUSD à 1,2 pip)
 * @param commission  coût additionnel par aller-retour, mêmes unités, converti
 *                    par l'appelant depuis le tarif au lot
 */
export function coutEnRDuPlan(plan, { spread = 0, commission = 0 } = {}) {
  const risque = Math.abs(plan.prixEntree - plan.prixStopLoss);
  if (!Number.isFinite(risque) || risque <= 0) return null;
  return arrondir((spread + commission) / risque, 4);
}

/**
 * Distribution des distances de stop, en prix et en pourcentage du prix.
 *
 * Sert à vérifier qu'un spread annoncé est plausible : un stop médian à
 * 0,25 % du prix, c'est 6 $ sur de l'or à 2400 — un spread de 0,25 $ pèse
 * alors 4 % du risque, pas 40 %.
 */
export function distributionDesStops(plans) {
  const distances = [];
  const relatives = [];

  for (const plan of plans) {
    const d = Math.abs(plan.prixEntree - plan.prixStopLoss);
    if (!Number.isFinite(d) || d <= 0 || !plan.prixEntree) continue;
    distances.push(d);
    relatives.push(d / Math.abs(plan.prixEntree));
  }

  if (!distances.length) return null;

  return {
    nombre: distances.length,
    medianePrix: arrondir(mediane(distances), 6),
    medianeRelative: arrondir(mediane(relatives), 6),
    premierQuartileRelative: arrondir(quantile(relatives, 0.25), 6),
    dernierQuartileRelative: arrondir(quantile(relatives, 0.75), 6),
  };
}

/**
 * Taux de réussite minimal pour ne rien perdre, coûts compris.
 *
 * Le chiffre qui décide : observé au-dessus, le système gagne ; au-dessous,
 * il perd, quelle que soit la beauté du reste.
 */
export function seuilDeRentabilite(ratioMoyen, coutEnR = 0) {
  if (!Number.isFinite(ratioMoyen) || ratioMoyen <= 0) return null;
  const seuil = (1 + coutEnR) / (1 + ratioMoyen);
  return seuil >= 1 ? null : arrondir(seuil, 4);
}

function quantile(valeurs, q) {
  const tri = [...valeurs].sort((a, b) => a - b);
  const pos = (tri.length - 1) * q;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  return bas === haut ? tri[bas] : tri[bas] + (tri[haut] - tri[bas]) * (pos - bas);
}

const mediane = (v) => quantile(v, 0.5);

function arrondir(n, decimales) {
  return Number(n.toFixed(decimales));
}
