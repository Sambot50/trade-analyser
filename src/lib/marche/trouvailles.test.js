import { describe, it, expect } from 'vitest';

import {
  TYPES, estTypeConnu, libelleDuType, aUneZone, normaliser, duType, dessinables, trouvaillesDeMesure,
} from './trouvailles.js';

const ob = { type: 'order_block', index: 71, ms: 1, sens: 'haussier', zone: { haut: 4180, bas: 4166 } };

describe('le registre', () => {
  it('connaît l’order block, et rien qu’il n’ait déclaré', () => {
    expect(estTypeConnu('order_block')).toBe(true);
    expect(estTypeConnu('marteau')).toBe(false);
    expect(libelleDuType('order_block')).toBe('Order block');
    expect(libelleDuType('inconnu')).toBe('inconnu');
    expect(TYPES.order_block).toMatchObject({ dessine: true, juge: true });
  });
});

describe('aUneZone', () => {
  it('exige deux bornes finies et ordonnées', () => {
    expect(aUneZone(ob)).toBe(true);
    expect(aUneZone({ zone: { haut: 10, bas: 10 } })).toBe(false);   // plate
    expect(aUneZone({ zone: { haut: 10, bas: 20 } })).toBe(false);   // inversée
    expect(aUneZone({ zone: { haut: NaN, bas: 1 } })).toBe(false);
    expect(aUneZone(null)).toBe(false);
  });
});

describe('normaliser', () => {
  it('refuse ce qui n’a ni type connu ni rang', () => {
    // Une trouvaille sans rang se jugerait sous un identifiant instable, et
    // réapparaîtrait à chaque lecture comme une nouvelle zone à juger.
    expect(normaliser({ type: 'marteau', index: 3 })).toBeNull();
    expect(normaliser({ type: 'order_block' })).toBeNull();
    expect(normaliser(null)).toBeNull();
  });

  it('garde une trouvaille sans zone, mais la marque comme telle', () => {
    const t = normaliser({ type: 'order_block', index: 5 });
    expect(t).toMatchObject({ type: 'order_block', index: 5, zone: null, ms: null });
  });

  it('GARDE ce qui n’est pas du contrat, au lieu de le jeter', () => {
    // La première version jetait. Elle a fait disparaître `indexCassure` d'un
    // order block sans qu'aucun test ne bronche, parce que rien en aval ne
    // s'en servait encore. Un contrat dit ce qui est commun ; il n'autorise
    // pas à perdre ce qui est propre à une figure.
    const t = normaliser({ ...ob, indexCassure: 80, indexOrigine: 60 });
    expect(Object.keys(t).sort()).toEqual(['details', 'index', 'ms', 'plan', 'qualificatifs', 'sens', 'type', 'zone']);
    expect(t.details).toEqual({ indexCassure: 80, indexOrigine: 60 });
  });

  it('rend `details` nul quand il n’y a rien à garder', () => {
    expect(normaliser(ob).details).toBeNull();
  });
});

describe('duType et dessinables', () => {
  const liste = [ob, { type: 'order_block', index: 2, zone: null }, { type: 'autre', index: 3 }];

  it('filtre par type sans connaître la forme', () => {
    expect(duType(liste, 'order_block')).toHaveLength(2);
    expect(duType(null, 'order_block')).toEqual([]);
  });

  it('ne rend dessinable que ce qui a un type ET une zone', () => {
    expect(dessinables(liste)).toEqual([ob]);
  });
});

describe('trouvaillesDeMesure', () => {
  it('lit un enregistrement du nouveau format', () => {
    expect(trouvaillesDeMesure({ structure: { trouvailles: [ob] } })).toEqual([ob]);
  });

  it('RELIT un enregistrement antérieur au contrat, sans rien migrer', () => {
    // Un journal déjà écrit ne se réécrit pas : on apprend à le relire. Les
    // anciens n'avaient qu'un type, les lire comme order blocks est exact.
    const ancien = { structure: { orderBlocks: [{ indexBougie: 71, sens: 'haussier' }] } };
    expect(trouvaillesDeMesure(ancien)).toEqual([{ indexBougie: 71, sens: 'haussier', type: 'order_block' }]);
  });

  it('ne bronche pas sur une mesure creuse', () => {
    expect(trouvaillesDeMesure(null)).toEqual([]);
    expect(trouvaillesDeMesure({})).toEqual([]);
    expect(trouvaillesDeMesure({ structure: {} })).toEqual([]);
  });
});

// ── La compatibilité, qui est la seule chose irréversible ───────────────────
//
// Le code revient en arrière d'une commande ; un fichier déjà écrit sur le
// disque de l'utilisateur, non. Un enregistrement fait avant ce contrat doit
// donc rester lisible après, sans migration et sans réécriture.

import { construireMesure, resumeMesure, ligneIndexMesure } from '../journal/mesure.js';
import { ligneTrouvaille, fileDAttente } from '../journal/jugement.js';
import { reduireIndex } from '../journal/schema.js';

describe('un journal écrit AVANT le contrat reste lisible', () => {
  // La forme exacte produite par la version précédente : pas de `trouvailles`,
  // pas de `type`, une liste nommée `orderBlocks`.
  const ancien = {
    type: 'mesure',
    id: '2026-10-03T13:34:15Z-BTCUSD-15m-mesure',
    horodatage: '2026-10-03T13:34:15Z',
    marche: { symbole: 'BTCUSD', uniteTemps: '15m' },
    mesure: {
      nombreDeBougies: 210,
      echelleDesPrix: { prixEnHautDuTrace: 87171, prixEnBasDuTrace: 83135, hauteurTraceEnPixels: 783 },
      structure: {
        cassures: [{ index: 60, sens: 'haussier', prix: 84500 }],
        orderBlocks: [
          { indexBougie: 71, sens: 'haussier', prixHautDeZone: 84619.8, prixBasDeZone: 84547.7,
            qualificatifs: { priseDeLiquidite: true } },
          { indexBougie: 135, sens: 'baissier', prixHautDeZone: 84789.9, prixBasDeZone: 84558.0, qualificatifs: null },
        ],
      },
      bougies: [],
    },
  };

  it('rend ses order blocks, typés au passage', () => {
    const t = trouvaillesDeMesure(ancien.mesure);
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.type === 'order_block')).toBe(true);
    expect(t[0].prixBasDeZone).toBe(84547.7);
  });

  it('s’indexe et entre dans la file d’attente comme un neuf', () => {
    const lignes = trouvaillesDeMesure(ancien.mesure)
      .map((t) => ligneTrouvaille(ancien, t, '2026-10-03/133415-BTCUSD-15m-mesure'));
    const file = fileDAttente(reduireIndex(lignes));
    expect(file).toHaveLength(2);
    expect(file[0].type).toBe('order_block');
    expect(file[0].symbole).toBe('BTCUSD');
  });

  it('se résume et se compte sans erreur', () => {
    expect(() => resumeMesure(ancien)).not.toThrow();
    expect(resumeMesure(ancien)).toMatch(/2 order block/);
    expect(ligneIndexMesure(ancien, 'd').trouvailles).toBe(2);
  });

  it('un enregistrement NEUF porte la liste typée, et pas l’ancienne', () => {
    const neuf = construireMesure({
      lecture: {
        ok: true, convention: 'point',
        zone: { x0: 0, x1: 100, y0: 0, y1: 100, avecVolume: false },
        echelle: { prixDeY: (y) => 100 - y },
        titre: null,
        bougies: [{ index: 0, ouverture: 1, cloture: 2, plusHaut: 3, plusBas: 0, centreX: 5 }],
        analyses: {
          cassures: [],
          trouvailles: [{ type: 'order_block', index: 0, sens: 'haussier', zone: { haut: 3, bas: 0 }, qualificatifs: null }],
          orderBlocks: [],
          rejetes: 0, assezDeBougies: true,
        },
      },
      marche: { symbole: 'BTCUSD', unite: '15m' },
      horodatage: '2026-10-05T10:00:00Z',
      fichiers: {},
    });
    expect(neuf.mesure.structure.trouvailles[0].type).toBe('order_block');
    expect(neuf.mesure.structure.orderBlocks).toBeUndefined();
  });
});
