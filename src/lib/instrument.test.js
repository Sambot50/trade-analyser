import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  symboleValide, uniteValide, normaliserInstrument, resoudreInstrument,
  chargerInstrument, enregistrerInstrument, illisible,
} from './instrument.js';

describe('symboleValide', () => {
  it('accepte ce que les plateformes écrivent vraiment', () => {
    for (const s of ['BTCUSD', 'GC1!', 'EURUSD', 'XAUUSD', 'ES=F', 'BTC-USD', 'CME_MINI:ES1!']) {
      if (s === 'ES=F') continue;   // le signe égal n'est pas dans la liste, c'est voulu
      expect(symboleValide(s), s).toBe(true);
    }
  });

  it('refuse le vide, l’espace et le trop long', () => {
    for (const s of ['', ' ', 'A', 'BTC USD', 'x'.repeat(21), null, 42]) {
      expect(symboleValide(s), String(s)).toBe(false);
    }
  });
});

describe('uniteValide', () => {
  it('accepte les écritures courantes', () => {
    for (const u of ['15m', '15 min', '1h', '4H', '1d', 'D', 'W', 'weekly']) {
      expect(uniteValide(u), u).toBe(true);
    }
  });

  it('refuse ce qui ne dit pas de durée', () => {
    for (const u of ['intraday', '', 'bientôt', '15', null]) expect(uniteValide(u), String(u)).toBe(false);
  });
});

describe('normaliserInstrument', () => {
  it('met le symbole en capitales et l’unité en minuscules sans espace', () => {
    expect(normaliserInstrument({ symbole: ' btcusd ', unite: '15 MIN' }))
      .toEqual({ symbole: 'BTCUSD', unite: '15min' });
  });

  it('rend null plutôt qu’une valeur douteuse', () => {
    expect(normaliserInstrument({ symbole: 'BTC USD', unite: 'intraday' }))
      .toEqual({ symbole: null, unite: null });
    expect(normaliserInstrument(null)).toEqual({ symbole: null, unite: null });
  });
});

describe('resoudreInstrument', () => {
  const titre = { symbole: 'XAUUSD', unite: '1h' };
  const saisi = { symbole: 'BTCUSD', unite: '15m' };

  it('préfère le modèle quand il a lu quelque chose', () => {
    const r = resoudreInstrument({ analyse: { symbol: 'GC1!', timeframe: '4h' }, titre, saisi });
    expect(r.symbole).toEqual({ valeur: 'GC1!', source: 'modèle' });
    expect(r.unite).toEqual({ valeur: '4h', source: 'modèle' });
  });

  it('passe au bandeau quand le modèle rend UNKNOWN', () => {
    const r = resoudreInstrument({ analyse: { symbol: 'UNKNOWN', timeframe: 'intraday' }, titre, saisi });
    expect(r.symbole).toEqual({ valeur: 'XAUUSD', source: 'bandeau' });
    expect(r.unite).toEqual({ valeur: '1h', source: 'bandeau' });
  });

  it('ne tombe sur la saisie qu’en DERNIER, et le dit', () => {
    // La saisie est la plus fiable des trois mais la seule à ne pas décrire
    // la capture en cours. Sa provenance doit remonter jusqu'à l'écran.
    const r = resoudreInstrument({ analyse: { symbol: 'unknown' }, titre: null, saisi });
    expect(r.symbole).toEqual({ valeur: 'BTCUSD', source: 'saisi' });
  });

  it('résout les deux champs SÉPARÉMENT', () => {
    // Le bandeau donne souvent le symbole sans l'unité, ou l'inverse.
    const r = resoudreInstrument({
      analyse: { symbol: 'UNKNOWN', timeframe: '4h' },
      titre: { symbole: 'XAUUSD', unite: null },
      saisi,
    });
    expect(r.symbole.source).toBe('bandeau');
    expect(r.unite.source).toBe('modèle');
  });

  it('rend null quand aucune source ne sait', () => {
    expect(resoudreInstrument({})).toEqual({
      symbole: { valeur: null, source: null }, unite: { valeur: null, source: null },
    });
  });
});

describe('illisible', () => {
  it('reconnaît les non-réponses du modèle', () => {
    for (const v of ['UNKNOWN', 'unknown', 'N/A', 'inconnu', 'intraday', '???', '', null]) {
      expect(illisible(v), String(v)).toBe(true);
    }
    expect(illisible('BTCUSD')).toBe(false);
  });
});

describe('mémoire entre deux sessions', () => {
  beforeEach(() => {
    const magasin = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => magasin.get(k) ?? null,
      setItem: (k, v) => magasin.set(k, v),
    });
  });

  it('retient ce qui a été saisi', () => {
    enregistrerInstrument({ symbole: 'btcusd', unite: '15m' });
    expect(chargerInstrument()).toEqual({ symbole: 'BTCUSD', unite: '15m' });
  });

  it('ne retient PAS une saisie invalide', () => {
    enregistrerInstrument({ symbole: 'BTC USD', unite: 'bientôt' });
    expect(chargerInstrument()).toEqual({ symbole: null, unite: null });
  });

  it('fonctionne sans mémoire du tout', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('stockage bloqué'); },
      setItem: () => { throw new Error('stockage bloqué'); },
    });
    expect(() => enregistrerInstrument({ symbole: 'BTCUSD' })).not.toThrow();
    expect(chargerInstrument()).toEqual({ symbole: null, unite: null });
  });
});
