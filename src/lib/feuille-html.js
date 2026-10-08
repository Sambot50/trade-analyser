// La feuille de route en page HTML autonome, sur fond clair.
//
// Elle s'ouvre par un double-clic, sans lancer l'analyseur : le raccourci du
// bureau pointe sur elle. Même lecteur que l'onglet de l'application
// (`markdown.js`), donc même structure : avancement à gauche, document à droite.
//
// La page est GÉNÉRÉE depuis docs/FEUILLE-DE-ROUTE.md (`npm run feuille`) et
// versionnée à côté. Un test refuse qu'elle diverge de sa source : une seule
// vérité, jamais deux copies (BLK-016).

import { lireBlocs, lireEnLigne, avancement } from './markdown.js';

const echapper = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function enLigne(texte) {
  return lireEnLigne(texte).map((m) => {
    const t = echapper(m.texte);
    if (m.type === 'gras') return `<strong>${t}</strong>`;
    if (m.type === 'italique') return `<em>${t}</em>`;
    if (m.type === 'code') return `<code>${t}</code>`;
    if (m.type === 'lien') return `<a href="${echapper(m.url)}">${t}</a>`;
    return t;
  }).join('');
}

function bloc(b) {
  switch (b.type) {
    case 'titre': return `<h${b.niveau}>${enLigne(b.texte)}</h${b.niveau}>`;
    case 'paragraphe': return `<p>${enLigne(b.texte)}</p>`;
    case 'liste': {
      const balise = b.numerotee ? 'ol' : 'ul';
      const lis = b.elements.map((e) => {
        if (e.case === null) return `<li>${enLigne(e.texte)}</li>`;
        return `<li class="case${e.case ? ' faite' : ''}"><span class="boite">${e.case ? '✓' : ''}</span><span>${enLigne(e.texte)}</span></li>`;
      });
      return `<${balise}>${lis.join('')}</${balise}>`;
    }
    case 'tableau': {
      const tete = b.entete.map((c) => `<th>${enLigne(c)}</th>`).join('');
      const corps = b.rangees.map((r) => `<tr>${r.map((c) => `<td>${enLigne(c)}</td>`).join('')}</tr>`).join('\n');
      return `<div class="defile"><table><thead><tr>${tete}</tr></thead><tbody>\n${corps}\n</tbody></table></div>`;
    }
    default: return '';
  }
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f7f9; color: #1f2937; font: 15px/1.6 system-ui, "Segoe UI", Arial, sans-serif; }
.page { display: grid; grid-template-columns: 280px 1fr; gap: 24px; max-width: 1280px; margin: 0 auto; padding: 24px 16px; align-items: start; }
aside { position: sticky; top: 24px; background: #fff; border: 1px solid #d9dee5; border-radius: 10px; padding: 16px; }
aside h2 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #4b5563; border: 0; padding: 0; }
.etape { margin-bottom: 10px; font-size: 13px; }
.etape .ligne { display: flex; justify-content: space-between; gap: 8px; color: #111827; }
.etape .compte { color: #4b5563; font-variant-numeric: tabular-nums; white-space: nowrap; }
.barre { height: 6px; margin-top: 4px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
.barre div { height: 100%; background: #15803d; }
aside .source { margin: 14px 0 0; font-size: 12px; color: #6b7280; }
article { background: #fff; border: 1px solid #d9dee5; border-radius: 10px; padding: 24px 28px; min-width: 0; }
h1 { font-size: 26px; margin: 0 0 8px; color: #111827; }
h2 { font-size: 20px; margin: 32px 0 8px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #111827; }
h3 { font-size: 17px; margin: 24px 0 6px; color: #1e3a8a; }
h4 { font-size: 15px; margin: 18px 0 4px; color: #374151; }
p { margin: 8px 0; }
strong { color: #111827; }
code { font: 13px Consolas, monospace; background: #eef1f5; border: 1px solid #dde2e8; border-radius: 4px; padding: 0 4px; color: #1f2937; }
a { color: #1d4ed8; }
ul, ol { margin: 8px 0; padding-left: 22px; }
li { margin: 3px 0; }
li.case { list-style: none; margin-left: -22px; display: flex; gap: 10px; align-items: flex-start; }
.boite { flex: none; width: 18px; height: 18px; margin-top: 3px; border: 2px solid #6b7280; border-radius: 4px; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: #fff; }
li.faite .boite { background: #15803d; border-color: #15803d; color: #fff; }
li.faite > span:last-child { color: #4b5563; }
.defile { overflow-x: auto; margin: 10px 0; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th { text-align: left; background: #f1f4f8; color: #374151; font-weight: 600; }
th, td { border: 1px solid #dde2e8; padding: 6px 10px; vertical-align: top; }
@media (max-width: 860px) { .page { grid-template-columns: 1fr; } aside { position: static; } article { padding: 18px 16px; } }
@media print { body { background: #fff; } aside { position: static; } }
`;

/** La page complète, depuis le texte Markdown de la feuille de route. */
export function feuilleEnHtml(markdown) {
  const blocs = lireBlocs(markdown);
  const etapes = avancement(blocs).map((e) => `<div class="etape"><div class="ligne"><span>${enLigne(e.titre)}</span><span class="compte">${e.faites}/${e.total}</span></div><div class="barre"><div style="width:${Math.round((100 * e.faites) / e.total)}%"></div></div></div>`);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feuille de route — trade-analyser</title>
<!-- GÉNÉRÉ par « npm run feuille » depuis docs/FEUILLE-DE-ROUTE.md. Ne pas modifier à la main. -->
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<aside>
<h2>Avancement</h2>
${etapes.join('\n')}
<p class="source">Lecture seule. La source est <code>docs/FEUILLE-DE-ROUTE.md</code>.</p>
</aside>
<article>
${blocs.map(bloc).filter(Boolean).join('\n')}
</article>
</div>
</body>
</html>
`;
}
