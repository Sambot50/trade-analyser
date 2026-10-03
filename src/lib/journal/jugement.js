// Le jugement différé d'un order block.
//
// Une zone détectée aujourd'hui ne se juge pas aujourd'hui. Il faut que le
// prix revienne — quelques heures sur une unité courte, des semaines sur une
// grande. Le jugement est donc un ÉVÈNEMENT SÉPARÉ de la détection, posé plus
// tard, et c'est ce qui dicte toute la forme de ce fichier.
//
// Trois états, et le troisième n'est pas un défaut de saisie : « en attente »
// est l'état normal d'une zone récente, et il peut le rester longtemps. Le
// confondre avec « pas encore regardé » ferait disparaître de la file ce qui
// n'a simplement pas encore eu lieu.

import { SCHEMA_VERSION } from './schema.js';

export const ETATS = ['en_attente', 'valide', 'invalide'];

/** L'état d'une zone que le prix n'a pas encore eu l'occasion de trancher. */
export const ETAT_INITIAL = 'en_attente';

/**
 * L'identifiant d'un order block, stable et lisible.
 *
 * Il porte celui de l'enregistrement dont il vient, suffixé de son rang. Un
 * jugement s'écrit donc dans l'index comme une ligne de plus portant le MÊME
 * identifiant, que la réduction fusionne avec la ligne d'origine. Pas de
 * table à joindre, pas de fichier à réécrire.
 */
export function idOrderBlock(idEnregistrement, index) {
  return `${idEnregistrement}#ob${index}`;
}

export function etatValide(etat) {
  return ETATS.includes(etat);
}

/**
 * La ligne d'index d'un order block, émise à la détection.
 *
 * Une ligne PAR order block, et non une seule ligne par mesure portant leur
 * compte. C'est ce qui permet à `index.jsonl` de rester le seul fichier à
 * lire : la file d'attente, les vues et un futur backtest s'en servent sans
 * ouvrir un seul `mesure.json`.
 */
export function ligneOrderBlock(record, ob, dossier) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'order_block',
    id: idOrderBlock(record.id, ob.indexBougie),
    idEnregistrement: record.id,
    horodatage: record.horodatage,
    dossier,
    symbole: record.marche?.symbole ?? null,
    uniteTemps: record.marche?.uniteTemps ?? null,
    indexBougie: ob.indexBougie,
    sens: ob.sens ?? null,
    prixHautDeZone: ob.prixHautDeZone ?? null,
    prixBasDeZone: ob.prixBasDeZone ?? null,
    qualificatifs: ob.qualificatifs ?? null,
    etat: ETAT_INITIAL,
  };
}

/**
 * La ligne d'un jugement, ajoutée plus tard.
 *
 * Elle ne répète QUE ce qui change. L'index est un journal : une ligne dit
 * « voici ce qui est devenu vrai », pas « voici l'état complet ». Y recopier
 * le reste inviterait à écrire deux versions d'un même fait.
 */
export function ligneJugement({ id, etat, note, horodatage }) {
  if (!etatValide(etat)) throw new Error(`État inconnu : "${etat}". Attendu ${ETATS.join(', ')}.`);
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'order_block',
    id,
    maj: horodatage,
    etat,
    ...(note ? { note } : {}),
  };
}

/** Les order blocks d'un index réduit, tous états confondus. */
export const orderBlocksDe = (lignes) => (lignes ?? []).filter((l) => l?.type === 'order_block');

/**
 * Ce qui reste à juger, du plus ancien au plus récent.
 *
 * Du plus ancien d'abord, et c'est délibéré : une zone vieille de trois jours
 * a eu le temps d'être tranchée, une zone d'il y a dix minutes non. Présenter
 * les récentes en tête remplirait la file de cas qu'on ne peut pas juger.
 */
export function fileDAttente(lignes, { symbole = null } = {}) {
  return orderBlocksDe(lignes)
    .filter((l) => (l.etat ?? ETAT_INITIAL) === ETAT_INITIAL)
    .filter((l) => !symbole || l.symbole === symbole)
    .sort((a, b) => (a.horodatage < b.horodatage ? -1 : 1));
}

/** Combien de zones dans chaque état, pour savoir où l'on en est. */
export function compteParEtat(lignes) {
  const compte = Object.fromEntries(ETATS.map((e) => [e, 0]));
  for (const l of orderBlocksDe(lignes)) {
    const e = etatValide(l.etat) ? l.etat : ETAT_INITIAL;
    compte[e]++;
  }
  return compte;
}

/**
 * Le taux de validation, et ce qu'il vaut.
 *
 * Les zones en attente sont EXCLUES du dénominateur, pas comptées perdantes :
 * une zone que le prix n'a pas encore atteinte n'a rien échoué. Les compter
 * ferait baisser le taux à mesure qu'on détecte, ce qui n'aurait aucun sens.
 */
export function tauxValidation(lignes) {
  const c = compteParEtat(lignes);
  const tranches = c.valide + c.invalide;
  return {
    valide: c.valide,
    invalide: c.invalide,
    enAttente: c.en_attente,
    tranches,
    taux: tranches ? c.valide / tranches : null,
  };
}
