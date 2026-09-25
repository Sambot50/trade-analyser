import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ICI = dirname(fileURLToPath(import.meta.url));

// Un script exécutable se termine par une garde qui distingue « lancé en
// ligne de commande » de « importé par un test ». Écrite naïvement —
// `file://${process.argv[1]}` — elle est VRAIE sous Linux et FAUSSE sous
// Windows, où argv[1] vaut `C:\chemin\script.mjs` quand import.meta.url vaut
// `file:///C:/chemin/script.mjs`.
//
// Le script se charge alors, ne s'exécute pas, et sort avec le code 0. Aucun
// message, aucune erreur : la commande a l'air d'avoir marché. C'est arrivé,
// sur la machine de travail, et il a fallu le format d'une sortie vide pour
// s'en apercevoir.
//
// `pathToFileURL` fait la conversion correctement sur les deux systèmes.
const NAIF = /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/;

const scripts = readdirSync(ICI)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => [f, readFileSync(join(ICI, f), 'utf8')]);

describe('garde d’exécution des scripts', () => {
  it('trouve bien des scripts à vérifier', () => {
    expect(scripts.length).toBeGreaterThan(5);
  });

  it.each(scripts)('%s n’utilise pas la comparaison naïve, cassée sous Windows', (_nom, source) => {
    expect(NAIF.test(source)).toBe(false);
  });

  it.each(scripts.filter(([, s]) => s.includes('import.meta.url ===')))(
    '%s compare via pathToFileURL',
    (_nom, source) => {
      expect(source).toMatch(/pathToFileURL\(process\.argv\[1\]/);
    },
  );
});
