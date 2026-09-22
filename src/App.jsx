import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Sparkles, TrendingUp, TrendingDown,
  Target, RefreshCw, Key, CheckCircle2,
  Copy, Zap, ShieldAlert, AlertCircle, Layers,
  BarChart2, ArrowUpRight, ArrowDownRight, Eye, EyeOff,
} from 'lucide-react';

import { SAMPLES } from './samples.js';
import { analyzeChart } from './lib/gemini.js';
import { validateAnalysis, validateScale, normalizeAnalysis, buildOverlayLines } from './lib/analysis.js';

const LEVEL_LABELS = { entry: 'ENTRÉE', sl: 'STOP LOSS', tp1: 'TP 1', tp2: 'TP 2' };

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  // Pré-rempli depuis .env.local (VITE_GEMINI_API_KEY) pour éviter de ressaisir
  // la clé à chaque rechargement. Jamais persistée par l'application elle-même.
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showKeyValue, setShowKeyValue] = useState(false);
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [overlayWarning, setOverlayWarning] = useState('');

  const [visibleLevels, setVisibleLevels] = useState({ entry: true, sl: true, tp1: true, tp2: true });

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const resetAnalysis = useCallback(() => {
    setAnalysis(null);
    setErrorMsg('');
    setOverlayWarning('');
  }, []);

  const handleImageUpload = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageSrc(e.target.result);
      resetAnalysis();
    };
    reader.readAsDataURL(file);
  }, [resetAnalysis]);

  // Collage global : un gestionnaire sur un div ne reçoit l'évènement que
  // si ce div a le focus, ce qui n'est presque jamais le cas au chargement.
  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          handleImageUpload(item.getAsFile());
          break;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleImageUpload]);

  // Rendu de l'image et de l'overlay.
  //
  // Le drapeau `cancelled` évite qu'un chargement lent écrase un rendu plus
  // récent : basculer un calque relance cet effet, et deux onload peuvent
  // s'entrelacer.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!imageSrc || !canvas) return;

    let cancelled = false;
    const img = new Image();

    img.onload = () => {
      if (cancelled) return;

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      if (!analysis) {
        setOverlayWarning('');
        return;
      }

      // L'overlay n'est tracé que si le repère de prix est exploitable.
      // Le tracer à des hauteurs arbitraires produirait une image qui a
      // l'apparence d'une mesure sans en être une.
      const scaleCheck = validateScale(analysis.scale);
      if (!scaleCheck.ok) {
        setOverlayWarning(
          "Overlay non tracé : le modèle n'a pas su situer l'axe des prix de façon fiable. " +
          'Les niveaux restent lisibles dans le panneau de droite.'
        );
        return;
      }

      const { lines, offScreen } = buildOverlayLines(analysis, analysis.scale, canvas.height, visibleLevels);
      for (const line of lines) drawLevel(ctx, canvas.width, line);

      setOverlayWarning(
        offScreen.length
          ? `Hors cadre visible, non tracé : ${offScreen.join(', ')}.`
          : ''
      );
    };

    img.onerror = () => {
      if (!cancelled) setErrorMsg("L'image n'a pas pu être chargée.");
    };

    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc, analysis, visibleLevels]);

  const loadSample = (sample) => {
    setImageSrc(sample.src);
    setErrorMsg('');
    setOverlayWarning('');
    setAnalysis(normalizeAnalysis(sample.analysis, 'demo'));
  };

  const runAnalysis = async () => {
    if (!imageSrc || loading) return;

    // Sans clé, l'ancienne version renvoyait l'analyse BTC de démonstration
    // quelle que soit l'image importée. On refuse explicitement plutôt que
    // de produire un signal sans rapport avec le graphique fourni.
    if (!apiKey.trim()) {
      setErrorMsg(
        "Aucune clé API renseignée : impossible d'analyser cette image. " +
        'Renseigne ta clé Gemini, ou charge un graphique de démonstration pour explorer l’interface.'
      );
      setShowKeyModal(true);
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setOverlayWarning('');

    try {
      const raw = await analyzeChart(imageSrc, apiKey);

      const check = validateAnalysis(raw);
      if (!check.ok) {
        setAnalysis(null);
        setErrorMsg(`Analyse incohérente, rejetée : ${check.errors.join(' ')}`);
        return;
      }

      setAnalysis(normalizeAnalysis(raw, 'api'));
    } catch (err) {
      console.error(err);
      setAnalysis(null);
      setErrorMsg(err.message || "Échec de l'analyse.");
    } finally {
      setLoading(false);
    }
  };

  const copySignal = async () => {
    if (!analysis) return;

    const dirText = analysis.direction === 'BUY' ? 'ACHAT (LONG)' : 'VENTE (SHORT)';
    const header = analysis.source === 'demo'
      ? '*** EXEMPLE DE DÉMONSTRATION — SIGNAL FICTIF ***\n\n'
      : '';

    const text =
      header +
      'SIGNAL DE TRADING — ANALYSE ASSISTÉE PAR IA\n\n' +
      `Actif : ${analysis.symbol} (${analysis.timeframe})\n` +
      `Direction : ${dirText}\n\n` +
      `Entrée : ${analysis.entry}\n` +
      `Stop Loss : ${analysis.stopLoss}\n` +
      `Take Profit 1 : ${analysis.tp1}\n` +
      `Take Profit 2 : ${analysis.tp2}\n` +
      `Ratio R:R (TP1) : 1:${analysis.rr}\n` +
      `Confiance déclarée par le modèle : ${analysis.confidence}%\n\n` +
      'Analyse automatisée, non vérifiée. Ne constitue pas un conseil en investissement.';

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg('Copie refusée par le navigateur. Le presse-papier exige un contexte sécurisé (https ou localhost).');
    }
  };

  const isDemo = analysis?.source === 'demo';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 grid place-items-center">
              <BarChart2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">AI Trade Analyser</h1>
              <p className="text-[11px] text-slate-500">Lecture de graphique assistée — moteur SMC Vision</p>
            </div>
          </div>

          <button
            onClick={() => setShowKeyModal(true)}
            className="flex items-center gap-2 text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 px-3.5 py-2 rounded-lg border border-slate-700/80 transition"
          >
            <Key className="w-3.5 h-3.5" />
            {apiKey ? 'API Gemini active' : 'Clé API non renseignée'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-6 grid lg:grid-cols-[1.35fr_1fr] gap-6 items-start">
        <section className="flex flex-col gap-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs text-slate-500 shrink-0 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" /> Graphiques démo :
            </span>
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                onClick={() => loadSample(s)}
                className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-lg text-slate-300 shrink-0 transition flex items-center gap-1.5"
              >
                {s.name}
                <span className="text-[10px] text-slate-500">{s.type}</span>
              </button>
            ))}
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleImageUpload(e.dataTransfer.files[0]); }}
            className="flex-1 min-h-[420px] border-2 border-dashed border-slate-800 hover:border-indigo-500/40 bg-slate-900/20 rounded-2xl flex flex-col items-center justify-center p-4 cursor-pointer transition relative overflow-hidden group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleImageUpload(e.target.files[0])}
              className="hidden"
            />

            {imageSrc ? (
              <canvas ref={canvasRef} className="max-w-full max-h-[560px] object-contain rounded-lg" />
            ) : (
              <div className="text-center px-6">
                <Upload className="w-8 h-8 text-slate-600 mx-auto mb-3 group-hover:text-indigo-400 transition" />
                <p className="text-sm text-slate-400">Glissez-déposez ou cliquez pour importer votre graphique</p>
                <p className="text-xs text-slate-600 mt-1">Collez directement votre capture avec Ctrl + V</p>
              </div>
            )}
          </div>

          {analysis && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">Niveaux affichés sur l'image :</span>
              {Object.keys(visibleLevels).map((key) => (
                <button
                  key={key}
                  onClick={() => setVisibleLevels((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className={`text-xs px-2.5 py-1 rounded-md border transition flex items-center gap-1 ${
                    visibleLevels[key]
                      ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300 font-medium'
                      : 'bg-slate-950 border-slate-800 text-slate-600'
                  }`}
                >
                  {visibleLevels[key] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {LEVEL_LABELS[key]}
                </button>
              ))}
            </div>
          )}

          {overlayWarning && (
            <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{overlayWarning}</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            onClick={runAnalysis}
            disabled={!imageSrc || loading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold py-3 rounded-xl transition"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Analyse en cours…' : "Lancer l'analyse AI"}
          </button>
        </section>

        <aside className="lg:sticky lg:top-24">
          {analysis ? (
            <div className="flex flex-col gap-3.5">
              {isDemo && (
                <div className="flex items-start gap-2 text-xs font-semibold text-amber-200 bg-amber-500/15 border border-amber-400/40 rounded-xl px-3.5 py-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
                  <span>
                    SIMULATION — exemple préenregistré sur un graphique synthétique.
                    Aucun appel au modèle n'a eu lieu, ce signal est fictif.
                  </span>
                </div>
              )}

              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">{analysis.symbol} • {analysis.timeframe}</p>
                    <div className={`mt-1.5 inline-flex items-center gap-1.5 text-sm font-bold ${
                      analysis.direction === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {analysis.direction === 'BUY'
                        ? <><TrendingUp className="w-4 h-4" /> ACHAT (LONG)</>
                        : <><TrendingDown className="w-4 h-4" /> VENTE (SHORT)</>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 leading-tight">Confiance<br />déclarée</p>
                    <p className="text-xl font-bold text-slate-200">{analysis.confidence}%</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <LevelCard icon={Target} label="Entrée conseillée" value={analysis.entry} tone="text-blue-400" />
                <LevelCard icon={ShieldAlert} label="Stop Loss" value={analysis.stopLoss} tone="text-rose-400" />
                <LevelCard icon={ArrowUpRight} label="Take Profit 1" value={analysis.tp1} tone="text-emerald-400" />
                <LevelCard icon={ArrowUpRight} label="Take Profit 2" value={analysis.tp2} tone="text-emerald-500" />
              </div>

              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">Ratio risque / rendement (TP1)</p>
                  <p className="text-lg font-bold text-slate-100">1 : {analysis.rr ?? '—'}</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">Jusqu'au TP2 : 1 : {analysis.rrTp2 ?? '—'}</p>
                </div>
                <span className={`text-[10px] px-2.5 py-1 rounded-lg shrink-0 ${
                  (analysis.rr ?? 0) >= 2
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {(analysis.rr ?? 0) >= 2 ? 'Bonne asymétrie' : 'Ratio modéré'}
                </span>
              </div>

              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
                <p className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-2.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" /> Confluences Price Action &amp; SMC
                </p>
                <ul className="space-y-2">
                  {analysis.reasoning.map((item, i) => (
                    <li key={i} className="text-xs text-slate-400 leading-relaxed flex gap-2">
                      <span className="text-indigo-500 shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={copySignal}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-medium py-2.5 rounded-xl transition"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Signal copié' : 'Copier le signal'}
              </button>

              <p className="text-[10px] text-slate-600 leading-relaxed px-1">
                Lecture automatisée d'une image, non vérifiée. Les niveaux sont estimés par un modèle
                de vision à partir de l'axe des prix : recoupe-les toujours sur ta plateforme avant
                toute exécution. Ceci n'est pas un conseil en investissement.
              </p>
            </div>
          ) : (
            <div className="bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl p-8 text-center">
              <Target className="w-7 h-7 text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-slate-400 font-medium">Aucune analyse active</p>
              <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                Sélectionnez un graphique d'exemple ou importez votre propre capture pour démarrer.
              </p>
            </div>
          )}
        </aside>
      </main>

      {showKeyModal && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-5"
          onClick={() => setShowKeyModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5"
          >
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-400" /> Configuration de l'API Gemini Vision
            </h2>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              La clé est conservée en mémoire pour la durée de la session uniquement : elle n'est
              écrite ni dans le navigateur, ni sur disque. Pour éviter de la ressaisir, place-la dans
              un fichier <code className="text-slate-400">.env.local</code> sous la clé{' '}
              <code className="text-slate-400">VITE_GEMINI_API_KEY</code>.
            </p>

            <div className="relative mt-3.5">
              <input
                type={showKeyValue ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza…"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowKeyValue((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showKeyValue ? 'Masquer la clé' : 'Afficher la clé'}
              >
                {showKeyValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowKeyModal(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LevelCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3">
      <p className="text-[10px] text-slate-500 flex items-center gap-1">
        <Icon className={`w-3 h-3 ${tone}`} /> {label}
      </p>
      <p className="text-sm font-semibold text-slate-100 mt-1 tabular-nums">{value}</p>
    </div>
  );
}

/** Trace une ligne de niveau et son étiquette de prix sur le canvas. */
function drawLevel(ctx, width, { y, color, label, price }) {
  ctx.save();

  ctx.beginPath();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.font = 'bold 15px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const text = `${label} : ${price}`;
  const textWidth = ctx.measureText(text).width;
  const boxWidth = textWidth + 20;

  ctx.fillStyle = color;
  ctx.fillRect(width - boxWidth - 8, y - 15, boxWidth, 30);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, width - boxWidth + 2, y);

  ctx.restore();
}
