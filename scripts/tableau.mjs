// Un gros volume apparaît. Que fait le graphique ensuite ?
//
//   node scripts/tableau.mjs --csv GC_2023_2024.csv --symbole GC
//
// C'est la question du projet, et rien d'autre. Les planches de
// `inspecter.mjs` montrent l'image ; ce script met les CHIFFRES à côté, sur
// une seule page qu'on fait défiler.
//
// Pour chaque évènement : combien de contrats, combien de fois la normale, et
// ce que le prix a fait après — en dollars, pas en ratios. Monté de combien,
// descendu de combien, en combien de temps.
//
// Aucune moyenne, aucun test, aucun verdict. Cent lignes brutes qu'on lit.

import { readFile, writeFile } from 'node:fs/promises';

import { analyser as analyserCsv, agreger as agregerBougies } from '../src/lib/marche/csv.js';
import { dureeUnite, UNITES } from '../src/lib/marche/bougies.js';
import { decouperParContrat } from '../src/lib/marche/contrats.js';
import { scorerSegment, mediane } from '../src/lib/marche/anomalies.js';
import { parseArgs } from './backtest.mjs';

const DEFAUTS = { ut: '15m', utCsv: '1m', fenetre: 60, apres: 96, nombre: 60, sortie: 'tableau.html' };

export function validerOptions(args) {
  const o = { ...DEFAUTS };
  const erreurs = [];
  if (typeof args.csv !== 'string') erreurs.push('--csv attend un chemin de fichier');
  else o.csv = args.csv;
  for (const [option, cle] of [['--ut', 'ut'], ['--ut-csv', 'utCsv']]) {
    if (args[cle] === undefined) continue;
    if (!UNITES[args[cle]]) erreurs.push(`${option} "${args[cle]}" inconnue`);
    else o[cle] = args[cle];
  }
  for (const [option, cle, min] of [['--apres', 'apres', 1], ['--nombre', 'nombre', 1], ['--fenetre', 'fenetre', 20]]) {
    if (args[cle] === undefined) continue;
    const n = Number(args[cle]);
    if (!Number.isFinite(n) || n < min) erreurs.push(`${option} attend un nombre ≥ ${min}`);
    else o[cle] = n;
  }
  if (typeof args.sortie === 'string') o.sortie = args.sortie;
  if (typeof args.planches === 'string') o.planches = args.planches;
  o.symbole = typeof args.symbole === 'string' ? args.symbole.toUpperCase() : 'INSTRUMENT';
  return erreurs.length ? { erreurs } : o;
}

/**
 * Ce que le prix fait APRÈS la bougie, en unités de prix.
 *
 * Le point de départ est la CLÔTURE de la bougie signalée : c'est le premier
 * prix auquel on aurait pu agir en la voyant. Partir de son ouverture ferait
 * compter comme « après » un mouvement déjà terminé quand l'alerte tombe.
 */
export function apresEnPrix(bougies, index, nombre) {
  const depart = bougies[index].cloture;
  const suite = bougies.slice(index + 1, index + 1 + nombre);
  if (!suite.length) return null;

  let hautMax = -Infinity; let basMin = Infinity;
  let bougiesHaut = 0; let bougiesBas = 0;
  for (const [i, b] of suite.entries()) {
    if (b.plusHaut > hautMax) { hautMax = b.plusHaut; bougiesHaut = i + 1; }
    if (b.plusBas < basMin) { basMin = b.plusBas; bougiesBas = i + 1; }
  }
  return {
    depart,
    monte: hautMax - depart,
    descend: depart - basMin,
    bougiesHaut,
    bougiesBas,
    cloture: suite.at(-1).cloture,
    net: suite.at(-1).cloture - depart,
    complet: suite.length === nombre,
  };
}

const ech = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export function construirePage(lignes, { symbole, ut, apres, medianeVolume, dureeApresH }) {
  const corps = lignes.map((l) => {
    const sens = l.hausse ? 'hausse' : 'baisse';
    const img = l.planche ? `<img src="${ech(l.planche)}" alt="" loading="lazy">` : '<div class="sans">planche absente</div>';
    return `<article>
  <header>
    <span class="date">${ech(iso(l.ms))}</span>
    <span class="vol">${l.volume.toLocaleString('fr-FR')} contrats</span>
    <span class="fois">${l.ratio.toFixed(1)}× la normale</span>
    <span class="bougie ${sens}">bougie ${sens} de ${Math.abs(l.corps).toFixed(2)} $</span>
  </header>
  ${img}
  <table>
    <tr><th>monte ensuite de</th><td class="haut">${n2(l.monte)} $</td><td class="quand">après ${l.bougiesHaut} bougies</td></tr>
    <tr><th>descend ensuite de</th><td class="bas">−${l.descend.toFixed(2)} $</td><td class="quand">après ${l.bougiesBas} bougies</td></tr>
    <tr><th>au bout de ${dureeApresH} h</th><td class="${l.net >= 0 ? 'haut' : 'bas'}">${n2(l.net)} $</td><td class="quand">${l.complet ? '' : 'horizon tronqué'}</td></tr>
  </table>
</article>`;
  }).join('\n');

  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<title>${ech(symbole)} — volume et graphique</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark;--fond:#0d1117;--carte:#161b22;--trait:#30363d;--texte:#e6edf3;--gris:#8b949e;--haut:#3fb950;--bas:#f85149;--or:#d29922}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--fond);color:var(--texte);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}
.intro{color:var(--gris);max-width:70ch;margin:0 0 24px}
.intro strong{color:var(--texte)}
article{background:var(--carte);border:1px solid var(--trait);border-radius:10px;padding:14px;margin:0 0 20px;max-width:1240px}
header{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;margin-bottom:10px}
.date{font-variant-numeric:tabular-nums;color:var(--gris)}
.vol{font-weight:600;font-size:17px}
.fois{color:var(--or);font-weight:600}
.bougie{font-size:13px;padding:1px 8px;border-radius:99px;border:1px solid var(--trait)}
.bougie.hausse{color:var(--haut)}.bougie.baisse{color:var(--bas)}
img{width:100%;height:auto;border-radius:6px;display:block;background:#0a0e14}
.sans{padding:40px;text-align:center;color:var(--gris);border:1px dashed var(--trait);border-radius:6px}
table{width:100%;border-collapse:collapse;margin-top:10px;font-variant-numeric:tabular-nums}
th{text-align:left;font-weight:400;color:var(--gris);padding:5px 0;width:15em}
td{padding:5px 0;font-weight:600}
td.haut{color:var(--haut)}td.bas{color:var(--bas)}
td.quand{font-weight:400;color:var(--gris);text-align:right}
@media(max-width:640px){th{width:auto}td.quand{display:none}}
</style>
<h1>${ech(symbole)} · ${ech(ut)} · ${lignes.length} évènements de volume</h1>
<p class="intro">Classés du plus gros volume au plus petit. La bougie signalée porte le bandeau jaune ;
ce qui la suit est éclairci. <strong>« Monte » et « descend » partent de sa clôture</strong> — le premier
prix auquel on aurait pu agir en la voyant — et couvrent les ${apres} bougies suivantes, soit ${dureeApresH} heures.
Volume normal de référence : <strong>${medianeVolume.toLocaleString('fr-FR')} contrats</strong> par bougie.</p>
${corps}
</html>`;
}

async function principal() {
  const o = validerOptions(parseArgs(process.argv.slice(2)));
  if (o.erreurs) {
    console.error('\nArguments invalides :');
    for (const e of o.erreurs) console.error('  - ' + e);
    console.error('\nExemple :\n  node scripts/tableau.mjs --csv GC_2023_2024.csv --symbole GC\n');
    process.exit(1);
  }

  process.stdout.write(`\nlecture de ${o.csv}… `);
  const { bougies: fines, volumeExploitable } = analyserCsv(await readFile(o.csv, 'utf8'), { unite: o.utCsv });
  console.log(`${fines.length} bougies ${o.utCsv}`);
  if (!volumeExploitable) { console.error('\nÉchec : ce fichier ne porte pas de volume réel.\n'); process.exit(2); }

  const { segments } = decouperParContrat(fines);
  const candidats = [];
  const volumes = [];

  for (const segment of segments) {
    const serie = dureeUnite(o.ut) === dureeUnite(o.utCsv) ? segment.bougies : agregerBougies(segment.bougies, o.ut);
    for (const b of serie) volumes.push(b.volume || 0);
    for (const s of scorerSegment(serie, { fenetre: o.fenetre })) {
      if (!s.scores.picVolume) continue;
      const suite = apresEnPrix(serie, s.index, o.apres);
      if (!suite) continue;
      const b = serie[s.index];
      candidats.push({
        ms: b.ouvertureMs, volume: b.volume || 0, ratio: s.mesures.ratioVolume,
        hausse: b.cloture > b.ouverture, corps: b.cloture - b.ouverture, ...suite,
      });
    }
  }

  const medianeVolume = Math.round(mediane(volumes.filter((v) => v > 0)) || 0);
  candidats.sort((a, b) => b.volume - a.volume);
  const retenus = candidats.slice(0, o.nombre);

  // Les planches produites par inspecter.mjs, si elles sont là : le nom porte
  // l'horodatage, ce qui suffit à les apparier sans index supplémentaire.
  if (o.planches) {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    let fichiers = [];
    try { fichiers = await readdir(o.planches); } catch { console.log(`(dossier ${o.planches} introuvable, page sans images)`); }
    for (const l of retenus) {
      const cle = iso(l.ms).replace(/[: ]/g, '-');
      const trouve = fichiers.find((f) => f.includes(cle));
      if (trouve) l.planche = join(o.planches, trouve).replace(/\\/g, '/');
    }
  }

  const dureeApresH = Math.round((o.apres * dureeUnite(o.ut)) / 3_600_000);
  const page = construirePage(retenus, { symbole: o.symbole, ut: o.ut, apres: o.apres, medianeVolume, dureeApresH });
  await writeFile(o.sortie, page);

  const avecImage = retenus.filter((l) => l.planche).length;
  console.log(`${candidats.length} évènements de volume · ${retenus.length} retenus · ${avecImage} avec planche`);
  console.log(`volume normal de référence : ${medianeVolume.toLocaleString('fr-FR')} contrats\n`);
  console.log(`Page écrite : ${o.sortie}`);
  console.log('Ouvre-la dans ton navigateur : chaque évènement porte son volume et ce que le prix a fait après.\n');
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] || '').href) {
  principal().catch((err) => { console.error('\nÉchec : ' + err.message + '\n'); process.exitCode = 1; });
}
