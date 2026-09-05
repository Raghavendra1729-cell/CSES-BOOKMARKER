// Deduplicate identical review requests without letting one caller cancel the
// shared provider request while another caller is still waiting for it.
(function (global) {
  function create() {
    const byKey = new Map();
    const byRequestId = new Map();

    function acquire(key, requestId, start) {
      let entry = byKey.get(key);
      if (!entry) {
        const controller = new AbortController();
        entry = {
          controller,
          requestIds: new Set(),
          task: Promise.resolve().then(() => start(controller)),
        };
        byKey.set(key, entry);
        entry.task.finally(() => {
          entry.requestIds.forEach((id) => {
            if (byRequestId.get(id) === entry) byRequestId.delete(id);
          });
          if (byKey.get(key) === entry) byKey.delete(key);
        });
      }

      entry.requestIds.add(requestId);
      byRequestId.set(requestId, entry);
      return entry.task;
    }

    function cancel(requestId) {
      const entry = byRequestId.get(requestId);
      if (!entry) return false;
      byRequestId.delete(requestId);
      entry.requestIds.delete(requestId);
      if (entry.requestIds.size === 0) entry.controller.abort();
      return true;
    }

    return { acquire, cancel };
  }

  global.CSESReviewCoordinator = { create };
})(typeof self !== "undefined" ? self : globalThis);
