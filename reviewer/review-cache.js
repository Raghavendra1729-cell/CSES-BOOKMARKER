// Persist AI reviews in chrome.storage.local (result + problem keys).
(function (global) {
  const RESULT_PREFIX = "csesbm:rev:r:";
  const PROBLEM_PREFIX = "csesbm:rev:p:";
  const MAX_ENTRIES = 50;

  function resultKey(resultId) {
    return RESULT_PREFIX + String(resultId);
  }

  function problemKey(problemId) {
    return PROBLEM_PREFIX + String(problemId);
  }

  function fallbackResultId(submission) {
    const text = String(submission.code || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return [
      "p" + (submission.problem_id || "x"),
      String(submission.verdict || "").replace(/\s+/g, "").slice(0, 12) || "unknown",
      (hash >>> 0).toString(36),
    ].join("-");
  }

  function localGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (res) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(res || {});
      });
    });
  }

  function localSet(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function localRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function slimSubmission(sub) {
    sub = sub || {};
    return {
      result_id: sub.result_id || null,
      problem_id: sub.problem_id || null,
      problem_name: sub.problem_name || null,
      category: sub.category || null,
      language: sub.language || null,
      verdict: sub.verdict || null,
      accepted: Boolean(sub.accepted),
      failed_test: sub.failed_test != null ? sub.failed_test : null,
      time_ms: sub.time_ms != null ? sub.time_ms : null,
      memory_kb: sub.memory_kb != null ? sub.memory_kb : null,
      constraints: sub.constraints ? String(sub.constraints).slice(0, 2400) : null,
      samples: sub.samples ? String(sub.samples).slice(0, 2400) : null,
      // Keep code so a cached re-open still has context if needed
      code: sub.code ? String(sub.code).slice(0, 20000) : "",
    };
  }

  async function getByResultId(resultId) {
    if (resultId == null || resultId === "") return null;
    const res = await localGet(resultKey(resultId));
    return res[resultKey(resultId)] || null;
  }

  async function getByProblemId(problemId) {
    if (problemId == null || problemId === "") return null;
    const ptr = await localGet(problemKey(problemId));
    const entry = ptr[problemKey(problemId)];
    if (!entry || !entry.result_id) return null;
    return getByResultId(entry.result_id);
  }

  async function getCached(submission) {
    const sub = submission || {};
    // Prefer exact submission (result page). Do not fall back to another
    // submission on the same problem — that would show a stale review.
    if (sub.result_id) {
      return getByResultId(sub.result_id);
    }
    // Task page / unknown result: latest review for this problem.
    if (sub.problem_id) {
      return getByProblemId(sub.problem_id);
    }
    return null;
  }

  async function pruneIfNeeded() {
    const all = await localGet(null);
    const keys = Object.keys(all || {}).filter((k) => k.startsWith(RESULT_PREFIX));
    if (keys.length <= MAX_ENTRIES) return;

    const items = keys
      .map((key) => ({
        key,
        resultId: key.slice(RESULT_PREFIX.length),
        problemId: all[key] && all[key].problem_id,
        savedAt: (all[key] && all[key].savedAt) || 0,
      }))
      .sort((a, b) => a.savedAt - b.savedAt);

    const expired = items.slice(0, keys.length - MAX_ENTRIES);
    if (!expired.length) return;

    const drop = expired.map((item) => item.key);
    // Only remove a problem pointer when it still targets the entry being
    // pruned. A newer review for the same problem must remain reachable.
    expired.forEach((item) => {
      if (!item.problemId) return;
      const pointer = all[problemKey(item.problemId)];
      if (pointer && String(pointer.result_id) === item.resultId) {
        drop.push(problemKey(item.problemId));
      }
    });
    await localRemove(drop);
  }

  async function save(submission, data) {
    const sub = slimSubmission(submission);
    const resultId = sub.result_id;
    if (!resultId) {
      // Result pages normally have an ID. Keep the rare fallback stable and
      // content-based so two submissions with equal-length source do not
      // overwrite one another.
      sub.result_id = fallbackResultId(sub);
    }

    const rid = String(sub.result_id);
    const entry = {
      result_id: rid,
      problem_id: sub.problem_id,
      savedAt: Date.now(),
      submission: sub,
      schemaVersion: (global.CSESReviewSchema && global.CSESReviewSchema.VERSION) || 1,
      data: data,
    };

    const payload = { [resultKey(rid)]: entry };
    if (sub.problem_id) {
      payload[problemKey(sub.problem_id)] = {
        result_id: rid,
        savedAt: entry.savedAt,
        problem_name: sub.problem_name,
        verdict: sub.verdict,
        accepted: sub.accepted,
      };
    }

    await localSet(payload);
    await pruneIfNeeded();
    return entry;
  }

  global.CSESReviewCache = {
    getCached,
    getByResultId,
    getByProblemId,
    save,
    resultKey,
    problemKey,
    fallbackResultId,
  };
})(typeof self !== "undefined" ? self : globalThis);
