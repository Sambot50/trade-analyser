import { describe, it, expect, vi } from 'vitest';

import { libererPort, pidsWindows, pidsPosix, PORT_PAR_DEFAUT } from './liberer-port.mjs';

describe('pidsWindows', () => {
  const sortie = `
  Proto  Adresse locale         Adresse distante       État            PID
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       25972
  TCP    127.0.0.1:5173         127.0.0.1:61234        ESTABLISHED     8080
  TCP    0.0.0.0:51730          0.0.0.0:0              LISTENING       4242
  TCP    [::]:5173              [::]:0                 LISTENING       25972
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       777
`;

  it('ne retient que ce qui ÉCOUTE le port demandé', () => {
    expect(pidsWindows(sortie, 5173)).toEqual([25972]);
  });

  it('ne confond pas 5173 avec 51730', () => {
    // Un `includes` naïf sur « 5173 » attraperait aussi le port 51730, et
    // tuerait un processus qui n'a rien à voir.
    expect(pidsWindows(sortie, 5173)).not.toContain(4242);
    expect(pidsWindows(sortie, 51730)).toEqual([4242]);
  });

  it('ignore une connexion ÉTABLIE sur ce port', () => {
    // Un navigateur ouvert sur l'application ne doit pas être fermé parce
    // qu'on relance le serveur.
    expect(pidsWindows(sortie, 5173)).not.toContain(8080);
  });

  it('refuse le processus 0, qui est le noyau', () => {
    expect(pidsWindows('  TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  0', 5173)).toEqual([]);
  });

  it('ne bronche pas sur une sortie vide ou illisible', () => {
    expect(pidsWindows('', 5173)).toEqual([]);
    expect(pidsWindows('n’importe quoi', 5173)).toEqual([]);
  });
});

describe('pidsPosix', () => {
  it('lit une liste de PID, un par ligne', () => {
    expect(pidsPosix('123\n456\n')).toEqual([123, 456]);
  });

  it('écarte le bruit et les doublons', () => {
    expect(pidsPosix('123\n\n123\nabc\n0\n')).toEqual([123]);
  });
});

describe('libererPort', () => {
  it('tue ce qu’il trouve, et rend le compte', () => {
    const tuerPid = vi.fn().mockReturnValue(true);
    const r = libererPort(5173, { trouverPids: () => [11, 22], tuerPid });
    expect(r).toEqual({ port: 5173, trouves: [11, 22], tues: [11, 22] });
    expect(tuerPid).toHaveBeenCalledTimes(2);
  });

  it('ne compte pas comme tué ce qu’il n’a pas pu arrêter', () => {
    // Un processus appartenant à un autre utilisateur résiste. Le dire est
    // utile : Vite échouera ensuite, et il faut savoir pourquoi.
    const r = libererPort(5173, { trouverPids: () => [11, 22], tuerPid: (p) => p === 11 });
    expect(r.tues).toEqual([11]);
    expect(r.trouves).toHaveLength(2);
  });

  it('ne fait rien quand le port est libre, sans se plaindre', () => {
    const tuerPid = vi.fn();
    expect(libererPort(5173, { trouverPids: () => [], tuerPid })).toMatchObject({ trouves: [], tues: [] });
    expect(tuerPid).not.toHaveBeenCalled();
  });

  it('vise le port du serveur de développement par défaut', () => {
    expect(PORT_PAR_DEFAUT).toBe(5173);
  });
});
