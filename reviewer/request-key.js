// Stable, content-based key for coalescing duplicate in-flight review requests.
(function (global) {
  function hash(value) {
    let state = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      state ^= text.charCodeAt(index);
      state = Math.imul(state, 16777619);
    }
    return (state >>> 0).toString(36);
  }

  function forSubmission(submission) {
    const sub = submission || {};
    if (sub.result_id != null && String(sub.result_id).trim()) {
      return "result:" + String(sub.result_id).trim();
    }
    return "submission:" + [sub.problem_id || "?", sub.verdict || "?", hash(sub.code)].join(":");
  }

  global.CSESReviewRequestKey = { forSubmission };
})(typeof self !== "undefined" ? self : globalThis);
