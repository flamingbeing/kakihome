// Storage backends. All three give the same small interface, so the app doesn't care where data lives:
//   load()                 -> { items: [], events: [], shop: [] }
//   put(kind, obj)         save one document (obj.id is its key)
//   del(kind, id)          delete one document
//   listen(cb)             cb(kind, docs, removedIds) when another device changes something (cloud only)
// The local backend keeps everything in this browser's IndexedDB (nothing leaves the phone).
// The memory backend (demo mode, ?demo) keeps made-up items in memory only: nothing is saved anywhere.
// The cloud backend (cloud.js) keeps the household's shared copy in Firestore.

// settings: shared household settings, one document per id (today only 'people': the names given to members)
// KINDS are loaded in full and kept in memory; photos (one per item with a picture, photos/<item id>) are read one at
// a time, when their item is opened (photo.js).
export const KINDS = ['items', 'events', 'shop', 'settings'];
export const PHOTOS = 'photos';
export const ALL_KINDS = [...KINDS, PHOTOS];
const DB = 'kakihome', STORE = 'docs', VER = 1;

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(STORE, mode);
  const out = fn(t.objectStore(STORE));
  t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
  t.onerror = () => rej(t.error);
});

export async function openLocal() {
  const db = await idb();
  return {
    kind: 'local',
    async load() {
      const all = await new Promise((res, rej) => {
        const out = [];
        const t = db.transaction(STORE, 'readonly');
        const c = t.objectStore(STORE).openCursor();
        c.onsuccess = () => { const x = c.result; if (x) { out.push([x.key, x.value]); x.continue(); } };
        t.oncomplete = () => res(out);
        t.onerror = () => rej(t.error);
      });
      const data = Object.fromEntries(KINDS.map(k => [k, []]));
      for (const [k, v] of all) {
        const kind = String(k).split('/')[0];
        if (data[kind]) data[kind].push(v);
      }
      return data;
    },
    get: (kind, id) => new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(`${kind}/${id}`);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => rej(r.error);
    }),
    list: kind => new Promise((res, rej) => {
      const range = IDBKeyRange.bound(kind + '/', kind + '/\uffff');
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range);
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }),
    put: (kind, obj) => tx(db, 'readwrite', s => s.put(obj, `${kind}/${obj.id}`)),
    del: (kind, id) => tx(db, 'readwrite', s => s.delete(`${kind}/${id}`)),
    clear: () => tx(db, 'readwrite', s => s.clear()),
    listen() {},
  };
}

// Demo mode: everything in memory, gone on reload.
export function openMemory(seed = {}) {
  const data = Object.fromEntries(ALL_KINDS.map(k => [k, new Map((seed[k] || []).map(o => [o.id, o]))]));
  return {
    kind: 'memory',
    async load() { return Object.fromEntries(KINDS.map(k => [k, [...data[k].values()]])); },
    async get(kind, id) { return data[kind].get(id) ?? null; },
    async list(kind) { return [...data[kind].values()]; },
    put(kind, obj) { data[kind].set(obj.id, obj); },
    del(kind, id) { data[kind].delete(id); },
    async clear() { for (const k of ALL_KINDS) data[k].clear(); },
    listen() {},
  };
}

// Small per-device settings (not shared with the household): which mode, the household id, display name.
export const prefs = {
  get(k, d = null) { try { const v = localStorage.getItem('kakihome:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kakihome:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('kakihome:' + k); } catch { /* private mode */ } },
};
