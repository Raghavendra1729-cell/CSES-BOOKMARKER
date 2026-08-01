const PREFIX = "csesbm:";
const REVIEW_SETTINGS_KEY = "csesbm:reviewSettings";

const DEFAULT_REVIEW_SETTINGS = {
  enabled: true,
  serverUrl: "http://127.0.0.1:8765",
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

async function postReview(submission) {
  const settings = await getReviewSettings();
  if (!settings.enabled) {
    return { ok: false, error: "AI review is disabled in extension settings." };
  }

  const base = String(settings.serverUrl || DEFAULT_REVIEW_SETTINGS.serverUrl).replace(
    /\/$/,
    ""
  );
  const url = base + "/review";

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!resp.ok) {
      const detail =
        (data && (data.detail || data.error || data.message)) ||
        text ||
        resp.statusText;
      return { ok: false, error: String(detail) };
    }
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error:
        "Cannot reach review server at " +
        base +
        ". Start it with: python -m server.app  (" +
        (e && e.message ? e.message : "network error") +
        ")",
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "REVIEW_SUBMISSION") {
    postReview(msg.submission || {})
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }

  if (msg.type === "GET_REVIEW_SETTINGS") {
    getReviewSettings().then(sendResponse);
    return true;
  }

  if (msg.type === "SET_REVIEW_SETTINGS") {
    const next = { ...DEFAULT_REVIEW_SETTINGS, ...(msg.settings || {}) };
    chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: next }, () => {
      sendResponse({ ok: true, settings: next });
    });
    return true;
  }

  if (msg.type === "HEALTH_CHECK") {
    getReviewSettings().then(async (settings) => {
      const base = String(settings.serverUrl || DEFAULT_REVIEW_SETTINGS.serverUrl).replace(
        /\/$/,
        ""
      );
      try {
        const resp = await fetch(base + "/health");
        const data = await resp.json();
        sendResponse({ ok: resp.ok, data, serverUrl: base });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e && e.message ? e.message : "unreachable",
          serverUrl: base,
        });
      }
    });
    return true;
  }
});
