// Hugging Face OpenAI-compatible router client. One retry, explicit deadlines.
(function (global) {
  const DEFAULTS = { baseUrl: "https://router.huggingface.co/v1", detailModel: "MiniMaxAI/MiniMax-M3:novita", summaryModel: "Qwen/Qwen2.5-Coder-32B-Instruct:fastest" };
  function extractJson(text) {
    let s = String(text || "").trim();
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) s = m[1].trim();
    try { return JSON.parse(s); } catch (_) { const a = s.indexOf("{"), b = s.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)); throw new Error("Model did not return valid JSON"); }
  }
  function content(choice) { const c = choice && choice.message && choice.message.content; return typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => x.text || "").join("") : ""; }
  function transient(status, message) { return [429, 502, 503, 504].includes(status) || /timeout|network|connection|temporar|rate/i.test(message || ""); }
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function request(settings, messages, options, strict) {
    const controller = options.controller || new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), options.timeoutMs);
    const model = options.model;
    try {
      const body = { model, messages, max_tokens: options.maxTokens, temperature: 0.15 };
      if (strict) body.response_format = { type: "json_schema", json_schema: global.CSESReviewSchema.jsonSchema(options.schemaStage) };
      const response = await fetch(String(settings.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, "") + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.hfToken }, body: JSON.stringify(body), signal: controller.signal });
      const raw = await response.text(); let json; try { json = JSON.parse(raw); } catch (_) { json = null; }
      if (!response.ok) { const err = new Error((json && (json.error && (json.error.message || json.error) || json.message)) || raw || response.statusText); err.status = response.status; err.retryAfter = Number(response.headers.get("Retry-After")) || 0; err.strictUnsupported = strict && response.status === 400 && /response_format|json_schema|strict/i.test(err.message); throw err; }
      return { data: extractJson(content(json && json.choices && json.choices[0])), model: json.model || model, strict };
    } finally { clearTimeout(timer); }
  }
  async function reviewStage(settings, payload, stage, options) {
    if (!settings.hfToken) throw new Error("HF token not set. Add it in the extension popup.");
    options = options || {}; const accepted = Boolean(payload.accepted);
    const model = stage === "summary" ? settings.summaryModel : settings.detailModel;
    const maxTokens = stage === "summary" ? 900 : accepted ? 7000 : 1800;
    const timeoutMs = stage === "summary" ? 15000 : 60000;
    const messages = [{ role: "system", content: global.CSESReviewPrompts.SYSTEM_PROMPT }, { role: "user", content: global.CSESReviewPrompts.buildStagePrompt(payload, stage) }];
    let retries = 0, strict = true;
    for (;;) {
      try {
        const result = await request(settings, messages, { model, maxTokens, timeoutMs, schemaStage: stage === "summary" ? "summary" : accepted ? "acceptedDetails" : "rejectedDetails", controller: options.controller }, strict);
        const shape = stage === "summary" ? "summary" : accepted ? "acceptedDetails" : "rejectedDetails";
        const bad = global.CSESReviewSchema.validate(shape, result.data, accepted);
        // Accepted detail gets one bounded repair pass in the orchestrator.
        if (bad && shape === "acceptedDetails") result.data._validationProblem = bad;
        else if (bad) { const e = new Error(bad); e.failureType = "validation"; throw e; }
        return { data: result.data, timing: { ms: Date.now() - options.startedAt, retryCount: retries, model: result.model, strict: result.strict } };
      } catch (e) {
        if (e.strictUnsupported && strict) { strict = false; continue; }
        if (transient(e.status, e.message) && retries < 1 && !(options.controller && options.controller.signal.aborted)) { retries++; await wait(Math.min(5000, e.retryAfter ? e.retryAfter * 1000 : 700)); continue; }
        e.failureType = e.failureType || (e.name === "AbortError" || e.name === "TimeoutError" ? "timeout" : e.status ? "provider" : "response"); throw e;
      }
    }
  }
  async function repairAccepted(settings, payload, details, validationProblem, options) {
    const messages = [{ role: "system", content: global.CSESReviewPrompts.SYSTEM_PROMPT }, { role: "user", content: global.CSESReviewPrompts.buildRepairPrompt(payload, details, validationProblem) }];
    const result = await request(settings, messages, { model: settings.detailModel, maxTokens: 7000, timeoutMs: 60000, schemaStage: "acceptedDetails", controller: options.controller }, true);
    const bad = global.CSESReviewSchema.validate("acceptedDetails", result.data, true); if (bad) throw new Error("Validation failed after repair: " + bad);
    return result.data;
  }
  global.CSESReviewHF = { DEFAULTS, reviewStage, repairAccepted };
})(typeof self !== "undefined" ? self : globalThis);
