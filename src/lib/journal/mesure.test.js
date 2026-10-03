import { describe, it, expect } from 'vitest';

import {
  mesureDepuisLecture, construireMesure, resumeMesure, ligneIndexMesure, TYPE_MESURE,
} from './mesure.js';
import { cheminDossier, construireId } from './schema.js';
import { calculerStatistiques, genererRapport, estMesure } from './report.js';

const lecture = {
  ok: true,
  convention: 'point',
  zone: { x0: 10, x1: 900, y0: 50, y1: 650, avecVolume: true, volumeY0: 700, volumeY1: 800 },
  echelle: { prixDeY: (y) => 87000 - (y - 50) * 6, yDePrix: (p) => 50 + (87000 - p) / 6 },
  titre: { symbole: 'BTCUSD', unite: '15m', texte: 'BTCUSD · 15 · BINANCE' },
  bougies: [
    { index: 0, ouverture: 84100, cloture: 84250.456, plusHaut: 84300, plusBas: 84050, centreX: 12 },
    { index: 1, ouverture: 84250, cloture: 84100, plusHaut: 84280, plusBas: 84000, centreX: 18 },
  ],
  analyses: {
    cassures: [{ index: 1, sens: 'haussier', prix: 84300.123 }],
    orderBlocks: [{ index: 0, sens: 'haussier', zone: { haut: 84300.9, bas: 84050.1 }, qualificatifs: { priseDeLiquidite: true, fvg: true } }],
    rejetes: 2,
    assezDeBougies: true,
  },
};

describe('mesureDepuisLecture', () => {
  it('garde les bougies EN ENTIER : c’est la seule donnée irremplaçable', () => {
    // La capture se relit, mais elle ne se re-mesure pas à l'identique si le
    // code d'extraction change. La série, elle, est figée.
    const m = mesureDepuisLecture(lecture, { dimensions: { largeur: 1000, hauteur: 900 } });
    expect(m.nombreDeBougies).toBe(2);
    expect(m.bougies).toHaveLength(2);
    expect(m.bougies[0]).toMatchObject({ index: 0, ouverture: 84100, cloture: 84250.46 });
  });

  it('reporte l’échelle en prix, pas en pixels', () => {
    const m = mesureDepuisLecture(lecture, {});
    expect(m.echelleDesPrix.prixEnHautDuTrace).toBe(87000);
    expect(m.echelleDesPrix.prixEnBasDuTrace).toBe(83400);
    expect(m.echelleDesPrix.hauteurTraceEnPixels).toBe(600);
  });

  it('nomme la convention décimale et dit ce qu’elle coûte', () => {
    const m = mesureDepuisLecture(lecture, {});
    expect(m.conventionDecimale).toBe('point');
    expect(m.commentaireConvention).toMatch(/facteur mille/);
  });

  it('rend null sur une lecture qui a échoué', () => {
    expect(mesureDepuisLecture({ ok: false })).toBeNull();
    expect(mesureDepuisLecture(null)).toBeNull();
  });
});

describe('construireMesure', () => {
  const record = construireMesure({
    lecture,
    marche: { symbole: 'BTCUSD', unite: '15m', provenanceSymbole: 'bandeau' },
    horodatage: '2026-10-03T13:45:12Z',
    dimensions: { largeur: 1000, hauteur: 900 },
    fichiers: { capture: { nom: 'capture.png' }, overlay: null },
  });

  it('porte un type, que l’analyse n’a pas', () => {
    expect(record.type).toBe(TYPE_MESURE);
    expect(record.plan).toBeUndefined();
  });

  it('déduit la devise du symbole', () => {
    expect(record.marche.devise).toBe('USD');
  });

  it('se range dans un dossier distinct de l’analyse de la même seconde', () => {
    // Sans ce suffixe, la mesure écraserait le capture.png de l'analyse.
    expect(cheminDossier(record)).toBe('2026-10-03/134512-BTCUSD-15m-mesure');
    expect(cheminDossier({ ...record, type: undefined })).toBe('2026-10-03/134512-BTCUSD-15m');
  });

  it('écrit un résumé qui suffit à trier', () => {
    expect(record.resume).toMatch(/BTCUSD/);
    expect(record.resume).toMatch(/2 bougies/);
    expect(record.resume).toMatch(/1 order block/);
    expect(record.resume).toMatch(/Aucun modèle n’intervient/);
  });

  it('retient la provenance du symbole', () => {
    expect(record.marche.provenanceSymbole).toBe('bandeau');
  });
});

describe('le rapport ne compte pas une mesure comme un trade', () => {
  const lignes = [
    { id: 'a', horodatage: '2026-10-03T10:00:00Z', statut: 'tp2', direction: 'BUY', ratioRisqueRendementTp1: 2, confianceDeclareeParLeModele: 70, modele: 'm' },
    { id: 'b', horodatage: '2026-10-03T11:00:00Z', statut: 'stop', direction: 'SELL', ratioRisqueRendementTp1: 1.5, confianceDeclareeParLeModele: 60, modele: 'm' },
    { id: 'c-mesure', type: 'mesure', horodatage: '2026-10-03T12:00:00Z', symbole: 'BTCUSD', nombreDeBougies: 210, cassures: 3, orderBlocks: 3 },
  ];

  it('les exclut des statistiques', () => {
    const s = calculerStatistiques(lignes);
    expect(s.total).toBe(2);
    expect(s.tranchees).toBe(2);
    // Sans exclusion, la mesure aurait atterri ici comme un plan non résolu.
    expect(s.parStatut.en_cours).toBeUndefined();
  });

  it('les compte à part dans le rapport, en le disant', () => {
    const r = genererRapport(lignes, { genereLe: '2026-10-03T13:00:00Z' });
    expect(r).toMatch(/2 analyses/);
    expect(r).toMatch(/1 mesure géométrique/);
    expect(r).toMatch(/210 bougies reconstruites/);
    expect(r).toMatch(/ni entrée ni stop/);
  });

  it('reconnaît une ligne de mesure', () => {
    expect(estMesure(lignes[2])).toBe(true);
    expect(estMesure(lignes[0])).toBe(false);
    expect(estMesure(null)).toBe(false);
  });
});

describe('ligneIndexMesure', () => {
  it('ne porte aucun champ de plan', () => {
    const record = construireMesure({
      lecture, marche: { symbole: 'BTCUSD', unite: '15m' },
      horodatage: '2026-10-03T13:45:12Z', fichiers: {},
    });
    const l = ligneIndexMesure(record, 'd');
    expect(l.type).toBe('mesure');
    expect(l.nombreDeBougies).toBe(2);
    expect(l.orderBlocks).toBe(1);
    for (const champ of ['direction', 'prixEntree', 'prixStopLoss', 'statut']) {
      expect(l[champ], champ).toBeUndefined();
    }
  });
});

describe('un nom de dossier dit ce qui manque', () => {
  const sans = { horodatage: '2026-10-03T13:34:15Z', marche: { symbole: null, uniteTemps: null }, type: 'mesure' };

  it('remplace une valeur absente par un repli QUI SURVIT au nettoyage', () => {
    // L'ancien repli valait « ? », effacé juste après par le filtre qui ne
    // garde que lettres et chiffres : le dossier s'appelait `INCONNU--mesure`,
    // avec un champ vide au milieu plutôt qu'un champ qui dit qu'il est vide.
    expect(cheminDossier(sans)).toBe('2026-10-03/133415-INCONNU-NA-mesure');
    expect(cheminDossier(sans)).not.toMatch(/--/);
  });

  it('garde la casse de l’unité de temps, et met le symbole en capitales', () => {
    const r = { ...sans, marche: { symbole: 'btcusd', uniteTemps: '15m' } };
    expect(cheminDossier(r)).toBe('2026-10-03/133415-BTCUSD-15m-mesure');
  });

  it('applique le même repli à l’identifiant', () => {
    expect(construireId('2026-10-03T13:34:15Z', null, null)).toBe('2026-10-03T13:34:15Z-INCONNU-NA');
  });
});
