import { describe, it, expect } from 'vitest';
import {
  quartiles, comparerGroupes, analyserBinaire, analyserContinue, analyserTout,
  pFamilial, lireJsonl, gagnant, blocHoraire, MINIMUM_PAR_GROUPE, EXCLUES,
} from './analyser-export.mjs';

/** n cas dont `gagnants` gagnent, tous portant `champs`. */
const groupe = (n, gagnants, champs = {}) =>
  Array.from({ length: n }, (_, i) => ({ gagne: i < gagnants, ...champs }));

describe('quartiles', () => {
  it('découpe un échantillon étalé', () => {
    const b = quartiles([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b.q1).toBeLessThan(b.q2);
    expect(b.q2).toBeLessThan(b.q3);
  });

  it('refuse un échantillon trop court', () => {
    expect(quartiles([1, 2, 3])).toBeNull();
  });

  it('refuse une variable quasi constante', () => {
    // Le défaut qui produisait le plus gros écart du classement :
    // `bougiesDansLaZone` valait 0 pour 188 cas sur 191, et ses « quartiles »
    // comparaient 3 cas à 188.
    expect(quartiles([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull();
  });
});

describe('comparerGroupes', () => {
  it('rend l’écart et sa version rapportée à l’erreur-type', () => {
    const r = comparerGroupes(groupe(50, 35), groupe(50, 20), 'A', 'B');
    expect(r.ecart).toBeCloseTo(0.3, 2);
    expect(r.z).toBeGreaterThan(2);
  });

  it('refuse un groupe trop petit', () => {
    expect(comparerGroupes(groupe(5, 5), groupe(50, 25), 'A', 'B')).toBeNull();
    expect(comparerGroupes(groupe(50, 25), groupe(5, 0), 'A', 'B')).toBeNull();
  });

  it('pénalise le petit échantillon à écart égal', () => {
    // Deux comparaisons au même écart de 20 points : celle qui repose sur
    // moins de cas doit rendre un z plus faible. Sans ça, le classement trie
    // les variables par la petitesse de leur échantillon.
    const petit = comparerGroupes(groupe(20, 12), groupe(20, 8), 'A', 'B');
    const grand = comparerGroupes(groupe(200, 120), groupe(200, 80), 'A', 'B');
    expect(petit.ecart).toBeCloseTo(grand.ecart, 6);
    expect(Math.abs(petit.z)).toBeLessThan(Math.abs(grand.z));
  });

  it('rend un z nul quand les deux groupes se valent', () => {
    expect(comparerGroupes(groupe(50, 25), groupe(50, 25), 'A', 'B').z).toBe(0);
  });
});

describe('analyserBinaire', () => {
  it('sépare vrais et faux', () => {
    const cas = [...groupe(40, 30, { marque: true }), ...groupe(40, 10, { marque: false })];
    const r = analyserBinaire(cas, 'marque');
    expect(r.groupeA.n).toBe(40);
    expect(r.ecart).toBeCloseTo(0.5, 2);
  });

  it('ignore les cas où le champ n’est pas booléen', () => {
    const cas = [...groupe(40, 20, { marque: true }), ...groupe(40, 20, { marque: false }),
                 ...groupe(30, 30, { marque: null })];
    expect(analyserBinaire(cas, 'marque').n).toBe(80);
  });

  it('rend null quand un des deux groupes est trop rare', () => {
    const cas = [...groupe(3, 3, { marque: true }), ...groupe(100, 50, { marque: false })];
    expect(analyserBinaire(cas, 'marque')).toBeNull();
  });
});

describe('analyserContinue', () => {
  it('rend les quatre quartiles et compare les extrêmes', () => {
    const cas = Array.from({ length: 200 }, (_, i) => ({ v: i, gagne: i >= 150 }));
    const r = analyserContinue(cas, 'v');
    expect(r.parQuartile).toHaveLength(4);
    expect(r.groupeA.taux).toBeGreaterThan(r.groupeB.taux);
    expect(r.z).toBeGreaterThan(3);
  });

  it('rend null sur une variable sans dispersion', () => {
    expect(analyserContinue(groupe(100, 50, { v: 7 }), 'v')).toBeNull();
  });

  it('ignore les valeurs absentes', () => {
    const cas = [...Array.from({ length: 120 }, (_, i) => ({ v: i, gagne: i % 2 === 0 })),
                 ...groupe(50, 25, { v: null })];
    expect(analyserContinue(cas, 'v').n).toBe(120);
  });
});

describe('analyserTout — classement', () => {
  it('place en tête la variable au plus fort z, pas au plus fort écart', () => {
    const cas = [
      // Écart énorme sur peu de cas : doit passer APRÈS.
      ...groupe(22, 20, { typeCassure: 'CHoCH', sens: 'haussier', aligne: true }),
      ...groupe(22, 2, { typeCassure: 'CHoCH', sens: 'baissier', aligne: true }),
      // Écart modéré sur beaucoup de cas.
      ...groupe(200, 130, { typeCassure: 'BOS', sens: 'haussier', aligne: true }),
      ...groupe(200, 90, { typeCassure: 'BOS', sens: 'haussier', aligne: false }),
    ];
    const r = analyserTout(cas);
    expect(Math.abs(r[0].z)).toBeGreaterThanOrEqual(Math.abs(r[r.length - 1].z));
    expect(r.every((x, i) => i === 0 || Math.abs(r[i - 1].z) >= Math.abs(x.z))).toBe(true);
  });
});

describe('pFamilial', () => {
  it('rend un p élevé quand rien ne sépare rien', () => {
    // Issues tirées indépendamment des variables : la recherche ne doit
    // trouver que du bruit, et le dire.
    const cas = Array.from({ length: 300 }, (_, i) => ({
      gagne: i % 2 === 0,
      typeCassure: i % 3 === 0 ? 'CHoCH' : 'BOS',
      sens: i % 5 === 0 ? 'baissier' : 'haussier',
      aligne: i % 7 === 0,
      heureUtc: i % 24,
      zoneSurAtr: (i * 37) % 100,
    }));
    const r = pFamilial(cas, analyserTout(cas)[0].z, 40, 3);
    expect(r.p).toBeGreaterThan(0.2);
  });

  it('ne descend jamais à zéro', () => {
    const cas = Array.from({ length: 200 }, (_, i) => ({
      gagne: i < 100, zoneSurAtr: i, heureUtc: i % 24,
      typeCassure: 'BOS', sens: 'haussier', aligne: true,
    }));
    const r = pFamilial(cas, 99, 20, 1);
    expect(r.p).toBeCloseTo(1 / 21, 4);
  });
});

describe('lireJsonl', () => {
  it('lit une ligne par enregistrement', () => {
    expect(lireJsonl('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('nomme la ligne fautive', () => {
    expect(() => lireJsonl('{"a":1}\npas du json\n')).toThrow(/Ligne 2/);
  });
});

describe('gagnant', () => {
  it('classe par le gain en R', () => {
    expect(gagnant({ gainEnR: 2 })).toBe(true);
    expect(gagnant({ gainEnR: -1 })).toBe(false);
  });

  it('écarte les issues qui ne comptent pas', () => {
    expect(gagnant({ gainEnR: null })).toBeNull();
    expect(gagnant({})).toBeNull();
  });
});

describe('blocHoraire', () => {
  it('range les heures en quatre blocs de six', () => {
    expect(blocHoraire(0)).toBe('00-05');
    expect(blocHoraire(9)).toBe('06-11');
    expect(blocHoraire(15)).toBe('12-17');
    expect(blocHoraire(23)).toBe('18-23');
  });
});

describe('garde-fous déclarés', () => {
  it('exclut les variables mesurées après l’entrée', () => {
    // MFE et MAE sont des conséquences de l'issue : les traiter comme
    // prédicteurs reviendrait à prédire l'issue par elle-même.
    expect(EXCLUES).toContain('faveurMaxEnR');
    expect(EXCLUES).toContain('contreMaxEnR');
    expect(EXCLUES).toContain('gainEnR');
  });

  it('impose une taille minimale de groupe', () => {
    expect(MINIMUM_PAR_GROUPE).toBeGreaterThanOrEqual(20);
  });
});
