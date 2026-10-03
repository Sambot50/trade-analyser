// La file des zones qui attendent un jugement.
//
// Sans cet écran, rien ne se juge. Une zone détectée aujourd'hui se tranche
// dans quelques heures ou quelques jours, et personne ne va rouvrir des
// dossiers un par un pour les retrouver. La file les présente d'elle-même.
//
// Du plus ANCIEN au plus récent, délibérément : une zone de trois jours a eu
// le temps d'être tranchée, une zone de dix minutes non. Les récentes en tête
// rempliraient l'écran de cas qu'on ne peut pas juger.

import React, { useEffect, useState, useCallback } from 'react';
import { Hourglass, Check, X, RefreshCw, AlertCircle } from 'lucide-react';

import { lireLignesIndex, reduireIndex, fileDAttente, tauxValidation, jugerOrderBlock } from './lib/journal/index.js';

export default function FileDAttente({ racine }) {
  const [lignes, setLignes] = useState([]);
  const [message, setMessage] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [notes, setNotes] = useState({});

  const recharger = useCallback(async () => {
    if (!racine) { setLignes([]); return; }
    try {
      setLignes(reduireIndex(await lireLignesIndex(racine)));
    } catch (err) {
      setMessage({ type: 'erreur', texte: `Index illisible : ${err.message}` });
    }
  }, [racine]);

  useEffect(() => { recharger(); }, [recharger]);

  const juger = async (ob, etat) => {
    if (occupe) return;
    setOccupe(true);
    try {
      await jugerOrderBlock({
        racine,
        idEnregistrement: ob.idEnregistrement,
        indexBougie: ob.indexBougie,
        etat,
        note: notes[ob.id]?.trim() || undefined,
      });
      setNotes((n) => ({ ...n, [ob.id]: '' }));
      await recharger();
    } catch (err) {
      setMessage({ type: 'erreur', texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  if (!racine) {
    return (
      <Encadre>
        <p className="text-[13px] text-slate-300">
          Aucun dossier de journal connecté. La file se lit dans <code>index.jsonl</code>,
          qui vit dans ce dossier — connecte-le depuis l’onglet Journal.
        </p>
      </Encadre>
    );
  }

  const attente = fileDAttente(lignes);
  const t = tauxValidation(lignes);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hourglass className="w-4 h-4 text-amber-400" />
          <span className="text-[13px] text-slate-200 font-semibold">
            {attente.length} zone{attente.length > 1 ? 's' : ''} à juger
          </span>
        </div>
        <button
          onClick={recharger}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> relire l’index
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <Chiffre libelle="En attente" valeur={t.enAttente} couleur="text-amber-400" />
        <Chiffre libelle="Validées" valeur={t.valide} couleur="text-emerald-400" />
        <Chiffre libelle="Invalidées" valeur={t.invalide} couleur="text-rose-400" />
        <Chiffre
          libelle="Taux"
          valeur={t.taux === null ? '—' : `${(t.taux * 100).toFixed(0)} %`}
          couleur="text-slate-200"
        />
      </div>

      {/* Le taux ne compte que ce qui est tranché. Une zone que le prix n'a pas
          encore atteinte n'a rien échoué — la compter perdante ferait baisser
          le taux à mesure qu'on détecte, ce qui n'aurait aucun sens. */}
      <p className="text-[11px] text-slate-600 leading-relaxed">
        Le taux porte sur les {t.tranches} zone{t.tranches > 1 ? 's' : ''} tranchée{t.tranches > 1 ? 's' : ''}.
        Les zones en attente en sont exclues : le prix n’y est pas encore revenu, elles n’ont rien échoué.
      </p>

      {message && (
        <div className="flex items-start gap-2 bg-rose-950/40 border border-rose-900/50 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-[12px] text-rose-200">{message.texte}</p>
        </div>
      )}

      {attente.length === 0 ? (
        <Encadre>
          <p className="text-[13px] text-slate-300">
            Rien à juger. Les zones apparaissent ici dès qu’une mesure est enregistrée au journal.
          </p>
        </Encadre>
      ) : (
        attente.map((ob) => (
          <Zone
            key={ob.id}
            ob={ob}
            note={notes[ob.id] ?? ''}
            setNote={(v) => setNotes((n) => ({ ...n, [ob.id]: v }))}
            onJuger={(etat) => juger(ob, etat)}
            occupe={occupe}
          />
        ))
      )}
    </div>
  );
}

function Encadre({ children }) {
  return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">{children}</div>;
}

function Chiffre({ libelle, valeur, couleur }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
      <span className="text-slate-500">{libelle}</span>
      <p className={`text-[15px] font-semibold tabular-nums ${couleur}`}>{valeur}</p>
    </div>
  );
}

function Zone({ ob, note, setNote, onJuger, occupe }) {
  const critères = ob.qualificatifs
    ? Object.entries(ob.qualificatifs).filter(([, v]) => v === true).map(([k]) => k)
    : [];
  const jour = String(ob.horodatage ?? '').slice(0, 10);
  const heure = String(ob.horodatage ?? '').slice(11, 16);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-slate-200 font-semibold">
          {ob.symbole ?? 'INCONNU'} <span className="text-slate-500 font-normal">{ob.uniteTemps ?? ''}</span>
        </span>
        <span className="text-[11px] text-slate-500 tabular-nums">{jour} {heure}</span>
      </div>

      <div className="flex items-baseline gap-3 text-[12px]">
        <span className={ob.sens === 'haussier' ? 'text-emerald-400' : 'text-rose-400'}>
          {ob.sens === 'haussier' ? 'OB ↑' : 'OB ↓'}
        </span>
        <span className="text-slate-300 font-mono tabular-nums">
          {ob.prixBasDeZone} – {ob.prixHautDeZone}
        </span>
        <span className="text-slate-600">bougie #{ob.indexBougie}</span>
      </div>

      {critères.length > 0 && (
        <p className="text-[11px] text-indigo-400">{critères.join(' · ')}</p>
      )}

      <p className="text-[11px] text-slate-600 font-mono">{ob.dossier}</p>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="pourquoi (facultatif) — c’est ce qui servira à comprendre"
        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-200
                   focus:outline-none focus:border-indigo-600"
      />

      <div className="flex gap-2">
        <button
          onClick={() => onJuger('valide')}
          disabled={occupe}
          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-900/40 hover:bg-emerald-900/60
                     border border-emerald-800/50 disabled:opacity-50 text-emerald-300 text-[12px]
                     font-semibold rounded-lg py-2 transition"
        >
          <Check className="w-3.5 h-3.5" /> A tenu
        </button>
        <button
          onClick={() => onJuger('invalide')}
          disabled={occupe}
          className="flex-1 flex items-center justify-center gap-1.5 bg-rose-900/40 hover:bg-rose-900/60
                     border border-rose-800/50 disabled:opacity-50 text-rose-300 text-[12px]
                     font-semibold rounded-lg py-2 transition"
        >
          <X className="w-3.5 h-3.5" /> N’a pas tenu
        </button>
      </div>
    </div>
  );
}
