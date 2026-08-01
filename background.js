/* global CSESReviewPrompts, CSESReviewHF, CSESBM_LOCAL_CONFIG */
importScripts("reviewer/prompts.js", "reviewer/hf-client.js");

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

const DEFAULT_REVIEW_SETTINGS = {
  enabled: true,
  hfToken: "",
  baseUrl: CSESReviewHF.DEFAULTS.baseUrl,
  model: CSESReviewHF.DEFAULTS.model,
  maxTokens: CSESReviewHF.DEFAULTS.maxTokens,
};

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

  // File config fills gaps; popup/storage wins if set.
  if (!(s.hfToken || "").trim() && fileToken()) {
    s.hfToken = fileToken();
    s._tokenSource = "config.local.js";
  } else if ((s.hfToken || "").trim()) {
    s._tokenSource = "popup";
  } else {
    s._tokenSource = "none";
  }

  if (!(s.model || "").trim() && FILE_CONFIG.model) {
    s.model = String(FILE_CONFIG.model).trim();
  }
  if (!(s.baseUrl || "").trim() && FILE_CONFIG.baseUrl) {
    s.baseUrl = String(FILE_CONFIG.baseUrl).trim();
  }
  if (FILE_CONFIG.maxTokens) {
    const fileMax = Number(FILE_CONFIG.maxTokens);
    // Prefer higher budget (reasoning models need headroom).
    if (fileMax && (!s.maxTokens || fileMax > s.maxTokens)) {
      s.maxTokens = fileMax;
    }
  }
  if (!s.maxTokens || s.maxTokens < 2048) {
    s.maxTokens = Math.max(Number(s.maxTokens) || 0, DEFAULT_REVIEW_SETTINGS.maxTokens, 2048);
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

function sanitizeSettingsForClient(s) {
  const hasToken = Boolean((s.hfToken || "").trim());
  return {
    enabled: s.enabled !== false,
    hasToken,
    tokenHint: maskToken(s.hfToken),
    tokenSource: hasToken ? s._tokenSource || "unknown" : "none",
    hasFileConfig: Boolean(fileToken()),
    baseUrl: s.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl,
    model: s.model || DEFAULT_REVIEW_SETTINGS.model,
    maxTokens: s.maxTokens || DEFAULT_REVIEW_SETTINGS.maxTokens,
  };
}

function maskToken(token) {
  const t = (token || "").trim();
  if (!t) return "";
  if (t.length <= 8) return "••••";
  return t.slice(0, 4) + "…" + t.slice(-4);
}

async function postReview(submission) {
  const settings = await getReviewSettings();
  if (!settings.enabled) {
    return { ok: false, error: "AI review is disabled in extension settings." };
  }
  if (!(settings.hfToken || "").trim()) {
    return {
      ok: false,
      error:
        "HF token not found. The extension cannot read .env. " +
        "Either: (1) open the popup → paste token → Save, or " +
        "(2) copy config.local.example.js to config.local.js with your token, then Reload the extension.",
    };
  }
  if (!(submission && String(submission.code || "").trim())) {
    return { ok: false, error: "No submitted code provided." };
  }

  try {
    const data = await CSESReviewHF.reviewSubmission(settings, submission);
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: (e && e.message) || "Review failed",
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "REVIEW_SUBMISSION") {
    postReview(msg.submission || {})
      .then(sendResponse)
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
          model: (
            incoming.model ||
            stored.model ||
            DEFAULT_REVIEW_SETTINGS.model
          ).trim(),
          maxTokens:
            Number(incoming.maxTokens) ||
            stored.maxTokens ||
            DEFAULT_REVIEW_SETTINGS.maxTokens,
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
            model: settings.model,
            tokenSource: settings._tokenSource,
          });
          return;
        }
        sendResponse({
          ok: true,
          data: {
            has_token: true,
            model: settings.model,
            base_url: base,
            http_status: resp.status,
            token_source: settings._tokenSource,
          },
        });
      } catch (e) {
        sendResponse({
          ok: false,
          error: (e && e.message) || "Cannot reach Hugging Face router",
          model: settings.model,
        });
      }
    });
    return true;
  }
});
