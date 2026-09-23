import { describe, it, expect } from 'vitest';
import { analyser, agreger, decrire, detecterSeparateur, lireHorodatage } from './csv.js';
import { dureeUnite } from './bougies.js';
import { cassures } from './structure.js';

const HISTDATA = [
  '20250102 000000;2062.51;2063.11;2062.19;2062.65;0',
  '20250102 000100;2062.65;2062.90;2062.10;2062.20;0',
  '20250102 000200;2062.20;2064.00;2062.15;2063.80;0',
].join('\n');

const METATRADER = [
  '<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<TICKVOL>',
  '2025.01.02,00:00,2062.51,2063.11,2062.19,2062.65,148',
  '2025.01.02,00:01,2062.65,2062.90,2062.10,2062.20,131',
].join('\n');

describe('lireHorodatage', () => {
  it('lit le format HistData collé', () => {
    const { ms, colonnesUtilisees } = lireHorodatage(['20250102 000000']);
    expect(new Date(ms).toISOString()).toBe('2025-01-02T00:00:00.000Z');
    expect(colonnesUtilisees).toBe(1);
  });

  it('lit le format MetaTrader en deux colonnes', () => {
    const { ms, colonnesUtilisees } = lireHorodatage(['2025.01.02', '13:45']);
    expect(new Date(ms).toISOString()).toBe('2025-01-02T13:45:00.000Z');
    expect(colonnesUtilisees).toBe(2);
  });

  it('applique le décalage horaire dans le bon sens', () => {
    // HistData horodate en EST : midi EST vaut 17 h UTC, donc -5 doit
    // AVANCER l'instant, pas le reculer. Une inversion ici décalerait toute
    // la série de dix heures sans jamais lever d'erreur.
    const { ms } = lireHorodatage(['20250102 120000'], -5);
    expect(new Date(ms).toISOString()).toBe('2025-01-02T17:00:00.000Z');
  });

  it('accepte ISO 8601 et les époques', () => {
    expect(lireHorodatage(['2025-01-02T00:00:00Z']).ms).toBe(Date.UTC(2025, 0, 2));
    expect(lireHorodatage(['1735776000000']).ms).toBe(1735776000000);
    expect(lireHorodatage(['1735776000']).ms).toBe(1735776000000);
  });

  it('refuse un horodatage illisible plutôt que de rendre NaN', () => {
    expect(() => lireHorodatage(['hier midi'])).toThrow(/illisible/);
  });
});

describe('detecterSeparateur', () => {
  it('reconnaît le point-virgule, la tabulation et la virgule', () => {
    expect(detecterSeparateur(['a;b;c;d;e;f'])).toBe(';');
    expect(detecterSeparateur(['a\tb\tc\td\te\tf'])).toBe('\t');
    expect(detecterSeparateur(['a,b,c,d,e,f'])).toBe(',');
  });

  it('refuse un fichier qui ne découpe en rien d’exploitable', () => {
    expect(() => detecterSeparateur(['une ligne de prose'])).toThrow(/indétectable/);
  });
});

describe('analyser', () => {
  it('produit des bougies canoniques depuis HistData', () => {
    const { bougies } = analyser(HISTDATA, { unite: '1m' });
    expect(bougies).toHaveLength(3);
    expect(bougies[0]).toMatchObject({
      ouverture: 2062.51, plusHaut: 2063.11, plusBas: 2062.19, cloture: 2062.65,
    });
  });

  it('calcule fermetureMs à partir de l’unité, sans chevauchement', () => {
    const { bougies } = analyser(HISTDATA, { unite: '1m' });
    for (const b of bougies) {
      expect(b.fermetureMs).toBe(b.ouvertureMs + dureeUnite('1m') - 1);
    }
    // La fermeture d'une bougie précède strictement l'ouverture de la suivante.
    expect(bougies[0].fermetureMs).toBeLessThan(bougies[1].ouvertureMs);
  });

  it('laisse le déséquilibre acheteur/vendeur à null plutôt que de l’inventer', () => {
    const { bougies } = analyser(HISTDATA, { unite: '1m' });
    for (const b of bougies) {
      expect(b.delta).toBeNull();
      expect(b.volumeAcheteur).toBeNull();
    }
  });

  it('signale un fichier sans volume réel', () => {
    expect(analyser(HISTDATA, { unite: '1m' }).volumeExploitable).toBe(false);
    expect(analyser(METATRADER, { unite: '1m' }).volumeExploitable).toBe(true);
  });

  it('saute l’en-tête MetaTrader et lit ses deux colonnes de date', () => {
    const { bougies, separateur } = analyser(METATRADER, { unite: '1m' });
    expect(separateur).toBe(',');
    expect(bougies).toHaveLength(2);
    expect(bougies[1].volume).toBe(131);
    expect(new Date(bougies[1].ouvertureMs).toISOString()).toBe('2025-01-02T00:01:00.000Z');
  });

  it('nomme la ligne fautive quand un prix est illisible', () => {
    const casse = HISTDATA.replace('2062.19', 'n/a');
    expect(() => analyser(casse, { unite: '1m' })).toThrow(/Ligne 1/);
  });

  it('refuse un plus haut inférieur au plus bas', () => {
    const incoherent = '20250102 000000;2062.51;2060.00;2063.00;2062.65;0';
    expect(() => analyser(incoherent, { unite: '1m' })).toThrow(/plus haut/);
  });

  it('refuse un fichier vide ou réduit à son en-tête', () => {
    expect(() => analyser('', { unite: '1m' })).toThrow(/vide/);
    expect(() => analyser('<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>', { unite: '1m' })).toThrow(/en-tête/);
  });

  it('remet les bougies en ordre chronologique', () => {
    const desordre = HISTDATA.split('\n').reverse().join('\n');
    const { bougies } = analyser(desordre, { unite: '1m' });
    expect(bougies.map((b) => b.ouverture)).toEqual([2062.51, 2062.65, 2062.20]);
  });
});

/** Cinq minutes de bougies 1 minute, valeurs choisies pour être vérifiables. */
function serieUneMinute(n, debutMs = Date.UTC(2025, 0, 2, 0, 0)) {
  return Array.from({ length: n }, (_, i) => {
    const t = debutMs + i * 60_000;
    return [
      new Date(t).toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 15),
      100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2, 10 + i,
    ].join(';');
  }).join('\n');
}

describe('agreger', () => {
  it('reconstruit exactement une bougie 5 minutes depuis cinq bougies 1 minute', () => {
    const { bougies } = analyser(serieUneMinute(5), { unite: '1m' });
    const [cinq] = agreger(bougies, '5m');

    expect(cinq.ouverture).toBe(bougies[0].ouverture);
    expect(cinq.cloture).toBe(bougies[4].cloture);
    expect(cinq.plusHaut).toBe(Math.max(...bougies.map((b) => b.plusHaut)));
    expect(cinq.plusBas).toBe(Math.min(...bougies.map((b) => b.plusBas)));
    expect(cinq.volume).toBe(bougies.reduce((a, b) => a + b.volume, 0));
  });

  it('aligne les bornes sur l’époque, pas sur la première bougie', () => {
    // Départ à 00:07 : la bougie 15 minutes qui l'accueille commence à 00:00.
    const { bougies } = analyser(serieUneMinute(10, Date.UTC(2025, 0, 2, 0, 7)), { unite: '1m' });
    const quinze = agreger(bougies, '15m');
    expect(new Date(quinze[0].ouvertureMs).toISOString()).toBe('2025-01-02T00:00:00.000Z');
    expect(new Date(quinze[1].ouvertureMs).toISOString()).toBe('2025-01-02T00:15:00.000Z');
  });

  it('ne fabrique aucune bougie dans un trou de marché', () => {
    // Deux blocs séparés par trois heures, comme une coupure de week-end.
    const avant = analyser(serieUneMinute(5, Date.UTC(2025, 0, 2, 0, 0)), { unite: '1m' }).bougies;
    const apres = analyser(serieUneMinute(5, Date.UTC(2025, 0, 2, 3, 0)), { unite: '1m' }).bougies;
    const heures = agreger([...avant, ...apres], '1h');

    expect(heures).toHaveLength(2);
    expect(heures[1].ouvertureMs - heures[0].ouvertureMs).toBe(3 * 3_600_000);
  });

  it('conserve l’invariant anti-lecture-du-futur après agrégation', () => {
    const { bougies } = analyser(serieUneMinute(120), { unite: '1m' });
    for (const b of agreger(bougies, '15m')) {
      expect(b.fermetureMs).toBe(b.ouvertureMs + dureeUnite('15m') - 1);
      expect(b.fermetureMs).toBeGreaterThan(b.ouvertureMs);
    }
  });

  it('produit des bougies que les détecteurs de structure acceptent', () => {
    // Le contrat qui compte : une cassure issue de données CSV est datée à la
    // fermeture, comme sur Binance. Sans fermetureMs, cassures() lèverait.
    const { bougies } = analyser(serieUneMinute(200), { unite: '1m' });
    const quinze = agreger(bougies, '15m');
    for (const c of cassures(quinze, 3)) {
      expect(c.ms).toBe(quinze[c.index].fermetureMs);
      expect(c.ms).toBeGreaterThan(c.msOuverture);
    }
  });
});

describe('decrire', () => {
  it('mesure le taux de remplissage d’une série continue', () => {
    const { bougies } = analyser(serieUneMinute(60), { unite: '1m' });
    expect(decrire(bougies, '1m').tauxDeRemplissage).toBe(1);
  });

  it('signale les trous par un taux inférieur à 1', () => {
    const avant = analyser(serieUneMinute(30, Date.UTC(2025, 0, 2, 0, 0)), { unite: '1m' }).bougies;
    const apres = analyser(serieUneMinute(30, Date.UTC(2025, 0, 2, 1, 0)), { unite: '1m' }).bougies;
    const d = decrire([...avant, ...apres], '1m');
    expect(d.nombre).toBe(60);
    expect(d.tauxDeRemplissage).toBeLessThan(0.7);
  });

  it('rend null sur une série vide', () => {
    expect(decrire([], '1m')).toBeNull();
  });
});
