import { describe, it, expect } from 'vitest';
import { validerOptions, symboleDe, visibilite, TAILLES } from './comparer-marches.mjs';

describe('symbole depuis le nom de fichier', () => {
  it('lit le symbole quel que soit le séparateur', () => {
    expect(symboleDe('GC.csv')).toBe('GC');
    expect(symboleDe('SI_2024.csv')).toBe('SI');
    expect(symboleDe('marches/pa-2023-2024.csv')).toBe('PA');
  });
});

describe('visibilité d’une empreinte', () => {
  const volumes = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  it('mesure le rapport du maximum à la médiane', () => {
    // 199 bougies à 100, une à 1000.
    const v = visibilite([...volumes(199, () => 100), 1000]);
    expect(v.medianeVolume).toBe(100);
    expect(v.maxSurMediane).toBe(10);
  });

  it('compte les parts au-dessus des seuils', () => {
    // 180 à 100, 20 à 500 : un dixième au-dessus de 3× et de 5×.
    const v = visibilite([...volumes(180, () => 100), ...volumes(20, () => 500)]);
    expect(v.part3x).toBeCloseTo(10, 1);
    expect(v.part5x).toBeCloseTo(10, 1);
    expect(v.part10x).toBe(0);
  });

  it('ignore les volumes nuls plutôt que d’écraser la médiane', () => {
    const v = visibilite([...volumes(150, () => 200), ...volumes(150, () => 0)]);
    expect(v.medianeVolume).toBe(200);
    expect(v.bougies).toBe(150);
  });

  it('refuse de conclure sur trop peu de bougies', () => {
    expect(visibilite(volumes(50, () => 100))).toBeNull();
  });
});

describe('options', () => {
  it('porte les multiplicateurs des contrats CME courants', () => {
    expect(TAILLES.GC).toBe(100);
    expect(TAILLES.SI).toBe(5000);
    expect(validerOptions({}).tailles.PA).toBe(100);
  });

  it('accepte des multiplicateurs supplémentaires', () => {
    const o = validerOptions({ tailleContrat: 'XX=42,GC=999' });
    expect(o.tailles.XX).toBe(42);
    expect(o.tailles.GC).toBe(999);
  });

  it('refuse un multiplicateur illisible', () => {
    expect(validerOptions({ tailleContrat: 'GC=beaucoup' }).erreurs.join(' ')).toMatch(/illisible/);
  });

  it('refuse une unité plus fine que le fichier', () => {
    expect(validerOptions({ ut: '1m', utCsv: '5m' }).erreurs.join(' ')).toMatch(/--ut/);
  });
});
