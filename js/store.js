// Archivos (fotos/videos) en IndexedDB para que sobrevivan al recargar.
// Si IndexedDB falla (modo privado), se usa memoria.

const DB = 'proyectalo', STORE = 'media';
const mem = new Map();
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
  }
  return dbp;
}

async function run(mode, fn) {
  const d = await db();
  if (!d) return undefined;
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export async function putMedia(id, rec) {
  mem.set(id, rec);
  try { await run('readwrite', s => s.put(rec, id)); } catch { /* queda en memoria */ }
}

export async function getMedia(id) {
  if (mem.has(id)) return mem.get(id);
  try {
    const rec = await run('readonly', s => s.get(id));
    if (rec) mem.set(id, rec);
    return rec;
  } catch { return undefined; }
}

export async function delMedia(id) {
  mem.delete(id);
  try { await run('readwrite', s => s.delete(id)); } catch { /* nada */ }
}

export async function mediaIds() {
  try {
    const keys = (await run('readonly', s => s.getAllKeys())) || [];
    return new Set([...keys, ...mem.keys()]);
  } catch { return new Set(mem.keys()); }
}
