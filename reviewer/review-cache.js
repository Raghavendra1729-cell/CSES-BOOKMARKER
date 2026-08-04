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

  function localGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
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
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
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
      .map((k) => ({ key: k, savedAt: (all[k] && all[k].savedAt) || 0 }))
      .sort((a, b) => a.savedAt - b.savedAt);

    const drop = items.slice(0, keys.length - MAX_ENTRIES).map((x) => x.key);
    if (drop.length) await localRemove(drop);
  }

  async function save(submission, data) {
    const sub = slimSubmission(submission);
    const resultId = sub.result_id;
    if (!resultId) {
      // Fallback key from problem + hash of code length/verdict
      sub.result_id =
        "p" +
        (sub.problem_id || "x") +
        "-" +
        String(sub.verdict || "")
          .replace(/\s+/g, "")
          .slice(0, 12) +
        "-" +
        String((sub.code || "").length);
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

  async function saveStage(submission, stage, data, timing) {
    const previous = (await getCached(submission)) || null;
    const review = previous && previous.data && previous.data.summary
      ? previous.data
      : { summary: previous && previous.data && !previous.data.verdict_summary ? null : (previous && previous.data) || null, detail: null };
    if (stage === "summary") review.summary = data;
    else review.detail = data;
    review.timing = { ...(review.timing || {}), [stage]: timing || null };
    return save(submission, review);
  }

  global.CSESReviewCache = {
    getCached,
    getByResultId,
    getByProblemId,
    save,
    saveStage,
    resultKey,
    problemKey,
  };
})(typeof self !== "undefined" ? self : globalThis);
