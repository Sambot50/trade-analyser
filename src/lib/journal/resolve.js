// Résolution automatique de l'issue d'un plan de trade à partir de bougies.
//
// Logique pure : elle ne connaît ni le réseau, ni la source des bougies. Ce
// qui la rend testable exhaustivement — et c'est nécessaire, parce qu'une
// erreur ici fausserait silencieusement toute la mesure. Elle l'a fait.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ Une seule règle de sortie par plan, choisie AVANT d'ouvrir.             │
// │                                                                         │
// │ La version précédente créditait +1 R à un trade passé par TP1 puis      │
// │ stoppé, tout en créditant +2 R s'il allait jusqu'à TP2. C'est une       │
// │ option gratuite : à l'instant où le prix touche 1 R, il faut choisir —  │
// │ encaisser ou tenir — et on ne peut pas savoir laquelle était la bonne   │
// │ sans regarder la suite. Une lecture du futur, dans la règle de sortie.  │
// │                                                                         │
// │ Mesuré sur 200 000 marches aléatoires, où toute espérance doit être     │
// │ nulle : +0,330 R avec cette convention, −0,001 R avec une sortie ferme  │
// │ à 1 R, −0,007 R avec une tenue jusqu'à 2 R. Elle fabriquait un tiers    │
// │ d'unité de risque par trade à partir de rien.                           │
// └─────────────────────────────────────────────────────────────────────────┘

export const STATUTS = ['non_declenche', 'stop', 'tp1', 'tp2', 'ambigu', 'horizon_depasse', 'en_cours'];

/**
 * Hypothèse de remplissage : à quel prix suppose-t-on être entré ?
 *
 * `meche` — au prix exact du plan, dès qu'une mèche le touche. C'est
 *   l'hypothèse la plus favorable qui existe : une bougie dont la mèche vient
 *   chercher un niveau referme généralement au-dessus, donc on entre à
 *   l'extrême favorable, sans glissement ni file d'attente. Le mouvement
 *   favorable de la bougie de déclenchement est compté pour nous.
 *
 * `cloture` — à la clôture de la bougie qui a touché la zone, et la résolution
 *   ne commence qu'à la bougie SUIVANTE. Le stop reste où le plan l'a posé,
 *   c'est un niveau structurel ; les objectifs sont redérivés à 1 R et 2 R du
 *   prix réellement obtenu. Un remplissage défavorable éloigne donc aussi les
 *   objectifs — ce qui est exactement ce qui arrive en réel.
 */
export const REMPLISSAGES = ['meche', 'cloture'];

/**
 * Les deux règles de sortie mesurables sans stop mobile.
 *
 * `champ` désigne le SEUL prix qui clôt le trade en gain ; l'autre objectif
 * n'existe pas pour cette règle. `gain` est ce que vaut ce gain en unités de
 * risque, et `seuil` le taux de réussite qui annule l'espérance hors coûts.
 */
export const OBJECTIFS = {
  '1r': { champ: 'prixTp1', statut: 'tp1', gain: 1, seuil: 0.5 },
  '2r': { champ: 'prixTp2', statut: 'tp2', gain: 2, seuil: 1 / 3 },
};

export function reglageObjectif(objectif) {
  const reglage = OBJECTIFS[objectif];
  if (!reglage) {
    // Pas de valeur par défaut : une convention de sortie implicite est
    // exactement ce qui a faussé toutes les mesures précédentes.
    throw new Error(`Objectif de sortie manquant ou inconnu : "${objectif}". Attendu ${Object.keys(OBJECTIFS).join(' ou ')}.`);
  }
  return reglage;
}

/**
 * Traitements possibles d'une issue ambiguë.
 *
 * Le résolveur ne devine jamais l'ordre dans lequel une bougie a touché le
 * stop et l'objectif — il ne peut pas le savoir. Mais l'EXCLURE des
 * statistiques est aussi une décision, et rien ne dit qu'elle soit neutre.
 * `perdant` et `gagnant` encadrent la vérité ; l'écart entre les deux mesure
 * ce que l'exclusion cache.
 *
 * Le vrai remède reste une unité de résolution plus fine : une bougie de
 * 5 minutes qui touche les deux niveaux se décompose en bougies d'une minute
 * qui, elles, disent l'ordre.
 */
export const TRAITEMENTS_AMBIGU = ['exclu', 'perdant', 'gagnant'];

/**
 * Ce que vaut une issue, en unités de risque. null si elle ne compte pas.
 *
 * @param ambigu 'exclu' (défaut), 'perdant' ou 'gagnant'
 */
export function gainEnR(statut, objectif, ambigu = 'exclu') {
  const reglage = reglageObjectif(objectif);
  if (!TRAITEMENTS_AMBIGU.includes(ambigu)) {
    throw new Error(`Traitement des issues ambiguës inconnu : "${ambigu}". Attendu ${TRAITEMENTS_AMBIGU.join(', ')}.`);
  }

  if (statut === reglage.statut) return reglage.gain;
  if (statut === 'stop') return -1;

  if (statut === 'ambigu') {
    if (ambigu === 'perdant') return -1;
    if (ambigu === 'gagnant') return reglage.gain;
  }

  return null;
}

/**
 * @param plan    { direction, prixEntree, prixStopLoss, prixTp1, prixTp2 }
 * @param bougies [{ ouvertureMs, plusHaut, plusBas }] triées chronologiquement,
 *                à partir de l'horodatage de l'analyse
 * @param horizonBougies nombre de bougies couvrant l'horizon de résolution
 * @param objectif '1r' ou '2r' — la règle de sortie, obligatoire
 * @param remplissage 'meche' (défaut) ou 'cloture' — voir REMPLISSAGES
 *
 * @returns { statut, detail }
 */
export function resoudreIssue({ plan, bougies, horizonBougies, objectif, remplissage = 'meche' }) {
  const reglage = reglageObjectif(objectif);
  if (!REMPLISSAGES.includes(remplissage)) {
    throw new Error(`Hypothèse de remplissage inconnue : "${remplissage}". Attendu ${REMPLISSAGES.join(' ou ')}.`);
  }

  const examinees = bougies.slice(0, horizonBougies);
  const horizonCouvert = bougies.length >= horizonBougies;

  const estLong = plan.direction === 'BUY';
  const toucheEntree = (b) => (estLong ? b.plusBas <= plan.prixEntree : b.plusHaut >= plan.prixEntree);
  const toucheStop = (b) => (estLong ? b.plusBas <= plan.prixStopLoss : b.plusHaut >= plan.prixStopLoss);

  const indexEntree = examinees.findIndex(toucheEntree);

  if (indexEntree === -1) {
    // Pas encore déclenché. Tant que l'horizon n'est pas couvert, rien n'est
    // acquis : le prix peut encore venir chercher l'entrée.
    return {
      statut: horizonCouvert ? 'non_declenche' : 'en_cours',
      detail: { bougiesExaminees: examinees.length, declencheLe: null, objectif, remplissage },
    };
  }

  const bougieEntree = examinees[indexEntree];
  const declencheLe = bougieEntree.ouvertureMs;

  let prixEntreeReel = plan.prixEntree;
  let prixCible = plan[reglage.champ];
  // Sous l'hypothèse de la mèche, la bougie de déclenchement peut elle-même
  // trancher l'issue ; sous celle de la clôture, on n'est en position qu'après
  // elle.
  let debutResolution = indexEntree;

  if (remplissage === 'cloture') {
    if (typeof bougieEntree.cloture !== 'number' || !Number.isFinite(bougieEntree.cloture)) {
      throw new Error("Bougie sans clôture : impossible de supposer un remplissage à la clôture.");
    }

    prixEntreeReel = bougieEntree.cloture;
    const risqueReel = estLong ? prixEntreeReel - plan.prixStopLoss : plan.prixStopLoss - prixEntreeReel;

    // La bougie a refermé au-delà du stop : on aurait été pris et sorti dans
    // la même bougie. C'est une perte, pas un trade qui n'a pas eu lieu.
    if (risqueReel <= 0) {
      return {
        statut: 'stop',
        detail: {
          bougiesExaminees: indexEntree + 1, declencheLe, objectif, remplissage,
          prixEntreeReel, stopToucheLe: bougieEntree.ouvertureMs,
          raison: 'La bougie de déclenchement a clôturé au-delà du stop.',
        },
      };
    }

    // Objectifs redérivés depuis le prix réellement obtenu : un remplissage
    // défavorable éloigne l'objectif autant qu'il rapproche le stop.
    prixCible = estLong
      ? prixEntreeReel + reglage.gain * risqueReel
      : prixEntreeReel - reglage.gain * risqueReel;

    debutResolution = indexEntree + 1;

    if (debutResolution >= examinees.length) {
      return {
        statut: horizonCouvert ? 'horizon_depasse' : 'en_cours',
        detail: { bougiesExaminees: examinees.length, declencheLe, objectif, remplissage, prixEntreeReel },
      };
    }
  }

  const toucheCible = (b) => (estLong ? b.plusHaut >= prixCible : b.plusBas <= prixCible);

  for (let i = debutResolution; i < examinees.length; i++) {
    const b = examinees[i];
    const stop = toucheStop(b);
    const cible = toucheCible(b);

    // Une même bougie touchant le stop et l'objectif ne dit pas l'ordre.
    // Deviner biaiserait la mesure : on le déclare et on exclut le cas.
    if (stop && cible) {
      return {
        statut: 'ambigu',
        detail: {
          bougiesExaminees: i + 1,
          declencheLe,
          objectif,
          remplissage,
          prixEntreeReel,
          bougieAmbigueMs: b.ouvertureMs,
          raison: "La bougie touche le stop et l'objectif ; son OHLC ne dit pas dans quel ordre.",
        },
      };
    }

    if (cible) {
      return { statut: reglage.statut, detail: { bougiesExaminees: i + 1, declencheLe, objectif, remplissage, prixEntreeReel, atteintLe: b.ouvertureMs } };
    }

    // Le stop clôt le trade, définitivement. Un objectif intermédiaire frôlé
    // en chemin ne rapporte rien : on n'y était pas sorti.
    if (stop) {
      return { statut: 'stop', detail: { bougiesExaminees: i + 1, declencheLe, objectif, remplissage, prixEntreeReel, stopToucheLe: b.ouvertureMs } };
    }
  }

  return {
    statut: horizonCouvert ? 'horizon_depasse' : 'en_cours',
    detail: { bougiesExaminees: examinees.length, declencheLe, objectif, remplissage, prixEntreeReel },
  };
}

/** Un statut compte-t-il dans les statistiques de réussite ? */
export function compteDansLesStats(statut) {
  return statut === 'stop' || statut === 'tp1' || statut === 'tp2';
}

export function estGagnant(statut) {
  return statut === 'tp1' || statut === 'tp2';
}
