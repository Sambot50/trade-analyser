import React, { useState } from 'react';
import { Upload, AlertCircle, ShieldAlert } from 'lucide-react';

import { lireJsonl, positionsDepuisDeals } from './lib/journal/mt5.js';
import { performances } from './lib/journal/performances.js';

// Le journal de performances, depuis l'export MT5 (`npm run mt5:export`).
//
// Les fichiers sont lus dans le navigateur et n'en sortent pas. Aucun groupe
// n'est désigné « meilleur », et un groupe sous l'effectif minimal est marqué :
// voir src/lib/journal/performances.js.

const argent = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}`);
const pct = (t) => (t ? `${Math.round(t.proportion * 100)} %` : '—');
const ic = (t) => (t ? `${Math.round(t.bas * 100)}–${Math.round(t.haut * 100)} %` : '');
const num = (x, d = 2) => (x === null || x === undefined ? '—' : x.toFixed(d));

function Tuile({ titre, valeur, detail, ton }) {
  const couleur = ton === 'bon' ? 'text-emerald-300' : ton === 'mauvais' ? 'text-rose-300' : 'text-slate-100';
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{titre}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${couleur}`}>{valeur}</div>
      {detail && <div className="text-[11px] text-slate-500 mt-1">{detail}</div>}
    </div>
  );
}

function Tableau({ titre, groupes, libelle, minimum }) {
  if (!groupes.length) return null;
  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">{titre}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-normal py-1 pr-3">Groupe</th>
              <th className="text-right font-normal py-1 px-2">Trades</th>
              <th className="text-right font-normal py-1 px-2">Réussite</th>
              <th className="text-right font-normal py-1 px-2">IC 95 %</th>
              <th className="text-right font-normal py-1 px-2">P&amp;L</th>
              <th className="text-right font-normal py-1 pl-2">PF</th>
            </tr>
          </thead>
          <tbody>
            {groupes.map((g) => (
              <tr key={String(g.groupe)} className={`border-t border-slate-800 ${g.suffisant ? 'text-slate-200' : 'text-slate-500'}`}>
                <td className="text-left py-1.5 pr-3">{libelle(g)}{!g.suffisant && <span className="ml-2 text-[10px] text-slate-600">trop peu</span>}</td>
                <td className="text-right px-2">{g.n}</td>
                <td className="text-right px-2">{pct(g.taux)}</td>
                <td className="text-right px-2">{ic(g.taux)}</td>
                <td className={`text-right px-2 ${g.pnl > 0 ? 'text-emerald-400/80' : g.pnl < 0 ? 'text-rose-400/80' : ''}`}>{argent(g.pnl)}</td>
                <td className="text-right pl-2">{num(g.profitFactor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-600 mt-2">Ordre naturel, jamais trié par résultat. Grisé : moins de {minimum} trades, rien à en conclure.</p>
    </section>
  );
}

export default function PerformancesView() {
  const [journal, setJournal] = useState(null);
  const [erreur, setErreur] = useState('');

  const charger = async (fichiers) => {
    setErreur('');
    const parNom = Object.fromEntries([...fichiers].map((f) => [f.name, f]));
    if (!parNom['deals.jsonl']) {
      setErreur('Sélectionne au moins deals.jsonl (et ordres.jsonl pour les stops), dans donnees/mt5.');
      return;
    }
    try {
      const deals = lireJsonl(await parNom['deals.jsonl'].text());
      const ordres = parNom['ordres.jsonl'] ? lireJsonl(await parNom['ordres.jsonl'].text()) : { lignes: [], illisibles: [] };
      const compte = parNom['compte.json'] ? JSON.parse(await parNom['compte.json'].text()) : null;
      const reconstitue = positionsDepuisDeals(deals.lignes, ordres.lignes);
      setJournal({
        ...reconstitue, compte, sansOrdres: !parNom['ordres.jsonl'],
        illisibles: deals.illisibles.length + ordres.illisibles.length,
        rapport: performances(reconstitue.positions),
      });
    } catch (err) {
      setErreur(`Lecture impossible : ${err.message}`);
    }
  };

  const r = journal?.rapport;
  const g = r?.global;
  const devise = journal?.compte?.devise ?? '';

  return (
    <div className="flex flex-col gap-5">
      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
        <h2 className="text-base font-semibold text-slate-100">Journal de performances</h2>
        <p className="text-xs text-slate-500 mt-1">
          Depuis l'export MT5 : <code className="text-slate-400">npm run mt5:export</code>, puis sélectionne les fichiers de{' '}
          <code className="text-slate-400">donnees/mt5</code>. Rien ne quitte ton navigateur.
        </p>
        <label className="mt-4 inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> deals.jsonl, ordres.jsonl, compte.json
          <input type="file" multiple accept=".jsonl,.json" className="hidden" onChange={(e) => charger(e.target.files)} />
        </label>
        {erreur && <p className="mt-3 text-xs text-rose-300 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{erreur}</p>}
      </section>

      {journal && (
        <>
          <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>{journal.compte?.serveur ?? 'compte'} · export du {journal.compte?.exporteLe ?? '?'}</span>
            <span>{g.n} fermée(s) · {r.ouvertes} ouverte(s) · {journal.mouvements.length} dépôt(s)/retrait(s)</span>
            {journal.compte?.verificationHeure && <span>heure du serveur : {journal.compte.verificationHeure}</span>}
          </div>

          {(journal.anomalies.length > 0 || journal.illisibles > 0 || journal.sansOrdres) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 flex flex-col gap-1">
              {journal.sansOrdres && <span>ordres.jsonl absent : aucun stop connu, donc aucun R.</span>}
              {journal.illisibles > 0 && <span>{journal.illisibles} ligne(s) illisible(s) dans l'export.</span>}
              {journal.anomalies.map((a) => <span key={a.position}>Position {a.position} : {a.quoi}</span>)}
            </div>
          )}

          {g.n === 0 ? (
            <p className="text-sm text-slate-400">Aucune position fermée dans cet export.</p>
          ) : (
            <>
              {!g.suffisant && (
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-300" />
                  Moins de {r.minimum} trades : ces chiffres décrivent ton historique, ils ne prouvent rien sur la suite.
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tuile titre="Réussite" valeur={pct(g.taux)} detail={`IC 95 % ${ic(g.taux)} · ${g.gagnants}/${g.n}`} />
                <Tuile titre="Profit factor" valeur={g.profitFactor === null ? '—' : num(g.profitFactor)} detail={g.profitFactor === null ? 'aucune perte' : 'gains / pertes'} ton={g.profitFactor > 1 ? 'bon' : g.profitFactor !== null ? 'mauvais' : undefined} />
                <Tuile titre="P&L net" valeur={`${argent(g.pnl)} ${devise}`} detail={`dont frais ${argent(g.frais)}`} ton={g.pnl > 0 ? 'bon' : 'mauvais'} />
                <Tuile titre="Espérance / trade" valeur={`${argent(g.esperance)} ${devise}`} />
                <Tuile titre="Gain moyen" valeur={argent(g.gainMoyen)} detail={`perte moyenne ${argent(g.perteMoyenne === null ? null : -g.perteMoyenne)}`} />
                <Tuile titre="Creux maximal" valeur={argent(-g.drawdownMax)} />
                <Tuile titre="R net moyen" valeur={g.r.n ? num(g.r.moyen) : '—'} detail={`${g.r.n} avec stop à l'ouverture · ${g.r.sansStop} sans`} />
                <Tuile titre="Sharpe par trade" valeur={g.sharpeParTrade === null ? '—' : num(g.sharpeParTrade)} detail={g.sharpeParTrade === null ? `moins de ${r.minimum} trades` : 'espérance / écart type'} />
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <Tableau titre="Par heure d'ouverture (Paris)" groupes={r.parHeure} libelle={(x) => `${String(x.groupe).padStart(2, '0')} h`} minimum={r.minimum} />
                <Tableau titre="Par jour" groupes={r.parJour} libelle={(x) => x.libelle} minimum={r.minimum} />
                <Tableau titre="Par setup (commentaire de l'ordre)" groupes={r.parSetup} libelle={(x) => x.groupe ?? '(sans commentaire)'} minimum={r.minimum} />
                <Tableau titre="Par symbole" groupes={r.parSymbole} libelle={(x) => x.groupe} minimum={r.minimum} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
