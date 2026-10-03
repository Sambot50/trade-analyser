import { describe, it, expect, vi } from 'vitest';

import { symboleDepuisTexte, uniteDepuisTexte, bandeDuTitre, lireTitre } from './titre.js';

describe('symboleDepuisTexte', () => {
  it('trouve le symbole au milieu d’un bandeau bavard', () => {
    expect(symboleDepuisTexte('Bitcoin / U.S. Dollar · BTCUSD · 15 · CRYPTO')).toBe('BTCUSD');
    expect(symboleDepuisTexte('XAUUSD 1h OANDA')).toBe('XAUUSD');
  });

  it('écarte le préfixe de place', () => {
    expect(symboleDepuisTexte('BINANCE:BTCUSDT')).toBe('BTCUSDT');
  });

  it('reconnaît un continu à terme', () => {
    expect(symboleDepuisTexte('Gold Futures GC1! COMEX')).toBe('GC1!');
    expect(symboleDepuisTexte('ES1! S&P 500')).toBe('ES1!');
  });

  it('REFUSE les mots du décor, qui ressemblent pourtant à des symboles', () => {
    // Accepter « toute suite de majuscules » les ramasserait tous, et le
    // journal irait chercher les bougies de « CRYPTO ».
    expect(symboleDepuisTexte('CRYPTO TradingView NASDAQ FOREX')).toBeNull();
    expect(symboleDepuisTexte('Chart Indicators Alert Replay')).toBeNull();
  });

  it('exige quelque chose devant la devise de cotation', () => {
    expect(symboleDepuisTexte('USD')).toBeNull();
    expect(symboleDepuisTexte('USDT')).toBeNull();
  });

  it('rend null plutôt que d’inventer', () => {
    expect(symboleDepuisTexte('')).toBeNull();
    expect(symboleDepuisTexte(null)).toBeNull();
    expect(symboleDepuisTexte('84 648.74 +159.69')).toBeNull();
  });
});

describe('uniteDepuisTexte', () => {
  it('lit les formes directes et inversées', () => {
    expect(uniteDepuisTexte('BTCUSD 15m')).toBe('15m');
    expect(uniteDepuisTexte('EURUSD H4')).toBe('4h');
    expect(uniteDepuisTexte('XAUUSD 1h')).toBe('1h');
    expect(uniteDepuisTexte('SPX M15')).toBe('15m');
  });

  it('lit un nombre nu comme des minutes — convention TradingView', () => {
    expect(uniteDepuisTexte('Bitcoin / U.S. Dollar · 15 · CRYPTO')).toBe('15m');
    expect(uniteDepuisTexte('· 5 ·')).toBe('5m');
  });

  it('lit le jour et la semaine seuls', () => {
    expect(uniteDepuisTexte('SPX D')).toBe('1d');
    expect(uniteDepuisTexte('SPX W')).toBe('1w');
  });

  it('refuse une unité que le dépôt ne connaît pas', () => {
    expect(uniteDepuisTexte('BTCUSD 7m')).toBeNull();     // 7 minutes n'existe pas
    expect(uniteDepuisTexte('rien du tout')).toBeNull();
    expect(uniteDepuisTexte(null)).toBeNull();
  });
});

describe('bandeDuTitre', () => {
  it('prend la bande au-dessus du tracé, sur sa largeur', () => {
    const b = bandeDuTitre({ x0: 20, x1: 900, y0: 120 }, 700, { marge: 90 });
    expect(b).toEqual({ x0: 20, x1: 900, y0: 28, y1: 118 });
  });

  it('se borne au haut de l’image', () => {
    const b = bandeDuTitre({ x0: 0, x1: 500, y0: 40 }, 700, { marge: 90 });
    expect(b.y0).toBe(0);
    expect(b.y1).toBe(38);
  });

  it('rend null quand il n’y a pas de place au-dessus', () => {
    expect(bandeDuTitre({ x0: 0, x1: 500, y0: 4 }, 700)).toBeNull();
    expect(bandeDuTitre(null, 700)).toBeNull();
  });
});

describe('lireTitre', () => {
  const image = new Uint8ClampedArray(400 * 300 * 4).fill(30);
  const zone = { x0: 20, x1: 380, y0: 150 };

  const moteur = (mots) => vi.fn().mockResolvedValue({
    setParameters: vi.fn(),
    recognize: vi.fn().mockResolvedValue({ data: { words: mots } }),
    terminate: vi.fn(),
  });

  it('rend le symbole, l’unité, ET le texte brut', async () => {
    const r = await lireTitre(image, 400, 300, zone, {
      creerWorker: moteur([
        { text: 'BTCUSD', confidence: 90, bbox: { y0: 10, y1: 30 } },
        { text: '15', confidence: 88, bbox: { y0: 10, y1: 30 } },
        { text: 'CRYPTO', confidence: 85, bbox: { y0: 10, y1: 30 } },
      ]),
    });
    expect(r.symbole).toBe('BTCUSD');
    expect(r.unite).toBe('15m');
    expect(r.texte).toContain('BTCUSD');
  });

  it('rend le texte brut MÊME quand rien n’est reconnu', async () => {
    // Un champ vide ne dit pas pourquoi. Le texte brut, si.
    const r = await lireTitre(image, 400, 300, zone, {
      creerWorker: moteur([{ text: 'lll|||', confidence: 70, bbox: { y0: 10, y1: 30 } }]),
    });
    expect(r.symbole).toBeNull();
    expect(r.unite).toBeNull();
    expect(r.texte).toBe('lll|||');
  });

  it('ne tente rien sans place au-dessus du tracé', async () => {
    const creerWorker = vi.fn();
    const r = await lireTitre(image, 400, 300, { x0: 0, x1: 100, y0: 3 }, { creerWorker });
    expect(r).toEqual({ symbole: null, unite: null, texte: '' });
    expect(creerWorker).not.toHaveBeenCalled();
  });

  it('demande au moteur les lettres, pas seulement les chiffres', async () => {
    const setParameters = vi.fn();
    const creerWorker = vi.fn().mockResolvedValue({
      setParameters,
      recognize: vi.fn().mockResolvedValue({ data: { words: [] } }),
      terminate: vi.fn(),
    });
    await lireTitre(image, 400, 300, zone, { creerWorker });
    const liste = setParameters.mock.calls[0][0].tessedit_char_whitelist;
    expect(liste).toMatch(/A/);
    expect(liste).toMatch(/!/);
  });
});
