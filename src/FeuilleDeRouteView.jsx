import React, { useMemo } from 'react';

import texte from '../docs/FEUILLE-DE-ROUTE.md?raw';
import { lireBlocs, lireEnLigne, avancement } from './lib/markdown.js';

// La feuille de route, toujours visible dans l'analyseur. Lecture seule : elle
// se modifie dans docs/FEUILLE-DE-ROUTE.md, versionnée, et l'application la
// relit à chaque lancement. Une seule source, jamais deux copies (BLK-016).

function EnLigne({ texte: t }) {
  return lireEnLigne(t).map((m, i) => {
    if (m.type === 'gras') return <strong key={i} className="text-slate-100 font-semibold">{m.texte}</strong>;
    if (m.type === 'italique') return <em key={i}>{m.texte}</em>;
    if (m.type === 'code') return <code key={i} className="text-[0.85em] px-1 rounded bg-slate-800 text-slate-300">{m.texte}</code>;
    if (m.type === 'lien') return <a key={i} href={m.url} target="_blank" rel="noreferrer" className="text-indigo-300 underline">{m.texte}</a>;
    return <React.Fragment key={i}>{m.texte}</React.Fragment>;
  });
}

function Bloc({ b }) {
  switch (b.type) {
    case 'titre': {
      const classes = {
        1: 'text-xl font-semibold text-slate-100 mt-2',
        2: 'text-base font-semibold text-slate-100 mt-6 pt-4 border-t border-slate-800',
        3: 'text-sm font-semibold text-slate-200 mt-5',
        4: 'text-sm font-medium text-slate-300 mt-4',
      };
      return <div className={classes[b.niveau]}><EnLigne texte={b.texte} /></div>;
    }
    case 'separateur':
      return null;
    case 'paragraphe':
      return <p className="text-xs leading-relaxed text-slate-400 mt-2"><EnLigne texte={b.texte} /></p>;
    case 'liste':
      return (
        <ul className="mt-2 flex flex-col gap-1">
          {b.elements.map((e, i) => (
            <li key={i} className="text-xs leading-relaxed text-slate-400 flex gap-2">
              {e.case === null ? (
                <span className="text-slate-600">{b.numerotee ? `${i + 1}.` : '•'}</span>
              ) : (
                <span
                  aria-label={e.case ? 'fait' : 'à faire'}
                  className={`mt-0.5 w-3.5 h-3.5 shrink-0 rounded border grid place-items-center text-[10px] ${
                    e.case ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'border-slate-600'
                  }`}
                >
                  {e.case ? '✓' : ''}
                </span>
              )}
              <span className={e.case ? 'text-slate-500' : ''}><EnLigne texte={e.texte} /></span>
            </li>
          ))}
        </ul>
      );
    case 'tableau':
      return (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[11px]">
            <thead>
              <tr>{b.entete.map((c, i) => <th key={i} className="text-left font-medium text-slate-500 py-1 pr-3"><EnLigne texte={c} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rangees.map((r, i) => (
                <tr key={i} className="border-t border-slate-800 align-top">
                  {r.map((c, j) => <td key={j} className="py-1.5 pr-3 text-slate-400"><EnLigne texte={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export default function FeuilleDeRouteView() {
  const blocs = useMemo(() => lireBlocs(texte), []);
  const etapes = useMemo(() => avancement(blocs), [blocs]);

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-6 items-start">
      <aside className="lg:sticky lg:top-6 bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-3">Avancement</div>
        <div className="flex flex-col gap-2.5">
          {etapes.map((e) => (
            <div key={e.titre}>
              <div className="flex justify-between text-[11px] text-slate-300 gap-2">
                <span className="truncate">{e.titre}</span>
                <span className="tabular-nums text-slate-500 shrink-0">{e.faites}/{e.total}</span>
              </div>
              <div className="h-1 mt-1 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-emerald-500/70" style={{ width: `${(100 * e.faites) / e.total}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-4 leading-relaxed">
          Lecture seule. La source est <code>docs/FEUILLE-DE-ROUTE.md</code>.
        </p>
      </aside>
      <article className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 min-w-0">
        {blocs.map((b, i) => <Bloc key={i} b={b} />)}
      </article>
    </div>
  );
}
