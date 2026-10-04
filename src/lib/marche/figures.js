// Les figures de chandelier.
//
// Marteau, englobante, doji, inside bar : de la géométrie pure sur quatre
// prix, sans pivot, sans structure, sans historique. C'est ce qui les rend
// faciles à détecter — et c'est aussi ce qui doit rendre méfiant.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ CES FIGURES NE SONT PAS DES SIGNAUX.                                    │
// │                                                                         │
// │ Sur deux cents bougies il y aura vingt ou trente marteaux. Un marteau   │
// │ au milieu de nulle part est une bougie avec une mèche, il y en a tout   │
// │ le temps. Ce sont par ailleurs les figures les plus testées de la       │
// │ littérature publique, et leur valeur en isolé est au mieux marginale.   │
// │                                                                         │
// │ Ce qui peut avoir du sens, c'est la COÏNCIDENCE : une figure qui tombe  │
// │ dans une zone mesurée, au moment où le prix y revient. Deux choses      │
// │ indépendantes désignant le même prix au même instant.                   │
// │                                                                         │
// │ Elles sont donc détectées pour être CROISÉES, pas pour être jouées.     │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Les seuils ci-dessous sont des conventions, pas des découvertes. Aucun n'a
// été ajusté sur des données : les ajuster avant d'avoir mesuré quoi que ce
// soit reviendrait à régler un filtre sur du bruit, ce que ce dépôt a déjà
// fait une fois (DEC-024, DEC-025).

import { estHaussiere } from './bougies.js';

/** Un corps qui pèse moins que ça dans l'amplitude est un corps « petit ». */
export const PART_CORPS_PETIT = 0.34;

/** Une mèche qui dépasse ce multiple du corps est une mèche « longue ». */
export const MECHE_LONGUE = 2;

/** En deçà, le corps est si fin que la bougie est indécise. */
export const PART_CORPS_DOJI = 0.1;

const corps = (b) => Math.abs(b.cloture - b.ouverture);
const amplitude = (b) => b.plusHaut - b.plusBas;
const hautDuCorps = (b) => Math.max(b.ouverture, b.cloture);
const basDuCorps = (b) => Math.min(b.ouverture, b.cloture);
const mecheHaute = (b) => b.plusHaut - hautDuCorps(b);
const mecheBasse = (b) => basDuCorps(b) - b.plusBas;

/** Une bougie exploitable : quatre prix finis et une amplitude non nulle. */
export function mesurable(b) {
  if (!b) return false;
  for (const champ of ['ouverture', 'cloture', 'plusHaut', 'plusBas']) {
    if (!Number.isFinite(b[champ])) return false;
  }
  return amplitude(b) > 0;
}

/**
 * Marteau, et son symétrique le pendu.
 *
 * Petit corps en haut de l'amplitude, longue mèche basse, mèche haute
 * négligeable. La forme ne dit RIEN du sens : la même bougie s'appelle
 * marteau en bas d'une baisse et pendu en haut d'une hausse. C'est le
 * contexte qui tranche, et le contexte n'est pas ici.
 *
 * On rend donc la forme, sans trancher — `sens` reste nul, et c'est le
 * croisement avec une zone qui lui donnera une direction.
 */
export function estMarteau(b) {
  if (!mesurable(b)) return false;
  const c = corps(b);
  return c <= amplitude(b) * PART_CORPS_PETIT
    && mecheBasse(b) >= Math.max(c * MECHE_LONGUE, amplitude(b) * 0.5)
    && mecheHaute(b) <= c;
}

/** Marteau inversé : la même forme, retournée. */
export function estMarteauInverse(b) {
  if (!mesurable(b)) return false;
  const c = corps(b);
  return c <= amplitude(b) * PART_CORPS_PETIT
    && mecheHaute(b) >= Math.max(c * MECHE_LONGUE, amplitude(b) * 0.5)
    && mecheBasse(b) <= c;
}

/**
 * Doji : un corps qui n'existe presque pas.
 *
 * Il n'annonce rien par lui-même — il dit seulement que l'ouverture et la
 * clôture se sont rejointes. Sa valeur, s'il en a une, est d'être arrivé
 * quelque part de particulier.
 */
export function estDoji(b) {
  return mesurable(b) && corps(b) <= amplitude(b) * PART_CORPS_DOJI;
}

/**
 * Englobante : le corps de la seconde recouvre entièrement celui de la
 * première, et elles sont de couleurs opposées.
 *
 * Sur les CORPS, pas sur les amplitudes. L'usage courant dit « englobe la
 * bougie précédente », mais une bougie dont les mèches dépassent sans que son
 * corps recouvre quoi que ce soit n'a rien englobé — elle a juste été
 * volatile. Le corps est ce qui a été accepté ; les mèches sont ce qui a été
 * refusé.
 */
export function estEnglobante(precedente, b) {
  if (!mesurable(precedente) || !mesurable(b)) return false;
  if (estHaussiere(precedente) === estHaussiere(b)) return false;
  return hautDuCorps(b) >= hautDuCorps(precedente) && basDuCorps(b) <= basDuCorps(precedente)
    && corps(b) > corps(precedente);
}

/**
 * Inside bar : l'amplitude entière tient dans celle de la précédente.
 *
 * Sur les AMPLITUDES cette fois, et pour la raison inverse : ce qui fait une
 * inside bar, c'est que le prix n'est allé nulle part où il n'était pas déjà
 * allé. Les mèches comptent, puisque ce sont elles qui bornent le terrain.
 */
export function estInsideBar(precedente, b) {
  if (!mesurable(precedente) || !mesurable(b)) return false;
  return b.plusHaut <= precedente.plusHaut && b.plusBas >= precedente.plusBas;
}

/** Les figures d'une seule bougie, et celles qui en demandent deux. */
const SOLITAIRES = [
  ['marteau', estMarteau],
  ['marteau_inverse', estMarteauInverse],
  ['doji', estDoji],
];
const PAIRES = [
  ['englobante', estEnglobante],
  ['inside_bar', estInsideBar],
];

/**
 * Toutes les figures d'une série, au format des trouvailles.
 *
 * La zone d'une figure est son amplitude : c'est elle qu'on dessine, et c'est
 * elle qui se croisera avec une zone d'order block. Le sens d'une englobante
 * vient de sa couleur ; celui d'un marteau ou d'un doji reste nul, parce que
 * la forme seule ne le dit pas.
 */
export function figuresDe(bougies) {
  const out = [];
  if (!Array.isArray(bougies)) return out;

  for (let i = 0; i < bougies.length; i++) {
    const b = bougies[i];
    if (!mesurable(b)) continue;

    const zone = { haut: b.plusHaut, bas: b.plusBas };
    const commun = { index: i, ms: b.ouvertureMs ?? null, zone, qualificatifs: null };

    for (const [type, test] of SOLITAIRES) {
      if (test(b)) out.push({ ...commun, type, sens: null });
    }
    if (i > 0) {
      for (const [type, test] of PAIRES) {
        if (test(bougies[i - 1], b)) {
          out.push({ ...commun, type, sens: type === 'englobante' ? (estHaussiere(b) ? 'haussier' : 'baissier') : null });
        }
      }
    }
  }
  return out;
}
