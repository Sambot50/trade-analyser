// Le carnet de trades réels — le seul instrument que les données passées ne
// remplacent pas.
//
// DEC-034 a chiffré la friction du plan : **0,08 R par trade**. C'est le seuil
// qu'une lecture de direction doit franchir pour que le plan cesse de perdre.
// Aucune mesure sur l'historique ne dira s'il est franchi : la direction vient
// de l'opérateur, pas du volume (DEC-031), et elle ne se simule pas.
//
// DEUX RÈGLES, ET ELLES FONT TOUT.
//
// 1. LE FICHIER EST EN AJOUT SEUL. Chaque ligne est un évènement, jamais un
//    état. Un carnet qu'on peut rouvrir et corriger ne mesure rien : il
//    enregistre ce qu'on aurait voulu faire. L'état se reconstitue en relisant
//    les évènements dans l'ordre.
//
// 2. LE R SE CALCULE SUR LE STOP ANNONCÉ À L'OUVERTURE, jamais sur un stop
//    retrouvé après coup. C'est exactement l'erreur qu'ERRATUM-001 a coûté
//    trois semaines à ce projet : un stop annoncé qui n'était pas le stop
//    mesuré.
//
// Les anomalies — fermeture sans ouverture, double fermeture, horodatage qui
// recule — sont RAPPORTÉES, jamais ignorées. Un carnet qui avale ses
// incohérences en silence est un carnet qui ment.

import { trancheDe } from './marche/plan.js';

/** La friction mesurée par DEC-034, en R. */
export const BARRE = 0.08;

const SENS = { achat: 1, vente: -1 };

/**
 * Lit un fichier d'évènements, une ligne de JSON par évènement.
 *
 * Une ligne illisible est signalée avec son numéro, pas écartée en silence :
 * un carnet amputé d'un trade perdant flatterait la moyenne.
 */
export function lireEvenements(texte) {
  const evenements = [];
  const illisibles = [];
  const lignes = String(texte ?? '').split('\n');
  for (let i = 0; i < lignes.length; i++) {
    const brut = lignes[i].trim();
    if (!brut) continue;
    try {
      const e = JSON.parse(brut);
      if (!e || typeof e !== 'object') throw new Error('pas un objet');
      evenements.push({ ...e, ligne: i + 1 });
    } catch (err) {
      illisibles.push({ ligne: i + 1, texte: brut.slice(0, 60), raison: err.message });
    }
  }
  return { evenements, illisibles };
}

const estFini = (x) => typeof x === 'number' && Number.isFinite(x);

/** Le R d'un trade fermé : brut, puis net des frais. 1 R = la distance du stop. */
export function calculerR(ouverture, fermeture) {
  const sens = SENS[ouverture.sens];
  if (!sens || !estFini(ouverture.entree) || !(ouverture.stop > 0)) return null;
  if (!estFini(fermeture.sortie)) return null;
  const brut = ((fermeture.sortie - ouverture.entree) * sens) / ouverture.stop;
  const frais = estFini(fermeture.frais) ? Math.abs(fermeture.frais) / ouverture.stop : 0;
  return { brut, frais, net: brut - frais };
}

/**
 * Rejoue les évènements et rend l'état : trades fermés, trades encore ouverts,
 * et tout ce qui cloche.
 */
export function reconstituer(evenements) {
  const ouvertures = new Map();
  const fermes = [];
  const anomalies = [];

  for (const e of evenements) {
    if (e.t === 'ouverture') {
      if (ouvertures.has(e.id)) {
        anomalies.push({ ligne: e.ligne, quoi: `ouverture en double pour le trade ${e.id}` });
        continue;
      }
      if (!SENS[e.sens]) {
        anomalies.push({ ligne: e.ligne, quoi: `sens inconnu « ${e.sens} » — attendu achat ou vente` });
        continue;
      }
      if (!(e.stop > 0)) {
        anomalies.push({ ligne: e.ligne, quoi: `trade ${e.id} sans stop : aucun R calculable` });
        continue;
      }
      ouvertures.set(e.id, e);
      continue;
    }

    if (e.t === 'fermeture') {
      const o = ouvertures.get(e.id);
      if (!o) {
        anomalies.push({ ligne: e.ligne, quoi: `fermeture du trade ${e.id} sans ouverture connue` });
        continue;
      }
      if (o.ferme) {
        anomalies.push({ ligne: e.ligne, quoi: `trade ${e.id} fermé deux fois` });
        continue;
      }
      // Un horodatage qui recule est la signature d'un carnet rempli après
      // coup. On le signale sans refuser le trade : c'est à l'opérateur de
      // savoir ce qu'il vaut.
      if (o.le && e.le && e.le < o.le) {
        anomalies.push({ ligne: e.ligne, quoi: `trade ${e.id} fermé AVANT son ouverture — carnet rempli après coup ?` });
      }
      const R = calculerR(o, e);
      if (!R) {
        anomalies.push({ ligne: e.ligne, quoi: `trade ${e.id} : prix de sortie illisible` });
        continue;
      }
      o.ferme = true;
      fermes.push({
        id: e.id, marche: o.marche ?? '—', sens: o.sens,
        tranche: estFini(o.tranche) ? trancheDe(o.tranche) : null,
        rapport: o.tranche, entree: o.entree, stop: o.stop, objectif: o.objectif,
        sortie: e.sortie, issue: e.issue ?? '—', ouvertLe: o.le, fermeLe: e.le, ...R,
      });
      continue;
    }

    anomalies.push({ ligne: e.ligne, quoi: `évènement inconnu « ${e.t} »` });
  }

  const ouverts = [...ouvertures.values()].filter((o) => !o.ferme);
  return { fermes, ouverts, anomalies };
}

const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function statistiques(valeurs) {
  const n = valeurs.length;
  if (!n) return null;
  const m = moyenne(valeurs);
  const sd = n > 1
    ? Math.sqrt(valeurs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1))
    : null;
  return { n, moyenne: m, ecartType: sd, erreurType: sd === null ? null : sd / Math.sqrt(n) };
}

/** Le minimum en dessous duquel une moyenne de R ne décrit rien. */
export const MINIMUM = 30;

/**
 * Le bilan : l'espérance brute face à la barre, la nette face à zéro.
 *
 * Les deux disent la même chose par deux chemins. La brute se compare aux
 * 0,08 R de friction mesurés par DEC-034 ; la nette, qui retranche les frais
 * réellement payés, se compare à zéro. Quand elles divergent, ce sont les
 * frais annoncés qui ne sont pas ceux du courtier.
 */
export function bilan(fermes, { barre = BARRE, minimum = MINIMUM } = {}) {
  if (!fermes.length) return null;
  const brut = statistiques(fermes.map((t) => t.brut));
  const net = statistiques(fermes.map((t) => t.net));

  const grouper = (cle) => {
    const seaux = new Map();
    for (const t of fermes) {
      const k = t[cle] ?? '—';
      if (!seaux.has(k)) seaux.set(k, []);
      seaux.get(k).push(t);
    }
    return [...seaux].map(([k, ts]) => ({
      cle: k, n: ts.length,
      brut: moyenne(ts.map((t) => t.brut)),
      net: moyenne(ts.map((t) => t.net)),
    })).sort((a, b) => b.n - a.n);
  };

  return {
    brut, net, barre, minimum,
    assez: fermes.length >= minimum,
    // Combien d'écarts-types séparent l'espérance brute de la barre.
    marge: brut.erreurType ? (brut.moyenne - barre) / brut.erreurType : null,
    fraisMoyens: moyenne(fermes.map((t) => t.frais)),
    parIssue: grouper('issue'),
    parTranche: grouper('tranche'),
    parSens: grouper('sens'),
  };
}
