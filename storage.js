// Shared storage layer, loaded in both the content script and the popup.
// Bookmarks are stored one-per-key under `csesbm:<id>` in chrome.storage.sync.
// This avoids sync's 8 KB-per-item cap that a single big object would hit,
// while staying well under the 512-item / 100 KB sync quota (CSES has ~300 tasks).
(function () {
  const AREA = chrome.storage.sync;
  const PREFIX = "csesbm:";
  const LEGACY_KEY = "bookmarks";

  const keyFor = (id) => PREFIX + id;

  function normalize(b) {
    return {
      id: String(b.id),
      name: b.name || "",
      category: b.category || "",
      url: b.url || `https://cses.fi/problemset/task/${b.id}`,
      note: b.note || "",
      addedAt: b.addedAt || Date.now(),
      status: b.status === "done" ? "done" : "todo",
      csesSolved: Boolean(b.csesSolved),
      timeSpentMs: b.timeSpentMs != null ? b.timeSpentMs : null,
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

  const rawGetAll = () =>
    new Promise((resolve) => AREA.get(null, (all) => resolve(all || {})));

  async function migrateIfNeeded() {
    const all = await rawGetAll();
    const legacy = all[LEGACY_KEY];
    if (!legacy || typeof legacy !== "object") return;
    const toSet = {};
    Object.values(legacy).forEach((b) => {
      if (b && b.id != null) toSet[keyFor(b.id)] = normalize(b);
    });
    if (Object.keys(toSet).length) {
      await new Promise((res) => AREA.set(toSet, res));
    }
    await new Promise((res) => AREA.remove(LEGACY_KEY, res));
  }

  async function getAll() {
    const all = await rawGetAll();
    return Object.keys(all)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => normalize(all[k]));
  }

  async function getMap() {
    const list = await getAll();
    const map = {};
    list.forEach((b) => (map[b.id] = b));
    return map;
  }

  async function get(id) {
    const k = keyFor(id);
    const res = await new Promise((r) => AREA.get(k, r));
    return res[k] ? normalize(res[k]) : null;
  }

  function put(b) {
    const nb = normalize(b);
    return new Promise((resolve, reject) => {
      AREA.set({ [keyFor(nb.id)]: nb }, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve(nb);
      });
    });
  }

  async function patch(id, partial) {
    const cur = await get(id);
    if (!cur) return null;
    return put({ ...cur, ...partial, id });
  }

  const remove = (id) =>
    new Promise((resolve) => AREA.remove(keyFor(id), resolve));

  async function clearAll() {
    const all = await rawGetAll();
    const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
    return new Promise((resolve) => AREA.remove(keys, resolve));
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
