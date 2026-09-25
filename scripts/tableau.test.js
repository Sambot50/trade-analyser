import { describe, expect, it } from 'vitest';
import { apresEnPrix, bougiesAutour, construirePage, rendreBougies, validerOptions } from './tableau.mjs';

const bougie = (o, h, b, c, ms = 0) => ({
  ouvertureMs: ms, fermetureMs: ms + 899999, ouverture: o, plusHaut: h, plusBas: b, cloture: c, volume: 100,
});

describe('validerOptions', () => {
  it('exige un fichier', () => expect(validerOptions({}).erreurs).toBeTruthy());
  it('travaille en 15 minutes par défaut', () => expect(validerOptions({ csv: 'x' }).ut).toBe('15m'));
  it('refuse une unité inconnue', () => expect(validerOptions({ csv: 'x', ut: '7m' }).erreurs).toBeTruthy());
});

describe('ce que le prix fait après', () => {
  // La bougie 0 est celle qui est signalée ; elle clôture à 100.
  const serie = [
    bougie(98, 101, 97, 100),
    bougie(100, 105, 99, 104),
    bougie(104, 108, 95, 96),
    bougie(96, 99, 94, 97),
  ];

  it('part de la CLÔTURE de la bougie signalée, pas de son ouverture', () => {
    // Le mouvement déjà accompli pendant la bougie n'est plus disponible
    // quand l'alerte tombe : le compter gonflerait tout.
    expect(apresEnPrix(serie, 0, 3).depart).toBe(100);
  });

  it('mesure la montée et la descente maximales en prix', () => {
    const r = apresEnPrix(serie, 0, 3);
    expect(r.monte).toBeCloseTo(8, 6);     // 108 − 100
    expect(r.descend).toBeCloseTo(6, 6);   // 100 − 94
  });

  it('dit au bout de combien de bougies chaque extrême est atteint', () => {
    const r = apresEnPrix(serie, 0, 3);
    expect(r.bougiesHaut).toBe(2);
    expect(r.bougiesBas).toBe(3);
  });

  it('donne le résultat net à la fin de l’horizon', () => {
    expect(apresEnPrix(serie, 0, 3).net).toBeCloseTo(-3, 6);
  });

  it('signale un horizon tronqué au lieu de le taire', () => {
    expect(apresEnPrix(serie, 0, 3).complet).toBe(true);
    expect(apresEnPrix(serie, 0, 10).complet).toBe(false);
  });

  it('rend null quand il n’y a rien après', () => {
    expect(apresEnPrix(serie, 3, 5)).toBeNull();
  });
});

describe('page', () => {
  const ligne = {
    ms: Date.UTC(2024, 8, 12, 13, 0), volume: 19351, ratio: 39.371,
    hausse: true, corps: 4.2, monte: 12.5, descend: 3.1,
    bougiesHaut: 8, bougiesBas: 2, net: 9.4, complet: true,
    planche: 'planches/x.png',
  };
  const page = construirePage([ligne], { symbole: 'GC', ut: '15m', apres: 96, medianeVolume: 1080, dureeApresH: 24 });

  it('porte le volume en contrats et le rapport à la normale', () => {
    expect(page).toContain('contrats');
    expect(page).toContain('39.4×');
  });

  it('affiche les mouvements en dollars, signés', () => {
    expect(page).toContain('+12.50 $');
    expect(page).toContain('−3.10 $');
  });

  it('inclut la planche quand elle existe', () => {
    expect(page).toContain('src="planches/x.png"');
  });

  it('dit « planche absente » plutôt que d’afficher une image cassée', () => {
    const sans = construirePage([{ ...ligne, planche: undefined }], { symbole: 'GC', ut: '15m', apres: 96, medianeVolume: 1080, dureeApresH: 24 });
    expect(sans).toContain('planche absente');
    expect(sans).not.toContain('<img');
  });

  it('échappe le symbole plutôt que de le coller tel quel', () => {
    const p = construirePage([], { symbole: '<script>', ut: '15m', apres: 96, medianeVolume: 1, dureeApresH: 24 });
    expect(p).not.toContain('<script>');
    expect(p).toContain('&lt;script&gt;');
  });
});

describe('bougies autour de l’évènement', () => {
  const serie = Array.from({ length: 20 }, (_, i) => {
    const ms = Date.UTC(2024, 0, 1) + i * 900000;
    return { ouvertureMs: ms, fermetureMs: ms + 899999, ouverture: 100, plusHaut: 101, plusBas: 99, cloture: 100.5, volume: 1000 + i };
  });

  it('repère par le TEMPS, pas par un index', () => {
    // Un instant au milieu d'une bougie doit désigner cette bougie : c'est ce
    // qui permet de retrouver la même fenêtre dans une autre unité.
    const ms = serie[10].ouvertureMs + 400000;
    expect(bougiesAutour(serie, ms, 2, 2).bougies[2].ouvertureMs).toBe(serie[10].ouvertureMs);
  });

  it('rend la bonne largeur de fenêtre et la position de la marque', () => {
    const r = bougiesAutour(serie, serie[10].ouvertureMs, 3, 4);
    expect(r.bougies).toHaveLength(8);
    expect(r.index).toBe(3);
  });

  it('tronque au début sans décaler la marque', () => {
    const r = bougiesAutour(serie, serie[1].ouvertureMs, 5, 2);
    expect(r.index).toBe(1);
    expect(r.bougies[r.index].ouvertureMs).toBe(serie[1].ouvertureMs);
  });

  it('rend null pour un instant hors de la série', () => {
    expect(bougiesAutour(serie, Date.UTC(2020, 0, 1), 2, 2)).toBeNull();
  });
});

describe('rendu des bougies', () => {
  const bloc = {
    index: 1,
    bougies: [
      { ouvertureMs: Date.UTC(2024, 0, 1, 4, 30), ouverture: 100, plusHaut: 101, plusBas: 99, cloture: 100.5, volume: 998 },
      { ouvertureMs: Date.UTC(2024, 0, 1, 4, 45), ouverture: 100, plusHaut: 101, plusBas: 95, cloture: 96, volume: 16604 },
    ],
  };
  const html = rendreBougies(bloc, '15m', 1036);

  it('affiche le volume de CHAQUE bougie', () => {
    expect(html).toContain('998');
    expect(html).toContain('16\u202f604');
  });

  it('marque la bougie signalée', () => {
    expect((html.match(/class="marquee"/g) ?? [])).toHaveLength(1);
  });

  it('note le multiple seulement quand il se remarque', () => {
    // 998 / 1036 vaut 0,96 : l'écrire encombrerait sans rien apprendre.
    expect(html).toContain('16.0\u00d7');
    expect(html).not.toContain('1.0\u00d7');
  });

  it('dimensionne les barres sur le maximum de la fenêtre', () => {
    expect(html).toContain('width:100.0%');
    expect(html).toMatch(/width:6\.0%/);
  });

  it('dit quand il n’y a rien plutôt que de rendre un tableau vide', () => {
    expect(rendreBougies(null, '5m', 1036)).toContain('aucune bougie');
  });
});
