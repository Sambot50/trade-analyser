// Une lecture géométrique, enregistrée au journal.
//
// Ce n'est PAS un plan, et c'est tout l'intérêt de lui donner son propre type
// plutôt que de la faire entrer dans le schéma d'analyse. Une mesure n'a ni
// entrée, ni stop, ni objectif : il n'y a donc pas d'issue à constater, pas de
// ratio à juger, pas de taux d'équilibre à calculer. La forcer dans le schéma
// du plan reviendrait à écrire une douzaine de `null` et à apprendre au
// résolveur à les ignorer — deux occasions de se tromper pour aucun gain.
//
// Ce qu'elle apporte, le plan ne l'a pas : la série de bougies elle-même,
// reconstruite depuis l'image. C'est la seule pièce du journal qui permette de
// rejouer une analyse autrement, ou de vérifier six mois plus tard ce que le
// graphique montrait vraiment — plutôt que ce qu'un modèle en a dit.

import { SCHEMA_VERSION, deviseDeCotation, construireId } from './schema.js';
import { trouvaillesDeMesure, duType, libelleDuType } from '../marche/trouvailles.js';

/** Le type que porte un enregistrement de mesure, et que l'analyse n'a pas. */
export const TYPE_MESURE = 'mesure';

const arrondir = (n, decimales = 2) => (Number.isFinite(n) ? Number(n.toFixed(decimales)) : null);

/**
 * Ce qu'on garde d'une lecture, sous une forme relisible sans le code.
 *
 * Les bougies sont conservées en entier. C'est le gros de l'enregistrement —
 * deux cents bougies pèsent une vingtaine de kilo-octets — et c'est aussi la
 * seule donnée irremplaçable : la capture peut être relue, mais pas
 * re-mesurée à l'identique si le code change.
 */
export function mesureDepuisLecture(lecture, { dimensions } = {}) {
  if (!lecture?.ok) return null;
  const { bougies, analyses, echelle, zone, convention, titre } = lecture;

  return {
    nombreDeBougies: bougies.length,
    conventionDecimale: convention,
    commentaireConvention:
      'Séparateur décimal retenu pour lire l’axe. « point » : 4,440.50 vaut quatre mille. ' +
      '« virgule » : 4.440,50 vaut la même chose. Une lecture dans la mauvaise convention ' +
      'se trompe d’un facteur mille sans que rien ne le signale.',

    echelleDesPrix: {
      prixEnHautDuTrace: arrondir(echelle.prixDeY(zone.y0)),
      prixEnBasDuTrace: arrondir(echelle.prixDeY(zone.y1)),
      hauteurTraceEnPixels: zone.y1 - zone.y0,
      commentaire:
        'Déduite des graduations lues sur l’axe, par ajustement par consensus : ' +
        'la droite retenue est celle sur laquelle tombe le plus de graduations, ' +
        'pas celle qui minimise l’erreur totale — une seule graduation mal lue ' +
        'suffirait sinon à fausser toute l’échelle.',
    },

    bornesDuTrace: {
      x0: zone.x0, x1: zone.x1, y0: zone.y0, y1: zone.y1,
      panneauDeVolume: zone.avecVolume
        ? { y0: zone.volumeY0, y1: zone.volumeY1 }
        : null,
      imageEnPixels: dimensions ?? null,
    },

    bandeau: titre ? { symbole: titre.symbole ?? null, unite: titre.unite ?? null, texteLu: titre.texte ?? null } : null,

    structure: {
      cassures: analyses.cassures.map((c) => ({
        index: c.index, sens: c.sens ?? null, prix: arrondir(c.prix),
      })),
      // Une seule liste typée, et non une liste par figure. C'est ce qui fait
      // qu'ajouter un marteau ou une englobante ne touchera ni ce fichier, ni
      // le tracé, ni l'index, ni la file d'attente.
      trouvailles: (analyses.trouvailles ?? analyses.orderBlocks ?? []).map((t) => ({
        type: t.type ?? 'order_block',
        indexBougie: t.index,
        sens: t.sens ?? null,
        prixHautDeZone: arrondir(t.zone?.haut),
        prixBasDeZone: arrondir(t.zone?.bas),
        qualificatifs: t.qualificatifs ?? null,
      })),
      candidatsEcartes: analyses.rejetes ?? 0,
      assezDeBougies: analyses.assezDeBougies ?? null,
    },

    bougies: bougies.map((b) => ({
      index: b.index ?? null,
      ouverture: arrondir(b.ouverture), cloture: arrondir(b.cloture),
      plusHaut: arrondir(b.plusHaut), plusBas: arrondir(b.plusBas),
      centreXEnPixels: b.centreX ?? null,
    })),
    commentaireBougies:
      'Prix reconstruits depuis les pixels, pas depuis une source de marché. ' +
      'Ils ne portent pas plus de précision que le quadrillage de l’image : ' +
      'compter deux pixels d’incertitude, soit la hauteur d’une graduation ' +
      'divisée par l’écart entre deux graduations.',
  };
}

/** Phrase de résumé, lue en premier. Elle doit suffire à trier. */
export function resumeMesure(record) {
  const { marche, mesure } = record;
  const haut = mesure.echelleDesPrix.prixEnHautDuTrace;
  const bas = mesure.echelleDesPrix.prixEnBasDuTrace;
  const devise = marche.devise ? ` ${marche.devise}` : '';
  const obs = duType(trouvaillesDeMesure({ structure: mesure.structure }), 'order_block').length;
  return (
    `Mesure ${marche.symbole ?? 'symbole inconnu'} ${marche.uniteTemps ?? ''} — `.replace(/\s+—/, ' —')
    + `${mesure.nombreDeBougies} bougies entre ${bas} et ${haut}${devise}, `
    + `${mesure.structure.cassures.length} cassure(s), ${obs} order block(s). `
    + 'Aucun modèle n’intervient : mesuré sur l’image.'
  );
}

/**
 * L'enregistrement complet d'une mesure.
 *
 * `moteur` reste renseigné, mais décrit l'extraction et non un modèle : c'est
 * ce qui permettra, dans six mois, de savoir si une mesure douteuse vient
 * d'une version du code ou de la capture elle-même.
 */
export function construireMesure({ lecture, marche, horodatage, fichiers, dimensions, dureeMs }) {
  const mesure = mesureDepuisLecture(lecture, { dimensions });
  if (!mesure) return null;

  const symbole = marche?.symbole ?? null;
  const record = {
    schemaVersion: SCHEMA_VERSION,
    type: TYPE_MESURE,
    id: `${construireId(horodatage, symbole, marche?.unite)}-mesure`,
    resume: null,
    horodatage,

    moteur: {
      fournisseur: 'géométrie',
      modele: 'extraction locale, sans modèle',
      dureeMs: dureeMs ?? null,
    },

    marche: {
      symbole,
      uniteTemps: marche?.unite ?? null,
      devise: deviseDeCotation(symbole),
      provenanceSymbole: marche?.provenanceSymbole ?? null,
      commentaireDevise: 'Tous les prix de cet enregistrement sont exprimés dans cette devise.',
    },

    mesure,
    fichiers,
  };
  record.resume = resumeMesure(record);
  return record;
}

/** Ligne compacte pour index.jsonl. Les champs de plan n'existent pas ici. */
export function ligneIndexMesure(record, dossier) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: TYPE_MESURE,
    id: record.id,
    horodatage: record.horodatage,
    dossier,
    symbole: record.marche.symbole,
    uniteTemps: record.marche.uniteTemps,
    devise: record.marche.devise,
    nombreDeBougies: record.mesure.nombreDeBougies,
    cassures: record.mesure.structure.cassures.length,
    trouvailles: trouvaillesDeMesure(record.mesure).length,
    orderBlocks: duType(trouvaillesDeMesure(record.mesure), 'order_block').length,
    prixEnHautDuTrace: record.mesure.echelleDesPrix.prixEnHautDuTrace,
    prixEnBasDuTrace: record.mesure.echelleDesPrix.prixEnBasDuTrace,
  };
}
