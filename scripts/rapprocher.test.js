import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { minutesDeLUnite, finSupposee, rendreRapport } from './rapprocher.mjs';

const PAS = 15 * 60_000;
const FIN = Date.UTC(2026, 9, 3, 13, 0, 0);

/** Un CSV comme TradingView l'exporte, et la mesure qui devrait lui répondre. */
async function materiel({ biais = 0, n = 80 } = {}) {
  const dossier = await mkdtemp(join(tmpdir(), 'rapprocher-'));
  const lignes = ['time,open,high,low,close,Volume'];
  const bougies = [];

  for (let i = 0; i < n; i++) {
    const t = FIN - (n - 1 - i) * PAS;
    const o = 84000 + i * 4 + 60 * Math.sin(i / 6.1);
    const b = { ouverture: o, cloture: o + 7, plusHaut: o + 22, plusBas: o - 15 };
    lignes.push(`${new Date(t).toISOString()},${b.ouverture},${b.plusHaut},${b.plusBas},${b.cloture},100`);
    bougies.push(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v + biais])));
  }

  const csv = join(dossier, 'export.csv');
  await writeFile(csv, lignes.join('\n'), 'utf8');

  const mesure = join(dossier, 'mesure.json');
  await writeFile(mesure, JSON.stringify({
    type: 'mesure',
    horodatage: new Date(FIN + 40_000).toISOString(),   // enregistrée APRÈS la capture
    marche: { symbole: 'BTCUSD', uniteTemps: '15m' },
    mesure: {
      nombreDeBougies: n,
      echelleDesPrix: { prixEnHautDuTrace: 84800, prixEnBasDuTrace: 83900, hauteurTraceEnPixels: 780 },
      bougies,
    },
  }, null, 2), 'utf8');

  return { csv, mesure };
}

const lancer = (args) => execFileSync('node', ['scripts/rapprocher.mjs', ...args], { encoding: 'utf8' });

describe('minutesDeLUnite', () => {
  it('traduit les unités que porte un enregistrement', () => {
    expect(minutesDeLUnite('15m')).toBe(15);
    expect(minutesDeLUnite('1h')).toBe(60);
    expect(minutesDeLUnite('bientôt')).toBeNull();
  });
});

describe('finSupposee', () => {
  it('part de l’horodatage de l’enregistrement', () => {
    expect(finSupposee({ horodatage: '2026-10-03T13:00:00Z' })).toBe(FIN);
  });

  it('accepte une surcharge explicite', () => {
    expect(finSupposee({ horodatage: '2026-10-03T13:00:00Z' }, '2026-10-03T12:00:00Z')).toBe(FIN - 3600_000);
  });

  it('refuse plutôt que de deviner', () => {
    expect(() => finSupposee({})).toThrow(/horodatage lisible/);
    expect(() => finSupposee({ horodatage: '2026-10-03T13:00:00Z' }, 'hier')).toThrow(/pas une date lisible/);
  });
});

describe('la chaîne complète, en ligne de commande', () => {
  it('ne trouve aucun biais sur une lecture juste', async () => {
    const { csv, mesure } = await materiel();
    const sortie = lancer(['--mesure', mesure, '--csv', csv, '--ut', '15m']);
    expect(sortie).toMatch(/BTCUSD · 15m/);
    expect(sortie).toMatch(/80 bougies appariées sur 80/);
    expect(sortie).not.toMatch(/ATTENTION/);
  });

  it('ALERTE sur une échelle faussée, et la nomme', async () => {
    // Le cas qui justifie tout ce script. Une échelle décalée de 40 points —
    // près de huit pixels — produit des bougies parfaitement vraisemblables :
    // bonne forme, bonne amplitude, bons écarts entre elles. Rien dans l'image
    // ne peut le dire. Seule une référence extérieure le peut.
    const { csv, mesure } = await materiel({ biais: 40 });
    const sortie = lancer(['--mesure', mesure, '--csv', csv, '--ut', '15m']);
    expect(sortie).toMatch(/ATTENTION/);
    expect(sortie).toMatch(/échelle lue sur l’axe est probablement décalée/);
    for (const prix of ['ouverture', 'clôture', 'plus haut', 'plus bas']) {
      expect(sortie, prix).toMatch(new RegExp(prix));
    }
  });

  it('rattrape le retard entre la capture et son enregistrement', async () => {
    // L'horodatage du journal est postérieur de quarante secondes à la
    // capture. Compter ça comme une erreur de lecture serait absurde.
    const { csv, mesure } = await materiel();
    expect(lancer(['--mesure', mesure, '--csv', csv, '--ut', '15m'])).toMatch(/décalage 0 bougie/);
  });

  it('dit ce qui manque au lieu de planter', () => {
    expect(() => lancer([])).toThrow();
    const essai = () => execFileSync('node', ['scripts/rapprocher.mjs'], { encoding: 'utf8', stdio: 'pipe' });
    expect(essai).toThrow(/Usage|Command failed/);
  });
});

describe('rendreRapport', () => {
  it('dit en PIXELS, pas seulement en points', () => {
    // Un écart de cinq points ne veut rien dire tout seul. Rapporté au pixel,
    // il devient soit « sous la résolution de l'image », soit « à expliquer ».
    const r = {
      ok: true, nombreApparie: 50, decalage: 0, niveauMedian: 84000,
      parChamp: Object.fromEntries(['ouverture', 'cloture', 'plusHaut', 'plusBas']
        .map((c) => [c, { n: 50, ecartMedian: 5, ecartPire: 12, biaisMedian: 0.2 }])),
      enPourcent: {},
    };
    const texte = rendreRapport(r, { mesure: { nombreDeBougies: 50 }, unite: '15m', parPixel: 5 });
    expect(texte).toMatch(/un pixel vaut 5\.00/);
    expect(texte).toMatch(/en pixels/);
    expect(texte).not.toMatch(/ATTENTION/);
  });

  it('rend l’échec lisible plutôt qu’un objet vide', () => {
    const texte = rendreRapport({ ok: false, probleme: 'rien ne coïncide' }, { mesure: {}, unite: '15m' });
    expect(texte).toMatch(/ÉCHEC — rien ne coïncide/);
  });
});
