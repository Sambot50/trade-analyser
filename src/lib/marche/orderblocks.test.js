import { describe, it, expect } from 'vitest';
import { cassures, HAUSSIER } from './structure.js';
import { detecter, detecterEnDetail, valideParLeVolume, CRITERE_VOLUME } from './orderblocks.js';

/** Bougie compacte : ouverture, haut, bas, clôture, volume, volume acheteur. */
const b = (o, h, l, c, v = 100, va = 60) => ({
  ouverture: o, plusHaut: h, plusBas: l, cloture: c,
  volume: v, volumeAcheteur: va, volumeVendeur: v - va, delta: 2 * va - v, nombreTrades: 10,
});
const serie = (...bs) => bs.map((x, i) => ({
  ...x, ouvertureMs: i * 60000, fermetureMs: i * 60000 + 59_999,
}));
/** Bougie calme, de volume donné, dont 60 % est acheteur. */
const calme = (prix, v) => b(prix, prix + 1, prix - 1, prix, v, 0.6 * v);

/**
 * Une cassure haussière dont l'order block est la bougie baissière d'indice 7.
 * `volumeOb` et `acheteurOb` règlent l'empreinte de cette bougie-là.
 *
 * Les volumes précédents varient autour de 100 : à volume rigoureusement
 * constant, l'écart-type est nul et la mesure en écarts-types perd son sens.
 * Une série de test trop régulière ferait passer un seuil qui ne marche pas.
 */
const cassureHaussiere = ({ volumeOb = 100, acheteurOb = 60 } = {}) => serie(
  calme(100, 90), calme(100, 110), calme(100, 100),
  b(100, 120, 99, 110),          // 3 — sommet pivot
  calme(100, 80), calme(100, 100), calme(100, 120), // 4,5,6 — le pivot se confirme
  b(100, 101, 95, 96, volumeOb, acheteurOb), // 7 — la bougie baissière : l'order block
  b(96, 130, 96, 125),           // 8 — l'impulsion casse le sommet
);

describe('détection sans critère de volume', () => {
  it('rend un order block par cassure, comme avant', () => {
    const s = cassureHaussiere();
    const obs = detecter(s, cassures(s, 2));
    expect(obs).toHaveLength(1);
    expect(obs[0].index).toBe(7);
    expect(obs[0].sens).toBe(HAUSSIER);
  });

  it('ne rejette rien, puisqu’il n’y a rien à passer', () => {
    const s = cassureHaussiere();
    expect(detecterEnDetail(s, cassures(s, 2)).rejetes).toHaveLength(0);
  });
});

describe('le volume valide l’order block', () => {
  it('retient une bougie dont le volume dépasse le seuil', () => {
    const s = cassureHaussiere({ volumeOb: 300 });
    const { retenus, rejetes } = detecterEnDetail(s, cassures(s, 2), { volume: { rapportMinimum: 2 } });
    expect(retenus).toHaveLength(1);
    expect(rejetes).toHaveLength(0);
    expect(retenus[0].volumeMesure.volumeRapporteALaMoyenne).toBe(3);
  });

  it('écarte la même bougie quand le seuil monte au-dessus d’elle', () => {
    const s = cassureHaussiere({ volumeOb: 300 });
    const { retenus, rejetes } = detecterEnDetail(s, cassures(s, 2), { volume: { rapportMinimum: 4 } });
    expect(retenus).toHaveLength(0);
    expect(rejetes).toHaveLength(1);
  });

  it('dit de combien le seuil a été manqué, sans quoi il serait irréglable', () => {
    const s = cassureHaussiere({ volumeOb: 300 });
    const { rejetes } = detecterEnDetail(s, cassures(s, 2), { volume: { rapportMinimum: 4 } });
    expect(rejetes[0].raison).toContain('3');
    expect(rejetes[0].raison).toContain('4');
    expect(rejetes[0].mesure.volumeRapporteALaMoyenne).toBe(3);
  });

  it('accepte aussi un seuil en écarts-types', () => {
    const s = cassureHaussiere({ volumeOb: 300 });
    const { retenus } = detecterEnDetail(s, cassures(s, 2), { volume: { ecartsTypesMinimum: 1 } });
    expect(retenus).toHaveLength(1);
  });
});

describe('absorption — le déséquilibre à contre-courant de la bougie', () => {
  it('retient une bougie baissière sur laquelle les acheteurs dominent', () => {
    // 300 de volume dont 250 acheteur : delta +200, alors que la bougie est rouge.
    const s = cassureHaussiere({ volumeOb: 300, acheteurOb: 250 });
    const { retenus } = detecterEnDetail(s, cassures(s, 2), { volume: { absorptionMinimum: 1 } });
    expect(retenus).toHaveLength(1);
    expect(retenus[0].volumeMesure.absorption).toBeGreaterThan(1);
  });

  it('écarte la même bougie quand ce sont les vendeurs qui dominent', () => {
    // 300 de volume dont 50 acheteur : delta −200, la bougie rouge est vendue.
    const s = cassureHaussiere({ volumeOb: 300, acheteurOb: 50 });
    const { retenus, rejetes } = detecterEnDetail(s, cassures(s, 2), { volume: { absorptionMinimum: 0 } });
    expect(retenus).toHaveLength(0);
    expect(rejetes[0].raison).toContain('absorption');
  });

  it('écarte, sans inventer, quand la ventilation acheteur/vendeur manque', () => {
    const s = cassureHaussiere({ volumeOb: 300 }).map((x) => ({ ...x, delta: null, volumeAcheteur: null }));
    const { retenus, rejetes } = detecterEnDetail(s, cassures(s, 2), { volume: { absorptionMinimum: 0 } });
    expect(retenus).toHaveLength(0);
    expect(rejetes[0].raison).toMatch(/indisponible/);
  });
});

describe('garde-fous', () => {
  it('refuse de tourner sur une série sans volume plutôt que de tout rejeter en silence', () => {
    const s = cassureHaussiere().map((x) => ({ ...x, volume: 0 }));
    expect(() => detecterEnDetail(s, cassures(s, 2), { volume: { rapportMinimum: 2 } }))
      .toThrow(/aucun volume mesurable/);
  });

  it('laisse passer tout le monde quand aucun seuil n’est posé', () => {
    const s = cassureHaussiere({ volumeOb: 1 });
    expect(detecter(s, cassures(s, 2), { volume: { ...CRITERE_VOLUME } })).toHaveLength(1);
  });

  it('rend la mesure à côté du verdict, y compris quand il est positif', () => {
    const s = cassureHaussiere({ volumeOb: 300 });
    const v = valideParLeVolume(s, 7, { rapportMinimum: 2 }, HAUSSIER);
    expect(v.valide).toBe(true);
    expect(v.mesure.volumeRapporteALaMoyenne).toBe(3);
  });
});
