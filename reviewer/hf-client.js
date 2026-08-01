// Hugging Face OpenAI-compatible router client (runs in the service worker).
// Same interface as:
//   OpenAI(base_url="https://router.huggingface.co/v1", api_key=HF_TOKEN)
//   model="MiniMaxAI/MiniMax-M3:novita"
//
// MiniMax-M3 is a reasoning model: completion budget is shared with
// reasoning_tokens. Too-low max_tokens → empty content + finish_reason "length".
(function (global) {
  const DEFAULTS = {
    baseUrl: "https://router.huggingface.co/v1",
    model: "MiniMaxAI/MiniMax-M3:novita",
    // Need headroom for reasoning + JSON answer (400 is too small → empty content).
    maxTokens: 2048,
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

  /** Normalize message.content which may be string | array | null. */
  function messageContent(message) {
    if (!message) return "";
    const c = message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) {
      return c
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          if (part && part.type === "text" && part.text) return part.text;
          return "";
        })
        .join("");
    }
    // Some providers put the final answer in other fields when content is empty.
    if (typeof message.reasoning_content === "string" && !c) {
      // Do not use raw reasoning as the answer — only as last-resort JSON scrape.
      const m = message.reasoning_content.match(/\{[\s\S]*\}/);
      if (m) return m[0];
    }
    return c == null ? "" : String(c);
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
    let maxTokens = Number(settings.maxTokens) || DEFAULTS.maxTokens;
    // Clamp floor for reasoning models so we never re-hit empty-content.
    // Empirically max_tokens=400 → 399 reasoning + empty content on MiniMax-M3.
    if (maxTokens < 2048) maxTokens = 2048;

    const token = (settings.hfToken || "").trim();
    if (!token) {
      throw new Error(
        "HF token not set. Open the extension popup and paste your Hugging Face token."
      );
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

        const choice = body && body.choices && body.choices[0];
        const content = messageContent(choice && choice.message);
        const finish = choice && choice.finish_reason;
        const usage = body && body.usage;
        const reasoningTok =
          usage &&
          usage.completion_tokens_details &&
          usage.completion_tokens_details.reasoning_tokens;

        if (!String(content || "").trim()) {
          // Retry once with a larger budget if we hit the reasoning ceiling.
          if (finish === "length" && attempt < MAX_RETRIES - 1 && maxTokens < 4096) {
            maxTokens = Math.min(4096, maxTokens * 2);
            lastErr = new Error(
              "Empty content (reasoning used all tokens); retrying with max_tokens=" +
                maxTokens
            );
            await sleep(BACKOFF_BASE_MS);
            continue;
          }
          throw new Error(
            "Empty model response" +
              (finish ? " (finish=" + finish + ")" : "") +
              (reasoningTok != null ? ", reasoning_tokens=" + reasoningTok : "") +
              ". MiniMax spends tokens on internal reasoning; raise max tokens (try 2048+)."
          );
        }

        return { content, model: (body && body.model) || model };
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
