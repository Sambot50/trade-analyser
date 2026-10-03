// L'instrument regardé : son symbole et son unité de temps.
//
// Ces deux valeurs décident de tout ce qui se passe APRÈS l'analyse. Sans
// symbole, le journal ne sait pas quelles bougies aller chercher ; l'issue
// n'est jamais constatée, et le plan reste « en cours » indéfiniment. Sans
// unité de temps, l'horizon de résolution n'a pas de durée.
//
// Trois sources peuvent les fournir, et elles ne se valent pas :
//
//   1. le modèle, qui lit le bandeau du graphique — et rend régulièrement
//      « UNKNOWN » devant un titre parfaitement lisible ;
//   2. l'OCR du bandeau, qui ne peut rien si la capture est rognée dessous ;
//   3. la saisie, retenue d'une session à l'autre.
//
// La saisie passe en DERNIER, délibérément. Elle est la plus fiable mais la
// seule à ne pas décrire la capture en cours : se tromper d'instrument au
// journal est pire que de ne rien journaliser, parce que l'erreur ne se voit
// qu'au moment où l'on croit relire ses propres résultats.

const CLE = 'trade-analyser.instrument';

/** Un symbole plausible : des lettres, des chiffres, et rien d'exotique. */
export function symboleValide(v) {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._!:-]{1,19}$/.test(v.trim());
}

/** Une unité de temps telle que les plateformes les écrivent. */
export function uniteValide(v) {
  return typeof v === 'string' && /^(\d{1,4}\s?(m|min|h|d|j|w|s|mois)|[DWMS]|daily|weekly)$/i.test(v.trim());
}

export function normaliserInstrument(brut) {
  const symbole = symboleValide(brut?.symbole) ? brut.symbole.trim().toUpperCase() : null;
  const unite = uniteValide(brut?.unite) ? brut.unite.trim().toLowerCase().replace(/\s+/g, '') : null;
  return { symbole, unite };
}

export function chargerInstrument() {
  try {
    return normaliserInstrument(JSON.parse(localStorage.getItem(CLE) ?? 'null'));
  } catch {
    // Navigation privée, stockage bloqué : on fonctionne sans mémoire.
    return { symbole: null, unite: null };
  }
}

export function enregistrerInstrument(instrument) {
  try {
    localStorage.setItem(CLE, JSON.stringify(normaliserInstrument(instrument)));
  } catch {
    // Perdre la préférence n'empêche pas d'analyser.
  }
}

/** Ce qu'on retient d'une valeur que le modèle n'a visiblement pas su lire. */
export const illisible = (v) => !v || /^(unknown|inconnu|n\/?a|intraday|\?+)$/i.test(String(v).trim());

/**
 * Le symbole et l'unité à retenir, et D'OÙ ils viennent.
 *
 * La provenance est rendue avec la valeur, pas déduite après coup : l'écran
 * doit pouvoir dire « saisi » plutôt que laisser croire que la capture a été
 * lue. C'est la seule protection contre le cas où l'instrument retenu n'est
 * plus celui qu'on regarde.
 */
export function resoudreInstrument({ analyse, titre, saisi } = {}) {
  const choix = (duModele, deLOcr, deLaSaisie) => {
    if (!illisible(duModele)) return { valeur: String(duModele).trim(), source: 'modèle' };
    if (!illisible(deLOcr)) return { valeur: String(deLOcr).trim(), source: 'bandeau' };
    if (!illisible(deLaSaisie)) return { valeur: String(deLaSaisie).trim(), source: 'saisi' };
    return { valeur: null, source: null };
  };
  return {
    symbole: choix(analyse?.symbol, titre?.symbole, saisi?.symbole),
    unite: choix(analyse?.timeframe, titre?.unite, saisi?.unite),
  };
}
