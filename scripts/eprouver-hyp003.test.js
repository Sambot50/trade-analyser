import { describe, expect, it } from 'vitest';
import { GEL, decider, esperance, pasDeCotation, resultatEnR } from './eprouver-hyp003.mjs';
import { GEL as GEL_001 } from './eprouver-hyp001.mjs';

const bg = (ouverture, plusHaut, plusBas, cloture) => ({ ouverture, plusHaut, plusBas, cloture, volume: 1 });

describe('paramètres gelés', () => {
  it('reprend la détection de HYP-001 sans la modifier', () => {
    expect(GEL.regle).toBe(GEL_001);
  });

  it('fige les métaux, la période et les frais', () => {
    expect(GEL.marches).toEqual(['GC', 'SI', 'PL', 'HG']);
    expect(GEL.debut).toBe('2020-01-01');
    expect(GEL.fin).toBe('2023-01-01');
    expect(GEL.ticksAllerRetour).toBe(4);
    expect(GEL.objectifR).toBe(3);
    expect(GEL.stopR).toBe(1);
  });

  it('est immuable', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(() => { GEL.ticksAllerRetour = 0; }).toThrow();
  });

  it('choisit une période ANTÉRIEURE à tout ce qui a été regardé', () => {
    // 2023-2024 a formé HYP-001, 2025-2026 l'a éprouvée, 2023-2026 a servi à
    // HYP-002. 2020-2022 n'a jamais été ouvert, et son régime est inverse.
    expect(GEL.fin <= '2023-01-01').toBe(true);
  });
});

describe('pas de cotation', () => {
  it('le lit dans les prix au lieu de le supposer', () => {
    expect(pasDeCotation([1900.0, 1900.1, 1900.3, 1900.6])).toBeCloseTo(0.1, 9);
  });

  it('ignore les doublons', () => {
    expect(pasDeCotation([10, 10, 10.5, 10.5, 11])).toBeCloseTo(0.5, 9);
  });

  it('rend null quand tous les prix sont identiques', () => {
    expect(pasDeCotation([5, 5, 5])).toBeNull();
  });
});

describe('résultat d’une position', () => {
  // Bougie signalée : 100 → 110, haut 112, bas 98. R = 14, entrée 110.
  // Objectif 110 + 42 = 152. Stop 110 − 14 = 96.
  const signal = bg(100, 112, 98, 110);
  const opts = { objectifR: 3, stopR: 1, coutEnR: 0.02 };

  it('compte l’objectif moins les frais', () => {
    const r = resultatEnR([signal, bg(110, 155, 109, 150)], 0, 5, opts);
    expect(r.verdict).toBe('objectif');
    expect(r.R).toBeCloseTo(2.98, 9);
  });

  it('compte le stop ET les frais — les frais s’ajoutent à la perte', () => {
    const r = resultatEnR([signal, bg(110, 111, 95, 97)], 0, 5, opts);
    expect(r.verdict).toBe('stop');
    expect(r.R).toBeCloseTo(-1.02, 9);
  });

  it('rend « ambigu » quand une seule bougie touche les deux', () => {
    expect(resultatEnR([signal, bg(110, 155, 95, 120)], 0, 5, opts).verdict).toBe('ambigu');
  });

  it('ferme au marché en fin d’horizon plutôt que d’écarter le cas', () => {
    // Ni objectif ni stop : sortie à 117, soit +7 sur un R de 14.
    const r = resultatEnR([signal, bg(110, 118, 105, 117)], 0, 1, opts);
    expect(r.verdict).toBe('horizon');
    expect(r.R).toBeCloseTo(7 / 14 - 0.02, 9);
  });

  it('traite une position vendeuse symétriquement', () => {
    const vente = bg(110, 112, 98, 100);          // R = 14, entrée 100, objectif 58
    const r = resultatEnR([vente, bg(100, 101, 55, 57)], 0, 5, opts);
    expect(r.verdict).toBe('objectif');
  });

  it('refuse une bougie plate — aucun sens à donner', () => {
    expect(resultatEnR([bg(100, 101, 99, 100), bg(100, 110, 99, 105)], 0, 5, opts)).toBeNull();
  });
});

describe('espérance et décision', () => {
  const positions = (...valeurs) => valeurs.map((R) => ({ verdict: 'x', R }));

  it('calcule moyenne et erreur type', () => {
    const e = esperance(positions(3, -1, 3, -1));
    expect(e.n).toBe(4);
    expect(e.moyenne).toBe(1);
  });

  it('écarte les ambigus du calcul', () => {
    expect(esperance([...positions(3, -1), { verdict: 'ambigu', R: null }]).n).toBe(2);
  });

  it('déclare NON CONCLUANTE quand la précision manque, avant de regarder le signe', () => {
    for (const moyenne of [+0.5, -0.5]) {
      expect(decider({ n: 10, moyenne, ecartType: 2, se: 0.3 }).verdict).toBe('NON CONCLUANTE');
    }
  });

  it('déclare RENTABLE une espérance positive et précise', () => {
    expect(decider({ n: 4000, moyenne: 0.3, ecartType: 1.9, se: 0.03 }).verdict).toBe('RENTABLE');
  });

  it('déclare NON RENTABLE une espérance nulle ou négative', () => {
    expect(decider({ n: 4000, moyenne: 0, ecartType: 1.9, se: 0.03 }).verdict).toBe('NON RENTABLE');
    expect(decider({ n: 4000, moyenne: -0.2, ecartType: 1.9, se: 0.03 }).verdict).toBe('NON RENTABLE');
  });

  it('le seuil de précision correspond bien à +0,25 R détectable à 80 %', () => {
    expect(0.25 / GEL.erreurTypeMaximale).toBeCloseTo(2.5, 1);
  });
});
