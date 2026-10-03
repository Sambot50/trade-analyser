// Une série de bougies qui ne contient AUCUN avantage, par construction.
//
// `controle.js` répond à « cette règle lisait-elle la structure ? » en
// mélangeant les bougies réelles. Ce fichier répond à une autre question :
// « cette MESURE rend-elle zéro quand il n'y a rien à trouver ? »
//
// La différence compte. Un mélange conserve la distribution empirique des
// bougies ; une marche aléatoire, elle, est un martingale dont on connaît la
// réponse à l'avance. Toute mesure qui en tire un chiffre non nul mesure son
// propre biais, pas le marché.
//
// Le volume est tiré INDÉPENDAMMENT du prix. C'est ce qui garantit l'absence
// d'avantage : aucun détecteur fondé sur le volume ne peut prédire quoi que
// ce soit, quel que soit son seuil. Si l'un d'eux y arrive, il triche.

import { generateurAleatoire } from './controle.js';

/** Loi normale centrée réduite, par Box-Muller, à partir d'un uniforme. */
export function gaussienne(alea) {
  let u = 0;
  let v = 0;
  while (u === 0) u = alea();
  while (v === 0) v = alea();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const arrondirAuPas = (prix, pas) => (pas > 0 ? Math.round(prix / pas) * pas : prix);

/**
 * Marche aléatoire en bougies d'une minute, découpée en contrats.
 *
 * `partRafale` et `ampleurRafale` créent des bouffées de volume. Sans elles,
 * le volume d'une bougie de 15 minutes — somme de quinze tirages indépendants —
 * se concentre autour de sa moyenne et ne dépasse jamais quatre fois sa
 * médiane glissante. Aucun détecteur de pic ne se déclenche, et le témoin ne
 * teste alors que la moitié du chemin. Les rafales sont tirées sur le temps,
 * jamais sur le prix : elles rendent le détecteur actif sans lui rien apprendre.
 */
export function serieAleatoire({
  graine = 1,
  minutes = 43_200,
  depart = 4300,
  sigma = 0.5,
  pas = 0.1,
  contrats = 1,
  debutMs = Date.UTC(2026, 0, 1),
  volumeMedian = 66,
  partRafale = 0.05,
  ampleurRafale = 1.6,
} = {}) {
  const alea = generateurAleatoire(graine);
  const g = () => gaussienne(alea);
  const bougies = [];

  let prix = depart;
  let ms = debutMs;
  let rafale = 1;

  for (let contrat = 0; contrat < contrats; contrat++) {
    for (let m = 0; m < minutes; m++) {
      // La rafale change par blocs de quinze minutes, comme une séance réelle.
      if (m % 15 === 0) {
        rafale = alea() < partRafale
          ? Math.exp(ampleurRafale + 0.8 * Math.abs(g()))
          : Math.exp(0.35 * g());
      }

      const ouverture = prix;
      let cloture = prix;
      let plusHaut = prix;
      let plusBas = prix;
      for (let k = 0; k < 6; k++) {
        cloture += (sigma / Math.sqrt(6)) * g();
        if (cloture > plusHaut) plusHaut = cloture;
        if (cloture < plusBas) plusBas = cloture;
      }
      prix = cloture;

      const o = arrondirAuPas(ouverture, pas);
      const c = arrondirAuPas(cloture, pas);
      // L'arrondi peut faire passer une extrémité du mauvais côté du corps.
      const h = Math.max(arrondirAuPas(plusHaut, pas), o, c);
      const b = Math.min(arrondirAuPas(plusBas, pas), o, c);

      bougies.push({
        ouvertureMs: ms,
        fermetureMs: ms + 59_999,
        ouverture: o,
        plusHaut: h,
        plusBas: b,
        cloture: c,
        volume: Math.max(1, Math.round(rafale * volumeMedian * Math.exp(0.5 * g()))),
        contrat: 1000 + contrat,
      });
      ms += 60_000;
    }
  }
  return bougies;
}

const horodater = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** Sérialise en CSV au format d'un export Databento, colonnes nommées. */
export function enCsv(bougies) {
  const lignes = ['ts_event,open,high,low,close,volume,instrument_id'];
  for (const b of bougies) {
    lignes.push([
      horodater(b.ouvertureMs),
      b.ouverture.toFixed(2), b.plusHaut.toFixed(2),
      b.plusBas.toFixed(2), b.cloture.toFixed(2),
      b.volume, b.contrat,
    ].join(','));
  }
  return lignes.join('\n') + '\n';
}

/**
 * Le reflet de la série autour d'un axe : chaque hausse devient une baisse.
 *
 * C'est le seul moyen de distinguer une dérive d'échantillon d'un biais de
 * code. Une mesure qui rend un chiffre positif sur la série ET sur son reflet
 * ne lit pas la direction du marché — elle favorise la position.
 */
export function miroir(bougies, axe = null) {
  if (!bougies.length) return [];
  const a = axe ?? 2 * bougies[0].ouverture;
  return bougies.map((b) => ({
    ...b,
    ouverture: a - b.ouverture,
    cloture: a - b.cloture,
    // Le haut et le bas s'échangent : le sommet du reflet est l'ancien creux.
    plusHaut: a - b.plusBas,
    plusBas: a - b.plusHaut,
  }));
}

/**
 * De combien l'erreur type calculée est-elle fausse ?
 *
 * `observations` sont des mesures répétées de la même grandeur sur des
 * échantillons indépendants — une graine par échantillon. `erreursTypes` sont
 * les erreurs types que la formule usuelle annonçait pour chacune.
 *
 * Le rapport des deux est le facteur par lequel il faut corriger. Il vaut 1
 * quand les observations sont indépendantes, et davantage quand elles se
 * chevauchent : des positions qui partagent leur fenêtre de résolution
 * montent et descendent ensemble, et la formule, qui les croit séparées,
 * sous-estime leur dispersion commune.
 */
export function facteurInflation(observations, erreursTypes) {
  const n = observations.length;
  if (n < 3 || erreursTypes.length !== n) return null;
  const moyenne = observations.reduce((s, x) => s + x, 0) / n;
  const ecartTypeObserve = Math.sqrt(
    observations.reduce((s, x) => s + (x - moyenne) ** 2, 0) / (n - 1),
  );
  const erreurTypeNominale = erreursTypes.reduce((s, x) => s + x, 0) / n;
  if (!(erreurTypeNominale > 0)) return null;
  return {
    n,
    moyenne,
    ecartTypeObserve,
    erreurTypeNominale,
    facteur: ecartTypeObserve / erreurTypeNominale,
  };
}
