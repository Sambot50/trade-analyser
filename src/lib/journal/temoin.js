// Le témoin des plans : la même géométrie, à un instant tiré au sort.
//
// LA QUESTION. Un modèle regarde une capture et propose un plan. Si ses plans
// gagnent, est-ce parce qu'il a lu quelque chose — ou parce que le marché
// montait, ou parce que la FORME du plan (stop serré, objectif lointain) rend
// mécaniquement ce résultat ? Un chiffre seul ne le dit pas. Sur des bougies
// tirées au hasard, la chaîne de backtest affichait +0,407 R (DEC-014).
//
// LE PRINCIPE. Pour chaque plan, on garde sa géométrie — sens, distance de
// l'entrée au prix du moment, distance au stop, distance aux objectifs, en
// proportion du prix — et on la rejoue à des instants tirés au hasard, sur les
// mêmes bougies, avec le même résolveur. Ce que le plan obtient à son vrai
// moment, comparé à ce que la même forme obtient n'importe quand, isole ce que
// le modèle apporte par son CHOIX DU MOMENT, à géométrie constante.
//
// Les choix ci-dessous sont figés par DEC-035, AVANT qu'aucune analyse ne soit
// lue par ce code. Les changer après avoir vu un résultat serait ajuster le
// témoin sur ce qu'on veut lui faire dire.

import { resoudreIssue, gainEnR, reglageObjectif, TRAITEMENTS_AMBIGU } from './resolve.js';
import { generateurAleatoire, valeurP, resumeDistribution } from '../marche/controle.js';

/**
 * Le prix « du moment » d'une analyse : la clôture de la dernière bougie
 * FERMÉE avant l'instant. Jamais celle qui était en cours — son prix n'était
 * pas encore connu (garde-fou 4).
 *
 * @returns { prix, indice } ou null si aucune bougie ne précède l'instant
 */
export function prixDeReference(bougies, instantMs) {
  let indice = -1;
  for (let i = 0; i < bougies.length; i++) {
    if (bougies[i].fermetureMs < instantMs) indice = i;
    else break;
  }
  return indice === -1 ? null : { prix: bougies[indice].cloture, indice };
}

/**
 * La forme d'un plan, sans ses prix : des écarts RELATIFS.
 *
 * L'entrée se mesure depuis le prix du moment — un ordre posé loin du prix
 * n'est pas le même plan qu'un ordre au marché. Le stop et les objectifs se
 * mesurent depuis l'entrée. Proportionnels et non absolus : rejoué à un autre
 * niveau de prix, un stop de 0,1 % reste un stop de 0,1 %.
 *
 * En proportion du prix plutôt qu'en ATR : l'ATR ajouterait un réglage, sa
 * période, et donc un degré de liberté de plus à choisir. La fenêtre de
 * tirage étant courte, la volatilité y reste comparable.
 */
export function geometrieDe(plan, prixDuMoment) {
  if (!(prixDuMoment > 0)) throw new Error('Prix de référence nul ou négatif : géométrie indéfinie.');
  const e = plan.prixEntree;
  return {
    direction: plan.direction,
    entree: e / prixDuMoment - 1,
    stop: plan.prixStopLoss / e - 1,
    tp1: plan.prixTp1 / e - 1,
    tp2: plan.prixTp2 / e - 1,
  };
}

/** Le plan qu'aurait donné cette géométrie, posée sur un autre prix. */
export function planDepuisGeometrie(g, prixDuMoment) {
  const e = prixDuMoment * (1 + g.entree);
  return {
    direction: g.direction,
    prixEntree: e,
    prixStopLoss: e * (1 + g.stop),
    prixTp1: e * (1 + g.tp1),
    prixTp2: e * (1 + g.tp2),
  };
}

/**
 * Ce qu'un plan a rapporté, en R, en comptant TOUT.
 *
 * DEC-033 : écarter une issue du dénominateur d'un seul côté fabrique un
 * avantage. Ici rien n'est écarté une fois l'horizon couvert.
 *
 *   - objectif ou stop      : la règle de sortie, via `gainEnR`
 *   - ambigu                : selon `ambigu` — perdant par défaut, le choix
 *                             défavorable ; « gagnant » sert de sensibilité
 *   - jamais déclenché      : 0 R. Aucun trade, aucun gain, aucune perte.
 *   - horizon dépassé       : valorisé à la clôture de la dernière bougie de
 *                             l'horizon, rapportée au risque. C'est ce qu'un
 *                             compte encaisserait en fermant au marché.
 *   - en cours              : null — l'issue n'existe pas encore.
 *
 * Plus strict que les statistiques du journal, qui écartent les deux derniers
 * cas. Les deux bras subissent la même règle.
 */
export function rendementComplet({ plan, bougies, horizonBougies, objectif, remplissage = 'meche', ambigu = 'perdant' }) {
  if (!TRAITEMENTS_AMBIGU.includes(ambigu) || ambigu === 'exclu') {
    throw new Error(`Le témoin compte tout : ambigu doit valoir "perdant" ou "gagnant", pas "${ambigu}".`);
  }
  const { statut, detail } = resoudreIssue({ plan, bougies, horizonBougies, objectif, remplissage });

  if (statut === 'en_cours') return { statut, r: null };
  if (statut === 'non_declenche') return { statut, r: 0 };

  if (statut === 'horizon_depasse') {
    const entree = detail.prixEntreeReel ?? plan.prixEntree;
    const risque = Math.abs(entree - plan.prixStopLoss);
    const derniere = bougies[Math.min(bougies.length, horizonBougies) - 1];
    const sens = plan.direction === 'BUY' ? 1 : -1;
    return { statut, r: (sens * (derniere.cloture - entree)) / risque };
  }

  return { statut, r: gainEnR(statut, objectif, ambigu) };
}

/** Fuseau des heures de séance : celui où l'analyse est faite. */
export const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

/**
 * Écart maximal entre l'instant et la clôture de la bougie qui donne son prix.
 * Au-delà, le marché était fermé : il n'y avait pas de prix du moment.
 */
export const FRAICHEUR_MAX_MS = 15 * 60_000;

/** Décalage du fuseau à un instant donné, en ms (UTC + décalage = heure locale). */
export function decalageFuseau(ms, fuseau) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return local - Math.floor(ms / 1000) * 1000;
}

/**
 * Le même instant d'horloge locale, `jours` jours de calendrier plus tôt.
 *
 * À l'heure locale et non à 24 h près : 15 h 30 à Paris tombe à 13 h 30 UTC
 * l'été et 14 h 30 l'hiver. Reculer de 24 h en UTC à travers un changement
 * d'heure décalerait le témoin d'une heure de séance.
 */
export function memeHeureLocale(ms, jours, fuseau = FUSEAU_PAR_DEFAUT) {
  const local = ms + decalageFuseau(ms, fuseau) - jours * 86_400_000;
  // Deux passes : le décalage à la date cible peut différer de celui d'origine.
  let utc = local - decalageFuseau(local, fuseau);
  utc = local - decalageFuseau(utc, fuseau);
  return utc;
}

/**
 * Les instants où la géométrie d'un plan peut être rejouée : des indices de
 * bougies dont la clôture sert de prix du moment.
 *
 * **À la même heure locale, les jours précédents.** Un plan posé à 15 h 30
 * Paris démarre avec l'ouverture de New York ; rejoué à 3 h du matin, il
 * démarrerait dans la séance la plus calme du jour. L'écart mesuré dirait
 * alors quelque chose de l'heure, rien du modèle.
 *
 * Un candidat doit :
 *   - tomber dans la fenêtre qui précède l'analyse ;
 *   - avoir un prix frais : la bougie qui le précède a fermé moins de
 *     `FRAICHEUR_MAX_MS` avant lui — marché fermé, pas de candidat ;
 *   - avoir derrière lui un horizon complet de bougies, qui se referme AVANT
 *     l'analyse. Le témoin ne partage donc aucune bougie de résolution avec le
 *     plan réel : sans cela, un même mouvement de marché pousserait les deux
 *     bras dans le même sens (DEC-032).
 */
export function instantsCandidats(bougies, instantMs, { fenetreMs, horizonBougies, fuseau = FUSEAU_PAR_DEFAUT }) {
  const candidats = [];
  for (let jours = 1; ; jours++) {
    const t = memeHeureLocale(instantMs, jours, fuseau);
    if (t < instantMs - fenetreMs) break;

    const reference = prixDeReference(bougies, t);
    if (!reference) break;
    const i = reference.indice;
    if (t - bougies[i].fermetureMs > FRAICHEUR_MAX_MS) continue;
    if (i + horizonBougies >= bougies.length) continue;
    if (bougies[i + horizonBougies].ouvertureMs >= instantMs) continue;
    candidats.push(i);
  }
  return candidats.reverse();
}

/**
 * Le plan réel, à son vrai moment.
 *
 * Résolu sur les bougies qui s'OUVRENT à l'instant de l'analyse ou après —
 * la convention du journal et de `startTime` chez Binance.
 */
export function evaluerReel(entree, bougies, reglages) {
  const { plan, instantMs } = entree;
  const reference = prixDeReference(bougies, instantMs);
  if (!reference) return { exclu: 'aucune bougie fermée avant l’analyse' };
  // Même règle que pour le témoin : sans prix frais, le marché était fermé.
  if (instantMs - bougies[reference.indice].fermetureMs > FRAICHEUR_MAX_MS) {
    return { exclu: 'marché fermé à l’instant de l’analyse : pas de prix du moment' };
  }

  // Pas `reference.indice + 1` : une bougie EN COURS à l'instant de l'analyse
  // s'est ouverte avant lui, et ses extrêmes mêlent des prix antérieurs au plan.
  const suite = bougies.filter((b) => b.ouvertureMs >= instantMs).slice(0, reglages.horizonBougies);
  const { statut, r } = rendementComplet({ plan, bougies: suite, ...reglages });
  if (r === null) return { exclu: 'issue pas encore tranchée : horizon non couvert par les bougies', statut };

  // Fin de l'horizon : sert à écarter un plan suivant qui le chevaucherait.
  return { statut, r, geometrie: geometrieDe(plan, reference.prix), finHorizonMs: suite.at(-1).fermetureMs };
}

/**
 * Le contrôle complet, sur une ou plusieurs séries.
 *
 * **Plusieurs séries, parce qu'un fichier de contrats à terme n'est pas une
 * série.** Deux contrats successifs ne se recollent pas (DEC-027) : chaque plan
 * est jugé, et témoigné, dans la série du contrat coté à son instant.
 *
 * **Deux plans réels dont les horizons se chevauchent subissent le même
 * mouvement de marché**, alors que le témoin tire leurs instants séparément :
 * il les croirait indépendants et se montrerait trop étroit, donc trop
 * indulgent. Dans chaque série, un plan qui démarre avant la fin de l'horizon du
 * précédent RETENU est écarté. La règle ne regarde que les horaires, jamais
 * les issues.
 *
 * Statistique : la moyenne des R sur l'ensemble des plans. Le réel en donne
 * une ; chaque tirage en donne une autre, en rejouant CHAQUE plan à un instant
 * candidat de sa série, tiré au sort. `p` est la part des tirages qui font au
 * moins aussi bien que le réel, corrigée du +1 (voir `valeurP`).
 *
 * @param groupes  [{ bougies, entrees: [{ id, plan, instantMs }] }]
 * @param reglages { horizonBougies, objectif, remplissage, ambigu, fenetreMs,
 *                   tirages, graine, fuseau? }
 */
export function controlerParTemoinGroupes(groupes, reglages) {
  const { fenetreMs, tirages, graine, fuseau = FUSEAU_PAR_DEFAUT, ...resolution } = reglages;
  reglageObjectif(resolution.objectif); // échoue tôt si la règle de sortie manque
  if (!(tirages >= 1)) throw new Error('Il faut au moins un tirage.');

  const retenus = [];
  const exclus = [];

  for (const { bougies, entrees } of groupes) {
    if (!bougies.length) throw new Error('Aucune bougie : rien sur quoi rejouer les plans.');
    let finPrecedent = -Infinity;

    for (const entree of [...entrees].sort((a, b) => a.instantMs - b.instantMs)) {
      if (entree.instantMs < finPrecedent) {
        exclus.push({ id: entree.id, raison: 'horizon chevauchant celui du plan précédent : même mouvement de marché' });
        continue;
      }

      const reel = evaluerReel(entree, bougies, resolution);
      if (reel.exclu) { exclus.push({ id: entree.id, raison: reel.exclu }); continue; }

      // La fenêtre doit être couverte en entier. Sinon le témoin d'un plan pris
      // au début des données serait tiré sur quelques jours au lieu de trente.
      if (bougies[0].ouvertureMs > entree.instantMs - fenetreMs) {
        exclus.push({ id: entree.id, raison: 'fenêtre de témoin incomplète : les bougies commencent après son début' });
        continue;
      }

      const candidats = instantsCandidats(bougies, entree.instantMs, { fenetreMs, horizonBougies: resolution.horizonBougies, fuseau });
      if (!candidats.length) {
        exclus.push({ id: entree.id, raison: 'aucun instant de témoin : aucun jour de la fenêtre n’a de marché ouvert à cette heure' });
        continue;
      }
      retenus.push({ ...entree, ...reel, candidats, bougies });
      finPrecedent = reel.finHorizonMs;
    }
  }

  const sortie = (e) => {
    const { candidats, bougies, finHorizonMs, ...reste } = e;
    return { ...reste, candidats: candidats.length };
  };
  if (!retenus.length) return { retenus: [], exclus, reel: null, temoin: null, p: null };

  const moyenne = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const reelMoyen = moyenne(retenus.map((e) => e.r));

  // Un plan rejoué au même instant donne toujours le même R : on le calcule
  // une fois. Le cache ne change aucun chiffre, seulement la durée.
  const caches = retenus.map(() => new Map());
  const rendementA = (k, i) => {
    let r = caches[k].get(i);
    if (r === undefined) {
      const { bougies, geometrie } = retenus[k];
      const plan = planDepuisGeometrie(geometrie, bougies[i].cloture);
      ({ r } = rendementComplet({
        plan, bougies: bougies.slice(i + 1, i + 1 + resolution.horizonBougies), ...resolution,
      }));
      caches[k].set(i, r);
    }
    return r;
  };

  const alea = generateurAleatoire(graine);
  const moyennes = [];
  for (let t = 0; t < tirages; t++) {
    const rs = retenus.map((e, k) => rendementA(k, e.candidats[Math.floor(alea() * e.candidats.length)]));
    moyennes.push(moyenne(rs));
  }

  return {
    retenus: retenus.map(sortie),
    exclus,
    reel: reelMoyen,
    temoin: resumeDistribution(moyennes),
    p: valeurP(reelMoyen, moyennes),
  };
}

/** Le contrôle sur une seule série — Binance, un CSV de CFD. */
export function controlerParTemoin(entrees, bougies, reglages) {
  return controlerParTemoinGroupes([{ bougies, entrees }], reglages);
}
