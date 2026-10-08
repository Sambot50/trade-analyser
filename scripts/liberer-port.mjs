#!/usr/bin/env node
// Libérer le port du serveur de développement avant de le démarrer.
//
// `vite.config.js` fixe `strictPort: true`, et c'était un choix délibéré : sans
// lui, Vite bascule en silence sur 5174 quand 5173 est pris, et l'on teste
// l'ancien bundle en croyant tester le nouveau. Ça s'est produit, et le défaut
// a coûté une demi-heure à comprendre.
//
// Mais le coût de ce choix est retombé sur l'utilisateur : un serveur oublié
// d'une session précédente bloque la suivante, avec pour seul message « Port
// 5173 is already in use ». Trois fois en deux jours.
//
// Ce script récupère le bénéfice sans le coût : le port est libéré AVANT que
// Vite démarre, donc le serveur est toujours celui qu'on vient de lancer, et
// toujours sur le port attendu.
//
// Il ne tue qu'un processus qui ÉCOUTE le port demandé — jamais un client
// connecté dessus, jamais un processus trouvé par son nom. Un navigateur ouvert
// sur l'application ne doit pas être fermé parce qu'on relance le serveur.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PORT_PAR_DEFAUT = 5173;

/** Le processus qui écoute ce port, sous Windows. */
export function pidsWindows(sortie, port) {
  const pids = new Set();
  for (const ligne of String(sortie).split(/\r?\n/)) {
    // netstat : « TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  25972 »
    const champs = ligne.trim().split(/\s+/);
    if (champs.length < 5 || champs[3] !== 'LISTENING') continue;
    if (!champs[1].endsWith(`:${port}`)) continue;
    const pid = Number(champs[4]);
    // Le processus 0 est le noyau. Le tuer n'est pas une option.
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Le processus qui écoute ce port, sur un système POSIX. */
export function pidsPosix(sortie) {
  const pids = new Set();
  for (const ligne of String(sortie).split(/\r?\n/)) {
    const pid = Number(ligne.trim());
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

function trouver(port) {
  try {
    if (process.platform === 'win32') {
      return pidsWindows(execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }), port);
    }
    return pidsPosix(execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }));
  } catch {
    // Aucun processus trouvé, ou l'outil n'existe pas : dans les deux cas il
    // n'y a rien à libérer, et ce n'est pas une erreur.
    return [];
  }
}

function tuer(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export function libererPort(port = PORT_PAR_DEFAUT, { trouverPids = trouver, tuerPid = tuer } = {}) {
  const pids = trouverPids(port);
  const tues = pids.filter((pid) => tuerPid(pid));
  return { port, trouves: pids, tues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? PORT_PAR_DEFAUT);
  const { trouves, tues } = libererPort(port);
  if (!trouves.length) process.exit(0);
  console.log(`[port] ${port} était tenu par ${trouves.join(', ')} — ${tues.length} processus arrêté(s).`);
  // Laisser au système le temps de rendre le port, sans quoi Vite le trouve
  // encore occupé une fraction de seconde plus tard.
  const fin = Date.now() + 400;
  while (Date.now() < fin) { /* attente courte et volontairement bloquante */ }
}
