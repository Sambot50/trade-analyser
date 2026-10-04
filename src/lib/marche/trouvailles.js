// Ce qu'une analyse technique trouve sur un graphique.
//
// Order block, marteau, englobante, fair value gap, prise de liquidité : ce
// qui change d'une analyse à l'autre, c'est COMMENT on la trouve. Ce qui ne
// change pas, c'est tout le reste — la dessiner sur l'image, l'écrire au
// journal, l'attendre, la juger, la cataloguer.
//
// Sans ce contrat commun, chaque figure nouvelle se paie en sept fichiers :
// la détecter, l'afficher, la dessiner, la sérialiser, l'indexer, lui donner
// des états, la cataloguer. Et chaque oubli donne un défaut silencieux — une
// figure détectée mais pas dessinée, ou dessinée mais jamais journalisée.
//
// Avec lui, une figure nouvelle coûte un détecteur et une ligne de registre.

/**
 * Le registre des types connus.
 *
 * `dessine` dit si la trouvaille a une étendue de prix qu'on peut tracer sur
 * l'image ; `juge` si elle entre dans la file d'attente. Une figure d'une
 * seule bougie — un marteau — se dessine et se juge comme une zone, parce que
 * c'est son amplitude qui fait sa zone.
 */
export const TYPES = {
  order_block: { libelle: 'Order block', abrege: 'OB', dessine: true, juge: true },
};

export const estTypeConnu = (type) => Object.hasOwn(TYPES, type);

export const libelleDuType = (type) => TYPES[type]?.libelle ?? type ?? 'trouvaille';

/** Une trouvaille porte-t-elle une étendue de prix exploitable ? */
export function aUneZone(t) {
  return Boolean(t?.zone) && Number.isFinite(t.zone.haut) && Number.isFinite(t.zone.bas)
    && t.zone.haut > t.zone.bas;
}

/**
 * Normalise une trouvaille, et refuse ce qui n'en est pas une.
 *
 * Rend `null` plutôt qu'un objet approximatif : une trouvaille sans type ni
 * rang se dessinerait nulle part et se jugerait sous un identifiant instable.
 * Mieux vaut qu'elle n'existe pas que de la voir réapparaître à chaque lecture
 * comme une nouvelle zone à juger.
 */
const CHAMPS_DU_CONTRAT = ['type', 'index', 'ms', 'sens', 'zone', 'qualificatifs', 'plan', 'details'];

export function normaliser(brut) {
  if (!brut || !estTypeConnu(brut.type) || !Number.isFinite(brut.index)) return null;

  // Ce qui n'est pas du contrat va dans `details`, au lieu d'être jeté.
  //
  // La première version jetait. Elle a fait disparaître `indexCassure` et
  // `indexOrigine` d'un order block sans qu'aucun test ne bronche, parce que
  // rien en aval ne s'en servait ENCORE — exactement le défaut silencieux que
  // ce contrat existe pour empêcher. Un contrat dit ce qui est commun ; il
  // n'autorise pas à perdre ce qui est propre à une figure.
  const details = {};
  for (const [clef, valeur] of Object.entries(brut)) {
    if (!CHAMPS_DU_CONTRAT.includes(clef)) details[clef] = valeur;
  }
  if (brut.details) Object.assign(details, brut.details);

  return {
    type: brut.type,
    index: brut.index,
    ms: Number.isFinite(brut.ms) ? brut.ms : null,
    sens: brut.sens ?? null,
    zone: aUneZone(brut) ? { haut: brut.zone.haut, bas: brut.zone.bas } : null,
    qualificatifs: brut.qualificatifs ?? null,
    plan: brut.plan ?? null,
    details: Object.keys(details).length ? details : null,
  };
}

/** Celles d'un type donné, sans que l'appelant ait à connaître la forme. */
export const duType = (trouvailles, type) => (trouvailles ?? []).filter((t) => t?.type === type);

/** Celles qui se dessinent : un type qui le prévoit, et une zone pour le faire. */
export const dessinables = (trouvailles) => (trouvailles ?? [])
  .filter((t) => TYPES[t?.type]?.dessine && aUneZone(t));

/**
 * Les trouvailles d'une mesure enregistrée, quelle que soit son âge.
 *
 * Les enregistrements antérieurs au contrat portent `structure.orderBlocks`,
 * sans type. Les lire comme des order blocks est exact — c'était le seul type
 * qui existait — et c'est ce qui permet de ne RIEN migrer sur le disque. Un
 * journal déjà écrit ne se réécrit pas : on apprend à le relire.
 */
export function trouvaillesDeMesure(mesure) {
  const s = mesure?.structure;
  if (!s) return [];
  if (Array.isArray(s.trouvailles)) return s.trouvailles;
  return (s.orderBlocks ?? []).map((ob) => ({ ...ob, type: 'order_block' }));
}
