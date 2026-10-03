import { describe, it, expect } from 'vitest';

import {
  rapprocher, horodatagesSupposes, meilleurDecalage, prixParPixel, CHAMPS,
} from './rapprochement.js';

const PAS = 15 * 60_000;
const FIN = Date.UTC(2026, 9, 3, 13, 0, 0);

/** Une série réelle plausible, et sa lecture bruitée par le quadrillage. */
function serie(n, { bruit = 0, biais = 0, debut = 84000 } = {}) {
  const reelles = [];
  for (let i = 0; i < n; i++) {
    const base = debut + i * 3 + 40 * Math.sin(i / 7);
    reelles.push({
      ouvertureMs: FIN - (n - 1 - i) * PAS,
      ouverture: base, cloture: base + 5,
      plusHaut: base + 18, plusBas: base - 12,
    });
  }
  // Le signe alterne : un bruit constant serait un biais, pas un bruit.
  // Un bruit pseudo-aléatoire, de médiane nulle. Un bruit qui alterne
  // strictement de signe n'est pas du bruit : c'est un motif, et il se
  // comporte autrement dans toute mesure qui regarde des bougies voisines.
  let germe = 7;
  const tire = () => { germe = (germe * 1103515245 + 12345) % 2147483648; return germe / 2147483648 - 0.5; };
  const mesurees = reelles.map((b) => {
    const d = bruit * 2 * tire();
    return Object.fromEntries(CHAMPS.map((c) => [c, b[c] + biais + d]));
  });
  return { reelles, mesurees };
}

describe('horodatagesSupposes', () => {
  it('ancre la DERNIÈRE bougie sur l’instant de la capture', () => {
    // Une bougie lue sur une image n'a qu'un rang. Le seul point fixe est le
    // moment de la capture, où la dernière bougie est celle en cours.
    const t = horodatagesSupposes(3, FIN, 15);
    expect(t).toEqual([FIN - 2 * PAS, FIN - PAS, FIN]);
  });

  it('rend une liste vide plutôt qu’une supposition sur des entrées creuses', () => {
    expect(horodatagesSupposes(0, FIN, 15)).toEqual([]);
    expect(horodatagesSupposes(3, NaN, 15)).toEqual([]);
    expect(horodatagesSupposes(3, FIN, 0)).toEqual([]);
  });
});

describe('meilleurDecalage', () => {
  it('retrouve un décalage de rang introduit exprès', () => {
    // La série porte une FORME. Une rampe parfaitement linéaire ne dit rien de
    // son propre décalage : recentrée, elle est identique à elle-même décalée,
    // et aucun aligneur ne peut trancher — ni celui-ci, ni un autre.
    const vraies = Array.from({ length: 30 }, (_, i) => 100 + i + 9 * Math.sin(i / 2.3));
    const mesurees = vraies.slice(3);                       // décalées de 3
    const r = meilleurDecalage(mesurees, (i) => vraies[i + 3] ?? NaN);
    expect(r.decalage).toBe(0);
    const r2 = meilleurDecalage(mesurees, (i) => vraies[i] ?? NaN);
    expect(r2.decalage).toBe(3);
  });

  it('refuse un alignement qui ne recouvre presque rien', () => {
    // Sans ce garde-fou, le décalage gagnant serait celui qui ne compare que
    // deux bougies : il gagnerait par manque de contre-exemples.
    const mesurees = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(meilleurDecalage(mesurees, (i) => (i > 17 ? 118 : NaN))).toBeNull();
  });
});

describe('rapprocher', () => {
  it('ne trouve aucun écart sur une lecture parfaite', () => {
    const { reelles, mesurees } = serie(60);
    const r = rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 15 });
    expect(r.ok).toBe(true);
    expect(r.decalage).toBe(0);
    expect(r.nombreApparie).toBe(60);
    for (const c of CHAMPS) {
      expect(r.parChamp[c].ecartMedian, c).toBeCloseTo(0, 6);
      expect(r.parChamp[c].biaisMedian, c).toBeCloseTo(0, 6);
    }
  });

  it('chiffre un bruit de lecture SANS le confondre avec un biais', () => {
    // Un bruit de quadrillage alterne de signe ; une échelle fausse déplace
    // tout dans le même sens. Seule la médiane signée les distingue, et c'est
    // la distinction qui décide si l'erreur est explicable ou à corriger.
    const { reelles, mesurees } = serie(60, { bruit: 4 });
    const r = rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 15 });
    expect(r.decalage).toBe(0);
    expect(r.parChamp.cloture.ecartMedian).toBeGreaterThan(0.5);
    expect(r.parChamp.cloture.ecartMedian).toBeLessThan(4);
    expect(Math.abs(r.parChamp.cloture.biaisMedian)).toBeLessThan(1.5);
  });

  it('démasque un biais systématique SANS le dissoudre dans le décalage', () => {
    // LE test de ce fichier. Sur une série qui tend de trois points par
    // bougie, un biais de douze points est annulé en reculant de quatre rangs.
    // Un aligneur qui travaille sur les NIVEAUX saisit cette occasion :
    // l'alignement « réussit », et l'échelle fausse disparaît des résultats.
    // Aligner sur les VARIATIONS l'en empêche — une constante s'annule dans
    // une différence.
    const { reelles, mesurees } = serie(60, { biais: 12 });
    const r = rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 15 });
    expect(r.decalage).toBe(0);
    expect(r.parChamp.cloture.biaisMedian).toBeCloseTo(12, 6);
    expect(r.parChamp.cloture.ecartMedian).toBeCloseTo(12, 6);
  });

  it('retrouve le décalage MALGRÉ un biais, les deux ensemble', () => {
    const { reelles, mesurees } = serie(60, { biais: 12 });
    const r = rapprocher({ mesurees, reelles, finMs: FIN + 2 * PAS, uniteMinutes: 15 });
    expect(r.decalage).toBe(-2);
    expect(r.parChamp.cloture.biaisMedian).toBeCloseTo(12, 6);
  });

  it('rattrape un décalage d’horodatage, au lieu de le compter comme une erreur', () => {
    // La dernière bougie d'un graphique est EN COURS, et la capture est
    // enregistrée après avoir été prise. Un décalage d'une ou deux bougies est
    // la règle ; le compter comme une erreur de lecture serait absurde.
    const { reelles, mesurees } = serie(60);
    const r = rapprocher({ mesurees, reelles, finMs: FIN + 2 * PAS, uniteMinutes: 15 });
    expect(r.decalage).toBe(-2);
    expect(r.parChamp.cloture.ecartMedian).toBeCloseTo(0, 6);
  });

  it('rapporte les quatre prix SÉPARÉMENT', () => {
    // Un plus haut est l'extrémité d'un trait d'un pixel ; une clôture est le
    // bord d'un rectangle large. Les confondre masquerait que le prix sur
    // lequel on pose un stop est le moins fiable des quatre.
    const { reelles, mesurees } = serie(40);
    for (const m of mesurees) m.plusBas -= 25;
    const r = rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 15 });
    expect(r.parChamp.plusBas.ecartMedian).toBeCloseTo(25, 6);
    expect(r.parChamp.cloture.ecartMedian).toBeCloseTo(0, 6);
    expect(r.enPourcent.plusBas).toBeGreaterThan(r.enPourcent.cloture);
  });

  it('refuse de conclure quand rien ne coïncide', () => {
    const { reelles } = serie(60);
    const ailleurs = serie(60, { debut: 9000 }).mesurees;
    const r = rapprocher({ mesurees: ailleurs, reelles, finMs: FIN, uniteMinutes: 15 });
    // L'alignement trouve bien un décalage — il en trouve toujours un — mais
    // l'écart le dénonce : cent pour cent du niveau, pas une erreur de lecture.
    expect(r.ok).toBe(true);
    expect(r.enPourcent.cloture).toBeGreaterThan(50);
  });

  it('dit pourquoi plutôt que de rendre null', () => {
    expect(rapprocher({ mesurees: [], reelles: [], finMs: FIN, uniteMinutes: 15 }).probleme)
      .toMatch(/des deux côtés/);
    const { reelles, mesurees } = serie(10);
    expect(rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 0 }).probleme)
      .toMatch(/unité de temps/);
  });

  it('échoue proprement quand les bougies réelles sont d’une autre période', () => {
    const { mesurees } = serie(60);
    const { reelles } = serie(60);
    for (const b of reelles) b.ouvertureMs -= 400 * PAS;   // deux semaines avant
    const r = rapprocher({ mesurees, reelles, finMs: FIN, uniteMinutes: 15 });
    expect(r.ok).toBe(false);
    expect(r.probleme).toMatch(/unité de temps|ne couvrent pas/);
  });
});

describe('prixParPixel', () => {
  it('donne l’étalon devant lequel toute erreur se lit', () => {
    // Sur la capture réelle : 4 036 points d'étendue sur 783 pixels.
    expect(prixParPixel(4035.69, 783)).toBeCloseTo(5.154, 3);
  });

  it('refuse une étendue ou une hauteur absurde', () => {
    expect(prixParPixel(0, 783)).toBeNull();
    expect(prixParPixel(100, 0)).toBeNull();
  });
});
