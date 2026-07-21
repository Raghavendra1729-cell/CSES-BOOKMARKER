// Per-problem solve timer. Live ticking state lives in chrome.storage.local
// (device-local, not synced) so it never touches the sync-quota-conscious
// bookmark storage in storage.js. Only the final solved duration gets copied
// into a bookmark's `timeSpentMs` field once a problem is accepted.
(function () {
  const AREA = chrome.storage.local;
  const PREFIX = "csesbm-timer:";

  const keyFor = (id) => PREFIX + id;

  function get(id) {
    const k = keyFor(id);
    return new Promise((resolve) => AREA.get(k, (res) => resolve(res[k] || null)));
  }

  function set(id, state) {
    return new Promise((resolve) => AREA.set({ [keyFor(id)]: state }, resolve));
  }

  function elapsedMs(state) {
    if (!state) return 0;
    if (state.status === "running") {
      return state.accumulatedMs + (Date.now() - state.lastResumeAt);
    }
    return state.accumulatedMs;
  }

  async function ensureStarted(id) {
    const existing = await get(id);
    if (existing) return existing;
    const state = { status: "running", accumulatedMs: 0, lastResumeAt: Date.now() };
    await set(id, state);
    return state;
  }

  async function pause(id) {
    const state = await get(id);
    if (!state || state.status !== "running") return state;
    const next = {
      ...state,
      status: "paused",
      accumulatedMs: state.accumulatedMs + (Date.now() - state.lastResumeAt),
    };
    await set(id, next);
    return next;
  }

  async function resume(id) {
    const state = await get(id);
    if (!state || state.status !== "paused") return state;
    const next = { ...state, status: "running", lastResumeAt: Date.now() };
    await set(id, next);
    return next;
  }

  // Only way a timer permanently stops: an Accepted verdict (or a
  // reconciliation fallback finding the problem already solved).
  async function stop(id) {
    const state = await get(id);
    if (state && state.status === "stopped") return state;
    const finalMs = elapsedMs(state);
    const next = { status: "stopped", accumulatedMs: finalMs, finalMs };
    await set(id, next);
    return next;
  }

  globalThis.CSESTimer = { get, set, elapsedMs, ensureStarted, pause, resume, stop };
})();
