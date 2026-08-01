// Hugging Face OpenAI-compatible router client (runs in the service worker).
// Same interface as:
//   OpenAI(base_url="https://router.huggingface.co/v1", api_key=HF_TOKEN)
//   model="MiniMaxAI/MiniMax-M3:novita"
(function (global) {
  const DEFAULTS = {
    baseUrl: "https://router.huggingface.co/v1",
    model: "MiniMaxAI/MiniMax-M3:novita",
    maxTokens: 400,
  };

  const MAX_RETRIES = 3;
  const BACKOFF_BASE_MS = 800;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function extractJson(text) {
    let s = (text || "").trim();
    if (!s) throw new Error("Empty model response");

    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();

    try {
      return JSON.parse(s);
    } catch {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(s.slice(start, end + 1));
      }
      throw new Error("Model did not return valid JSON");
    }
  }

  function isTransient(errMsg, status) {
    if (status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    const m = String(errMsg || "").toLowerCase();
    return (
      m.includes("timeout") ||
      m.includes("rate") ||
      m.includes("connection") ||
      m.includes("temporarily") ||
      m.includes("network") ||
      m.includes("failed to fetch")
    );
  }

  async function chatCompletion(settings, messages) {
    const baseUrl = String(settings.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, "");
    const model = settings.model || DEFAULTS.model;
    const maxTokens = Number(settings.maxTokens) || DEFAULTS.maxTokens;
    const token = (settings.hfToken || "").trim();
    if (!token) {
      throw new Error("HF token not set. Open the extension popup and paste your Hugging Face token.");
    }

    const url = baseUrl + "/chat/completions";
    let lastErr = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.2,
          }),
        });

        const rawText = await resp.text();
        let body = null;
        try {
          body = rawText ? JSON.parse(rawText) : null;
        } catch {
          body = null;
        }

        if (!resp.ok) {
          const detail =
            (body &&
              (body.error?.message ||
                body.error ||
                body.message ||
                body.detail)) ||
            rawText ||
            resp.statusText;
          const err = new Error(String(detail));
          err.status = resp.status;
          throw err;
        }

        const content =
          body &&
          body.choices &&
          body.choices[0] &&
          body.choices[0].message &&
          body.choices[0].message.content;
        return { content: content || "", model };
      } catch (e) {
        lastErr = e;
        const status = e && e.status;
        if (!isTransient(e && e.message, status) || attempt === MAX_RETRIES - 1) {
          throw e;
        }
        await sleep(BACKOFF_BASE_MS * Math.pow(2, attempt));
      }
    }
    throw lastErr || new Error("Review failed");
  }

  async function reviewSubmission(settings, payload) {
    const prompts = global.CSESReviewPrompts;
    if (!prompts) throw new Error("Prompts not loaded");

    const messages = [
      { role: "system", content: prompts.SYSTEM_PROMPT },
      { role: "user", content: prompts.buildUserPrompt(payload || {}) },
    ];

    const { content, model } = await chatCompletion(settings, messages);
    const data = extractJson(content);
    data._meta = {
      model,
      accepted: Boolean(payload && payload.accepted),
      verdict: payload && payload.verdict,
    };
    return data;
  }

  global.CSESReviewHF = {
    DEFAULTS,
    reviewSubmission,
  };
})(typeof self !== "undefined" ? self : globalThis);
