import { describe, it, expect } from 'vitest';

import { genererVues } from './vues.js';
import { ligneTrouvaille, ligneJugement } from './jugement.js';
import { reduireIndex } from './schema.js';

const record = (h, symbole) => ({ id: `${h}-${symbole}`, horodatage: h, marche: { symbole, uniteTemps: '15m' } });
const ob = (i, extra = {}) => ({ type: 'order_block', indexBougie: i, sens: 'haussier', prixHautDeZone: 4180, prixBasDeZone: 4166,
  qualificatifs: { priseDeLiquidite: true, fvg: false }, ...extra });

function lignes() {
  const r1 = record('2026-10-03T13:45:12Z', 'XAUUSD');
  const r2 = record('2026-10-04T09:10:00Z', 'BTCUSD');
  const a = ligneTrouvaille(r1, ob(10), '2026-10-03/134512-XAUUSD-15m-mesure');
  const b = ligneTrouvaille(r1, ob(42), '2026-10-03/134512-XAUUSD-15m-mesure');
  const c = ligneTrouvaille(r2, ob(7), '2026-10-04/091000-BTCUSD-15m-mesure');
  return reduireIndex([
    a, b, c,
    ligneJugement({ id: a.id, etat: 'valide', note: 'rejet net', horodatage: '2026-10-05T08:00:00Z' }),
    ligneJugement({ id: b.id, etat: 'invalide', horodatage: '2026-10-05T08:05:00Z' }),
  ]);
}

describe('genererVues', () => {
  const v = genererVues(lignes(), { genereLe: '2026-10-05T09:00:00Z' });

  it('range par VALIDITÉ d’abord, par date ensuite', () => {
    expect([...v.keys()]).toContain('vues/par-validite/valide/2026-10-03.md');
    expect([...v.keys()]).toContain('vues/par-validite/invalide/2026-10-03.md');
    expect([...v.keys()]).toContain('vues/par-validite/en_attente/2026-10-04.md');
  });

  it('donne une fiche d’ensemble par état, pour ne pas ouvrir chaque jour', () => {
    const tout = v.get('vues/par-validite/en_attente/TOUT.md');
    expect(tout).toMatch(/1 zone/);
    expect(tout).toMatch(/BTCUSD/);
    expect(tout).toMatch(/du plus ancien au plus récent/i);
  });

  it('place chaque zone dans le bon état, et nulle part ailleurs', () => {
    expect(v.get('vues/par-validite/valide/2026-10-03.md')).toMatch(/\| 13:45 \| Order block \| XAUUSD \|/);
    expect(v.get('vues/par-validite/valide/TOUT.md')).not.toMatch(/BTCUSD/);
    expect(v.get('vues/par-validite/en_attente/TOUT.md')).not.toMatch(/XAUUSD/);
  });

  it('croise par FIGURE, pour que chaque analyse ait sa fiche', () => {
    // C'est la vue qui n'avait pas lieu d'être tant qu'il n'existait qu'un
    // type. Elle existe maintenant parce qu'il va y en avoir d'autres.
    expect(v.get('vues/par-figure/order_block.md')).toMatch(/3 zones/);
    expect(v.get('vues/par-figure/order_block.md')).toMatch(/# Order block/);
  });

  it('croise aussi par symbole et par mois', () => {
    expect(v.get('vues/par-symbole/XAUUSD.md')).toMatch(/2 zones/);
    expect(v.get('vues/par-symbole/BTCUSD.md')).toMatch(/1 zone/);
    expect(v.get('vues/par-mois/2026-10.md')).toMatch(/3 zones/);
  });

  it('reporte les critères remplis, et EUX SEULS', () => {
    // Un critère à false n'est pas une absence d'information : c'est une
    // information. Mais le lister avec les autres rendrait la colonne illisible
    // et ferait croire qu'il est rempli.
    const f = v.get('vues/par-validite/valide/2026-10-03.md');
    expect(f).toMatch(/priseDeLiquidite/);
    expect(f).not.toMatch(/fvg/);
  });

  it('dit où l’on en est, et ce que le taux exclut', () => {
    const l = v.get('vues/LISEZMOI.md');
    expect(l).toMatch(/zones en attente \| 1/);
    expect(l).toMatch(/50\.0 % sur 2/);
    expect(l).toMatch(/exclues.*du taux|exclues/i);
    expect(l).toMatch(/ne lis pas ces fiches/i);
  });

  it('ne contient RIEN d’unique, et le dit', () => {
    expect(v.get('vues/LISEZMOI.md')).toMatch(/rien d'unique|rien d’unique/);
    expect(v.get('vues/LISEZMOI.md')).toMatch(/index\.jsonl/);
  });

  it('rend une fiche lisible plutôt qu’un tableau vide', () => {
    const vide = genererVues([], { genereLe: 'h' });
    expect(vide.get('vues/par-validite/valide/TOUT.md')).toMatch(/Rien ici pour l’instant/);
    expect(vide.get('vues/LISEZMOI.md')).toMatch(/— \(rien de tranché\)/);
  });

  it('ne range pas une mesure parmi les order blocks', () => {
    const v2 = genererVues([{ type: 'mesure', id: 'm', horodatage: '2026-10-03T00:00:00Z' }]);
    expect(v2.get('vues/par-validite/en_attente/TOUT.md')).toMatch(/Rien ici/);
  });
});
