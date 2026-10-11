// Activity log storage: one IndexedDB store, local to this browser profile. Nothing is sent anywhere.
const DB = "workflow-detective", STORE = "events";
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); s.createIndex("t", "t"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbp = null; reject(r.error); };
  });
  return dbp;
}
function run(mode, body) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), st = tx.objectStore(STORE);
    let result;
    body(st, v => { result = v; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const addEvent = ev => run("readwrite", st => st.add(ev));
export const allEvents = () => run("readonly", (st, set) => { const r = st.getAll(); r.onsuccess = () => set(r.result); });
export const countSince = t => run("readonly", (st, set) => { const r = st.index("t").count(IDBKeyRange.lowerBound(t)); r.onsuccess = () => set(r.result); });
export const deleteIds = ids => run("readwrite", st => ids.forEach(id => st.delete(id)));
export const clearAll = () => run("readwrite", st => st.clear());
export const deleteWhere = pred => run("readwrite", st => {
  const r = st.openCursor();
  r.onsuccess = () => { const c = r.result; if (!c) return; if (pred(c.value)) c.delete(); c.continue(); };
});
