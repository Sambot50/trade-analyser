import { describe, it, expect } from 'vitest';

import {
  compression, detecterRanges, issueDeLaSortie, statistiques,
  SEUIL_COMPRESSION, FENETRE,
} from './range.js';
import { serieAleatoire } from './aleatoire.js';

const b = (ouverture, plusHaut, plusBas, cloture, i = 0) => ({
  ouverture, plusHaut, plusBas, cloture,
  ouvertureMs: i * 60_000, fermetureMs: i * 60_000 + 59_999,
});

/** Une série qui oscille dans une bande étroite, puis sort. */
function serieCompressee({ n = 40, centre = 100, demiBande = 1, sortie = null } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = (i % 2 ? 1 : -1) * demiBande;
    out.push(b(centre, centre + Math.abs(d) * 0.9, centre - Math.abs(d) * 0.9, centre + d * 0.5, i));
  }
  if (sortie !== null) out.push(b(centre, Math.max(centre, sortie) + 0.5, Math.min(centre, sortie) - 0.5, sortie, n));
  return out;
}

describe('compression', () => {
  it('rapporte ce qui a été couvert à ce qu’une marche couvrirait', () => {
    // Comparer une hauteur à l'ATR seul ne dit rien : sur 20 bougies, une
    // marche sans structure couvre déjà ATR × √20. C'est la seule référence
    // qui ne suppose rien.
    const s = serieCompressee({ n: 25, demiBande: 1 });
    const c = compression(s, 24, 20);
    expect(c.rapport).toBeLessThan(1);
    expect(c.hauteur).toBeCloseTo(c.haut - c.bas, 10);
  });

  it('rend un rapport SANS DIMENSION, comparable d’un prix à l’autre', () => {
    const petit = serieCompressee({ n: 25, centre: 100, demiBande: 1 });
    const gros = serieCompressee({ n: 25, centre: 90_000, demiBande: 900 });
    expect(compression(petit, 24, 20).rapport).toBeCloseTo(compression(gros, 24, 20).rapport, 6);
  });

  it('refuse de calculer sans assez de bougies derrière', () => {
    const s = serieCompressee({ n: 25 });
    expect(compression(s, 5, 20)).toBeNull();
    expect(compression(s, 24, 1)).toBeNull();
    expect(compression(null, 24, 20)).toBeNull();
  });

  it('refuse une fenêtre contenant une bougie illisible', () => {
    const s = serieCompressee({ n: 25 });
    s[10] = { plusHaut: NaN, plusBas: 1 };
    expect(compression(s, 24, 20)).toBeNull();
  });
});

describe('detecterRanges — LA causalité', () => {
  it('ne lit RIEN du futur', () => {
    // Le test central de ce fichier. On remplace tout ce qui suit la bougie N
    // par des prix absurdes : si la moindre décision prise avant N changeait,
    // c'est qu'une information d'après N y était entrée.
    //
    // Ce dépôt a déjà eu ce défaut — `fix/lecture-du-futur` est dans son
    // historique — et il ne se voit JAMAIS à l'œil : la détection paraît
    // simplement très bonne.
    const serie = serieCompressee({ n: 60, demiBande: 1, sortie: 110 });
    const coupe = 45;

    const abime = serie.map((x, i) => (i <= coupe ? x : b(99_999, 100_001, 99_997, 99_998, i)));
    const avant = detecterRanges(serie).filter((r) => r.index <= coupe);
    const apres = detecterRanges(abime).filter((r) => r.index <= coupe);

    expect(apres.map((r) => r.index)).toEqual(avant.map((r) => r.index));
    for (let k = 0; k < avant.length; k++) {
      expect(apres[k].haut, `range ${k} · borne haute`).toBeCloseTo(avant[k].haut, 10);
      expect(apres[k].bas, `range ${k} · borne basse`).toBeCloseTo(avant[k].bas, 10);
    }
  });

  it('fige les bornes à l’ouverture du range, et ne les élargit plus', () => {
    // Les élargir au fil des bougies ferait qu'une sortie n'arriverait jamais :
    // le range avalerait sa propre cassure.
    const serie = [...serieCompressee({ n: 30, demiBande: 1 })];
    serie.push(b(100, 103, 99, 100.2, 30));   // mèche large, clôture dedans
    serie.push(b(100, 101, 99, 104, 31));     // clôture au-delà
    const [r] = detecterRanges(serie);
    expect(r.haut).toBeLessThan(103);
    expect(r.indexSortie).toBe(31);
  });

  it('sort sur CLÔTURE, jamais sur mèche', () => {
    const serie = [...serieCompressee({ n: 30, demiBande: 1 })];
    serie.push(b(100, 120, 99, 100.1, 30));   // la mèche dépasse, la clôture non
    const [r] = detecterRanges(serie);
    expect(r?.indexSortie ?? null).toBeNull();
    expect(r?.enCours).toBe(true);
  });

  it('compte les touches de chaque borne', () => {
    const serie = serieCompressee({ n: 40, demiBande: 1, sortie: 110 });
    const [r] = detecterRanges(serie);
    expect(r.touchesHaut + r.touchesBas).toBeGreaterThan(0);
  });

  it('rend un range encore ouvert À PART, et ne le confond pas avec un échec', () => {
    const serie = serieCompressee({ n: 40, demiBande: 1 });
    const trouves = detecterRanges(serie);
    expect(trouves.at(-1).enCours).toBe(true);
    expect(trouves.at(-1).indexSortie).toBeNull();
  });

  it('ne trouve rien sur une entrée vide ou absurde', () => {
    expect(detecterRanges(null)).toEqual([]);
    expect(detecterRanges([])).toEqual([]);
  });
});

describe('issueDeLaSortie', () => {
  const range = { indexSortie: 10, haut: 100, bas: 98, hauteur: 2, sensSortie: 'haussier' };

  it('déclare continuation quand le prix va chercher une hauteur de plus', () => {
    const s = Array.from({ length: 20 }, (_, i) => b(100, i === 13 ? 102.5 : 100.5, 99.5, 100.5, i));
    expect(issueDeLaSortie(s, range).issue).toBe('continuation');
  });

  it('déclare retour quand il referme DANS le range', () => {
    const s = Array.from({ length: 20 }, (_, i) => b(100, 100.5, 98.5, i === 12 ? 99 : 100.5, i));
    expect(issueDeLaSortie(s, range).issue).toBe('retour');
  });

  it('refuse de trancher une bougie qui fait les deux', () => {
    // On ne peut pas savoir, à cette résolution, si elle est allée chercher la
    // cible avant de refermer. La compter en continuation serait une supposition.
    const s = [b(100, 100.5, 99.5, 100.5, 0), b(100, 103, 97, 99, 1)];
    const r = { ...range, indexSortie: 0 };
    expect(issueDeLaSortie(s, r)).toMatchObject({ issue: 'indecis', ambigu: true });
  });

  it('rend indécis quand l’horizon s’épuise', () => {
    const s = Array.from({ length: 30 }, (_, i) => b(100, 100.8, 100.2, 100.5, i));
    expect(issueDeLaSortie(s, range, { horizon: 5 }).issue).toBe('indecis');
  });

  it('traite la sortie baissière symétriquement', () => {
    const r = { ...range, sensSortie: 'baissier' };
    const s = Array.from({ length: 20 }, (_, i) => b(98, 98.5, i === 13 ? 95.5 : 97.5, 97.5, i));
    expect(issueDeLaSortie(s, r).issue).toBe('continuation');
  });

  it('rend null sur un range sans sortie', () => {
    expect(issueDeLaSortie([], { ...range, indexSortie: null })).toBeNull();
  });
});

describe('statistiques', () => {
  it('ne compte que ce qui est tranché', () => {
    const s = statistiques([
      { issue: 'continuation' }, { issue: 'continuation' },
      { issue: 'retour' }, { issue: 'indecis' }, { issue: 'indecis', ambigu: true },
    ]);
    expect(s).toMatchObject({ continuation: 2, retour: 1, indecis: 2, ambigus: 1, tranches: 3 });
    expect(s.tauxContinuation).toBeCloseTo(2 / 3, 6);
  });

  it('rend null plutôt que zéro quand rien n’est tranché', () => {
    expect(statistiques([{ issue: 'indecis' }]).tauxContinuation).toBeNull();
    expect(statistiques([]).tauxContinuation).toBeNull();
  });
});

describe('le témoin : une marche sans aucune structure', () => {
  it('y trouve quand même des ranges, et c’est le point', () => {
    // Un détecteur qui ne trouve rien dans du bruit ne détecte rien du tout.
    // Celui-ci en trouve — ce qui veut dire que le simple fait d'EN TROUVER ne
    // prouve rien. Seule la comparaison des issues entre marché réel et marche
    // aléatoire peut dire si la structure existe.
    const bougies = serieAleatoire({ graine: 7, minutes: 4000, sigma: 0.4 });
    const trouves = detecterRanges(bougies).filter((r) => !r.enCours);
    expect(trouves.length).toBeGreaterThan(0);
    expect(SEUIL_COMPRESSION).toBeLessThan(1);
    expect(FENETRE).toBeGreaterThanOrEqual(10);
  });
});

describe('la référence n’est PAS cinquante pour cent', () => {
  it('le hasard donne nettement moins, par construction de la question', () => {
    // La continuation demande d'aller chercher une hauteur de range au-delà ;
    // le retour demande seulement de refermer à l'intérieur, et la bougie de
    // sortie clôture déjà à quelques points de la borne. Le retour est
    // beaucoup plus proche.
    //
    // Conséquence : lire un taux de continuation contre 50 % ferait prendre un
    // résultat ordinaire pour un échec. La référence se MESURE, elle ne se
    // suppose pas — c'est toute la raison d'être du témoin.
    const toutes = [];
    for (let graine = 1; graine <= 6; graine++) {
      const bougies = serieAleatoire({ graine, minutes: 8000, sigma: 0.4 });
      for (const r of detecterRanges(bougies)) {
        if (r.enCours) continue;
        const issue = issueDeLaSortie(bougies, r);
        if (issue) toutes.push(issue);
      }
    }
    const s = statistiques(toutes);
    expect(s.tranches).toBeGreaterThan(50);
    expect(s.tauxContinuation).toBeLessThan(0.5);
    expect(s.tauxContinuation).toBeGreaterThan(0.2);
  });
});
