import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Sparkles, TrendingUp, TrendingDown,
  Target, RefreshCw, Key, CheckCircle2,
  Copy, Zap, ShieldAlert, AlertCircle, Layers,
  BarChart2, ArrowUpRight, Eye, EyeOff, Cpu, Settings, Ruler, NotebookPen, LineChart, GitCompare, Hourglass, Wallet,
} from 'lucide-react';

import { SAMPLES } from './samples.js';
import { PROVIDERS, analyzeChart, blockingReason, getProvider } from './lib/providers/index.js';
import { loadSettings, saveSettings } from './lib/settings.js';
import { chargerInstrument, enregistrerInstrument, resoudreInstrument } from './lib/instrument.js';
import { toPngDataUrl } from './lib/image.js';
import JournalView from './JournalView.jsx';
import { enregistrerAnalyse, enregistrerMesure, dossierMemorise, resoudreEnAttente } from './lib/journal/index.js';
import FileDAttente from './FileDAttente.jsx';
import PerformancesView from './PerformancesView.jsx';
import { validateAnalysis, validateScale, normalizeAnalysis, buildOverlayLines, rrVerdict, breakEvenRate, FRICTION_PAR_DEFAUT } from './lib/analysis.js';
import { lireGraphique } from './lib/vision/lecture.js';
import { pixelsDepuisDataUrl, enCanvas } from './lib/vision/navigateur.js';
import { rectanglesDesTrouvailles, etiquetteDuRectangle } from './lib/vision/trace.js';
import { confronter, ECART_PREOCCUPANT } from './lib/vision/confrontation.js';

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
  // Une clé par fournisseur : passer de Gemini à Claude ne doit jamais envoyer
  // la clé de l'un à l'autre. Jamais écrites sur disque (voir settings.js).
  const [cles, setCles] = useState(() => Object.fromEntries(
    Object.values(PROVIDERS).filter((p) => p.envKey).map((p) => [p.id, import.meta.env[p.envKey] || '']),
  ));
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyValue, setShowKeyValue] = useState(false);

  const [visibleLevels, setVisibleLevels] = useState({ entry: true, sl: true, tp1: true, tp2: true });

  const [lecture, setLecture] = useState(null);
  const [hauteurImage, setHauteurImage] = useState(0);
  const [instrument, setInstrument] = useState(chargerInstrument);
  const [mesureEnCours, setMesureEnCours] = useState(false);
  const [lectureEnCours, setLectureEnCours] = useState(false);
  const [prixHaut, setPrixHaut] = useState('');
  const [prixBas, setPrixBas] = useState('');

  const [onglet, setOnglet] = useState('analyse');
  const [dossierJournal, setDossierJournal] = useState(null);
  const [noteJournal, setNoteJournal] = useState('');

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  // L'overlay n'existe qu'une fois le canvas dessiné : on diffère
  // l'enregistrement jusque-là pour pouvoir y joindre l'image réellement vue.
  const enAttenteJournal = useRef(null);

  const provider = getProvider(engine.provider);
  const apiKey = cles[engine.provider] || '';
  const setApiKey = (valeur) => setCles((c) => ({ ...c, [engine.provider]: valeur }));
  const config = { ...engine, apiKey };
  const blocked = blockingReason(engine.provider, config);

  useEffect(() => { saveSettings(engine); }, [engine]);

  // Au démarrage : retrouver le dossier autorisé, puis tenter de constater les
  // issues en attente. C'est ce qui fait que le journal se remplit tout seul
  // quand on rouvre l'outil le lendemain.
  useEffect(() => {
    let annule = false;
    (async () => {
      const handle = await dossierMemorise().catch(() => null);
      if (annule) return;
      if (handle) setDossierJournal(handle);

      const rapport = await resoudreEnAttente({ racine: handle }).catch(() => []);
      if (annule) return;

      const tranchees = rapport.filter(
        (r) => !['en_cours', 'echec', 'non_resolvable'].includes(r.issue)
      );
      if (tranchees.length) {
        setNoteJournal(`${tranchees.length} issue(s) constatée(s) depuis la dernière session.`);
      }
    })();
    return () => { annule = true; };
  }, []);

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
      setHauteurImage(img.naturalHeight);

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Les zones mesurées se tracent même sans analyse du modèle : elles ne
      // lui doivent rien, et c'est tout l'intérêt de les voir côte à côte.
      for (const rect of rectanglesDesTrouvailles(lecture, canvas.width)) {
        dessinerZone(ctx, rect);
      }

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

      // Enregistrement du journal : ici et pas dans runAnalysis, parce que
      // c'est le seul endroit où l'overlay existe réellement.
      const demande = enAttenteJournal.current;
      if (demande && demande.analyse === analysis) {
        enAttenteJournal.current = null;
        enregistrerAnalyse({
          analyse: demande.analyse,
          moteur: { fournisseur: engine.provider, modele: engine.model, dureeMs: demande.dureeMs },
          captureDataUrl: imageSrc,
          overlayDataUrl: canvas.toDataURL('image/png'),
          dimensions: { largeur: canvas.width, hauteur: canvas.height },
          dossierRacine: dossierJournal,
        })
          .then(({ erreurDisque }) => {
            setNoteJournal(
              erreurDisque
                ? `Analyse enregistrée en mémoire, mais pas sur disque : ${erreurDisque}`
                : dossierJournal
                  ? 'Analyse enregistrée dans le journal.'
                  : 'Analyse enregistrée en mémoire du navigateur — connecte un dossier pour la garder.'
            );
          })
          .catch((err) => setNoteJournal(`Échec de l'enregistrement au journal : ${err.message}`));
      }
    };

    img.onerror = () => {
      if (!cancelled) setErrorMsg("L'image n'a pas pu être chargée.");
    };

    img.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc, analysis, lecture, visibleLevels, engine.provider, engine.model, dossierJournal]);

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

  const journaliser = (analyseNormalisee, dureeMs) => {
    // Le modèle rend parfois `UNKNOWN` et `intraday` devant un graphique qui
    // affiche son symbole en toutes lettres. Sans symbole reconnaissable, le
    // journal ne peut aller chercher aucune bougie, l'issue n'est jamais
    // constatée, et le plan reste « en cours » pour toujours. Deux secours :
    // le bandeau lu par OCR, puis la saisie retenue d'une session à l'autre.
    const { symbole, unite } = resoudreInstrument({
      analyse: analyseNormalisee,
      titre: lecture?.ok ? lecture.titre : null,
      saisi: instrument,
    });
    const analyse = {
      ...analyseNormalisee,
      symbol: symbole.valeur ?? analyseNormalisee.symbol,
      timeframe: unite.valeur ?? analyseNormalisee.timeframe,
    };
    enAttenteJournal.current = { analyse, dureeMs };
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
    const debut = Date.now();

    try {
      const raw = await analyzeChart(imageSrc, config);

      const check = validateAnalysis(raw);
      if (!check.ok) {
        setAnalysis(null);
        setErrorMsg(`Analyse incohérente, rejetée : ${check.errors.join(' ')}`);
        return;
      }

      const normalisee = normalizeAnalysis(raw, 'api');
      setAnalysis(normalisee);
      journaliser(normalisee, Date.now() - debut);
    } catch (err) {
      console.error(err);
      setAnalysis(null);
      setErrorMsg(err.message || "Échec de l'analyse.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Lit le graphique par la géométrie : aucun modèle, aucun appel réseau.
   *
   * Les couleurs, les bornes du tracé, la frontière du panneau de volume et
   * l'échelle sont déduites de l'image elle-même ; les bougies en sont
   * extraites, puis les figures que le dépôt sait déjà reconnaître.
   */
  /**
   * La mesure au journal, avec l'aperçu tel qu'il est tracé à l'écran.
   *
   * L'aperçu est pris sur le canevas plutôt que reconstruit : c'est ce qu'on
   * regarde d'abord en rouvrant un dossier, et il porte les zones aux pixels
   * près. Le reconstruire ailleurs serait une seconde implémentation à tenir
   * en accord avec la première.
   */
  const enregistrerLaMesure = async () => {
    if (!lecture?.ok || mesureEnCours) return;
    setMesureEnCours(true);
    try {
      const canvas = canvasRef.current;
      const resolu = resoudreInstrument({ analyse: analysis, titre: lecture.titre, saisi: instrument });
      const { erreurDisque } = await enregistrerMesure({
        lecture,
        marche: {
          symbole: resolu.symbole.valeur,
          unite: resolu.unite.valeur,
          provenanceSymbole: resolu.symbole.source,
        },
        captureDataUrl: imageSrc,
        apercuDataUrl: canvas ? canvas.toDataURL('image/png') : null,
        dimensions: canvas ? { largeur: canvas.width, hauteur: canvas.height } : null,
        dossierRacine: dossierJournal,
      });
      setNoteJournal(
        erreurDisque
          ? `Mesure enregistrée en mémoire, mais pas sur disque : ${erreurDisque}`
          : dossierJournal
            ? 'Mesure enregistrée dans le journal.'
            : 'Mesure enregistrée en mémoire du navigateur — connecte un dossier pour la garder.'
      );
    } catch (err) {
      setNoteJournal(`Échec de l’enregistrement de la mesure : ${err.message}`);
    } finally {
      setMesureEnCours(false);
    }
  };

  const runLecture = async (echelleManuelle = null) => {
    if (!imageSrc || lectureEnCours) return;
    setLectureEnCours(true);
    setLecture(null);
    setErrorMsg('');
    try {
      const { données, largeur, hauteur } = await pixelsDepuisDataUrl(imageSrc);
      // `cheminLangue` évite d'aller chercher le dictionnaire sur un CDN au
      // moment où l'on s'en sert : il est servi avec l'application.
      const r = await lireGraphique(données, largeur, hauteur, {
        facteur: 4,
        cheminLangue: '/tesseract',
        enImage: enCanvas,
        echelleManuelle,
      });
      setLecture(r);
      if (!r.ok) setErrorMsg(r.probleme);
    } catch (err) {
      console.error(err);
      setLecture(null);
      setErrorMsg(err.message || 'La lecture du graphique a échoué.');
    } finally {
      setLectureEnCours(false);
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
        <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 grid place-items-center">
              <BarChart2 className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">AI Trade Analyser</h1>
              <p className="text-[11px] text-slate-500">Lecture de graphique assistée — moteur SMC Vision</p>
            </div>
          </div>

          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            {[
              { id: 'analyse', label: 'Analyse', Icone: LineChart },
              { id: 'journal', label: 'Journal', Icone: NotebookPen },
              { id: 'file', label: 'À juger', Icone: Hourglass },
              { id: 'performances', label: 'Performances', Icone: Wallet },
            ].map(({ id, label, Icone }) => (
              <button
                key={id}
                onClick={() => setOnglet(id)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition ${
                  onglet === id ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icone className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className={`flex items-center gap-2 text-xs px-3.5 py-2 rounded-lg border transition ${
              blocked
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 text-slate-300'
            }`}
          >
            {provider.keyPolicy === 'requise' ? <Key className="w-3.5 h-3.5" /> : <Cpu className="w-3.5 h-3.5" />}
            <span>{provider.label}</span>
            <span className="text-slate-500 hidden sm:inline">· {engine.model}</span>
          </button>
        </div>
      </header>

      {noteJournal && (
        <div className="max-w-7xl mx-auto px-5 pt-4">
          <Notice tone="amber" icon={NotebookPen}>{noteJournal}</Notice>
        </div>
      )}

      {onglet === 'journal' ? (
        <main className="max-w-7xl mx-auto px-5 py-6">
          <JournalView racine={dossierJournal} setRacine={setDossierJournal} />
        </main>
      ) : onglet === 'performances' ? (
        <main className="max-w-7xl mx-auto px-5 py-6">
          <PerformancesView />
        </main>
      ) : onglet === 'file' ? (
        <main className="max-w-3xl mx-auto px-5 py-6">
          <FileDAttente racine={dossierJournal} />
        </main>
      ) : (
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

          <button
            onClick={() => runLecture()}
            disabled={!imageSrc || lectureEnCours}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-700 text-slate-100 text-sm font-semibold py-3 rounded-xl transition border border-slate-700"
          >
            {lectureEnCours ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Ruler className="w-4 h-4" />}
            {lectureEnCours ? 'Lecture de la géométrie…' : 'Lire les bougies (sans modèle)'}
          </button>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Mesure l'image au lieu de l'interpréter : couleurs, bornes du tracé et échelle
            déduites des pixels, puis structure, order blocks et prises de liquidité.
          </p>

          {lecture && <LectureCard lecture={lecture} />}

          {lecture?.ok && analysis?.scale && (
            <ConfrontationCard analysis={analysis} lecture={lecture} hauteurImage={hauteurImage} />
          )}

          {lecture?.ok && (
            <div className="flex flex-col gap-2">
              <button
                onClick={enregistrerLaMesure}
                disabled={mesureEnCours}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700
                           disabled:opacity-50 text-slate-200 text-[13px] font-semibold rounded-xl py-2.5 transition"
              >
                {mesureEnCours ? <RefreshCw className="w-4 h-4 animate-spin" /> : <NotebookPen className="w-4 h-4" />}
                {mesureEnCours ? 'Enregistrement…' : 'Enregistrer la mesure au journal'}
              </button>

              {/* L'avertissement est AVANT le clic, pas après. Une mesure sans
                  symbole s'enregistre quand même — perdre la série serait pire
                  — mais elle ne pourra jamais être rapprochée d'une source de
                  marché, et on ne s'en aperçoit qu'en relisant le dossier. */}
              {!resoudreInstrument({
                analyse: analysis, titre: lecture.titre, saisi: instrument,
              }).symbole.valeur && (
                <p className="text-[11px] text-amber-400 leading-relaxed">
                  Aucun symbole : cette mesure sera rangée sous « INCONNU » et ne pourra pas
                  être rapprochée d’une source de marché. Renseigne-le ci-dessous d’abord.
                </p>
              )}
            </div>
          )}

          <InstrumentCard
            instrument={instrument}
            onChange={(suivant) => { setInstrument(suivant); enregistrerInstrument(suivant); }}
            resolu={resoudreInstrument({
              analyse: analysis, titre: lecture?.ok ? lecture.titre : null, saisi: instrument,
            })}
          />

          {lecture && !lecture.ok && lecture.etape === 'echelle' && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2.5">
              <p className="text-[12px] text-slate-300 font-semibold">
                Saisis les deux prix extrêmes de l’axe
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Le prix tout en haut du graphique et celui tout en bas, lus sur l’axe de
                ta capture. Deux nombres suffisent : l’OCR devient inutile.
              </p>
              <div className="flex gap-2">
                <input
                  value={prixHaut} onChange={(e) => setPrixHaut(e.target.value)}
                  placeholder="prix en haut" inputMode="decimal"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-100 font-mono"
                />
                <input
                  value={prixBas} onChange={(e) => setPrixBas(e.target.value)}
                  placeholder="prix en bas" inputMode="decimal"
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[13px] text-slate-100 font-mono"
                />
              </div>
              <button
                onClick={() => runLecture({
                  prixHaut: Number(String(prixHaut).replace(',', '.')),
                  prixBas: Number(String(prixBas).replace(',', '.')),
                })}
                disabled={lectureEnCours || !prixHaut || !prixBas}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-semibold py-2.5 rounded-lg transition"
              >
                <Ruler className="w-4 h-4" />
                Relire avec cette échelle
              </button>
            </div>
          )}
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
      )}

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
    if (!provider.listModels) { setProbe(null); return; }

    let cancelled = false;
    setProbe({ state: 'checking' });

    provider.listModels(engine.baseUrl)
      .then((models) => { if (!cancelled) setProbe({ state: 'ok', models }); })
      .catch((err) => { if (!cancelled) setProbe({ state: 'error', message: err.message }); });

    return () => { cancelled = true; };
  }, [provider.listModels, engine.baseUrl]);

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
                {p.keyPolicy === 'requise' ? <Key className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                {p.label}
              </span>
              <span className="block text-[10px] text-slate-500 mt-1 leading-snug">{p.blurb}</span>
            </button>
          ))}
        </div>

        {provider.configurableEndpoint && (
          <label className="block mt-4">
            <span className="text-[11px] text-slate-500">{provider.endpoint}</span>
            <input
              value={engine.baseUrl}
              onChange={(e) => setEngine({ ...engine, baseUrl: e.target.value })}
              placeholder={provider.defaultBaseUrl}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 transition"
            />
          </label>
        )}

        {provider.presets && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {provider.presets.map((pr) => (
              <button
                key={pr.id}
                onClick={() => setEngine({ ...engine, baseUrl: pr.baseUrl, model: pr.modele })}
                title={pr.modele ? `Modèle : ${pr.modele}` : `Modèle à saisir : ${pr.aide}`}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${
                  engine.baseUrl === pr.baseUrl
                    ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                {pr.label}
              </button>
            ))}
          </div>
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

        {provider.keyPolicy !== 'aucune' && (
          <>
            <label className="block mt-4">
              <span className="text-[11px] text-slate-500">Clé API{provider.keyPolicy === 'optionnelle' ? ' (facultative)' : ''}</span>
              <div className="relative mt-1">
                <input
                  type={showKeyValue ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.keyPlaceholder}
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
              <code> {provider.envKey}</code>.
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
/**
 * Ce que la lecture géométrique a trouvé — ou l'étape où elle a buté.
 *
 * Nommer l'étape n'est pas un détail d'affichage : « l'axe n'a pas pu être
 * lu » et « aucune bougie trouvée » demandent deux gestes opposés de la part
 * de l'utilisateur.
 */
// Le modèle et la géométrie, côte à côte. Rien de tout cela n'est visible sans
// les deux lectures : c'est pour ça que la carte n'apparaît qu'alors.
function ConfrontationCard({ analysis, lecture, hauteurImage }) {
  const c = confronter(analysis, lecture, hauteurImage);
  if (!c) return null;
  const { axes, niveaux } = c;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wider text-cyan-400 font-semibold flex items-center gap-1.5">
        <GitCompare className="w-3.5 h-3.5" /> Modèle contre mesure
      </p>

      {axes ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-slate-400">Écart d’axe</span>
            <span
              className={`text-[13px] font-semibold tabular-nums ${
                c.axeDouteux ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {(axes.moyen * 100).toFixed(2)} % en moyenne · {(axes.pire * 100).toFixed(2)} % au pire
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-slate-500">
            <span>haut mesuré {axes.hautMesure.toFixed(2)}</span>
            <span>haut modèle {axes.hautModele.toFixed(2)}</span>
            <span>bas mesuré {axes.basMesure.toFixed(2)}</span>
            <span>bas modèle {axes.basModele.toFixed(2)}</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            {c.axeDouteux
              ? `Au-delà de ${(ECART_PREOCCUPANT * 100).toFixed(0)} % de l’étendue, le décalage dépasse de loin un stop : les niveaux du modèle visent à côté, même s’ils ont l’air justes.`
              : 'Les deux axes concordent — les niveaux du modèle portent bien sur les prix qu’il annonce.'}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          Le modèle n’a pas fourni de repère d’axe exploitable : rien à confronter.
        </p>
      )}

      {niveaux.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-slate-800 pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12px] text-slate-400">Niveaux sur une zone mesurée</span>
            <span className="text-[13px] text-slate-200 font-semibold tabular-nums">
              {c.appuyes} / {c.total}
            </span>
          </div>
          {niveaux.map((n) => (
            <div key={n.cle} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-slate-400">
                {n.libelle} <span className="font-mono text-slate-600">{n.prix.toFixed(2)}</span>
              </span>
              {n.dansUneZone ? (
                <span className="text-emerald-400">dans l’OB #{n.index}</span>
              ) : n.distance !== null ? (
                <span className="text-slate-500">
                  à {(n.distance * 100).toFixed(1)} % de l’OB #{n.index}
                </span>
              ) : (
                <span className="text-slate-600">aucune zone mesurée</span>
              )}
            </div>
          ))}
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Un niveau hors de toute zone n’est pas faux pour autant — il ne s’appuie
            simplement sur rien que l’image montre.
          </p>
        </div>
      )}
    </div>
  );
}

// L'instrument retenu, et d'où il vient.
//
// La provenance est affichée, pas seulement la valeur. Un symbole « saisi »
// est le dernier recours : il décrit ce qu'on regardait la fois d'avant, pas
// forcément la capture en cours. Le montrer est la seule protection contre
// un journal qui range une analyse de l'or sous BTCUSD, erreur qui ne se voit
// qu'au moment où l'on croit relire ses propres résultats.
function InstrumentCard({ instrument, onChange, resolu }) {
  const couleurs = { modèle: 'text-emerald-400', bandeau: 'text-indigo-400', saisi: 'text-amber-400' };
  const ligne = (libelle, champ) => (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-slate-500">{libelle}</span>
      {champ.valeur ? (
        <span className="text-slate-200 font-mono">
          {champ.valeur} <span className={couleurs[champ.source] ?? 'text-slate-600'}>· {champ.source}</span>
        </span>
      ) : (
        <span className="text-slate-600">non résolu</span>
      )}
    </div>
  );

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
        <LineChart className="w-3.5 h-3.5" /> Instrument
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Symbole</span>
          <input
            value={instrument.symbole ?? ''}
            onChange={(e) => onChange({ ...instrument, symbole: e.target.value })}
            placeholder="ex. BTCUSD"
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-200 font-mono
                       focus:outline-none focus:border-indigo-600"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Unité de temps</span>
          <input
            value={instrument.unite ?? ''}
            onChange={(e) => onChange({ ...instrument, unite: e.target.value })}
            placeholder="ex. 15m"
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[12px] text-slate-200 font-mono
                       focus:outline-none focus:border-indigo-600"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 border-t border-slate-800 pt-2.5">
        {ligne('Retenu pour le journal', resolu.symbole)}
        {ligne('Horizon', resolu.unite)}
      </div>

      {/* Un champ vide affichant « BTCUSD » en exemple se lit comme un champ
          rempli : la ligne de résolution disait « non résolu » juste en
          dessous, et l'avertissement d'enregistrement répétait qu'aucun
          symbole n'était connu — sans que ni l'un ni l'autre ne soit cru,
          puisque la valeur semblait là. On le dit donc à l'endroit où
          l'erreur se commet, pas seulement en aval. */}
      {!instrument.symbole && (
        <p className="text-[11px] text-amber-400 leading-relaxed">
          Le champ est <strong>vide</strong> — « ex. BTCUSD » n’est qu’un exemple. Tape
          le symbole de ta capture pour qu’il serve.
        </p>
      )}

      <p className="text-[11px] text-slate-600 leading-relaxed">
        Sans symbole, le journal ne sait pas quelles bougies aller chercher : l’issue
        n’est jamais constatée et le plan reste « en cours » indéfiniment. La saisie ne
        sert qu’en dernier recours, quand ni le modèle ni le bandeau n’ont su lire.
      </p>
    </div>
  );
}

function LectureCard({ lecture }) {
  if (!lecture.ok) {
    const geste = {
      palette: 'Vérifie que la capture montre bien des chandeliers, pas une courbe.',
      zone: 'Recadre sur le graphique seul, sans la barre d’outils.',
      // Rien lu : le geste est de recadrer, pas d'agrandir. Agrandir une
      // capture qui ne contient pas l'axe ne fera jamais apparaître l'axe.
      echelle: (lecture.etiquettes?.length ?? 0) === 0
        ? 'Reprends la capture en incluant la colonne de prix, à droite du graphique.'
        : 'Agrandis la capture, ou dézoome l’axe pour afficher plus de graduations.',
      bougies: 'Le tracé a été trouvé mais reste vide : vérifie le recadrage.',
    }[lecture.etape];

    return (
      <div className="bg-slate-900/60 border border-rose-900/50 rounded-xl p-4 flex flex-col gap-2">
        <p className="text-[11px] uppercase tracking-wider text-rose-400 font-semibold">
          Lecture interrompue — étape « {lecture.etape} »
        </p>
        <p className="text-[13px] text-slate-300 leading-relaxed">{lecture.probleme}</p>
        {geste && <p className="text-[12px] text-slate-500 leading-relaxed">{geste}</p>}
        {lecture.etiquettes?.length > 0 && (
          <p className="text-[11px] text-slate-600 font-mono">
            lu sur l’axe : {lecture.etiquettes.map((e) => e.texte).join(' · ')}
          </p>
        )}
      </div>
    );
  }

  const { bougies, zone, convention, analyses } = lecture;
  const obs = analyses.orderBlocks;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wider text-indigo-400 font-semibold flex items-center gap-1.5">
        <Ruler className="w-3.5 h-3.5" /> Mesuré sur l’image
      </p>

      {(lecture.titre?.symbole || lecture.titre?.unite) && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-slate-200 font-semibold">{lecture.titre.symbole ?? '—'}</span>
          <span className="text-slate-500">{lecture.titre.unite ?? 'unité non lue'}</span>
          <span className="text-[10px] text-slate-600">lu sur le bandeau</span>
        </div>
      )}
      {lecture.titre && !lecture.titre.symbole && (
        <p className="text-[11px] text-amber-400">
          Symbole non reconnu sur le bandeau — l’issue devra être saisie à la main.
          {lecture.titre.texte && (
            <span className="text-slate-600 font-mono"> lu : « {lecture.titre.texte.slice(0, 60)} »</span>
          )}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <span className="text-slate-500">Bougies</span>
          <p className="text-slate-200 font-semibold tabular-nums">{bougies.length}</p>
        </div>
        <div>
          <span className="text-slate-500">Cassures</span>
          <p className="text-slate-200 font-semibold tabular-nums">{analyses.cassures.length}</p>
        </div>
        <div>
          <span className="text-slate-500">Order blocks</span>
          <p className="text-slate-200 font-semibold tabular-nums">{obs.length}</p>
        </div>
      </div>

      <p className="text-[11px] text-slate-600">
        axe lu en convention « {convention} » · panneau de volume {zone.avecVolume ? 'détecté' : 'absent'}
        {analyses.rejetes > 0 && ` · ${analyses.rejetes} candidat(s) écarté(s)`}
      </p>

      {!analyses.assezDeBougies && (
        <p className="text-[12px] text-amber-400">
          Trop peu de bougies pour chercher une structure. Dézoome la capture.
        </p>
      )}

      {obs.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
          {obs.slice(0, 4).map((ob, i) => {
            const q = ob.qualificatifs;
            const marques = [
              q.priseDeLiquidite && 'prise de liquidité',
              q.fvg && 'FVG dans l’impulsion',
              q.premiumDiscount?.enZoneFavorable && 'zone favorable',
              q.premiumDiscount?.ote && 'OTE',
            ].filter(Boolean);
            return (
              <div key={i} className="flex flex-col gap-1">
                <p className="text-[12px] text-slate-200 font-semibold">
                  OB {ob.sens ?? ''} — bougie {ob.index}
                </p>
                <p className="text-[11px] text-slate-500">
                  {marques.length ? marques.join(' · ') : 'aucun qualificatif'}
                </p>
                {q.etoiles ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[11px] text-amber-300 tabular-nums">
                      {'★'.repeat(q.etoiles.nombre)}{'☆'.repeat(5 - q.etoiles.nombre)}{' '}
                      <span className="text-slate-400">{q.etoiles.nombre} / 5 critères</span>
                    </p>
                    <ul className="text-[11px] leading-snug">
                      {q.etoiles.criteres.map((c) => (
                        <li key={c.cle} className={c.rempli ? 'text-emerald-400' : 'text-slate-500'}>
                          {c.rempli ? '✓' : '✗'} {c.libelle} — {c.phrase}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600">étoiles non calculables sur cette série</p>
                )}
              </div>
            );
          })}
          {obs.length > 4 && (
            <p className="text-[11px] text-slate-600">et {obs.length - 4} autre(s)</p>
          )}
          <p className="text-[10px] text-slate-600 leading-relaxed">
            Les étoiles comptent des critères, elles ne mesurent rien : HYP-004 n’a trouvé
            aucun avantage aux OB 5 étoiles face au hasard (p = 0,184).
          </p>
        </div>
      )}

      <p className="text-[10px] text-slate-600 leading-relaxed border-t border-slate-800 pt-2.5">
        Mesuré, pas interprété : aucun modèle n’intervient ici. Les prix sont justes à
        deux pixels près, soit la précision que porte l’image.
      </p>
    </div>
  );
}

function RiskCard({ analysis }) {
  const verdict = rrVerdict(analysis.rr);
  const breakEven = breakEvenRate(analysis.rr);
  const avecFrais = breakEvenRate(analysis.rr, FRICTION_PAR_DEFAUT);

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

      {avecFrais !== null && (
        avecFrais > 1 ? (
          <p className="text-[11px] mt-1 text-rose-300 font-semibold">
            Frais compris, aucun taux de réussite ne rend ce plan rentable : le ratio ne
            couvre même pas l'aller-retour.
          </p>
        ) : (
          <p className="text-[11px] mt-1 text-amber-400">
            Frais compris, il en faut {(avecFrais * 100).toFixed(0)} %.{' '}
            <span className="text-slate-600">
              friction supposée {FRICTION_PAR_DEFAUT} R — mesurée sur l'or en 15 min (DEC-034),
              à remesurer sur ton marché.
            </span>
          </p>
        )
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
/**
 * Une zone d'order block, telle qu'elle a été MESURÉE sur l'image.
 *
 * Volontairement discrète : un fond très transparent et un liseré. Ces zones
 * courent jusqu'au bord droit et se chevauchent souvent ; peintes en opaque,
 * elles masqueraient les bougies qu'elles servent à expliquer.
 */
function dessinerZone(ctx, rect) {
  const couleur = rect.sens === 'baissier' ? '239, 83, 80' : '38, 166, 154';
  ctx.save();

  ctx.fillStyle = `rgba(${couleur}, 0.13)`;
  ctx.fillRect(rect.x, rect.y, rect.largeur, rect.hauteur);

  ctx.strokeStyle = `rgba(${couleur}, 0.85)`;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rect.x, rect.y, rect.largeur, rect.hauteur);

  // Le bord gauche marque la bougie d'ancrage : c'est elle, l'order block.
  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.moveTo(rect.x, rect.y);
  ctx.lineTo(rect.x, rect.y + rect.hauteur);
  ctx.stroke();

  const texte = etiquetteDuRectangle(rect);
  ctx.font = 'bold 12px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  const largeurTexte = ctx.measureText(texte).width + 12;
  const yTexte = rect.y > 18 ? rect.y - 3 : rect.y + rect.hauteur + 15;

  ctx.fillStyle = `rgba(${couleur}, 0.92)`;
  ctx.fillRect(rect.x, yTexte - 14, largeurTexte, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(texte, rect.x + 6, yTexte);

  ctx.restore();
}

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
