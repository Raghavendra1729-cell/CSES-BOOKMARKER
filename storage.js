// Shared storage layer, loaded in both the content script and the popup.
// Bookmarks are stored one-per-key under `csesbm:<id>` in chrome.storage.sync.
// This avoids sync's 8 KB-per-item cap that a single big object would hit,
// while staying well under the 512-item / 100 KB sync quota (CSES has ~300 tasks).
(function () {
  const AREA = chrome.storage.sync;
  const PREFIX = "csesbm:";
  const LEGACY_KEY = "bookmarks";

  const keyFor = (id) => PREFIX + id;

  function storageError() {
    const error = chrome.runtime && chrome.runtime.lastError;
    return error ? new Error(error.message || "Chrome storage failed.") : null;
  }

  function text(value, maximum) {
    return String(value == null ? "" : value).slice(0, maximum);
  }

  function normalize(b) {
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      throw new TypeError("Bookmark must be an object.");
    }
    const id = String(b.id == null ? "" : b.id).trim();
    if (!/^\d{1,12}$/.test(id)) throw new TypeError("Invalid CSES problem ID.");
    const addedAt = Number(b.addedAt);
    const timeSpentMs = Number(b.timeSpentMs);
    return {
      id,
      name: text(b.name, 200),
      category: text(b.category, 120),
      // Never trust a URL from Sync or an imported backup.
      url: `https://cses.fi/problemset/task/${id}`,
      note: text(b.note, 1000),
      addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now(),
      status: b.status === "done" ? "done" : "todo",
      csesSolved: b.csesSolved === true,
      timeSpentMs: b.timeSpentMs != null && Number.isFinite(timeSpentMs) && timeSpentMs >= 0 ? timeSpentMs : null,
    };
  }

  // Shared by the on-page timer widget and the popup's solve-time tag.
  function formatDuration(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  const rawGet = (keys) =>
    new Promise((resolve, reject) => AREA.get(keys, (result) => {
      const error = storageError();
      if (error) reject(error);
      else resolve(result || {});
    }));

  const rawGetAll = () => rawGet(null);

  const rawSet = (values) =>
    new Promise((resolve, reject) => AREA.set(values, () => {
      const error = storageError();
      if (error) reject(error);
      else resolve();
    }));

  const rawRemove = (keys) =>
    new Promise((resolve, reject) => AREA.remove(keys, () => {
      const error = storageError();
      if (error) reject(error);
      else resolve();
    }));

  async function migrateIfNeeded() {
    const all = await rawGetAll();
    const legacy = all[LEGACY_KEY];
    if (!legacy || typeof legacy !== "object") return;
    const toSet = {};
    Object.values(legacy).forEach((b) => {
      try {
        const bookmark = normalize(b);
        toSet[keyFor(bookmark.id)] = bookmark;
      } catch (_) {
        // Ignore corrupt legacy entries instead of blocking every bookmark.
      }
    });
    if (Object.keys(toSet).length) await rawSet(toSet);
    await rawRemove(LEGACY_KEY);
  }

  async function getAll() {
    const all = await rawGetAll();
    return Object.keys(all)
      .filter((k) => k.startsWith(PREFIX))
      .flatMap((k) => {
        try { return [normalize(all[k])]; } catch (_) { return []; }
      });
  }

  async function getMap() {
    const list = await getAll();
    const map = {};
    list.forEach((b) => (map[b.id] = b));
    return map;
  }

  async function get(id) {
    const k = keyFor(id);
    const res = await rawGet(k);
    if (!res[k]) return null;
    try { return normalize(res[k]); } catch (_) { return null; }
  }

  function put(b) {
    const nb = normalize(b);
    return rawSet({ [keyFor(nb.id)]: nb }).then(() => nb);
  }

  async function patch(id, partial) {
    const cur = await get(id);
    if (!cur) return null;
    return put({ ...cur, ...partial, id });
  }

  const remove = (id) => rawRemove(keyFor(id));

  async function clearAll() {
    const all = await rawGetAll();
    const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
    if (!keys.length) return;
    await rawRemove(keys);
  }

  globalThis.CSESBM = {
    PREFIX,
    keyFor,
    normalize,
    formatDuration,
    migrateIfNeeded,
    getAll,
    getMap,
    get,
    put,
    patch,
    remove,
    clearAll,
  };
})();
