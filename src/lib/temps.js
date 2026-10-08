// Le temps, partagé par toutes les briques.
//
// Tout le projet compte en millisecondes UTC. L'heure locale n'intervient que
// pour deux choses : les heures de l'opérateur (Paris) et le découpage des
// séances de marché (New York). Les deux passent par ici, et nulle part
// ailleurs : un fuseau calculé à deux endroits finit par l'être de deux façons.

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
 * L'instant UTC d'une heure d'horloge locale, donnée comme si elle était UTC.
 * Deux passes : le décalage dépend de l'instant qu'on cherche.
 */
export function localVersUtc(localMs, fuseau) {
  let utc = localMs - decalageFuseau(localMs, fuseau);
  utc = localMs - decalageFuseau(utc, fuseau);
  return utc;
}
