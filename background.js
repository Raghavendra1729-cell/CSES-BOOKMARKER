/* global CSESReviewPrompts, CSESReviewHF */
importScripts("reviewer/prompts.js", "reviewer/hf-client.js");

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

function getReviewSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(REVIEW_SETTINGS_KEY, (res) => {
      resolve({ ...DEFAULT_REVIEW_SETTINGS, ...(res[REVIEW_SETTINGS_KEY] || {}) });
    });
  });
}

function sanitizeSettingsForClient(s) {
  // Never send the full token to the popup UI when not needed; mask for display.
  return {
    enabled: s.enabled !== false,
    hasToken: Boolean((s.hfToken || "").trim()),
    tokenHint: maskToken(s.hfToken),
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
        "HF token not set. Open the CSES Bookmarker popup, paste your Hugging Face token, and Save.",
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
      const next = {
        ...DEFAULT_REVIEW_SETTINGS,
        ...cur,
        enabled: incoming.enabled !== false,
        baseUrl: (incoming.baseUrl || cur.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl).trim(),
        model: (incoming.model || cur.model || DEFAULT_REVIEW_SETTINGS.model).trim(),
        maxTokens:
          Number(incoming.maxTokens) ||
          cur.maxTokens ||
          DEFAULT_REVIEW_SETTINGS.maxTokens,
      };

      // Only overwrite token if the user typed a new non-empty value
      // (empty field in popup means "keep existing").
      if (incoming.hfToken != null && String(incoming.hfToken).trim() !== "") {
        next.hfToken = String(incoming.hfToken).trim();
      }

      chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: next }, () => {
        sendResponse({ ok: true, settings: sanitizeSettingsForClient(next) });
      });
    });
    return true;
  }

  if (msg.type === "CLEAR_HF_TOKEN") {
    getReviewSettings().then((cur) => {
      const next = { ...cur, hfToken: "" };
      chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: next }, () => {
        sendResponse({ ok: true, settings: sanitizeSettingsForClient(next) });
      });
    });
    return true;
  }

  if (msg.type === "HEALTH_CHECK") {
    getReviewSettings().then(async (settings) => {
      if (!(settings.hfToken || "").trim()) {
        sendResponse({
          ok: false,
          error: "No HF token saved. Paste it in the popup and Save.",
        });
        return;
      }
      // Lightweight check: models list or a tiny probe against the base URL.
      const base = String(settings.baseUrl || DEFAULT_REVIEW_SETTINGS.baseUrl).replace(
        /\/$/,
        ""
      );
      try {
        const resp = await fetch(base + "/models", {
          headers: { Authorization: "Bearer " + settings.hfToken.trim() },
        });
        // Some HF router deployments may not expose /models; 401 = bad token,
        // network ok with other statuses still means reachability.
        if (resp.status === 401 || resp.status === 403) {
          sendResponse({
            ok: false,
            error: "HF rejected the token (HTTP " + resp.status + ").",
            model: settings.model,
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
