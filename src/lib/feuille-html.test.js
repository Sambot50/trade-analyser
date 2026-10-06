import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { feuilleEnHtml } from './feuille-html.js';

const lire = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('feuilleEnHtml', () => {
  it('rend les cases, cochées ou non, et l\'avancement', () => {
    const html = feuilleEnHtml('### E9 — Essai\n\n- [x] fait\n- [ ] à faire\n');
    expect(html).toContain('<li class="case faite"><span class="boite">✓</span><span>fait</span></li>');
    expect(html).toContain('<li class="case"><span class="boite"></span><span>à faire</span></li>');
    expect(html).toContain('<span class="compte">1/2</span>');
    expect(html).toContain('width:50%');
  });

  it('échappe le HTML du document', () => {
    expect(feuilleEnHtml('Un <script> et `a < b`')).toContain('Un &lt;script&gt; et <code>a &lt; b</code>');
  });

  it('la page versionnée correspond à sa source (sinon : npm run feuille)', () => {
    expect(lire('../../docs/feuille-de-route.html')).toBe(feuilleEnHtml(lire('../../docs/FEUILLE-DE-ROUTE.md')));
  });
});
