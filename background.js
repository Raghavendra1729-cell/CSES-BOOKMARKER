/* global CSESReviewHF, CSESReviewCache */
importScripts(
  "reviewer/schema.js",
  "reviewer/prompts.js",
  "reviewer/hf-client.js",
  "reviewer/review-cache.js",
  "reviewer/problem-context.js",
  "reviewer/request-key.js"
);

const PREFIX = "csesbm:";
const REVIEW_SETTINGS_KEY = "csesbm:reviewSettings";
const REVIEW_METRICS_KEY = "csesbm:reviewMetrics";
const DEFAULT_REVIEW_SETTINGS = {
  hfToken: "",
  baseUrl: CSESReviewHF.DEFAULTS.baseUrl,
};
const activeReviews = new Map();
const inFlightReviews = new Map();
const problemContextCache = new Map();
let metricWrite = Promise.resolve();

function localGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function localSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function recount() {
  chrome.storage.sync.get(null, (all) => {
    let toReview = 0;
    Object.keys(all || {}).forEach((key) => {
      if (!key.startsWith(PREFIX)) return;
      const value = all[key];
      if (value && value.status !== "done") toReview += 1;
    });
    chrome.action.setBadgeText({ text: toReview > 0 ? String(toReview) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#b36f00" });
  });
}

chrome.runtime.onInstalled.addListener(recount);
chrome.runtime.onStartup.addListener(recount);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((key) => key.startsWith(PREFIX))) recount();
});
recount();

function mergeSettings(stored) {
  const settings = {
    ...DEFAULT_REVIEW_SETTINGS,
    hfToken: stored && typeof stored.hfToken === "string" ? stored.hfToken : "",
    // The popup does not expose a custom endpoint. Pinning it prevents a
    // stale or crafted storage value from sending the token elsewhere.
    baseUrl: DEFAULT_REVIEW_SETTINGS.baseUrl,
  };
  if ((settings.hfToken || "").trim()) {
    settings._tokenSource = "popup";
  } else {
    settings._tokenSource = "none";
  }
  return settings;
}

function getReviewSettings() {
  return localGet(REVIEW_SETTINGS_KEY).then((result) => {
    return mergeSettings(result[REVIEW_SETTINGS_KEY]);
  });
}

function maskToken(token) {
  const value = (token || "").trim();
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return value.slice(0, 4) + "…" + value.slice(-4);
}

function sanitizeSettings(settings) {
  const hasToken = Boolean((settings.hfToken || "").trim());
  return {
    hasToken,
    tokenHint: maskToken(settings.hfToken),
    tokenSource: hasToken ? settings._tokenSource || "unknown" : "none",
    baseUrl: settings.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl,
    model: CSESReviewHF.DEFAULTS.model,
  };
}

function recordMetric(metric) {
  metricWrite = metricWrite.catch(() => undefined).then(async () => {
    const result = await localGet(REVIEW_METRICS_KEY);
    const rows = Array.isArray(result[REVIEW_METRICS_KEY]) ? result[REVIEW_METRICS_KEY] : [];
    rows.push({ at: Date.now(), ...metric });
    await localSet({ [REVIEW_METRICS_KEY]: rows.slice(-100) });
  });
  // Metrics are best-effort and must never make a review flow fail.
  metricWrite = metricWrite.catch(() => undefined);
  return metricWrite;
}

async function fetchProblemContext(submission, signal) {
  if (submission.problem_statement && submission.constraints) return submission;
  if (!submission.problem_id) return submission;
  const id = String(submission.problem_id);
  const remembered = problemContextCache.get(id);
  if (remembered) return { ...submission, ...remembered };

  const response = await fetch("https://cses.fi/problemset/task/" + encodeURIComponent(id), { signal });
  if (!response.ok) throw new Error("Could not read the CSES problem statement (HTTP " + response.status + ").");
  const html = await response.text();
  const context = CSESReviewProblemContext.extract(html);
  if (context.constraints === "Not explicitly listed" && submission.time_limit) {
    context.constraints = submission.time_limit;
  }
  problemContextCache.set(id, context);
  return { ...submission, ...context };
}

async function performReview(submission, options) {
  options = options || {};
  const force = Boolean(options.force);
  const controller = options.controller || new AbortController();

  try {
    if (!force) {
      const cached = await CSESReviewCache.getCached(submission || {});
      if (cached && cached.schemaVersion >= 3 && cached.data) {
        return { ok: true, data: cached.data, fromCache: true, savedAt: cached.savedAt };
      }
    }

    const settings = await getReviewSettings();
    if (!(settings.hfToken || "").trim()) {
      return {
        ok: false,
        error: "HF token not found. Open the extension popup, paste the token, and click Save.",
      };
    }
    if (!(submission && String(submission.code || "").trim())) {
      return { ok: false, error: "No submitted code provided." };
    }

    const full = await fetchProblemContext({ ...submission }, controller.signal);
    const result = await CSESReviewHF.review(settings, full, {
      controller,
      startedAt: Date.now(),
    });
    let savedAt = Date.now();
    try {
      const entry = await CSESReviewCache.save(full, result.data);
      savedAt = entry.savedAt || savedAt;
    } catch (_cacheError) {
      // The finished review is still useful even if local storage is full.
    }
    recordMetric({
      failureType: null,
      requestCount: 1,
      model: result.timing.model,
      ms: result.timing.ms,
      promptTokens: result.timing.promptTokens,
      completionTokens: result.timing.completionTokens,
      totalTokens: result.timing.totalTokens,
    });
    return {
      ok: true,
      data: result.data,
      timing: result.timing,
      fromCache: false,
      savedAt,
    };
  } catch (error) {
    recordMetric({
      failureType: error.failureType || "unknown",
      requestCount: 1,
      model: CSESReviewHF.DEFAULTS.model,
    });
    return {
      ok: false,
      error: error.message || "Review failed",
      failureType: error.failureType || "unknown",
    };
  }
}

function postReview(submission, options) {
  options = options || {};
  // A forced refresh must never attach itself to a cache-eligible request.
  const key = (options.force ? "refresh:" : "normal:") + CSESReviewRequestKey.forSubmission(submission);
  const requestId = String(options.requestId || crypto.randomUUID()).slice(0, 128);
  const existing = inFlightReviews.get(key);
  if (existing) {
    existing.requestIds.add(requestId);
    activeReviews.set(requestId, existing.controller);
    return existing.task;
  }

  const controller = new AbortController();
  const requestIds = new Set([requestId]);
  activeReviews.set(requestId, controller);
  const task = performReview(submission, { ...options, requestId, controller });
  const entry = { controller, requestIds, task };
  inFlightReviews.set(key, entry);
  task.finally(() => {
    requestIds.forEach((id) => {
      if (activeReviews.get(id) === controller) activeReviews.delete(id);
    });
    if (inFlightReviews.get(key) === entry) inFlightReviews.delete(key);
  });
  return task;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isCsesSender(sender) {
  return Boolean(sender && sender.tab && /^https:\/\/cses\.fi\//.test(sender.tab.url || ""));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "REVIEW_SUBMISSION") {
    if (!isCsesSender(sender)) {
      sendResponse({ ok: false, error: "Reviews can only be requested from CSES result pages." });
      return;
    }
    postReview(message.submission || {}, {
      force: Boolean(message.force),
      requestId: message.requestId,
    }).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "CANCEL_REVIEW") {
    if (!isCsesSender(sender)) {
      sendResponse({ ok: false });
      return;
    }
    const controller = activeReviews.get(message.requestId);
    if (controller) controller.abort();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "GET_CACHED_REVIEW") {
    if (!isCsesSender(sender)) {
      sendResponse({ ok: false, error: "Saved reviews can only be opened on CSES." });
      return;
    }
    CSESReviewCache.getCached(message.submission || { result_id: message.resultId, problem_id: message.problemId })
      .then((cached) => {
        if (!cached || cached.schemaVersion < 3 || !cached.data) {
          sendResponse({ ok: true, hit: false });
          return;
        }
        sendResponse({
          ok: true,
          hit: true,
          data: cached.data,
          submission: cached.submission,
          savedAt: cached.savedAt,
          result_id: cached.result_id,
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "GET_REVIEW_SETTINGS") {
    getReviewSettings()
      .then((settings) => sendResponse(sanitizeSettings(settings)))
      .catch(() => sendResponse(sanitizeSettings(DEFAULT_REVIEW_SETTINGS)));
    return true;
  }

  if (message.type === "SET_REVIEW_SETTINGS") {
    (async () => {
      try {
        const result = await localGet(REVIEW_SETTINGS_KEY);
        const stored = result[REVIEW_SETTINGS_KEY] || {};
        const incoming = message.settings || {};
        const next = {
          hfToken: stored.hfToken || "",
        };
        if (incoming.hfToken != null && String(incoming.hfToken).trim()) {
          next.hfToken = String(incoming.hfToken).trim();
        }
        await localSet({ [REVIEW_SETTINGS_KEY]: next });
        sendResponse({ ok: true, settings: sanitizeSettings(mergeSettings(next)) });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Could not save review settings." });
      }
    })();
    return true;
  }

  if (message.type === "CLEAR_HF_TOKEN") {
    (async () => {
      try {
        const stored = {
          hfToken: "",
        };
        await localSet({ [REVIEW_SETTINGS_KEY]: stored });
        sendResponse({ ok: true, settings: sanitizeSettings(mergeSettings(stored)) });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Could not clear the token." });
      }
    })();
    return true;
  }

  if (message.type === "HEALTH_CHECK") {
    (async () => {
      try {
        const settings = await getReviewSettings();
        if (!(settings.hfToken || "").trim()) {
          sendResponse({ ok: false, error: "No HF token. Paste one in the popup and click Save." });
          return;
        }
        const authResponse = await fetchWithTimeout("https://huggingface.co/api/whoami-v2", {
          headers: { Authorization: "Bearer " + settings.hfToken.trim() },
        }, 15000);
        if (!authResponse.ok) {
          sendResponse({ ok: false, error: "Hugging Face rejected this token (HTTP " + authResponse.status + ")." });
          return;
        }
        const base = DEFAULT_REVIEW_SETTINGS.baseUrl.replace(/\/$/, "");
        const response = await fetchWithTimeout(base + "/models/" + CSESReviewHF.DEFAULTS.modelId, {
          headers: { Authorization: "Bearer " + settings.hfToken.trim() },
        }, 15000);
        if (!response.ok) {
          sendResponse({ ok: false, error: "Hugging Face API check failed (HTTP " + response.status + ")." });
          return;
        }
        const metadata = await response.json();
        const providers = (metadata && metadata.data && metadata.data.providers) || [];
        const selected = providers.find((provider) => provider.provider === "fireworks-ai");
        if (!selected || selected.status !== "live" || !selected.supports_structured_output) {
          sendResponse({ ok: false, error: "The structured GLM-5.3 provider is not currently available." });
          return;
        }
        sendResponse({
          ok: true,
          data: {
            model: CSESReviewHF.DEFAULTS.model,
            base_url: base,
            http_status: response.status,
            token_source: settings._tokenSource,
            provider: selected.provider,
          },
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || "Cannot reach Hugging Face router" });
      }
    })();
    return true;
  }
});
