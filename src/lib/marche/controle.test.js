import { describe, it, expect } from 'vitest';
import { generateurAleatoire, melanger, melangerBougies, formeDe, valeurP, resumeDistribution } from './controle.js';

/** Série déterministe, bougies de formes variées, prix strictement positifs. */
function serie(n, debutMs = Date.UTC(2025, 0, 1)) {
  const alea = generateurAleatoire(7);
  let prix = 2400;
  return Array.from({ length: n }, (_, i) => {
    const ouverture = prix;
    const cloture = prix * (1 + (alea() - 0.5) * 0.01);
    const plusHaut = Math.max(ouverture, cloture) * (1 + alea() * 0.003);
    const plusBas = Math.min(ouverture, cloture) * (1 - alea() * 0.003);
    prix = cloture;
    return {
      ouvertureMs: debutMs + i * 60_000,
      fermetureMs: debutMs + (i + 1) * 60_000 - 1,
      ouverture, plusHaut, plusBas, cloture,
      volume: 100 + i, volumeAcheteur: 40 + i, volumeVendeur: 60, delta: -20, nombreTrades: 10 + i,
    };
  });
}

const formes = (bougies) => bougies.map((b, i) => formeDe(b, i ? bougies[i - 1] : null));
// Dix décimales : l'aller-retour log/exp de la reconstruction dérive à la
// douzième, ce qui n'a rien à voir avec ce qu'on vérifie ici.
const trie = (valeurs) => [...valeurs].sort((a, b) => a - b).map((v) => Number(v.toFixed(10)));

describe('generateurAleatoire', () => {
  it('rend la même suite pour une même graine', () => {
    const a = generateurAleatoire(42), b = generateurAleatoire(42);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('rend des suites différentes pour des graines différentes', () => {
    const a = Array.from({ length: 5 }, generateurAleatoire(1));
    const b = Array.from({ length: 5 }, generateurAleatoire(2));
    expect(a).not.toEqual(b);
  });

  it('reste dans [0, 1[', () => {
    const alea = generateurAleatoire(3);
    for (let i = 0; i < 1000; i++) {
      const v = alea();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('melanger', () => {
  it('conserve tous les éléments', () => {
    const avant = [1, 2, 3, 4, 5, 6, 7, 8];
    const apres = melanger([...avant], generateurAleatoire(9));
    expect([...apres].sort((a, b) => a - b)).toEqual(avant);
  });

  it('change effectivement l’ordre', () => {
    const avant = Array.from({ length: 50 }, (_, i) => i);
    expect(melanger([...avant], generateurAleatoire(9))).not.toEqual(avant);
  });
});

describe('melangerBougies — ce qui doit survivre', () => {
  it('conserve exactement la collection des formes de bougies', () => {
    // Le cœur de l'hypothèse nulle : chaque bougie reste elle-même, seule la
    // suite est détruite. Si cette égalité tombe, le contrôle compare la règle
    // à un marché qui n'existe pas.
    const origine = serie(200);
    const melangee = melangerBougies(origine, generateurAleatoire(5));

    for (const champ of ['haut', 'bas', 'cloture']) {
      expect(trie(formes(melangee).map((f) => f[champ])))
        .toEqual(trie(formes(origine).map((f) => f[champ])));
    }
  });

  it('conserve les horodatages, y compris les trous', () => {
    const origine = [...serie(20), ...serie(20, Date.UTC(2025, 0, 3))];
    const melangee = melangerBougies(origine, generateurAleatoire(5));
    expect(melangee.map((b) => b.ouvertureMs)).toEqual(origine.map((b) => b.ouvertureMs));
    expect(melangee.map((b) => b.fermetureMs)).toEqual(origine.map((b) => b.fermetureMs));
  });

  it('conserve le volume total et la collection des volumes', () => {
    const origine = serie(100);
    const melangee = melangerBougies(origine, generateurAleatoire(5));
    const total = (bs) => bs.reduce((a, b) => a + b.volume, 0);
    expect(total(melangee)).toBe(total(origine));
    expect(trie(melangee.map((b) => b.volume))).toEqual(trie(origine.map((b) => b.volume)));
  });

  it('recalcule le déséquilibre acheteur/vendeur de façon cohérente', () => {
    const melangee = melangerBougies(serie(50), generateurAleatoire(5));
    for (const b of melangee) {
      expect(b.volumeAcheteur + b.volumeVendeur).toBeCloseTo(b.volume, 9);
      expect(b.delta).toBeCloseTo(b.volumeAcheteur - b.volumeVendeur, 9);
    }
  });

  it('laisse le déséquilibre absent quand il l’était', () => {
    const sansDelta = serie(20).map((b) => ({ ...b, volumeAcheteur: null, volumeVendeur: null, delta: null }));
    for (const b of melangerBougies(sansDelta, generateurAleatoire(5))) {
      expect(b.delta).toBeNull();
      expect(b.volumeVendeur).toBeNull();
    }
  });
});

describe('melangerBougies — ce qui doit rester valide', () => {
  it('produit des bougies cohérentes : haut ≥ corps ≥ bas', () => {
    for (const b of melangerBougies(serie(300), generateurAleatoire(11))) {
      expect(b.plusHaut).toBeGreaterThanOrEqual(Math.max(b.ouverture, b.cloture) - 1e-9);
      expect(b.plusBas).toBeLessThanOrEqual(Math.min(b.ouverture, b.cloture) + 1e-9);
    }
  });

  it('garde tous les prix strictement positifs', () => {
    for (const b of melangerBougies(serie(300), generateurAleatoire(11))) {
      for (const p of [b.ouverture, b.plusHaut, b.plusBas, b.cloture]) {
        expect(p).toBeGreaterThan(0);
        expect(Number.isFinite(p)).toBe(true);
      }
    }
  });

  it('part du prix d’ouverture réel', () => {
    const origine = serie(50);
    expect(melangerBougies(origine, generateurAleatoire(5))[0].ouverture).toBe(origine[0].ouverture);
  });

  it('est reproductible à graine égale, et différent sinon', () => {
    const origine = serie(100);
    const a = melangerBougies(origine, generateurAleatoire(4));
    const b = melangerBougies(origine, generateurAleatoire(4));
    const c = melangerBougies(origine, generateurAleatoire(5));
    expect(a.map((x) => x.cloture)).toEqual(b.map((x) => x.cloture));
    expect(a.map((x) => x.cloture)).not.toEqual(c.map((x) => x.cloture));
  });

  it('change réellement la suite des prix', () => {
    const origine = serie(200);
    const melangee = melangerBougies(origine, generateurAleatoire(6));
    expect(melangee.map((b) => b.cloture)).not.toEqual(origine.map((b) => b.cloture));
  });

  it('rend la série intacte quand tout tient dans un seul paquet', () => {
    const origine = serie(30);
    const melangee = melangerBougies(origine, generateurAleatoire(6), 30);
    for (const [i, b] of melangee.entries()) {
      expect(b.cloture).toBeCloseTo(origine[i].cloture, 8);
    }
  });

  it('accepte une série trop courte pour être mélangée', () => {
    expect(melangerBougies([], generateurAleatoire(1))).toEqual([]);
    expect(melangerBougies(serie(1), generateurAleatoire(1))).toHaveLength(1);
  });

  it('refuse un prix nul ou négatif plutôt que de produire des NaN', () => {
    const cassee = serie(10);
    cassee[3].plusBas = 0;
    expect(() => melangerBougies(cassee, generateurAleatoire(1))).toThrow(/positifs/);
  });

  it('refuse une taille de paquet absurde', () => {
    expect(() => melangerBougies(serie(10), generateurAleatoire(1), 0)).toThrow(/entier positif/);
  });
});

describe('valeurP', () => {
  it('ne descend jamais à zéro, et annonce son plancher', () => {
    // Sans le +1, cent tirages tous battus afficheraient « p = 0 », c'est-à-dire
    // une impossibilité — alors qu'on a seulement manqué de tirages.
    const controles = Array.from({ length: 100 }, (_, i) => i / 1000);
    const r = valeurP(10, controles);
    expect(r.p).toBe(0.0099);
    expect(r.plancher).toBe(0.0099);
    expect(r.auMoinsAussiBons).toBe(0);
  });

  it('vaut 1 quand tous les contrôles font aussi bien', () => {
    expect(valeurP(0, [0, 0, 0, 0]).p).toBe(1);
  });

  it('compte les contrôles à égalité comme aussi bons', () => {
    expect(valeurP(5, [5, 1, 1, 1]).auMoinsAussiBons).toBe(1);
  });

  it('ignore les tirages non résolus', () => {
    expect(valeurP(5, [1, null, NaN, 9]).tirages).toBe(2);
  });

  it('rend null sans rien d’exploitable', () => {
    expect(valeurP(5, [])).toBeNull();
    expect(valeurP(null, [1, 2])).toBeNull();
  });
});

describe('resumeDistribution', () => {
  it('rend bornes, quartiles et moyenne', () => {
    const r = resumeDistribution([1, 2, 3, 4, 5]);
    expect(r).toMatchObject({ nombre: 5, minimum: 1, mediane: 3, maximum: 5, moyenne: 3 });
    expect(r.premierQuartile).toBe(2);
    expect(r.dernierQuartile).toBe(4);
  });

  it('ne se laisse pas troubler par l’ordre d’arrivée', () => {
    expect(resumeDistribution([5, 1, 4, 2, 3])).toEqual(resumeDistribution([1, 2, 3, 4, 5]));
  });

  it('rend null sur un échantillon vide', () => {
    expect(resumeDistribution([])).toBeNull();
    expect(resumeDistribution([null, NaN])).toBeNull();
  });
});
