// Repérage des minutes anormales dans une série de bougies.
//
// Renversement de méthode. Jusqu'ici on partait d'une RÈGLE — « dernière
// bougie opposée avant l'impulsion » — et on demandait aux données de la
// valider. Elle a échoué six fois (DEC-029).
//
// Ici on part des données. On ne cherche pas des order blocks : on cherche ce
// qui ne ressemble pas au reste, et on regardera ensuite. C'est de la
// GÉNÉRATION d'hypothèse, pas une mesure — aucun chiffre sorti d'ici ne
// prouve quoi que ce soit.
//
// Deux choix de méthode qui portent tout le module :
//
// La référence est une MÉDIANE glissante, jamais une moyenne. Une moyenne est
// tirée vers le haut par les pics qu'on traque : elle rendrait chaque anomalie
// moins anormale à mesure qu'elles sont nombreuses. La médiane ne bouge pas.
//
// Les détecteurs sont SÉPARÉS, et jamais additionnés en un score unique. Un
// score composite dirait « anormal » sans dire pourquoi, et c'est le pourquoi
// qu'on cherche à reconnaître.

/** Quantile d'un tableau non vide, par interpolation. Ne modifie pas l'entrée. */
export function quantile(valeurs, part) {
  if (!valeurs.length) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const rang = part * (tries.length - 1);
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  return bas === haut ? tries[bas] : tries[bas] + (rang - bas) * (tries[haut] - tries[bas]);
}

/** Médiane d'un tableau non vide. */
export const mediane = (valeurs) => quantile(valeurs, 0.5);

export const DETECTEURS = ['absorption', 'deplacement', 'rejet', 'horsSeance', 'gap', 'picVolume'];

/** Volume exigé, en multiples de la médiane locale, avant de scorer quoi que ce soit. */
const VOLUME_PLANCHER = 2;

/** Part de la bougie que la mèche doit occuper pour qu'on parle de rejet. */
const MECHE_MINIMALE = 0.6;

/**
 * Médiane du volume par heure UTC.
 *
 * L'or a un profil horaire marqué : le même volume n'a pas le même sens à
 * 3 h et à 14 h. Sert au détecteur `horsSeance`, qui cherche du volume là où
 * il ne devrait structurellement pas y en avoir.
 */
export function profilHoraire(bougies) {
  const parHeure = new Map();
  for (const b of bougies) {
    const h = new Date(b.ouvertureMs).getUTCHours();
    if (!parHeure.has(h)) parHeure.set(h, []);
    parHeure.get(h).push(b.volume || 0);
  }

  const medianes = new Map();
  for (const [h, volumes] of parHeure) medianes.set(h, mediane(volumes));

  // Le premier quartile, et non la médiane : « sous la moyenne » qualifierait
  // la moitié des heures de la journée, ce qui ne veut plus rien dire. On
  // cherche les heures structurellement vides, pas les heures calmes.
  const toutes = [...medianes.values()].filter((v) => v > 0);
  return { medianes, seuilCreux: quantile(toutes, 0.25) ?? 0 };
}

/**
 * Score chaque bougie d'UN segment homogène — un seul contrat.
 *
 * La fenêtre de référence ne doit jamais enjamber un roulement : le saut de
 * prix fausserait l'amplitude médiane, et le changement de liquidité le
 * volume médian. C'est à l'appelant de ne passer qu'un segment.
 *
 * Les `fenetre` premières bougies ne sont pas scorées : elles n'ont pas assez
 * de passé pour avoir une référence.
 */
export function scorerSegment(bougies, { fenetre = 60 } = {}) {
  if (bougies.length <= fenetre) return [];

  const { medianes: medianesHoraires, seuilCreux } = profilHoraire(bougies);
  const resultats = [];

  for (let i = fenetre; i < bougies.length; i++) {
    const b = bougies[i];
    const precedentes = bougies.slice(i - fenetre, i);

    const medVolume = mediane(precedentes.map((p) => p.volume || 0));
    const medAmplitude = mediane(precedentes.map((p) => p.plusHaut - p.plusBas));
    if (!medVolume || !medAmplitude) continue;

    const amplitude = b.plusHaut - b.plusBas;
    const corps = Math.abs(b.cloture - b.ouverture);
    const meche = Math.max(b.plusHaut - Math.max(b.ouverture, b.cloture), Math.min(b.ouverture, b.cloture) - b.plusBas);

    const ratioVolume = (b.volume || 0) / medVolume;
    // Une bougie d'amplitude nulle rendrait l'absorption infinie. On plafonne
    // le rapport plutôt que de produire un score qui écrase tous les autres.
    const ratioAmplitude = Math.max(amplitude / medAmplitude, 0.01);

    const assezDeVolume = ratioVolume >= VOLUME_PLANCHER;
    const heure = new Date(b.ouvertureMs).getUTCHours();
    const medHoraire = medianesHoraires.get(heure) ?? 0;
    const heureCreuse = medHoraire > 0 && medHoraire < seuilCreux;

    const ecartOuverture = i > 0 ? Math.abs(b.ouverture - bougies[i - 1].cloture) : 0;

    resultats.push({
      index: i,
      ms: b.ouvertureMs,
      mesures: {
        volume: b.volume || 0,
        ratioVolume: arrondir(ratioVolume),
        ratioAmplitude: arrondir(amplitude / medAmplitude),
        partDuCorps: amplitude ? arrondir(corps / amplitude) : 0,
        partDeLaMeche: amplitude ? arrondir(meche / amplitude) : 0,
        amplitude: arrondir(amplitude),
        cloture: b.cloture,
        heure,
      },
      scores: {
        // Beaucoup d'échanges, et le prix ne bouge pas : quelqu'un encaisse
        // tout le flux sans le laisser partir.
        //
        // L'amplitude doit être AU PLUS la médiane locale. Sans cette
        // condition, un volume à 11× la médiane l'emportait sur une amplitude
        // à 2× — et le détecteur classait en tête des bougies larges, c'est-
        // à-dire exactement le contraire de ce qu'il prétend nommer.
        absorption: assezDeVolume && ratioAmplitude <= 1
          ? arrondir(ratioVolume / ratioAmplitude)
          : 0,
        // L'inverse : quelqu'un prend le marché, en corps plein.
        deplacement: assezDeVolume && amplitude
          ? arrondir(ratioVolume * (amplitude / medAmplitude) * (corps / amplitude))
          : 0,
        // Le prix est allé chercher un niveau et s'est fait renvoyer.
        rejet: assezDeVolume && amplitude && meche / amplitude >= MECHE_MINIMALE
          ? arrondir(ratioVolume * (meche / amplitude))
          : 0,
        // Du volume là où il ne devrait structurellement pas y en avoir.
        horsSeance: heureCreuse ? arrondir((b.volume || 0) / medHoraire) : 0,
        // Saut de prix entre deux bougies. Jamais calculé au travers d'un
        // roulement, puisque le segment n'en contient aucun.
        gap: arrondir(ecartOuverture / medAmplitude),
        picVolume: arrondir(ratioVolume),
      },
    });
  }

  return resultats;
}

/**
 * Les `nombre` meilleurs d'un détecteur, sans deux candidats issus du même évènement.
 *
 * Un pic de volume s'étale sur plusieurs minutes : sans dédoublonnage, les
 * cent premiers seraient cinq évènements vus vingt fois. `ecartMinimalMs`
 * impose une distance entre deux retenus.
 */
export function meilleurs(scores, detecteur, { nombre = 20, ecartMinimalMs = 30 * 60_000 } = {}) {
  if (!DETECTEURS.includes(detecteur)) throw new Error(`Détecteur inconnu : "${detecteur}".`);

  const candidats = scores
    .filter((s) => s.scores[detecteur] > 0)
    .sort((a, b) => b.scores[detecteur] - a.scores[detecteur]);

  const retenus = [];
  for (const c of candidats) {
    if (retenus.length >= nombre) break;
    if (retenus.some((r) => Math.abs(r.ms - c.ms) < ecartMinimalMs)) continue;
    retenus.push(c);
  }
  return retenus;
}

const arrondir = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : 0);
