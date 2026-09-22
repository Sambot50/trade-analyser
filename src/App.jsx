import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Sparkles, TrendingUp, TrendingDown,
  Target, RefreshCw, Key, CheckCircle2,
  Copy, Zap, ShieldAlert, AlertCircle, Layers,
  BarChart2, ArrowUpRight, Eye, EyeOff, Cpu, Settings, Ruler,
} from 'lucide-react';

import { SAMPLES } from './samples.js';
import { PROVIDERS, analyzeChart, blockingReason, getProvider, listInstalledModels } from './lib/providers/index.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { toPngDataUrl } from './lib/image.js';
import { validateAnalysis, validateScale, normalizeAnalysis, buildOverlayLines, rrVerdict, breakEvenRate } from './lib/analysis.js';

const LEVEL_LABELS = { entry: 'ENTRÉE', sl: 'STOP LOSS', tp1: 'TP 1', tp2: 'TP 2' };

export default function App() {
  const [imageSrc, setImageSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [overlayWarning, setOverlayWarning] = useState('');

  const [engine, setEngine] = useState(loadSettings);
  // La clé vit en mémoire seulement. Pré-remplie depuis .env.local si présente.
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyValue, setShowKeyValue] = useState(false);

  const [visibleLevels, setVisibleLevels] = useState({ entry: true, sl: true, tp1: true, tp2: true });

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const provider = getProvider(engine.provider);
  const config = { ...engine, apiKey };
  const blocked = blockingReason(engine.provider, config);

  useEffect(() => { saveSettings(engine); }, [engine]);

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

  // Collage global : un gestionnaire sur un div ne reçoit l'évènement que si
  // ce div a le focus, ce qui n'est presque jamais le cas au chargement.
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
      if (!validateScale(analysis.scale).ok) {
        setOverlayWarning(
          "Overlay non tracé : le modèle n'a pas su situer l'axe des prix de façon fiable. " +
          'Les niveaux restent lisibles dans le panneau de droite.'
        );
        return;
      }

      const { lines, offScreen } = buildOverlayLines(analysis, analysis.scale, canvas.height, visibleLevels);
      for (const line of lines) drawLevel(ctx, canvas.width, line);

      setOverlayWarning(offScreen.length ? `Hors cadre visible, non tracé : ${offScreen.join(', ')}.` : '');
    };

    img.onerror = () => {
      if (!cancelled) setErrorMsg("L'image n'a pas pu être chargée.");
    };

    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc, analysis, visibleLevels]);

  const loadSample = async (sample) => {
    setErrorMsg('');
    setOverlayWarning('');

    // Rasterisé en PNG : la démo suit exactement le même chemin qu'une capture
    // importée, donc le bouton d'analyse fonctionne aussi sur elle.
    try {
      setImageSrc(await toPngDataUrl(sample.src));
    } catch (err) {
      setImageSrc(sample.src); // affichable, mais pas analysable
      setErrorMsg(`${err.message} La démo reste visible, l'analyse réelle ne pourra pas s'y appliquer.`);
    }

    setAnalysis(normalizeAnalysis(sample.analysis, 'demo'));
  };

  const runAnalysis = async () => {
    if (!imageSrc || loading) return;

    if (blocked) {
      setErrorMsg(blocked);
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setOverlayWarning('');

    try {
      const raw = await analyzeChart(imageSrc, config);

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
            onClick={() => setShowSettings(true)}
            className={`flex items-center gap-2 text-xs px-3.5 py-2 rounded-lg border transition ${
              blocked
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-300'
            }`}
          >
            {provider.needsApiKey ? <Key className="w-3.5 h-3.5" /> : <Cpu className="w-3.5 h-3.5" />}
            <span>{provider.label}</span>
            <span className="text-slate-500 hidden sm:inline">· {engine.model}</span>
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

          {overlayWarning && <Notice tone="amber" icon={AlertCircle}>{overlayWarning}</Notice>}
          {errorMsg && <Notice tone="rose" icon={ShieldAlert}>{errorMsg}</Notice>}

          <button
            onClick={runAnalysis}
            disabled={!imageSrc || loading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold py-3 rounded-xl transition"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? `Analyse en cours via ${provider.label}…` : "Lancer l'analyse AI"}
          </button>
        </section>

        <aside className="lg:sticky lg:top-24">
          {analysis ? (
            <div className="flex flex-col gap-3.5">
              {isDemo && (
                <Notice tone="amber" icon={AlertCircle} strong>
                  SIMULATION — exemple préenregistré sur un graphique synthétique.
                  Aucun appel au modèle n'a eu lieu, ce signal est fictif.
                </Notice>
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

              <RiskCard analysis={analysis} />

              {analysis.source === 'api' && analysis.scale && (
                <ScaleCard scale={analysis.scale} />
              )}

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

      {showSettings && (
        <EngineSettings
          engine={engine}
          setEngine={setEngine}
          apiKey={apiKey}
          setApiKey={setApiKey}
          showKeyValue={showKeyValue}
          setShowKeyValue={setShowKeyValue}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function EngineSettings({ engine, setEngine, apiKey, setApiKey, showKeyValue, setShowKeyValue, onClose }) {
  const provider = getProvider(engine.provider);
  const [probe, setProbe] = useState(null);

  // Sonde Ollama à l'ouverture : savoir tout de suite si le serveur répond et
  // quels modèles sont réellement installés évite un échec au moment du clic.
  useEffect(() => {
    if (provider.needsApiKey) { setProbe(null); return; }

    let cancelled = false;
    setProbe({ state: 'checking' });

    listInstalledModels(engine.baseUrl)
      .then((models) => { if (!cancelled) setProbe({ state: 'ok', models }); })
      .catch((err) => { if (!cancelled) setProbe({ state: 'error', message: err.message }); });

    return () => { cancelled = true; };
  }, [provider.needsApiKey, engine.baseUrl]);

  const selectProvider = (id) => {
    const next = getProvider(id);
    setEngine({
      provider: id,
      model: next.defaultModel,
      baseUrl: next.defaultBaseUrl || '',
    });
  };

  const installed = probe?.state === 'ok' ? probe.models : null;

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/80 backdrop-blur-sm grid place-items-center p-5" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Settings className="w-4 h-4 text-indigo-400" /> Moteur d'analyse
        </h2>

        <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
          {Object.values(PROVIDERS).map((p) => (
            <button
              key={p.id}
              onClick={() => selectProvider(p.id)}
              className={`text-left p-3 rounded-xl border transition ${
                p.id === engine.provider
                  ? 'bg-indigo-600/15 border-indigo-500/50'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700'
              }`}
            >
              <span className="text-xs font-semibold flex items-center gap-1.5">
                {p.needsApiKey ? <Key className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                {p.label}
              </span>
              <span className="block text-[10px] text-slate-500 mt-1 leading-snug">{p.blurb}</span>
            </button>
          ))}
        </div>

        {provider.configurableEndpoint && (
          <label className="block mt-4">
            <span className="text-[11px] text-slate-500">Adresse du serveur Ollama</span>
            <input
              value={engine.baseUrl}
              onChange={(e) => setEngine({ ...engine, baseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition"
            />
          </label>
        )}

        {probe && (
          <div className="mt-2.5">
            {probe.state === 'checking' && <p className="text-[11px] text-slate-500">Recherche du serveur…</p>}
            {probe.state === 'ok' && (
              <p className="text-[11px] text-emerald-400">
                Ollama répond — {probe.models.length} modèle{probe.models.length > 1 ? 's' : ''} installé{probe.models.length > 1 ? 's' : ''}.
              </p>
            )}
            {probe.state === 'error' && (
              <p className="text-[11px] text-amber-400 leading-snug">
                Ollama ne répond pas. Lance <code className="text-slate-300">ollama serve</code> et
                autorise cette page via <code className="text-slate-300">OLLAMA_ORIGINS</code> — voir le README.
              </p>
            )}
          </div>
        )}

        <label className="block mt-4">
          <span className="text-[11px] text-slate-500">Modèle</span>
          <input
            value={engine.model}
            onChange={(e) => setEngine({ ...engine, model: e.target.value })}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition"
          />
        </label>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {provider.suggestedModels.map((m) => {
            const missing = installed && !installed.some((name) => name === m.id || name.startsWith(`${m.id}:`));
            return (
              <button
                key={m.id}
                onClick={() => setEngine({ ...engine, model: m.id })}
                title={missing ? `Non installé — ollama pull ${m.id}` : m.note}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${
                  engine.model === m.id
                    ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                } ${missing ? 'opacity-50' : ''}`}
              >
                {m.label}{missing ? ' ·  à installer' : ''}
              </button>
            );
          })}
        </div>

        {provider.needsApiKey && (
          <>
            <label className="block mt-4">
              <span className="text-[11px] text-slate-500">Clé API</span>
              <div className="relative mt-1">
                <input
                  type={showKeyValue ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowKeyValue(!showKeyValue)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  aria-label={showKeyValue ? 'Masquer la clé' : 'Afficher la clé'}
                >
                  {showKeyValue ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </label>
            <p className="text-[10px] text-slate-600 mt-1.5 leading-relaxed">
              Gardée en mémoire pour la session seulement, jamais écrite sur disque ni dans le
              navigateur. Pour éviter de la ressaisir, place-la dans <code>.env.local</code> sous
              <code> VITE_GEMINI_API_KEY</code>.
            </p>
          </>
        )}

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Affiche le repère que le modèle a relevé sur l'axe.
 *
 * C'est la seule chose vérifiable à l'oeil sur une capture réelle : si ces
 * deux prix ne sont pas ceux des graduations extrêmes du graphique, la
 * projection est fausse, quelle que soit la plausibilité des niveaux.
 */
function ScaleCard({ scale }) {
  const pct = (r) => `${(r * 100).toFixed(1)} %`;
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
      <p className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-2.5">
        <Ruler className="w-3.5 h-3.5 text-indigo-400" /> Repère lu sur l'axe
      </p>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <span className="text-slate-500">Graduation haute</span>
          <p className="text-slate-200 font-semibold tabular-nums">{scale.priceTop}</p>
          <p className="text-slate-600">à {pct(scale.plotTopRatio)} de la hauteur</p>
        </div>
        <div>
          <span className="text-slate-500">Graduation basse</span>
          <p className="text-slate-200 font-semibold tabular-nums">{scale.priceBottom}</p>
          <p className="text-slate-600">à {pct(scale.plotBottomRatio)} de la hauteur</p>
        </div>
      </div>
      <p className="text-[10px] text-slate-600 mt-2.5 leading-relaxed">
        Compare ces deux prix aux graduations extrêmes de ta capture. S'ils ne correspondent
        pas, les traits sont mal placés même si les niveaux semblent crédibles.
      </p>
    </div>
  );
}

/**
 * Ratio risque/rendement, avec les montants qui le composent.
 *
 * Un ratio seul est abstrait ; voir « risque 256,73 pour viser 223,27 » dit
 * immédiatement si la proposition tient debout.
 */
function RiskCard({ analysis }) {
  const verdict = rrVerdict(analysis.rr);
  const breakEven = breakEvenRate(analysis.rr);

  const risk = Math.abs(analysis.entry - analysis.stopLoss);
  const reward = Math.abs(analysis.tp1 - analysis.entry);
  const decimals = Math.min(8, (String(analysis.entry).split('.')[1] || '').length || 2);
  const fmt = (n) => n.toFixed(decimals);

  const tones = {
    good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    weak: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    bad: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    neutral: 'bg-slate-800 text-slate-400 border-slate-700',
  };

  return (
    <div className={`rounded-2xl p-4 border ${
      verdict.tone === 'bad' ? 'bg-rose-500/5 border-rose-500/25' : 'bg-slate-900/40 border-slate-800'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Ratio risque / rendement (TP1)</p>
          <p className="text-lg font-bold text-slate-100">1 : {analysis.rr ?? '—'}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">Jusqu'au TP2 : 1 : {analysis.rrTp2 ?? '—'}</p>
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-lg shrink-0 border ${tones[verdict.tone]}`}>
          {verdict.label}
        </span>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 tabular-nums">
        Tu risques <span className="text-rose-300 font-semibold">{fmt(risk)}</span> pour viser{' '}
        <span className="text-emerald-300 font-semibold">{fmt(reward)}</span>.
      </p>

      {breakEven !== null && (
        <p className={`text-[11px] mt-1 ${verdict.tone === 'bad' ? 'text-rose-300' : 'text-slate-500'}`}>
          Il te faut {(breakEven * 100).toFixed(0)} % de trades gagnants rien que pour être à l'équilibre.
        </p>
      )}
    </div>
  );
}

function Notice({ tone, icon: Icon, strong, children }) {
  const tones = {
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    rose: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  };
  return (
    <div className={`flex items-start gap-2 text-xs border rounded-xl px-3.5 py-2.5 ${tones[tone]} ${strong ? 'font-semibold' : ''}`}>
      <Icon className="w-4 h-4 shrink-0 mt-px" />
      <span>{children}</span>
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
  const boxWidth = ctx.measureText(text).width + 20;

  ctx.fillStyle = color;
  ctx.fillRect(width - boxWidth - 8, y - 15, boxWidth, 30);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, width - boxWidth + 2, y);

  ctx.restore();
}
