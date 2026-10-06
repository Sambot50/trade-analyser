// Un lecteur de Markdown réduit, pour produire la page de la feuille de route
// (`feuille-html.js`) sans ajouter de dépendance.
//
// Il ne couvre que ce que nos documents emploient : titres, séparateurs,
// paragraphes, listes (numérotées ou non), cases à cocher, tableaux, et en
// ligne le gras, l'italique, le code et les liens. Le reste s'affiche comme du texte, ce
// qui est préférable à une interprétation devinée.

/** Les blocs d'un document. */
export function lireBlocs(texte) {
  const lignes = String(texte ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocs = [];
  let i = 0;

  while (i < lignes.length) {
    const ligne = lignes[i];

    if (!ligne.trim()) { i++; continue; }

    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (titre) { blocs.push({ type: 'titre', niveau: titre[1].length, texte: titre[2].trim() }); i++; continue; }

    if (/^-{3,}\s*$/.test(ligne)) { blocs.push({ type: 'separateur' }); i++; continue; }

    if (/^\s*\|/.test(ligne)) {
      const rangees = [];
      while (i < lignes.length && /^\s*\|/.test(lignes[i])) {
        const cellules = lignes[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cellules.every((c) => /^:?-{3,}:?$/.test(c))) rangees.push(cellules);
        i++;
      }
      blocs.push({ type: 'tableau', entete: rangees[0] ?? [], rangees: rangees.slice(1) });
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/.test(ligne)) {
      const elements = [];
      const numerotee = /^\s*\d+\./.test(ligne);
      while (i < lignes.length && lignes[i].trim() && !/^(#{1,4}\s|\s*\||-{3,}\s*$)/.test(lignes[i])) {
        const el = /^\s*(?:[-*]|\d+\.)\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(lignes[i]);
        if (el) {
          elements.push({ case: el[1] === undefined ? null : el[1].toLowerCase() === 'x', texte: el[2] });
        } else if (elements.length) {
          // Ligne de continuation : rattachée à l'élément précédent.
          elements[elements.length - 1].texte += ` ${lignes[i].trim()}`;
        }
        i++;
      }
      blocs.push({ type: 'liste', numerotee, elements });
      continue;
    }

    const paragraphe = [];
    while (i < lignes.length && lignes[i].trim() && !/^(#{1,4}\s|\s*\||\s*(?:[-*]|\d+\.)\s+|-{3,}\s*$)/.test(lignes[i])) {
      paragraphe.push(lignes[i].trim());
      i++;
    }
    blocs.push({ type: 'paragraphe', texte: paragraphe.join(' ') });
  }

  return blocs;
}

/** Les morceaux d'une ligne : texte, gras, code, lien. */
export function lireEnLigne(texte) {
  const morceaux = [];
  const motif = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*\s][^*]*)\*)/g;
  let dernier = 0;
  let m;
  while ((m = motif.exec(texte)) !== null) {
    if (m.index > dernier) morceaux.push({ type: 'texte', texte: texte.slice(dernier, m.index) });
    if (m[1]) morceaux.push({ type: 'gras', texte: m[2] });
    else if (m[3]) morceaux.push({ type: 'code', texte: m[4] });
    else if (m[5]) morceaux.push({ type: 'lien', texte: m[6], url: m[7] });
    else morceaux.push({ type: 'italique', texte: m[9] });
    dernier = motif.lastIndex;
  }
  if (dernier < texte.length) morceaux.push({ type: 'texte', texte: texte.slice(dernier) });
  return morceaux;
}

/**
 * L'avancement de chaque étape : ses cases, cochées ou non, regroupées sous
 * le titre de niveau 3 qui les précède (« ### E3 — … »).
 */
export function avancement(blocs) {
  const etapes = [];
  let courante = null;
  for (const b of blocs) {
    if (b.type === 'titre' && b.niveau <= 3) {
      courante = b.niveau === 3 ? { titre: b.texte, faites: 0, total: 0 } : null;
      if (courante) etapes.push(courante);
      continue;
    }
    if (courante && b.type === 'liste') {
      for (const e of b.elements) {
        if (e.case === null) continue;
        courante.total++;
        if (e.case) courante.faites++;
      }
    }
  }
  return etapes.filter((e) => e.total > 0);
}
