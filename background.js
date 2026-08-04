/* global CSESReviewPrompts, CSESReviewHF, CSESBM_LOCAL_CONFIG, CSESReviewCache */
importScripts(
  "reviewer/schema.js",
  "reviewer/prompts.js",
  "reviewer/hf-client.js",
  "reviewer/review-cache.js"
);

// Optional file-based secrets (config.local.js). Extensions cannot read .env.
// Missing file is fine — user can still paste token in the popup.
let FILE_CONFIG = {};
try {
  importScripts("config.local.js");
  if (typeof CSESBM_LOCAL_CONFIG === "object" && CSESBM_LOCAL_CONFIG) {
    FILE_CONFIG = CSESBM_LOCAL_CONFIG;
  }
} catch (_e) {
  FILE_CONFIG = {};
}

const PREFIX = "csesbm:";
const REVIEW_SETTINGS_KEY = "csesbm:reviewSettings";
const REVIEW_METRICS_KEY = "csesbm:reviewMetrics";

const DEFAULT_REVIEW_SETTINGS = {
  enabled: true,
  hfToken: "",
  baseUrl: CSESReviewHF.DEFAULTS.baseUrl,
  summaryModel: CSESReviewHF.DEFAULTS.summaryModel,
  detailModel: CSESReviewHF.DEFAULTS.detailModel,
};
const activeReviews = new Map();
const problemContextCache = new Map();

function recount() {
  chrome.storage.sync.get(null, (all) => {
    let toReview = 0;
    Object.keys(all || {}).forEach((k) => {
      if (!k.startsWith(PREFIX)) return;
      const v = all[k];
      if (v && v.status !== "done") toReview += 1;
    });
    chrome.action.setBadgeText({ text: toReview > 0 ? String(toReview) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#b36f00" });
  });
}

chrome.runtime.onInstalled.addListener(recount);
chrome.runtime.onStartup.addListener(recount);
recount();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (Object.keys(changes).some((k) => k.startsWith(PREFIX))) recount();
});

function fileToken() {
  return String((FILE_CONFIG && FILE_CONFIG.hfToken) || "").trim();
}

function mergeSettings(stored) {
  const s = { ...DEFAULT_REVIEW_SETTINGS, ...(stored || {}) };

  // v1 used one `model`; preserve it as the detailed model on upgrade.
  if (stored && stored.model && !stored.detailModel) s.detailModel = String(stored.model).trim();

  // File config fills gaps; popup/storage wins if set.
  if (!(s.hfToken || "").trim() && fileToken()) {
    s.hfToken = fileToken();
    s._tokenSource = "config.local.js";
  } else if ((s.hfToken || "").trim()) {
    s._tokenSource = "popup";
  } else {
    s._tokenSource = "none";
  }

  if (!(s.detailModel || "").trim() && (FILE_CONFIG.detailModel || FILE_CONFIG.model)) {
    s.detailModel = String(FILE_CONFIG.detailModel || FILE_CONFIG.model).trim();
  }
  if (!(s.summaryModel || "").trim() && FILE_CONFIG.summaryModel) s.summaryModel = String(FILE_CONFIG.summaryModel).trim();
  if (!(s.baseUrl || "").trim() && FILE_CONFIG.baseUrl) {
    s.baseUrl = String(FILE_CONFIG.baseUrl).trim();
  }
  return s;
}

function getReviewSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(REVIEW_SETTINGS_KEY, (res) => {
      resolve(mergeSettings(res[REVIEW_SETTINGS_KEY]));
    });
  });
}

function recordMetric(metric) {
  chrome.storage.local.get(REVIEW_METRICS_KEY, (res) => {
    const rows = Array.isArray(res[REVIEW_METRICS_KEY]) ? res[REVIEW_METRICS_KEY] : [];
    // Intentionally no problem id, submission id, statement, or source code.
    rows.push({ at: Date.now(), ...metric });
    chrome.storage.local.set({ [REVIEW_METRICS_KEY]: rows.slice(-100) });
  });
}

function sanitizeSettingsForClient(s) {
  const hasToken = Boolean((s.hfToken || "").trim());
  return {
    enabled: s.enabled !== false,
    hasToken,
    tokenHint: maskToken(s.hfToken),
    tokenSource: hasToken ? s._tokenSource || "unknown" : "none",
    hasFileConfig: Boolean(fileToken()),
    baseUrl: s.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl,
    summaryModel: s.summaryModel || DEFAULT_REVIEW_SETTINGS.summaryModel,
    detailModel: s.detailModel || DEFAULT_REVIEW_SETTINGS.detailModel,
  };
}

function maskToken(token) {
  const t = (token || "").trim();
  if (!t) return "";
  if (t.length <= 8) return "••••";
  return t.slice(0, 4) + "…" + t.slice(-4);
}

async function fetchProblemContext(submission, signal) {
  if (submission.problem_statement && submission.constraints) return submission;
  if (!submission.problem_id) return submission;
  const remembered = problemContextCache.get(String(submission.problem_id));
  if (remembered) return { ...submission, ...remembered };
  const res = await fetch("https://cses.fi/problemset/task/" + encodeURIComponent(submission.problem_id), { signal });
  if (!res.ok) throw new Error("Could not read the CSES problem statement (HTTP " + res.status + ").");
  const html = await res.text();
  const source = (html.match(/<div class="task-content">([\s\S]*?)<\/div>\s*<\/div>/i) || [null, html])[1];
  const plain = source.replace(/<\/(?:p|h[1-6]|li|pre|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks = plain.split(/\n(?=(?:Input|Output|Constraints|Example|Sample|Time limit|Memory limit))/i);
  const take = (name) => chunks.filter((x) => new RegExp("^" + name, "i").test(x.trim())).join("\n\n");
  submission.problem_statement = plain.slice(0, 11000);
  submission.constraints = take("Constraints|Time limit|Memory limit").slice(0, 2400) || submission.time_limit || "Not explicitly listed";
  submission.samples = take("Example|Sample").slice(0, 2400) || "Not explicitly listed";
  problemContextCache.set(String(submission.problem_id), { problem_statement: submission.problem_statement, constraints: submission.constraints, samples: submission.samples });
  return submission;
}

async function postReview(submission, opts) {
  opts = opts || {};
  const force = Boolean(opts.force);
  const stage = opts.stage === "detail" ? "detail" : "summary";
  const requestId = opts.requestId || crypto.randomUUID();
  const controller = new AbortController();
  activeReviews.set(requestId, controller);
  const startedAt = Date.now();

  const settings = await getReviewSettings();
  if (!settings.enabled) {
    activeReviews.delete(requestId);
    return { ok: false, error: "AI review is disabled in extension settings." };
  }

  // Cache stages independently. Old entries remain usable as a legacy summary.
  if (!force) {
    try {
      const cached = await CSESReviewCache.getCached(submission || {});
      const review = cached && cached.data;
      const cachedStage = review && (stage === "summary" ? review.summary : review.detail);
      if (cachedStage) {
        activeReviews.delete(requestId);
        return {
          ok: true,
          data: cachedStage,
          stage,
          fromCache: true,
          savedAt: cached.savedAt,
          timing: review.timing && review.timing[stage],
        };
      }
      if (stage === "summary" && review && review.verdict_summary) { activeReviews.delete(requestId); return { ok: true, data: review, stage, fromCache: true, savedAt: cached.savedAt, legacy: true }; }
    } catch (_e) {
      /* fall through to live review */
    }
  }

  if (!(settings.hfToken || "").trim()) {
    activeReviews.delete(requestId);
    return {
      ok: false,
      error:
        "HF token not found. The extension cannot read .env. " +
        "Either: (1) open the popup → paste token → Save, or " +
        "(2) copy config.local.example.js to config.local.js with your token, then Reload the extension.",
    };
  }
  if (!(submission && String(submission.code || "").trim())) {
    activeReviews.delete(requestId);
    return { ok: false, error: "No submitted code provided." };
  }

  try {
    const full = await fetchProblemContext({ ...submission }, controller.signal);
    const hfStage = stage === "summary" ? "summary" : full.accepted ? "acceptedDetails" : "rejectedDetails";
    let result = await CSESReviewHF.reviewStage(settings, full, hfStage, { controller, startedAt });
    let data = result.data;
    let validation = { status: "passed", repaired: false };
    if (hfStage === "acceptedDetails" && data._validationProblem) {
      const issue = data._validationProblem; delete data._validationProblem;
      data = await CSESReviewHF.repairAccepted(settings, full, data, issue, { controller });
      validation = { status: "repaired", repaired: true, issue };
    }
    data.validation = validation;
    let savedAt = Date.now();
    try {
      const entry = await CSESReviewCache.saveStage(full, stage, data, result.timing);
      savedAt = entry.savedAt || savedAt;
    } catch (_e) {
      /* review still usable if cache write fails */
    }
    recordMetric({ stage, failureType: null, retryCount: result.timing.retryCount, model: result.timing.model, ms: result.timing.ms });
    return {
      ok: true,
      data,
      stage,
      timing: result.timing,
      fromCache: false,
      savedAt,
    };
  } catch (e) {
    recordMetric({ stage, failureType: (e && e.failureType) || "unknown", retryCount: 0, model: stage === "summary" ? settings.summaryModel : settings.detailModel });
    return {
      ok: false,
      error: (e && e.message) || "Review failed",
      stage,
      failureType: (e && e.failureType) || "unknown",
    };
  } finally {
    activeReviews.delete(requestId);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "REVIEW_SUBMISSION") {
    postReview(msg.submission || {}, { force: Boolean(msg.force), stage: msg.stage, requestId: msg.requestId })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "CANCEL_REVIEW") {
    const controller = activeReviews.get(msg.requestId);
    if (controller) controller.abort();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "GET_CACHED_REVIEW") {
    CSESReviewCache.getCached(msg.submission || { result_id: msg.resultId, problem_id: msg.problemId })
      .then((cached) => {
        if (!cached || !cached.data) {
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
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "GET_REVIEW_SETTINGS") {
    getReviewSettings()
      .then((s) => sendResponse(sanitizeSettingsForClient(s)))
      .catch(() => sendResponse(sanitizeSettingsForClient(DEFAULT_REVIEW_SETTINGS)));
    return true;
  }

  if (msg.type === "SET_REVIEW_SETTINGS") {
    getReviewSettings().then((cur) => {
      const incoming = msg.settings || {};
      // Persist only storage fields (not file-derived token unless user typed one)
      chrome.storage.local.get(REVIEW_SETTINGS_KEY, (res) => {
        const stored = res[REVIEW_SETTINGS_KEY] || {};
        const next = {
          enabled: incoming.enabled !== false,
          baseUrl: (
            incoming.baseUrl ||
            stored.baseUrl ||
            DEFAULT_REVIEW_SETTINGS.baseUrl
          ).trim(),
          summaryModel: (incoming.summaryModel || stored.summaryModel || DEFAULT_REVIEW_SETTINGS.summaryModel).trim(),
          detailModel: (incoming.detailModel || stored.detailModel || stored.model || DEFAULT_REVIEW_SETTINGS.detailModel).trim(),
          hfToken: stored.hfToken || "",
        };

        if (incoming.hfToken != null && String(incoming.hfToken).trim() !== "") {
          next.hfToken = String(incoming.hfToken).trim();
        }

        chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: next }, () => {
          sendResponse({
            ok: true,
            settings: sanitizeSettingsForClient(mergeSettings(next)),
          });
        });
      });
    });
    return true;
  }

  if (msg.type === "CLEAR_HF_TOKEN") {
    chrome.storage.local.get(REVIEW_SETTINGS_KEY, (res) => {
      const stored = { ...(res[REVIEW_SETTINGS_KEY] || {}), hfToken: "" };
      chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: stored }, () => {
        sendResponse({
          ok: true,
          settings: sanitizeSettingsForClient(mergeSettings(stored)),
        });
      });
    });
    return true;
  }

  if (msg.type === "HEALTH_CHECK") {
    getReviewSettings().then(async (settings) => {
      if (!(settings.hfToken || "").trim()) {
        sendResponse({
          ok: false,
          error:
            "No HF token. Extension cannot read .env — use popup Save or config.local.js",
          hasFileConfig: Boolean(fileToken()),
        });
        return;
      }
      const base = String(settings.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl).replace(
        /\/$/,
        ""
      );
      try {
        const resp = await fetch(base + "/models", {
          headers: { Authorization: "Bearer " + settings.hfToken.trim() },
        });
        if (resp.status === 401 || resp.status === 403) {
          sendResponse({
            ok: false,
            error: "HF rejected the token (HTTP " + resp.status + ").",
            model: settings.detailModel,
            tokenSource: settings._tokenSource,
          });
          return;
        }
        sendResponse({
          ok: true,
          data: {
            has_token: true,
            model: settings.detailModel,
            base_url: base,
            http_status: resp.status,
            token_source: settings._tokenSource,
          },
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: (e && e.message) || "Cannot reach Hugging Face router",
          model: settings.detailModel,
        });
      }
    });
    return true;
  }
});
