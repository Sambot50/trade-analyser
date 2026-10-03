import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { charger, prochainId } from './carnet.mjs';

const SCRIPT = fileURLToPath(new URL('./carnet.mjs', import.meta.url));
const neuf = () => join(mkdtempSync(join(tmpdir(), 'carnet-')), 'c.jsonl');
const lancer = (fichier, ...args) =>
  execFileSync(process.execPath, [SCRIPT, '--fichier', fichier, ...args], { encoding: 'utf8' });
const lignes = (f) => readFileSync(f, 'utf8').trim().split('\n');

describe('prochainId', () => {
  it('part de 1 et prend toujours un de plus que le plus grand vu', () => {
    expect(prochainId([])).toBe(1);
    expect(prochainId([{ id: 1 }, { id: 7 }, { id: 3 }])).toBe(8);
  });

  it('ignore les lignes sans identifiant exploitable', () => {
    expect(prochainId([{ id: 2 }, { id: 'sept' }, {}, { id: NaN }])).toBe(3);
  });
});

describe('charger', () => {
  it('rend un carnet vide plutôt qu’une erreur quand le fichier n’existe pas', async () => {
    const e = await charger(join(tmpdir(), 'carnet-inexistant-' + Date.now() + '.jsonl'));
    expect(e.fermes).toEqual([]);
    expect(e.ouverts).toEqual([]);
    expect(e.illisibles).toEqual([]);
  });

  it('reconstitue l’état en relisant les évènements', async () => {
    const f = neuf();
    writeFileSync(f, [
      '{"t":"ouverture","id":1,"sens":"achat","entree":100,"stop":10,"le":"2026-10-01T10:00:00.000Z"}',
      '{"t":"fermeture","id":1,"sortie":115,"le":"2026-10-01T14:00:00.000Z"}',
      '{"t":"ouverture","id":2,"sens":"vente","entree":200,"stop":20,"le":"2026-10-01T15:00:00.000Z"}',
    ].join('\n') + '\n');
    const e = await charger(f);
    expect(e.fermes).toHaveLength(1);
    expect(e.fermes[0].brut).toBeCloseTo(1.5, 9);
    expect(e.ouverts.map((o) => o.id)).toEqual([2]);
  });
});

describe('le fichier est en AJOUT SEUL', () => {
  // La garantie centrale de ce carnet. Un fichier que le script réécrirait
  // enregistrerait ce qu'on aurait voulu faire, pas ce qu'on a fait.
  it('n’altère jamais une ligne déjà écrite', () => {
    const f = neuf();
    lancer(f, '--ouvrir', '--sens', 'achat', '--entree', '100', '--stop', '10', '--marche', 'GC');
    const apresOuverture = lignes(f);
    expect(apresOuverture).toHaveLength(1);

    lancer(f, '--fermer', '1', '--sortie', '115', '--issue', 'objectif', '--frais', '0.5');
    const apresFermeture = lignes(f);
    expect(apresFermeture).toHaveLength(2);
    expect(apresFermeture[0]).toBe(apresOuverture[0]);          // intacte

    lancer(f, '--ouvrir', '--sens', 'vente', '--entree', '200', '--stop', '20');
    const final = lignes(f);
    expect(final).toHaveLength(3);
    expect(final.slice(0, 2)).toEqual(apresFermeture);          // intactes
  });

  it('enregistre le stop à l’OUVERTURE, avant que l’issue soit connue', () => {
    const f = neuf();
    lancer(f, '--ouvrir', '--sens', 'achat', '--entree', '100', '--stop', '10');
    const ouverture = JSON.parse(lignes(f)[0]);
    expect(ouverture.stop).toBe(10);
    expect(ouverture).not.toHaveProperty('sortie');
    expect(ouverture.le).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('garde-fous de la ligne de commande', () => {
  const echoue = (fn) => { try { fn(); return false; } catch { return true; } };

  it('refuse une ouverture sans sens, sans entrée ou sans stop', () => {
    const f = neuf();
    expect(echoue(() => lancer(f, '--ouvrir', '--entree', '100', '--stop', '10'))).toBe(true);
    expect(echoue(() => lancer(f, '--ouvrir', '--sens', 'achat', '--stop', '10'))).toBe(true);
    expect(echoue(() => lancer(f, '--ouvrir', '--sens', 'achat', '--entree', '100'))).toBe(true);
    expect(echoue(() => lancer(f, '--ouvrir', '--sens', 'long', '--entree', '100', '--stop', '10'))).toBe(true);
  });

  it('refuse de fermer un trade qui n’est pas ouvert', () => {
    const f = neuf();
    lancer(f, '--ouvrir', '--sens', 'achat', '--entree', '100', '--stop', '10');
    expect(echoue(() => lancer(f, '--fermer', '9', '--sortie', '115'))).toBe(true);
    lancer(f, '--fermer', '1', '--sortie', '115');
    expect(echoue(() => lancer(f, '--fermer', '1', '--sortie', '120'))).toBe(true);
  });
});

describe('le bilan affiché', () => {
  it('rappelle la barre, et refuse de conclure sous le minimum', () => {
    const f = neuf();
    lancer(f, '--ouvrir', '--sens', 'achat', '--entree', '100', '--stop', '10');
    lancer(f, '--fermer', '1', '--sortie', '115');
    const sortie = lancer(f);
    expect(sortie).toMatch(/0\.080 R/);
    expect(sortie).toMatch(/ne décrit rien/);
  });

  it('rapporte ce qui cloche sans rien corriger', () => {
    const f = neuf();
    writeFileSync(f, '{"t":"fermeture","id":9,"sortie":100}\n{pas du json\n');
    const sortie = lancer(f);
    expect(sortie).toMatch(/sans ouverture connue/);
    expect(sortie).toMatch(/illisible/);
    expect(sortie).toMatch(/ajout seul/);
  });
});
