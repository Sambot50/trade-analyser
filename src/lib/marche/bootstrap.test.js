import { describe, it, expect } from 'vitest';

import { reechantillonnerParBlocs, tirages } from './bootstrap.js';
import { serieAleatoire } from './aleatoire.js';

const source = serieAleatoire({ graine: 5, minutes: 4000, sigma: 0.4 });

describe('reechantillonnerParBlocs', () => {
  const r = reechantillonnerParBlocs(source, { longueurBloc: 24, graine: 3 });

  it('rend une série de même longueur', () => {
    expect(r).toHaveLength(source.length);
  });

  it('RECOLLE les blocs au lieu de les juxtaposer', () => {
    // Sans décalage, la série sauterait à chaque jointure, et ces sauts
    // seraient pris pour des sorties de range : on fabriquerait l'évènement
    // qu'on veut compter.
    const sauts = [];
    for (let i = 1; i < r.length; i++) sauts.push(Math.abs(r[i].ouverture - r[i - 1].cloture));
    const amplitudeMediane = [...source.map((b) => b.plusHaut - b.plusBas)].sort((a, b) => a - b)[source.length >> 1];
    expect(Math.max(...sauts)).toBeLessThan(amplitudeMediane * 3);
  });

  it('conserve la FORME des bougies, une à une', () => {
    // Chaque bougie est une bougie d'origine translatée : son corps, ses
    // mèches et leurs proportions sont intacts. C'est ce qui distingue ce
    // témoin d'une marche à volatilité constante.
    const formeDe = (b) => [(b.cloture - b.ouverture), (b.plusHaut - b.plusBas)].map((x) => x.toFixed(6)).join('/');
    const formesSource = new Set(source.map(formeDe));
    for (const b of r.slice(0, 200)) expect(formesSource.has(formeDe(b))).toBe(true);
  });

  it('conserve la distribution des amplitudes', () => {
    const q = (xs) => { const a = [...xs].sort((x, y) => x - y); return a[a.length >> 1]; };
    expect(q(r.map((b) => b.plusHaut - b.plusBas)))
      .toBeCloseTo(q(source.map((b) => b.plusHaut - b.plusBas)), 6);
  });

  it('réécrit les horodatages régulièrement', () => {
    // Ceux d'origine n'ont plus de sens une fois les tronçons mélangés, et les
    // garder laisserait croire à une chronologie qui n'existe pas.
    const pas = r[1].ouvertureMs - r[0].ouvertureMs;
    for (let i = 2; i < 50; i++) expect(r[i].ouvertureMs - r[i - 1].ouvertureMs).toBe(pas);
  });

  it('est REPRODUCTIBLE : même graine, même série', () => {
    const a = reechantillonnerParBlocs(source, { longueurBloc: 24, graine: 9 });
    const b = reechantillonnerParBlocs(source, { longueurBloc: 24, graine: 9 });
    expect(a.map((x) => x.cloture)).toEqual(b.map((x) => x.cloture));
    const c = reechantillonnerParBlocs(source, { longueurBloc: 24, graine: 10 });
    expect(c.map((x) => x.cloture)).not.toEqual(a.map((x) => x.cloture));
  });

  it('refuse une série trop courte pour ses blocs', () => {
    expect(reechantillonnerParBlocs(source.slice(0, 20), { longueurBloc: 24 })).toEqual([]);
    expect(reechantillonnerParBlocs(null)).toEqual([]);
  });
});

describe('tirages', () => {
  it('rend des séries TOUTES différentes', () => {
    // Un seul tirage donnerait un chiffre, pas une référence. C'est la
    // dispersion entre tirages qui dit ce que vaut l'écart observé.
    const t = tirages(source, { nombre: 4, longueurBloc: 24 });
    expect(t).toHaveLength(4);
    const signatures = new Set(t.map((s) => s.slice(0, 50).map((b) => b.cloture.toFixed(4)).join()));
    expect(signatures.size).toBe(4);
  });
});
