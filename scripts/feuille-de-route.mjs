// Régénère docs/feuille-de-route.html depuis docs/FEUILLE-DE-ROUTE.md.
//   npm run feuille
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { feuilleEnHtml } from '../src/lib/feuille-html.js';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
writeFileSync(`${docs}feuille-de-route.html`, feuilleEnHtml(readFileSync(`${docs}FEUILLE-DE-ROUTE.md`, 'utf8')));
console.log('docs/feuille-de-route.html régénérée.');
