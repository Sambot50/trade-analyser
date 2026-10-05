import { describe, it, expect } from 'vitest';

import {
  instantDuJour, joursDuRejeu, facteurDeguisement, deguiserBougies, bougiesDuGraphique, ramenerPlan, idRejeu,
} from './rejeu.js';
import { serieAleatoire } from '../marche/aleatoire.js';

const MIN = 60_000;
const JOUR = 86_400_000;

// Soixante jours de bougies 1 minute, en deux contrats successifs de trente.
const DEUX_CONTRATS = serieAleatoire({ graine: 2, minutes: 30 * 24 * 60, contrats: 2 })
  .map((b) => ({ ...b, symbole: String(b.contrat) }));

const REGLAGES = {
  heure: '15:30', graine: 20261005, horizonBougies: 1440, fenetreJours: 10,
  bougiesGraphique: 150, uniteGraphiqueMs: 15 * MIN,
};

describe('instantDuJour', () => {
  it('rend 15 h 30 Paris en UTC, été comme hiver', () => {
    expect(new Date(instantDuJour(Date.parse('2026-07-15T03:00:00Z'), '15:30')).toISOString()).toBe('2026-07-15T13:30:00.000Z');
    expect(new Date(instantDuJour(Date.parse('2026-01-15T03:00:00Z'), '15:30')).toISOString()).toBe('2026-01-15T14:30:00.000Z');
  });
});

describe('joursDuRejeu', () => {
  const jours = joursDuRejeu(DEUX_CONTRATS, REGLAGES);

  it('ne tire que des instants à 15 h 30 Paris', () => {
    expect(jours.length).toBeGreaterThan(20);
    for (const { instantMs } of jours) {
      const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(instantMs));
      expect(local).toBe('15:30');
    }
  });

  it('laisse à chaque jour sa fenêtre de témoin dans son propre contrat', () => {
    for (const { instantMs, contrat } of jours) {
      const serie = DEUX_CONTRATS.filter((b) => b.symbole === contrat);
      expect(serie[0].ouvertureMs).toBeLessThanOrEqual(instantMs - REGLAGES.fenetreJours * JOUR);
      // Et un horizon complet après lui, dans le même contrat.
      expect(serie.filter((b) => b.ouvertureMs >= instantMs).length).toBeGreaterThanOrEqual(REGLAGES.horizonBougies);
    }
  });

  it('ne retient jamais deux jours dont les horizons se chevauchent', () => {
    const tries = [...jours].sort((a, b) => a.instantMs - b.instantMs);
    for (let i = 1; i < tries.length; i++) {
      if (tries[i].contrat !== tries[i - 1].contrat) continue;
      expect(tries[i].instantMs - tries[i - 1].instantMs).toBeGreaterThanOrEqual(JOUR);
    }
  });

  it('est entièrement déterminé par le fichier et la graine', () => {
    expect(joursDuRejeu(DEUX_CONTRATS, REGLAGES)).toEqual(jours);
    expect(joursDuRejeu(DEUX_CONTRATS, { ...REGLAGES, graine: 1 })).not.toEqual(jours);
  });

  it('saute un jour sans marché à 15 h 30', () => {
    const cible = jours[0].instantMs;
    const ferme = DEUX_CONTRATS.filter((b) => b.ouvertureMs < cible - 2 * 3_600_000 || b.ouvertureMs >= cible);
    expect(joursDuRejeu(ferme, REGLAGES).map((j) => j.instantMs)).not.toContain(cible);
  });
});

describe('déguisement', () => {
  it('tire un facteur entre 0,2 et 5, le même pour le même jour', () => {
    const ks = Array.from({ length: 500 }, (_, i) => facteurDeguisement(20261005, Date.UTC(2023, 0, 1) + i * JOUR));
    expect(Math.min(...ks)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...ks)).toBeLessThanOrEqual(5);
    // Log-uniforme : autant de facteurs sous 1 qu'au-dessus, à peu près.
    const sous = ks.filter((k) => k < 1).length;
    expect(sous).toBeGreaterThan(200);
    expect(sous).toBeLessThan(300);
    expect(facteurDeguisement(20261005, Date.UTC(2023, 5, 1))).toBe(facteurDeguisement(20261005, Date.UTC(2023, 5, 1)));
  });

  it('multiplie les prix, garde les variations relatives et retire le volume', () => {
    const [b] = deguiserBougies([{ ouvertureMs: 0, fermetureMs: 59_999, ouverture: 2000, plusHaut: 2010, plusBas: 1990, cloture: 2005, volume: 120 }], 0.3);
    expect(b).toEqual({ ouvertureMs: 0, fermetureMs: 59_999, ouverture: 600, plusHaut: 603, plusBas: 597, cloture: 601.5, volume: null });
  });

  it('ramène le plan à l’échelle réelle', () => {
    const plan = ramenerPlan({ direction: 'SELL', entry: 600, stopLoss: 606, tp1: 594, tp2: 588 }, 0.3);
    expect(plan.direction).toBe('SELL');
    expect(plan.prixEntree).toBeCloseTo(2000);
    expect(plan.prixStopLoss).toBeCloseTo(2020);
    expect(plan.prixTp2).toBeCloseTo(1960);
  });
});

describe('bougiesDuGraphique — le modèle ne voit que le passé', () => {
  const serie = DEUX_CONTRATS.filter((b) => b.symbole === DEUX_CONTRATS[0].symbole);
  const instant = serie[5000].ouvertureMs + 7 * MIN; // au milieu d'une bougie de 15 minutes

  it('s’arrête à la dernière bougie de 15 minutes fermée avant l’instant', () => {
    const bs = bougiesDuGraphique(serie, instant, { unite: '15m', nombre: 150 });
    expect(bs).toHaveLength(150);
    expect(bs.at(-1).fermetureMs).toBeLessThan(instant);
    // La bougie de 15 minutes en cours n'apparaît pas, même partiellement.
    expect(bs.at(-1).fermetureMs + 1).toBeLessThanOrEqual(instant - 7 * MIN);
  });

  it('ne contient aucun prix postérieur à l’instant', () => {
    const avant = bougiesDuGraphique(serie, instant, { unite: '15m', nombre: 150 });
    // Changer tout ce qui suit l'instant ne change rien au graphique.
    const falsifiee = serie.map((b) => (b.ouvertureMs >= instant - 7 * MIN ? { ...b, plusHaut: 1e9, cloture: 1e9 } : b));
    expect(bougiesDuGraphique(falsifiee, instant, { unite: '15m', nombre: 150 })).toEqual(avant);
  });

  it('refuse un graphique trop court plutôt que de le compléter', () => {
    expect(() => bougiesDuGraphique(serie, serie[100].ouvertureMs, { unite: '15m', nombre: 150 })).toThrow(/150 attendues/);
  });
});

describe('idRejeu', () => {
  it('nomme un jour par son instant, sans caractère interdit sous Windows', () => {
    expect(idRejeu(Date.parse('2023-06-15T13:30:00Z'))).toBe('rejeu-2023-06-15T13h30');
  });
});
