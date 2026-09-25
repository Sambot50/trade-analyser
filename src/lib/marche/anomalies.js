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

/**
 * Variation minimale pour qu'on parle de tendance : 0,2 % du prix.
 *
 * En dessous, on rend « plate » plutôt que de trancher. Un marché qui a bougé
 * d'un dixième de pour cent en une journée n'est ni haussier ni baissier, et
 * lui coller une étiquette fabriquerait une moitié des cas au hasard.
 *
 * Le seuil couvre aussi l'écart de report entre deux contrats, de l'ordre de
 * quelques dixièmes de pour cent sur l'or — mais la recherche reste confinée
 * au segment, donc la question ne se pose pas.
 */
export const SEUIL_TENDANCE = 0.002;

const HORIZONS = { tendanceJour: 24 * 3_600_000, tendanceSemaine: 7 * 24 * 3_600_000 };

/**
 * Les quatre familles : mouvement général × sens du volume.
 *
 * Toujours lues sur la MÊME série que la détection — les bougies de quinze
 * minutes. « Sur la journée » veut dire quatre-vingt-seize bougies en
 * arrière, « sur la semaine » six cent soixante-douze, pas un changement
 * d'unité.
 *
 * Rend `null` quand la tendance est plate ou inconnue : une cinquième famille
 * nommée « on ne sait pas » vaut mieux que quatre familles dont une est
 * remplie au hasard.
 */
export const FAMILLES = ['hausse-achat', 'hausse-vente', 'baisse-achat', 'baisse-vente'];

export function famille(sens, tendance) {
  if (tendance !== 'haussiere' && tendance !== 'baissiere') return null;
  if (sens !== 'achat' && sens !== 'vente') return null;
  return `${tendance === 'haussiere' ? 'hausse' : 'baisse'}-${sens}`;
}

/**
 * Sens du marché sur les `dureeMs` précédant une bougie.
 *
 * Défini par la VARIATION DU PRIX, et non par les cassures de structure
 * qu'emploie le reste du projet. Deux raisons, toutes deux contraignantes :
 *
 * Une tendance hebdomadaire par cassures demanderait des bougies
 * hebdomadaires, or un contrat GC ne vit que huit semaines. Il n'y a pas de
 * quoi former un seul pivot.
 *
 * Et la recherche reste DANS le segment : jamais au travers d'un roulement,
 * où le saut de prix se ferait passer pour un mouvement de marché.
 *
 * Rend `indetermine` quand l'historique manque, plutôt que de comparer à la
 * première bougie disponible — ce qui donnerait une tendance sur deux heures
 * en la nommant « semaine ».
 */
export function tendanceSur(bougies, index, dureeMs, seuil = SEUIL_TENDANCE) {
  const cible = bougies[index].ouvertureMs - dureeMs;
  if (!bougies.length || bougies[0].ouvertureMs > cible) return 'indetermine';

  // Binaire : la dernière bougie ouvrant au plus tard à l'instant cible.
  let bas = 0;
  let haut = index;
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    if (bougies[milieu].ouvertureMs <= cible) bas = milieu;
    else haut = milieu - 1;
  }

  const depart = bougies[bas].cloture;
  if (!depart) return 'indetermine';

  const variation = (bougies[index].cloture - depart) / depart;
  if (Math.abs(variation) < seuil) return 'plate';
  return variation > 0 ? 'haussiere' : 'baissiere';
}

/** Volume exigé, en multiples de la médiane locale, avant de scorer quoi que ce soit. */
const VOLUME_PLANCHER = 2;

/** Part de la bougie que la mèche doit occuper pour qu'on parle de rejet. */
const MECHE_MINIMALE = 0.6;

/**
 * Seuils propres à `picVolume` et `gap`.
 *
 * Sans eux, ces deux-là se déclenchaient sur presque toutes les bougies —
 * `picVolume` sur 3190 sur 3190, mesuré. Ce n'étaient pas des détecteurs mais
 * des mesures continues : ils notaient tout le monde et ne sélectionnaient
 * personne. Un détecteur doit pouvoir répondre non.
 */
const PIC_MINIMUM = 4;

/**
 * Un demi-écart, et non un écart entier.
 *
 * Choisi sur mesure, pas au jugé. L'or s'échange presque sans interruption,
 * donc les vrais sauts sont rares — comptés sur 15,8 jours de GC :
 *
 *   ≥ 0,25 amplitude   20 évènements   ~460 par an
 *   ≥ 0,50             5               ~116
 *   ≥ 1,00             2                ~46
 *
 * À un écart entier il ne restait que deux évènements, trop peu pour
 * échantillonner quoi que ce soit. Un demi garde la sélectivité — 0,16 % des
 * bougies — avec de quoi remplir les quatre bandes.
 */
const GAP_MINIMUM = 0.5;

/**
 * Heures de New York où tombent l'essentiel des publications américaines :
 * 8 h 30 (emploi, inflation, ventes au détail), 10 h 00 (ISM, confiance),
 * 14 h 00 (FOMC).
 *
 * Sert à MARQUER, pas à écarter. Un pic de volume à 8 h 31 un jour de NFP
 * n'est pas une empreinte discrète : c'est tout le marché qui réagit au même
 * titre à la même seconde. Sans ce marqueur, impossible de distinguer les
 * deux en regardant un graphique.
 */
export const ANNONCES_NEW_YORK = [{ h: 8, m: 30 }, { h: 10, m: 0 }, { h: 14, m: 0 }];

// Créé une fois : le formateur coûte cher, et il est appelé par bougie.
const HEURE_NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
});

/**
 * L'instant tombe-t-il dans une fenêtre d'annonce ?
 *
 * **Suppose des horodatages en UTC**, ce qui est le cas de l'export Databento.
 * Le passage à l'heure de New York gère l'heure d'été : 8 h 30 à New York vaut
 * 12 h 30 UTC en été et 13 h 30 en hiver.
 *
 * C'est une heuristique d'horaire, pas un calendrier économique : elle marque
 * les moments où une publication a LIEU D'ÊTRE, pas ceux où il y en a eu une.
 */
export function dansFenetreMacro(ms, { avantMinutes = 2, apresMinutes = 15 } = {}) {
  const parties = HEURE_NEW_YORK.formatToParts(new Date(ms));
  const heure = Number(parties.find((p) => p.type === 'hour').value);
  const minute = Number(parties.find((p) => p.type === 'minute').value);
  const minutesDuJour = heure * 60 + minute;

  return ANNONCES_NEW_YORK.some(({ h, m }) => {
    const annonce = h * 60 + m;
    return minutesDuJour >= annonce - avantMinutes && minutesDuJour <= annonce + apresMinutes;
  });
}

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

    const sens = b.cloture > b.ouverture ? 'achat' : b.cloture < b.ouverture ? 'vente' : 'neutre';
    const tendanceJour = tendanceSur(bougies, i, HORIZONS.tendanceJour);
    const tendanceSemaine = tendanceSur(bougies, i, HORIZONS.tendanceSemaine);

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
        // Côté dominant PRÉSUMÉ, d'après la clôture face à l'ouverture.
        //
        // RÉFUTÉ — DEC-030. Ce n'est pas « approximatif », c'est faux une fois
        // sur trois. Mesuré contre le côté réel de l'agresseur sur 71 826
        // transactions COMEX du 2026-06-03 : 71,7 % d'accord en 5 min, 62,6 %
        // en 15 min, 47,8 % en 1 heure — moins bien que pile ou face. Un seuil
        // de volume n'améliore rien : le proxy se trompe autant sur les
        // grosses bougies, celles que ce scanner retient.
        //
        // Le prix peut chuter de quatorze dollars pendant que les acheteurs
        // agressifs dominent : des vendeurs passifs encaissent le flux sans
        // reculer. C'est de l'absorption, et elle est invisible en OHLCV.
        //
        // Conservé parce que la structure servira quand la donnée `trades`
        // sera là. Nommé `sensApparent` pour qu'aucune lecture ne le prenne
        // pour un fait — c'est ainsi qu'on fabrique une fausse découverte.
        sensApparent: sens,
        // La tendance générale à deux échelles bien plus larges que la
        // détection, mais lues sur les MÊMES bougies de quinze minutes. Un
        // volume à contre-courant n'est pas le même évènement qu'un volume
        // qui suit le flot : le premier demande une raison et des moyens.
        tendanceJour,
        tendanceSemaine,
        familleJour: famille(sens, tendanceJour),
        familleSemaine: famille(sens, tendanceSemaine),
        // Marqué, jamais écarté : c'est à l'œil de trancher, mais il doit
        // savoir qu'une publication pouvait tomber à cet instant.
        macro: dansFenetreMacro(b.ouvertureMs),
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
        // roulement, puisque le segment n'en contient aucun. Le saut doit
        // valoir au moins une demi-amplitude médiane pour mériter le nom.
        gap: ecartOuverture / medAmplitude >= GAP_MINIMUM ? arrondir(ecartOuverture / medAmplitude) : 0,
        picVolume: ratioVolume >= PIC_MINIMUM ? arrondir(ratioVolume) : 0,
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

/**
 * Bandes de la distribution, du sommet au bas.
 *
 * Pourquoi ne pas se contenter du sommet : les évènements les plus extrêmes
 * d'un marché sont ses annonces macro. Les vingt plus gros déplacements de
 * l'or sur deux ans, ce sont NFP, CPI et Fed — tout le monde réagissant au
 * même titre à la même seconde, c'est-à-dire l'inverse d'une empreinte
 * discrète. Ne regarder que le sommet, c'est se condamner à ne voir que ça.
 */
export const BANDES = [
  { nom: 'sommet', de: 0.95, a: 1.00 },
  { nom: 'haut', de: 0.75, a: 0.95 },
  { nom: 'milieu', de: 0.50, a: 0.75 },
  { nom: 'bas', de: 0.00, a: 0.50 },
];

/**
 * Échantillonne dans toute la distribution, et dit d'où vient chaque candidat.
 *
 * Chaque retenu porte sa bande. Sans ça, impossible de savoir en regardant un
 * graphique si on a sous les yeux un cas extrême ou un cas médian — et c'est
 * précisément la comparaison qu'on cherche à faire.
 */
export function echantillonStratifie(scores, detecteur, {
  nombre = 20, ecartMinimalMs = 120 * 60_000, bandes = BANDES,
} = {}) {
  if (!DETECTEURS.includes(detecteur)) throw new Error(`Détecteur inconnu : "${detecteur}".`);

  const actifs = scores.filter((s) => s.scores[detecteur] > 0);
  if (!actifs.length) return [];

  const valeurs = actifs.map((s) => s.scores[detecteur]);
  const parBande = Math.max(1, Math.ceil(nombre / bandes.length));
  const retenus = [];

  for (const bande of bandes) {
    const bas = quantile(valeurs, bande.de);
    const haut = quantile(valeurs, bande.a);

    const candidats = actifs
      .filter((s) => {
        const v = s.scores[detecteur];
        // La borne haute est inclusive sur la bande du sommet seulement,
        // faute de quoi le maximum n'appartiendrait à aucune bande.
        return v >= bas && (bande.a === 1 ? v <= haut : v < haut);
      })
      .sort((a, b) => b.scores[detecteur] - a.scores[detecteur]);

    let pris = 0;
    for (const c of candidats) {
      if (pris >= parBande) break;
      if (retenus.some((r) => Math.abs(r.ms - c.ms) < ecartMinimalMs)) continue;
      retenus.push({ ...c, bande: bande.nom });
      pris++;
    }
  }

  return retenus;
}

const arrondir = (n) => (Number.isFinite(n) ? Number(n.toFixed(3)) : 0);
