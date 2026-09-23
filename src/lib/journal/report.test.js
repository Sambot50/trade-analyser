import { describe, it, expect } from 'vitest';
import { calculerStatistiques, genererRapport } from './report.js';
import { construireEnregistrement, ligneIndex, reduireIndex, deviseDeCotation, cheminDossier } from './schema.js';

const ligne = (over = {}) => ({
  id: over.id ?? 'x', horodatage: over.horodatage ?? '2026-09-22T18:00:00Z',
  dossier: '2026-09-22/180000-BTCUSDT-5m', modele: over.modele ?? 'qwen3.8:27b',
  symbole: 'BTCUSDT', uniteTemps: '5m', direction: over.direction ?? 'SELL',
  prixEntree: 86523, prixStopLoss: 86780, prixTp1: 86300, prixTp2: 86100,
  ratioRisqueRendementTp1: over.rr ?? 0.87, verdictRatio: 'defavorable',
  confianceDeclareeParLeModele: over.confiance ?? 70,
  statut: over.statut ?? null, sourceResultat: over.source ?? null,
});

describe('calculerStatistiques', () => {
  it('ne compte que les issues tranchées dans le taux', () => {
    const s = calculerStatistiques([
      ligne({ statut: 'tp1' }), ligne({ statut: 'tp2' }), ligne({ statut: 'stop' }),
      ligne({ statut: 'ambigu' }), ligne({ statut: 'non_declenche' }), ligne({ statut: null }),
    ]);
    expect(s.total).toBe(6);
    expect(s.tranchees).toBe(3);
    expect(s.gagnantes).toBe(2);
    expect(s.tauxReussite).toBeCloseTo(2 / 3, 5);
  });

  it('renvoie un taux nul quand rien n’est tranché', () => {
    const s = calculerStatistiques([ligne({ statut: null }), ligne({ statut: 'en_cours' })]);
    expect(s.tauxReussite).toBeNull();
  });

  it('mesure si la confiance déclarée sépare gagnantes et perdantes', () => {
    const s = calculerStatistiques([
      ligne({ statut: 'tp1', confiance: 90 }), ligne({ statut: 'tp2', confiance: 80 }),
      ligne({ statut: 'stop', confiance: 60 }), ligne({ statut: 'stop', confiance: 50 }),
    ]);
    expect(s.confianceGagnantes).toBe(85);
    expect(s.confiancePerdantes).toBe(55);
    expect(s.ecartConfiance).toBe(30);
  });

  it('calcule la médiane des ratios sur un nombre pair', () => {
    const s = calculerStatistiques([ligne({ rr: 1 }), ligne({ rr: 2 }), ligne({ rr: 3 }), ligne({ rr: 4 })]);
    expect(s.ratioMedian).toBe(2.5);
  });
});

describe('genererRapport', () => {
  const genereLe = '2026-09-23T10:00:00Z';

  it('dit clairement qu’il ne peut rien conclure sans issue', () => {
    const md = genererRapport([ligne({ statut: null })], { genereLe });
    expect(md).toMatch(/Aucune issue tranchée/);
    expect(md).not.toMatch(/Taux de réussite : \d/);
  });

  it('compare le taux constaté au seuil d’équilibre', () => {
    const md = genererRapport([
      ligne({ statut: 'tp1', rr: 2 }), ligne({ statut: 'tp1', rr: 2 }),
      ligne({ statut: 'stop', rr: 2 }), ligne({ statut: 'stop', rr: 2 }),
    ], { genereLe });
    // ratio 2 -> seuil 33 %, constaté 50 % -> au-dessus
    expect(md).toMatch(/33 %/);
    expect(md).toMatch(/au-dessus du seuil/);
  });

  it('signale un taux sous le seuil', () => {
    const md = genererRapport([
      ligne({ statut: 'tp1', rr: 1 }),
      ligne({ statut: 'stop', rr: 1 }), ligne({ statut: 'stop', rr: 1 }),
    ], { genereLe });
    expect(md).toMatch(/en dessous du seuil/);
  });

  it('dit quand la confiance ne prédit rien', () => {
    const md = genererRapport([
      ligne({ statut: 'tp1', confiance: 70 }), ligne({ statut: 'stop', confiance: 72 }),
    ], { genereLe });
    expect(md).toMatch(/ne distingue pas les gagnantes/);
  });

  it('signale une confiance inversée', () => {
    const md = genererRapport([
      ligne({ statut: 'tp1', confiance: 50 }), ligne({ statut: 'stop', confiance: 90 }),
    ], { genereLe });
    expect(md).toMatch(/plus élevée sur les \*\*perdantes\*\*/);
  });

  it('marque les issues saisies à la main', () => {
    const md = genererRapport([ligne({ statut: 'tp1', source: 'manuelle' })], { genereLe });
    expect(md).toMatch(/TP1 \*/);
  });

  it('exclut explicitement les ambigus du taux', () => {
    const md = genererRapport([ligne({ statut: 'ambigu' })], { genereLe });
    expect(md).toMatch(/Ambigu.*non/);
    expect(md).toMatch(/fausserait la mesure/);
  });
});

describe('format d’enregistrement', () => {
  const analyse = {
    symbol: 'BTCUSDT', timeframe: '5m', bias: 'BAISSIER', direction: 'SELL',
    entry: 86523.27, stopLoss: 86780, tp1: 86300, tp2: 86100, confidence: 72,
    reasoning: ['a', 'b'],
    scale: { priceTop: 86800, priceBottom: 85000, plotTopRatio: 0.055, plotBottomRatio: 0.89 },
  };
  const rec = construireEnregistrement({
    analyse,
    moteur: { fournisseur: 'ollama', modele: 'qwen3.8:27b', dureeMs: 21500 },
    fichiers: { capture: { nom: 'capture.png' }, overlay: { nom: 'overlay.png' } },
    horodatage: '2026-09-22T18:48:55Z',
  });

  it('porte une version de schéma', () => {
    expect(rec.schemaVersion).toBe(2);
  });

  it('inscrit la règle de sortie dans le plan', () => {
    // Sans elle, un « stop » ne dit pas si le prix avait frôlé 1 R en chemin
    // ni si ça comptait : l'enregistrement cesse d'être interprétable seul.
    expect(rec.plan.objectifDeSortie).toBe('2r');
    expect(rec.plan.commentaireObjectifDeSortie).toMatch(/ne rapporte rien/);
  });

  it('recalcule le ratio plutôt que de le recopier', () => {
    expect(rec.plan.ratioRisqueRendementTp1).toBe(0.87);
    expect(rec.plan.verdictRatio).toBe('defavorable');
  });

  it('embarque les seuils qui justifient le verdict', () => {
    expect(rec.plan.seuilsVerdictRatio.defavorableEnDessousDe).toBe(1);
  });

  it('déduit la devise de cotation', () => {
    expect(rec.marche.devise).toBe('USDT');
    expect(deviseDeCotation('EURUSD')).toBe('USD');
    expect(deviseDeCotation('INCONNU')).toBeNull();
  });

  it('produit un résumé lisible sans ouvrir le reste', () => {
    expect(rec.resume).toMatch(/^Short BTCUSDT 5m à 86523.27 USDT/);
    expect(rec.resume).toMatch(/issue non constatée/);
  });

  it('range les fichiers dans un dossier trié chronologiquement', () => {
    expect(cheminDossier(rec)).toBe('2026-09-22/184855-BTCUSDT-5m');
  });

  it('laisse le résultat explicitement nul', () => {
    expect(rec.resultat).toBeNull();
    expect('resultat' in rec).toBe(true);
  });
});

describe('reduireIndex', () => {
  it('garde le dernier état de chaque analyse', () => {
    const etat = reduireIndex([
      { id: 'a', horodatage: '2026-09-22T10:00:00Z', statut: null },
      { id: 'b', horodatage: '2026-09-23T10:00:00Z', statut: null },
      { id: 'a', maj: '2026-09-23T11:00:00Z', statut: 'stop' },
    ]);
    expect(etat).toHaveLength(2);
    expect(etat.find((l) => l.id === 'a').statut).toBe('stop');
    expect(etat.find((l) => l.id === 'a').horodatage).toBe('2026-09-22T10:00:00Z');
  });

  it('ignore les lignes sans identifiant', () => {
    expect(reduireIndex([{ statut: 'tp1' }, { id: 'a', horodatage: 'x' }])).toHaveLength(1);
  });
});
