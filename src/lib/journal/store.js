// Stockage du journal.
//
// Deux couches, avec des rôles distincts :
//
// - IndexedDB est le TAMPON. Il fonctionne toujours, sans autorisation, et
//   garantit qu'une analyse n'est jamais perdue entre sa production et son
//   écriture sur disque.
// - Le dossier sur disque est la MÉMOIRE. C'est lui qui survit à un nettoyage
//   du navigateur, qui se sauvegarde et qui se lit avec d'autres outils.
//
// Le tampon n'est jamais traité comme une mémoire : l'interface dit combien
// d'analyses n'ont pas encore atteint le disque.

const BASE = 'trade-analyser-journal';
const VERSION = 1;
const ANALYSES = 'analyses';
const REGLAGES = 'reglages';

function ouvrirBase() {
  return new Promise((resolve, reject) => {
    const requete = indexedDB.open(BASE, VERSION);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(ANALYSES)) db.createObjectStore(ANALYSES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(REGLAGES)) db.createObjectStore(REGLAGES);
    };
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

function transaction(db, magasin, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(magasin, mode);
    const requete = action(tx.objectStore(magasin));
    tx.oncomplete = () => resolve(requete?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// --- Tampon -----------------------------------------------------------------

/** @param entree { record, capture: Blob, overlay: Blob, ecritSurDisque: boolean } */
export async function deposerDansTampon(entree) {
  const db = await ouvrirBase();
  try {
    await transaction(db, ANALYSES, 'readwrite', (s) => s.put({ ...entree, id: entree.record.id }));
  } finally {
    db.close();
  }
}

export async function listerTampon() {
  const db = await ouvrirBase();
  try {
    const tout = await transaction(db, ANALYSES, 'readonly', (s) => s.getAll());
    return (tout || []).sort((a, b) => (a.record.horodatage < b.record.horodatage ? -1 : 1));
  } finally {
    db.close();
  }
}

export async function majEntree(id, transformation) {
  const db = await ouvrirBase();
  try {
    const existante = await transaction(db, ANALYSES, 'readonly', (s) => s.get(id));
    if (!existante) throw new Error(`Analyse absente du tampon : ${id}`);
    const suivante = transformation(existante);
    await transaction(db, ANALYSES, 'readwrite', (s) => s.put(suivante));
    return suivante;
  } finally {
    db.close();
  }
}

export async function nombreNonEcrites() {
  return (await listerTampon()).filter((e) => !e.ecritSurDisque).length;
}

// --- Dossier sur disque ------------------------------------------------------

export function accesDisqueDisponible() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function choisirDossier() {
  if (!accesDisqueDisponible()) {
    throw new Error(
      'Ce navigateur ne sait pas écrire dans un dossier local. Utilise Chrome ou Edge, ' +
      'ou exporte le journal à la main.'
    );
  }
  const handle = await window.showDirectoryPicker({ id: 'journal-trade-analyser', mode: 'readwrite' });
  const db = await ouvrirBase();
  try {
    await transaction(db, REGLAGES, 'readwrite', (s) => s.put(handle, 'dossier'));
  } finally {
    db.close();
  }
  return handle;
}

/**
 * Récupère le dossier mémorisé.
 * Renvoie null si aucun n'a été choisi, ou si l'autorisation a expiré —
 * le navigateur la redemande à chaque session, c'est par conception.
 */
export async function dossierMemorise({ redemander = false } = {}) {
  const db = await ouvrirBase();
  let handle;
  try {
    handle = await transaction(db, REGLAGES, 'readonly', (s) => s.get('dossier'));
  } finally {
    db.close();
  }
  if (!handle) return null;

  const etat = await handle.queryPermission({ mode: 'readwrite' });
  if (etat === 'granted') return handle;
  if (!redemander) return null;

  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted' ? handle : null;
}

async function sousDossier(racine, chemin) {
  let courant = racine;
  for (const segment of chemin.split('/').filter(Boolean)) {
    courant = await courant.getDirectoryHandle(segment, { create: true });
  }
  return courant;
}

async function ecrireFichier(dossier, nom, contenu) {
  const fichier = await dossier.getFileHandle(nom, { create: true });
  const flux = await fichier.createWritable();
  await flux.write(contenu);
  await flux.close();
}

async function lireFichier(racine, nom) {
  try {
    const handle = await racine.getFileHandle(nom);
    return await (await handle.getFile()).text();
  } catch {
    return null; // absent : premier démarrage
  }
}

async function ajouterLigne(racine, nom, objet) {
  const existant = (await lireFichier(racine, nom)) ?? '';
  await ecrireFichier(racine, nom, existant + JSON.stringify(objet) + '\n');
}

export async function lireLignesIndex(racine) {
  const texte = await lireFichier(racine, 'index.jsonl');
  if (!texte) return [];
  return texte
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

export { ecrireFichier, ajouterLigne, sousDossier, lireFichier };
