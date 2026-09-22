// Banc d'essai : lequel de tes modeles Ollama sait lire un axe de prix ?
//
// Envoie un graphique de reference a chaque modele de vision installe et
// compare le repere de prix qu'il renvoie au repere reel ayant servi a tracer
// l'image (scripts/make-samples.mjs).
//
// L'indicateur qui compte est la DERIVE : de combien de pixels une ligne de
// niveau serait mal placee si on faisait confiance a ce modele.
//
//   node scripts/bench-vision.mjs
//   node scripts/bench-vision.mjs --models qwen2.5vl:7b,llava:13b
//   node scripts/bench-vision.mjs --image public/samples/eurusd-h1.png

import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { ANALYSIS_SCHEMA, ANALYSIS_PROMPT, parseAnalysisJson } from '../src/lib/providers/schema.js';

const PLOT_TOP = 0.057143;
const PLOT_BOTTOM = 0.885714;
const HEIGHT = 700;

// Repere reel de chaque image de reference.
const TRUTH = {
  'btc-m15.png':   { priceTop: 65800, priceBottom: 63600, levels: [63850, 64200, 64900, 65600] },
  'eurusd-h1.png': { priceTop: 1.092, priceBottom: 1.069, levels: [1.072, 1.079, 1.085, 1.0885] },
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
const imagePath = resolve(args.image || 'public/samples/btc-m15.png');
const imageName = basename(imagePath);

const truth = TRUTH[imageName];
if (!truth) {
  fail(`Pas de reference connue pour "${imageName}". Utilise btc-m15.png ou eurusd-h1.png.`);
}

const b64 = readFileSync(imagePath).toString('base64');

console.log(`\nImage de reference : ${imageName}`);
console.log(`Verite terrain     : haut ${truth.priceTop}  bas ${truth.priceBottom}\n`);

const models = args.models ? args.models.split(',').map((s) => s.trim()) : await detectVisionModels();
if (!models.length) {
  fail('Aucun modele de vision detecte. Force la liste avec --models ton-modele');
}

const results = [];

for (const model of models) {
  process.stdout.write(`-> ${model.padEnd(28)}`);
  const started = Date.now();

  let raw;
  try {
    raw = await askModel(model, b64);
  } catch (err) {
    console.log(`ECHEC : ${err.message}`);
    results.push({ model, note: err.message });
    continue;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  let data;
  try {
    data = parseAnalysisJson(raw);
  } catch {
    console.log(`JSON illisible          (${seconds}s)`);
    results.push({ model, seconds, note: 'JSON illisible' });
    continue;
  }

  const drift = computeDrift(data.scale, truth);
  if (drift === null) {
    console.log(`repere de prix invalide (${seconds}s)`);
    results.push({ model, seconds, note: 'repere invalide' });
    continue;
  }

  const coherent = isCoherent(data);
  console.log(`derive ${drift.toFixed(1).padStart(7)} px  (${seconds}s)`);
  console.log(
    `   ${' '.repeat(28)}lu : haut ${data.scale.priceTop}  bas ${data.scale.priceBottom}` +
    `  |  coherent : ${coherent ? 'oui' : 'NON'}`
  );

  results.push({ model, seconds, drift, coherent, lu: `${data.scale.priceTop} / ${data.scale.priceBottom}` });
}

report(results);

// ---------------------------------------------------------------------------

function computeDrift(scale, truth) {
  if (!scale) return null;
  const { priceTop, priceBottom, plotTopRatio, plotBottomRatio } = scale;

  const numbers = [priceTop, priceBottom, plotTopRatio, plotBottomRatio];
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  if (priceTop <= priceBottom || plotTopRatio >= plotBottomRatio) return null;

  const y = (p, top, bottom, pTop, pBottom) =>
    (pTop + ((top - p) / (top - bottom)) * (pBottom - pTop)) * HEIGHT;

  let max = 0;
  for (const price of truth.levels) {
    const expected = y(price, truth.priceTop, truth.priceBottom, PLOT_TOP, PLOT_BOTTOM);
    const got = y(price, priceTop, priceBottom, plotTopRatio, plotBottomRatio);
    max = Math.max(max, Math.abs(expected - got));
  }
  return max;
}

function isCoherent(a) {
  if (a.direction === 'BUY') return a.stopLoss < a.entry && a.entry < a.tp1 && a.tp1 < a.tp2;
  if (a.direction === 'SELL') return a.stopLoss > a.entry && a.entry > a.tp1 && a.tp1 > a.tp2;
  return false;
}

async function askModel(model, image) {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: ANALYSIS_SCHEMA,
        options: { temperature: 0.2 },
        messages: [{ role: 'user', content: ANALYSIS_PROMPT, images: [image] }],
      }),
    });
  } catch {
    throw new Error(`Ollama injoignable sur ${baseUrl} (ollama serve ?)`);
  }

  if (!response.ok) {
    if (response.status === 404) throw new Error(`modele absent (ollama pull ${model})`);
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json())?.message?.content;
}

async function detectVisionModels() {
  process.stdout.write('Recherche des modeles de vision installes...\n');

  let tags;
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    tags = await response.json();
  } catch {
    fail(`Ollama injoignable sur ${baseUrl}. Lance "ollama serve".`);
  }

  const names = (tags?.models || []).map((m) => m.name);
  const vision = [];

  for (const name of names) {
    try {
      const response = await fetch(`${baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      const info = await response.json();

      // Ollama recent expose "capabilities". Sinon on se rabat sur les
      // marqueurs de projecteur d'image presents dans les details.
      const capable =
        (info?.capabilities || []).includes('vision') ||
        JSON.stringify(info?.details || {}).match(/clip|vision|mmproj/i);

      if (capable) vision.push(name);
    } catch {
      // modele illisible : on l'ignore plutot que d'interrompre
    }
  }

  console.log(`Installes : ${names.length}  |  vision : ${vision.join(', ') || 'aucun'}\n`);
  return vision;
}

function report(results) {
  const ok = results.filter((r) => typeof r.drift === 'number').sort((a, b) => a.drift - b.drift);
  const ko = results.filter((r) => typeof r.drift !== 'number');

  console.log('\n=== Classement (derive croissante) ===\n');
  if (ok.length) {
    console.table(ok.map((r) => ({
      Modele: r.model,
      'Derive (px)': r.drift.toFixed(1),
      Secondes: r.seconds,
      Coherent: r.coherent ? 'oui' : 'NON',
      'Lu haut/bas': r.lu,
    })));
  } else {
    console.log('  aucun modele exploitable\n');
  }

  if (ko.length) {
    console.log('Echecs :');
    for (const r of ko) console.log(`  ${r.model.padEnd(28)} ${r.note}`);
    console.log('');
  }

  console.log('Derive = de combien de pixels une ligne de niveau serait mal placee.');
  console.log('  < 10 px  utilisable      10-40 px  approximatif      > 40 px  inexploitable\n');

  if (ok.length && ok[0].drift < 10) {
    console.log(`Recommande : ${ok[0].model}\n`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) out[camel(argv[i].slice(2))] = argv[i + 1];
  }
  return out;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
