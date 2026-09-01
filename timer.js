// Per-problem solve timer. Live ticking state lives in chrome.storage.local
// (device-local, not synced) so it never touches the sync-quota-conscious
// bookmark storage in storage.js. Only the final solved duration gets copied
// into a bookmark's `timeSpentMs` field once a problem is accepted.
(function () {
  const AREA = chrome.storage.local;
  const PREFIX = "csesbm-timer:";

  const keyFor = (id) => PREFIX + id;

  function normalize(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    if (!["running", "paused", "stopped"].includes(state.status)) return null;
    const accumulatedMs = Number(state.accumulatedMs);
    if (!Number.isFinite(accumulatedMs) || accumulatedMs < 0) return null;
    const next = { status: state.status, accumulatedMs };
    if (state.status === "running") {
      const lastResumeAt = Number(state.lastResumeAt);
      if (!Number.isFinite(lastResumeAt) || lastResumeAt <= 0) return null;
      next.lastResumeAt = lastResumeAt;
    }
    if (state.status === "stopped") next.finalMs = accumulatedMs;
    return next;
  }

  function get(id) {
    const k = keyFor(id);
    return new Promise((resolve, reject) => AREA.get(k, (res) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(normalize(res[k]));
    }));
  }

  function set(id, state) {
    const next = normalize(state);
    if (!next) return Promise.reject(new TypeError("Invalid timer state."));
    return new Promise((resolve, reject) => AREA.set({ [keyFor(id)]: next }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(next);
    }));
  }

  function elapsedMs(state) {
    if (!state) return 0;
    if (state.status === "running") {
      return state.accumulatedMs + Math.max(0, Date.now() - state.lastResumeAt);
    }
    return state.accumulatedMs;
  }

  async function ensureStarted(id) {
    const existing = await get(id);
    if (existing) return existing;
    const state = { status: "running", accumulatedMs: 0, lastResumeAt: Date.now() };
    return set(id, state);
  }

  async function pause(id) {
    const state = await get(id);
    if (!state || state.status !== "running") return state;
    const next = {
      ...state,
      status: "paused",
      accumulatedMs: state.accumulatedMs + (Date.now() - state.lastResumeAt),
    };
    return set(id, next);
  }

  async function resume(id) {
    const state = await get(id);
    if (!state || state.status !== "paused") return state;
    const next = { ...state, status: "running", lastResumeAt: Date.now() };
    return set(id, next);
  }

  // Only way a timer permanently stops: an Accepted verdict (or a
  // reconciliation fallback finding the problem already solved).
  async function stop(id) {
    const state = await get(id);
    if (state && state.status === "stopped") return state;
    const finalMs = elapsedMs(state);
    const next = { status: "stopped", accumulatedMs: finalMs, finalMs };
    return set(id, next);
  }

  globalThis.CSESTimer = { get, set, elapsedMs, ensureStarted, pause, resume, stop };
})();
