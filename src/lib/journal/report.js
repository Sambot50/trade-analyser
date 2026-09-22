// Génération de RAPPORT.md.
//
// C'est le point d'entrée d'un agent à qui l'on demande « étudie mon
// journal » : un seul fichier, quelques milliers de tokens pour cent
// analyses, au lieu d'ouvrir cent fichiers JSON.
//
// Il répond à une seule question : est-ce que cet outil a raison ?

import { compteDansLesStats, estGagnant } from './resolve.js';
import { SCHEMA_VERSION, HORIZON_RESOLUTION_MINUTES } from './schema.js';

const LIBELLE_STATUT = {
  tp1: 'TP1', tp2: 'TP2', stop: 'Stop',
  non_declenche: 'Non déclenché', ambigu: 'Ambigu',
  horizon_depasse: 'Horizon dépassé', en_cours: 'En cours',
};

export function calculerStatistiques(lignes) {
  const total = lignes.length;
  const tranchees = lignes.filter((l) => compteDansLesStats(l.statut));
  const gagnantes = tranchees.filter((l) => estGagnant(l.statut));

  const parStatut = {};
  for (const l of lignes) {
    const cle = l.statut ?? 'en_cours';
    parStatut[cle] = (parStatut[cle] || 0) + 1;
  }

  const confianceGagnantes = moyenne(gagnantes.map((l) => l.confianceDeclareeParLeModele));
  const confiancePerdantes = moyenne(
    tranchees.filter((l) => !estGagnant(l.statut)).map((l) => l.confianceDeclareeParLeModele)
  );

  return {
    total,
    tranchees: tranchees.length,
    gagnantes: gagnantes.length,
    tauxReussite: tranchees.length ? gagnantes.length / tranchees.length : null,
    parStatut,
    ratioMedian: mediane(lignes.map((l) => l.ratioRisqueRendementTp1)),
    ratioMedianGagnantes: mediane(gagnantes.map((l) => l.ratioRisqueRendementTp1)),
    confianceGagnantes,
    confiancePerdantes,
    // Un écart proche de zéro signifie que la confiance déclarée ne prédit rien.
    ecartConfiance:
      confianceGagnantes !== null && confiancePerdantes !== null
        ? Number((confianceGagnantes - confiancePerdantes).toFixed(1))
        : null,
    parModele: grouper(lignes, (l) => l.modele),
    parDirection: grouper(lignes, (l) => l.direction),
  };
}

export function genererRapport(lignes, { genereLe }) {
  const s = calculerStatistiques(lignes);
  const out = [];

  out.push('# Journal des analyses');
  out.push('');
  out.push(`Généré le ${genereLe} · schéma v${SCHEMA_VERSION} · ${s.total} analyse${s.total > 1 ? 's' : ''}`);
  out.push('');
  out.push('Ce fichier est régénéré à chaque écriture. Il résume `index.jsonl` ;');
  out.push('le détail d\'une analyse se trouve dans son dossier, décrit par `SCHEMA.md`.');
  out.push('');

  out.push('## Ce que disent les chiffres');
  out.push('');

  if (!s.tranchees) {
    out.push('**Aucune issue tranchée pour l\'instant.** Le taux de réussite ne peut pas être');
    out.push('calculé tant qu\'aucun trade n\'a atteint son stop ou un objectif.');
  } else {
    out.push(`- **Taux de réussite : ${pourcent(s.tauxReussite)}** — ${s.gagnantes} sur ${s.tranchees} issues tranchées.`);
    out.push(`- Ratio risque/rendement médian : **${s.ratioMedian ?? '—'}** (gagnantes : ${s.ratioMedianGagnantes ?? '—'}).`);

    if (s.ecartConfiance !== null) {
      const verdict = Math.abs(s.ecartConfiance) < 5
        ? 'la confiance déclarée par le modèle ne distingue pas les gagnantes des perdantes'
        : s.ecartConfiance > 0
          ? 'la confiance déclarée est plus élevée sur les gagnantes'
          : 'la confiance déclarée est plus élevée sur les **perdantes**';
      out.push(`- Confiance moyenne : ${arr(s.confianceGagnantes)} % sur les gagnantes, ` +
        `${arr(s.confiancePerdantes)} % sur les perdantes — écart de ${s.ecartConfiance} points, ${verdict}.`);
    }

    const seuil = s.ratioMedian ? 1 / (1 + s.ratioMedian) : null;
    if (seuil !== null && s.tauxReussite !== null) {
      out.push(
        `- Avec un ratio médian de ${s.ratioMedian}, il faudrait **${pourcent(seuil)}** de réussite ` +
        `pour être à l'équilibre. Constaté : ${pourcent(s.tauxReussite)} — ` +
        (s.tauxReussite >= seuil ? '**au-dessus du seuil**.' : '**en dessous du seuil**.')
      );
    }
  }

  out.push('');
  out.push('### Répartition des issues');
  out.push('');
  out.push('| Issue | Nombre | Compté dans le taux |');
  out.push('|---|---:|---|');
  for (const [statut, n] of Object.entries(s.parStatut).sort((a, b) => b[1] - a[1])) {
    out.push(`| ${LIBELLE_STATUT[statut] ?? statut} | ${n} | ${compteDansLesStats(statut) ? 'oui' : 'non'} |`);
  }
  out.push('');
  out.push('Les issues `Ambigu` sont exclues du taux de réussite : la bougie touche le stop et');
  out.push('un objectif sans que son OHLC dise dans quel ordre. Les compter d\'un côté ou de');
  out.push('l\'autre fausserait la mesure.');
  out.push('');

  if (Object.keys(s.parModele).length > 1) {
    out.push('### Par modèle');
    out.push('');
    out.push('| Modèle | Analyses | Tranchées | Taux |');
    out.push('|---|---:|---:|---:|');
    for (const [modele, groupe] of Object.entries(s.parModele)) {
      const t = groupe.filter((l) => compteDansLesStats(l.statut));
      const g = t.filter((l) => estGagnant(l.statut));
      out.push(`| ${modele} | ${groupe.length} | ${t.length} | ${t.length ? pourcent(g.length / t.length) : '—'} |`);
    }
    out.push('');
  }

  out.push('## Analyses');
  out.push('');
  out.push('| Horodatage | Symbole | UT | Sens | Entrée | Stop | TP1 | R:R | Conf. | Issue | Dossier |');
  out.push('|---|---|---|---|---:|---:|---:|---:|---:|---|---|');
  for (const l of [...lignes].reverse()) {
    out.push(
      `| ${l.horodatage} | ${l.symbole ?? '—'} | ${l.uniteTemps ?? '—'} | ` +
      `${l.direction === 'BUY' ? 'Long' : 'Short'} | ${l.prixEntree} | ${l.prixStopLoss} | ${l.prixTp1} | ` +
      `${l.ratioRisqueRendementTp1 ?? '—'} | ${l.confianceDeclareeParLeModele ?? '—'} | ` +
      `${LIBELLE_STATUT[l.statut] ?? 'En cours'}${l.sourceResultat === 'manuelle' ? ' *' : ''} | ` +
      `\`${l.dossier}\` |`
    );
  }
  out.push('');
  out.push('`*` issue saisie à la main. Les autres sont constatées automatiquement sur les');
  out.push(`bougies d'une minute, sur un horizon de ${HORIZON_RESOLUTION_MINUTES / 60} heures après l'analyse.`);
  out.push('');

  out.push('## Limites à garder en tête');
  out.push('');
  out.push('- Le taux de réussite ne dit rien de la rentabilité : il faudrait pondérer par le');
  out.push('  ratio de chaque trade et par la taille de position, que ce journal n\'enregistre pas.');
  out.push('- Une issue `Non déclenché` n\'est ni un succès ni un échec, mais elle mesure quelque');
  out.push('  chose : un modèle qui propose des entrées jamais atteintes produit des plans inertes.');
  out.push('- Aucun de ces trades n\'a été exécuté. Ce sont des plans, pas des résultats.');
  out.push('');

  return out.join('\n');
}

function moyenne(valeurs) {
  const n = valeurs.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!n.length) return null;
  return Number((n.reduce((a, b) => a + b, 0) / n.length).toFixed(1));
}

function mediane(valeurs) {
  const n = valeurs.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!n.length) return null;
  const milieu = Math.floor(n.length / 2);
  const m = n.length % 2 ? n[milieu] : (n[milieu - 1] + n[milieu]) / 2;
  return Number(m.toFixed(2));
}

function grouper(lignes, cle) {
  const out = {};
  for (const l of lignes) {
    const k = cle(l) ?? 'inconnu';
    (out[k] ||= []).push(l);
  }
  return out;
}

const pourcent = (r) => (r === null ? '—' : `${(r * 100).toFixed(0)} %`);
const arr = (n) => (n === null ? '—' : n);
