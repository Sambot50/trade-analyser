// Les sessions de marché : Asie, Londres, New York.
//
// Ce qu'on en tire : le plus haut et le plus bas de chaque session, et si le
// prix les a balayés depuis. Le plus haut et le plus bas de l'Asie sont les
// premiers niveaux de liquidité qu'un trader SMC regarde à l'ouverture de
// Londres ou de New York.
//
// Les bornes sont en heure de New York, la convention du Forex, et suivent
// donc son heure d'été. Elles sont déclarées ici et modifiables. Celles de la
// référence ne sont pas connues avec certitude (son indicateur affiche
// « AsianSession 1900-0001 », ce qui suggère 19 h → minuit) : à confirmer avec
// l'opérateur au moment des points de contrôle d'E3.

import { localVersUtc, decalageFuseau } from '../temps.js';

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

export const SESSIONS = Object.freeze([
  Object.freeze({ id: 'asie', libelle: 'Asie', debut: 19, fin: 4 }),
  Object.freeze({ id: 'londres', libelle: 'Londres', debut: 3, fin: 12 }),
  Object.freeze({ id: 'newyork', libelle: 'New York', debut: 8, fin: 17 }),
]);

export const FUSEAU_SESSIONS = 'America/New_York';

/**
 * La dernière occurrence de la session ENTIÈREMENT terminée avant `aMs`, ou
 * celle en cours si `enCours` : ses bornes en UTC.
 */
export function bornesSession(session, aMs, { fuseau = FUSEAU_SESSIONS, enCours = false } = {}) {
  const local = aMs + decalageFuseau(aMs, fuseau);
  const jour = Math.floor(local / JOUR) * JOUR;
  // On remonte jour par jour jusqu'à trouver une occurrence qui convient.
  for (let k = 0; k <= 3; k++) {
    const debutLocal = jour - k * JOUR + session.debut * HEURE;
    const finLocal = session.fin > session.debut ? jour - k * JOUR + session.fin * HEURE : jour - k * JOUR + (24 + session.fin) * HEURE;
    const debut = localVersUtc(debutLocal, fuseau);
    const fin = localVersUtc(finLocal, fuseau);
    if (fin <= aMs || (enCours && debut <= aMs && aMs < fin)) return { debutMs: debut, finMs: fin };
  }
  return null;
}

/**
 * Le plus haut et le plus bas de chaque session, et leur balayage.
 *
 * @param bougies bougies d'une minute (ou de toute unité ≤ 1 h), triées
 * @param aMs     instant de lecture : rien au-delà n'est lu
 * @returns [{ id, libelle, debutMs, finMs, haut, bas, nombre, hautBalaye, basBalaye }]
 *          `hautBalaye` : un plus haut a dépassé celui de la session depuis sa fin.
 */
export function niveauxDeSessions(bougies, aMs, { sessions = SESSIONS, fuseau = FUSEAU_SESSIONS } = {}) {
  const passees = bougies.filter((b) => b.fermetureMs < aMs);
  return sessions.map((s) => {
    const bornes = bornesSession(s, aMs, { fuseau });
    if (!bornes) return { id: s.id, libelle: s.libelle, nombre: 0 };
    const dedans = passees.filter((b) => b.ouvertureMs >= bornes.debutMs && b.ouvertureMs < bornes.finMs);
    if (!dedans.length) return { id: s.id, libelle: s.libelle, ...bornes, nombre: 0, haut: null, bas: null, hautBalaye: false, basBalaye: false };
    const haut = Math.max(...dedans.map((b) => b.plusHaut));
    const bas = Math.min(...dedans.map((b) => b.plusBas));
    const apres = passees.filter((b) => b.ouvertureMs >= bornes.finMs);
    return {
      id: s.id, libelle: s.libelle, ...bornes, nombre: dedans.length, haut, bas,
      hautBalaye: apres.some((b) => b.plusHaut > haut),
      basBalaye: apres.some((b) => b.plusBas < bas),
    };
  });
}
