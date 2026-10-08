// Le découpage des bougies longues sur la SÉANCE, comme le font les
// plateformes pour l'or, le Forex et les contrats du CME.
//
// La journée de marché de ces actifs commence à 17 h heure de New York, et non
// à minuit UTC. Une bougie journalière, et les six bougies de 4 h qui la
// composent (17 h, 21 h, 1 h, 5 h, 9 h, 13 h à New York), suivent ce découpage.
// Agréger sur minuit UTC donnerait d'autres plus hauts, d'autres plus bas, donc
// d'autres pivots et une autre structure que celle que l'opérateur voit à
// l'écran.
//
// Les heures de New York suivent son heure d'été : la séance commence à
// 21 h UTC l'été et à 22 h UTC l'hiver. Une journée de changement d'heure dure
// donc 23 ou 25 heures, et sa dernière bougie de 4 h est raccourcie ou
// allongée d'autant.
//
// Pour les unités d'une heure ou moins, le découpage sur la séance et le
// découpage sur l'époque coïncident (17 h tombe sur une heure pleine) : on
// délègue à `agreger`, déjà éprouvé.
//
// NON VÉRIFIÉ : l'alignement exact de TradingView pour chaque symbole. C'est
// le critère de fin de E3, relevé par l'opérateur sur dix points de contrôle.

import { dureeUnite } from './bougies.js';
import { agreger } from './csv.js';
import { localVersUtc, decalageFuseau } from '../temps.js';

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/** La séance par défaut : 17 h à New York (or, Forex, CME). */
export const SEANCE = Object.freeze({ fuseau: 'America/New_York', heure: 17 });

/** Le début de la séance qui contient l'instant `ms` (le plus récent ≤ ms). */
export function debutDeSeance(ms, { fuseau, heure } = SEANCE) {
  const local = ms + decalageFuseau(ms, fuseau);
  let debutLocal = Math.floor(local / JOUR) * JOUR + heure * HEURE;
  if (debutLocal > local) debutLocal -= JOUR;
  return localVersUtc(debutLocal, fuseau);
}

/** Le début de la séance suivante. */
export function seanceSuivante(debutMs, seance = SEANCE) {
  // 25 h plus tard tombe toujours dans la séance suivante, que la journée
  // dure 23, 24 ou 25 heures.
  return debutDeSeance(debutMs + 25 * HEURE, seance);
}

/**
 * Agrège des bougies fines en bougies de `unite`, découpées sur la séance.
 *
 * Une bougie agrégée n'existe que si au moins une bougie fine y tombe : les
 * week-ends et les pauses ne fabriquent pas de bougies fantômes.
 */
export function agregerSeance(bougies, unite, seance = SEANCE) {
  const duree = dureeUnite(unite);
  if (duree <= HEURE) return agreger(bougies, unite);

  const groupes = new Map();
  let debut = null;
  let suivante = null;

  for (const b of bougies) {
    if (debut === null || b.ouvertureMs >= suivante || b.ouvertureMs < debut) {
      debut = debutDeSeance(b.ouvertureMs, seance);
      suivante = seanceSuivante(debut, seance);
    }
    const ouvertureMs = duree >= JOUR ? debut : debut + Math.floor((b.ouvertureMs - debut) / duree) * duree;
    const fermetureMs = Math.min(duree >= JOUR ? suivante : ouvertureMs + duree, suivante) - 1;

    const g = groupes.get(ouvertureMs);
    if (!g) {
      groupes.set(ouvertureMs, {
        ouvertureMs, fermetureMs,
        ouverture: b.ouverture, plusHaut: b.plusHaut, plusBas: b.plusBas, cloture: b.cloture,
        volume: b.volume ?? 0,
      });
    } else {
      g.plusHaut = Math.max(g.plusHaut, b.plusHaut);
      g.plusBas = Math.min(g.plusBas, b.plusBas);
      g.cloture = b.cloture;
      g.volume += b.volume ?? 0;
    }
  }

  return [...groupes.values()].sort((a, b) => a.ouvertureMs - b.ouvertureMs);
}
