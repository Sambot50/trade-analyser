import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderOpen, RefreshCw, AlertCircle, CheckCircle2, HardDrive,
  ChevronDown, ChevronRight, ShieldAlert, FileText,
} from 'lucide-react';

import {
  listerTampon, choisirDossier, dossierMemorise, accesDisqueDisponible,
  deverserSurDisque, resoudreEnAttente, appliquerResultat, resultatManuel,
} from './lib/journal/index.js';
import { calculerStatistiques } from './lib/journal/report.js';
import { ligneIndex } from './lib/journal/schema.js';
import { symboleResolvable } from './lib/journal/market.js';

const ISSUES = [
  { id: 'tp1', label: 'TP1' },
  { id: 'tp2', label: 'TP2' },
  { id: 'stop', label: 'Stop' },
  { id: 'non_declenche', label: 'Non déclenché' },
  { id: 'ambigu', label: 'Ambigu' },
];

const COULEUR_STATUT = {
  tp1: 'text-emerald-400', tp2: 'text-emerald-300', stop: 'text-rose-400',
  non_declenche: 'text-slate-500', ambigu: 'text-amber-400',
  horizon_depasse: 'text-slate-500', en_cours: 'text-slate-500',
};

export default function JournalView({ racine, setRacine }) {
  const [entrees, setEntrees] = useState([]);
  const [message, setMessage] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [deplie, setDeplie] = useState(null);

  const recharger = useCallback(async () => {
    setEntrees(await listerTampon());
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  const connecter = async () => {
    try {
      const handle = await choisirDossier();
      setRacine(handle);
      const n = await deverserSurDisque(handle);
      setMessage({ ton: 'ok', texte: n ? `${n} analyse(s) écrite(s) sur disque.` : 'Dossier connecté.' });
      await recharger();
    } catch (err) {
      if (err.name !== 'AbortError') setMessage({ ton: 'erreur', texte: err.message });
    }
  };

  const resoudre = async () => {
    setOccupe(true);
    setMessage(null);
    try {
      const rapport = await resoudreEnAttente({ racine });
      const tranchees = rapport.filter((r) => !['en_cours', 'echec', 'non_resolvable'].includes(r.issue));
      const echecs = rapport.filter((r) => r.issue === 'echec');
      const manuelles = rapport.filter((r) => r.issue === 'non_resolvable');

      const parties = [];
      if (tranchees.length) parties.push(`${tranchees.length} issue(s) constatée(s)`);
      if (manuelles.length) parties.push(`${manuelles.length} à saisir à la main`);
      if (echecs.length) parties.push(`${echecs.length} en échec : ${echecs[0].message}`);

      setMessage({
        ton: echecs.length ? 'erreur' : 'ok',
        texte: parties.join(' · ') || 'Rien à résoudre pour l’instant.',
      });
      await recharger();
    } catch (err) {
      setMessage({ ton: 'erreur', texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  const saisirIssue = async (record, statut) => {
    await appliquerResultat({ racine, id: record.id, resultat: resultatManuel(statut) });
    await recharger();
  };

  const nonEcrites = entrees.filter((e) => !e.ecritSurDisque).length;
  const stats = calculerStatistiques(entrees.map((e) => ligneIndex(e.record)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={connecter}
          disabled={!accesDisqueDisponible()}
          className="flex items-center gap-2 text-xs bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700/80 px-3.5 py-2 rounded-lg transition"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {racine ? `Dossier : ${racine.name}` : 'Connecter un dossier'}
        </button>

        <button
          onClick={resoudre}
          disabled={occupe || !entrees.length}
          className="flex items-center gap-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 px-3.5 py-2 rounded-lg transition"
        >
          {occupe ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Constater les issues
        </button>

        {!accesDisqueDisponible() && (
          <span className="text-[11px] text-amber-400">
            Ce navigateur n'écrit pas sur disque — utilise Chrome ou Edge.
          </span>
        )}
      </div>

      {nonEcrites > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-2.5">
          <HardDrive className="w-4 h-4 shrink-0 mt-px" />
          <span>
            <strong>{nonEcrites} analyse(s) uniquement en mémoire du navigateur.</strong>{' '}
            Le stockage du navigateur n'est pas une sauvegarde : il s'efface avec les données de
            site. Connecte un dossier pour les écrire sur disque.
          </span>
        </div>
      )}

      {message && (
        <div className={`flex items-start gap-2 text-xs border rounded-xl px-3.5 py-2.5 ${
          message.ton === 'erreur'
            ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
            : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
        }`}>
          {message.ton === 'erreur' ? <ShieldAlert className="w-4 h-4 shrink-0 mt-px" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />}
          <span>{message.texte}</span>
        </div>
      )}

      {entrees.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Tuile label="Analyses" valeur={stats.total} />
          <Tuile label="Issues tranchées" valeur={stats.tranchees} />
          <Tuile
            label="Taux de réussite"
            valeur={stats.tauxReussite === null ? '—' : `${(stats.tauxReussite * 100).toFixed(0)} %`}
            note={stats.tranchees ? `${stats.gagnantes} / ${stats.tranchees}` : 'rien de tranché'}
          />
          <Tuile label="Ratio médian" valeur={stats.ratioMedian ?? '—'} />
        </div>
      )}

      {!entrees.length ? (
        <div className="bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl p-8 text-center">
          <FileText className="w-7 h-7 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-medium">Journal vide</p>
          <p className="text-xs text-slate-600 mt-1.5">
            Chaque analyse lancée y est enregistrée automatiquement.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {[...entrees].reverse().map((entree) => (
            <Entree
              key={entree.record.id}
              entree={entree}
              ouvert={deplie === entree.record.id}
              basculer={() => setDeplie(deplie === entree.record.id ? null : entree.record.id)}
              saisirIssue={saisirIssue}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Entree({ entree, ouvert, basculer, saisirIssue }) {
  const { record, capture, ecritSurDisque } = entree;
  const [vignette, setVignette] = useState(null);

  useEffect(() => {
    if (!capture) return;
    const url = URL.createObjectURL(capture);
    setVignette(url);
    return () => URL.revokeObjectURL(url);
  }, [capture]);

  const statut = record.resultat?.statut;
  const auto = symboleResolvable(record.marche.symbole);

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
      <button onClick={basculer} className="w-full flex items-center gap-3 p-3 hover:bg-slate-900/60 transition text-left">
        {ouvert ? <ChevronDown className="w-4 h-4 text-slate-600 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />}
        {vignette && <img src={vignette} alt="" className="w-16 h-10 object-cover rounded border border-slate-800 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-300 font-medium truncate">
            {record.marche.symbole} · {record.marche.uniteTemps} ·{' '}
            <span className={record.plan.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}>
              {record.plan.direction === 'BUY' ? 'Long' : 'Short'}
            </span>
          </p>
          <p className="text-[10px] text-slate-600">
            {record.horodatage} · R:R {record.plan.ratioRisqueRendementTp1 ?? '—'} · {record.moteur.modele}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-xs font-semibold ${COULEUR_STATUT[statut] ?? 'text-slate-600'}`}>
            {statut ? (ISSUES.find((i) => i.id === statut)?.label ?? statut) : 'En attente'}
          </p>
          {!ecritSurDisque && <p className="text-[9px] text-amber-500">pas sur disque</p>}
        </div>
      </button>

      {ouvert && (
        <div className="px-3 pb-3 border-t border-slate-800/60 pt-3">
          <p className="text-[11px] text-slate-400 leading-relaxed">{record.resume}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px] tabular-nums">
            <Champ label="Entrée" valeur={record.plan.prixEntree} />
            <Champ label="Stop" valeur={record.plan.prixStopLoss} />
            <Champ label="TP1" valeur={record.plan.prixTp1} />
            <Champ label="TP2" valeur={record.plan.prixTp2} />
          </div>

          {record.lecture.repereAxeDesPrix && (
            <p className="text-[10px] text-slate-600 mt-2.5">
              Repère lu : {record.lecture.repereAxeDesPrix.prixGraduationHaute} à{' '}
              {(record.lecture.repereAxeDesPrix.hauteurGraduationHaute * 100).toFixed(1)} % ·{' '}
              {record.lecture.repereAxeDesPrix.prixGraduationBasse} à{' '}
              {(record.lecture.repereAxeDesPrix.hauteurGraduationBasse * 100).toFixed(1)} %
            </p>
          )}

          <div className="mt-3">
            <p className="text-[10px] text-slate-500 mb-1.5">
              Issue constatée
              {record.resultat && ` — ${record.resultat.source}, le ${record.resultat.constateLe}`}
              {!record.resultat && auto && ' — sera constatée automatiquement'}
              {!record.resultat && !auto && ' — pas de source publique, à saisir ici'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ISSUES.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => saisirIssue(record, issue.id)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition ${
                    statut === issue.id
                      ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {issue.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tuile({ label, valeur, note }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-100 tabular-nums">{valeur}</p>
      {note && <p className="text-[9px] text-slate-600">{note}</p>}
    </div>
  );
}

function Champ({ label, valeur }) {
  return (
    <div>
      <span className="text-slate-500">{label}</span>
      <p className="text-slate-200 font-semibold">{valeur}</p>
    </div>
  );
}
