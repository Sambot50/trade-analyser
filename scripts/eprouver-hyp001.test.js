import { describe, expect, it } from 'vitest';
import { GEL, eprouver, part, phi } from './eprouver-hyp001.mjs';

// Ces tests protègent le GEL autant que le calcul. Si quelqu'un — y compris
// moi dans six mois — retouche un paramètre après la première exécution,
// l'épreuve est annulée et le résultat ne vaut plus rien. Un test qui rougit
// est le seul rempart contre une modification qui se justifierait très bien
// sur le moment.
describe('paramètres gelés', () => {
  it('porte exactement les valeurs pré-enregistrées le 2026-09-25', () => {
    expect(GEL).toMatchObject({
      enregistreLe: '2026-09-25',
      ut: '15m', utCsv: '1m', fenetre: 60,
      detecteur: 'picVolume', famille: 'hausse-achat',
      horizonHeures: 24, multiple: 3,
      avecMacro: false, ecartAttendu: 5.5, alpha: 0.05, unilateral: true,
      debutAttendu: '2025-01-01', finAttendue: '2026-09-01',
    });
  });

  it('est immuable', () => {
    expect(Object.isFrozen(GEL)).toBe(true);
    expect(() => { GEL.multiple = 2; }).toThrow();
  });
});

describe('phi', () => {
  it('vaut un demi en zéro', () => expect(phi(0)).toBeCloseTo(0.5, 6));
  it.each([[1.645, 0.95], [1.96, 0.975], [2.576, 0.995], [-1.645, 0.05]])(
    'phi(%s) ≈ %s', (z, attendu) => expect(phi(z)).toBeCloseTo(attendu, 3));
});

describe('part', () => {
  it('compte atteint sur atteint plus perdu', () => {
    expect(part(['atteint', 'atteint', 'perdu', 'perdu'])).toEqual({ part: 50, n: 4 });
  });

  it('exclut « ambigu » du dénominateur plutôt que de trancher', () => {
    // Le compter comme perdu sous-estimerait, comme atteint surestimerait.
    expect(part(['atteint', 'perdu', 'ambigu', 'ni_lun_ni_lautre'])).toEqual({ part: 50, n: 2 });
  });

  it('rend null sans aucun verdict exploitable', () => {
    expect(part(['ambigu']).part).toBeNull();
  });
});

describe('règle de décision', () => {
  const groupe = (atteints, total) => [
    ...Array(atteints).fill('atteint'), ...Array(total - atteints).fill('perdu'),
  ];

  it('confirme un écart franc et significatif', () => {
    const r = eprouver(groupe(360, 600), groupe(3575, 7150));   // 60 % contre 50 %
    expect(r.verdict).toBe('CONFIRMÉE');
    expect(r.ecart).toBeCloseTo(10, 1);
    expect(r.p).toBeLessThan(0.05);
  });

  it('ne confirme pas un écart du bon signe mais noyé dans le bruit', () => {
    const r = eprouver(groupe(31, 60), groupe(340, 700));        // +3,1 points, n minuscule
    expect(r.ecart).toBeGreaterThan(0);
    expect(r.verdict).toBe('NON CONFIRMÉE');
  });

  it('réfute un écart nul', () => {
    expect(eprouver(groupe(300, 600), groupe(3575, 7150)).verdict).toBe('RÉFUTÉE');
  });

  it('réfute un écart inversé, si grand soit-il', () => {
    // Unilatéral : un effet énorme dans le MAUVAIS sens reste une réfutation.
    const r = eprouver(groupe(240, 600), groupe(3575, 7150));
    expect(r.verdict).toBe('RÉFUTÉE');
    expect(r.ecart).toBeLessThan(0);
  });

  it('refuse de conclure sur un groupe vide', () => {
    expect(eprouver([], groupe(3575, 7150)).verdict).toBe('IMPOSSIBLE');
    expect(eprouver(groupe(360, 600), ['ambigu']).verdict).toBe('IMPOSSIBLE');
  });

  it('retrouve la puissance annoncée : +5,5 points sur 20 mois est détectable', () => {
    // 601 cas et 7154 témoins, les effectifs attendus sur 2025→09/2026.
    const r = eprouver(groupe(Math.round(0.590 * 601), 601), groupe(Math.round(0.535 * 7154), 7154));
    expect(r.ecart).toBeCloseTo(5.5, 0);
    expect(r.verdict).toBe('CONFIRMÉE');
  });
});
