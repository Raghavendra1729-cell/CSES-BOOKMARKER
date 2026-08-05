// Hugging Face OpenAI-compatible router client. Exactly one request per review.
(function (global) {
  const DEFAULTS = {
    baseUrl: "https://router.huggingface.co/v1",
    model: "MiniMaxAI/MiniMax-M3:fastest",
  };

  function extractJson(text) {
    let value = String(text || "").trim();
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) value = fenced[1].trim();
    try {
      return JSON.parse(value);
    } catch (_) {
      const start = value.indexOf("{");
      const end = value.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
      throw new Error("MiniMax did not return valid JSON.");
    }
  }

  function messageContent(choice) {
    const value = choice && choice.message && choice.message.content;
    if (typeof value === "string") return value;
    return Array.isArray(value) ? value.map((part) => part.text || "").join("") : "";
  }

  async function review(settings, payload, options) {
    if (!settings.hfToken) throw new Error("HF token not set. Add it in the extension popup.");
    options = options || {};
    const accepted = Boolean(payload.accepted);
    const controller = options.controller || new AbortController();
    const timeoutMs = accepted ? 60000 : 30000;
    const timer = setTimeout(
      () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
      timeoutMs
    );
    const startedAt = options.startedAt || Date.now();
    const model = DEFAULTS.model;

    try {
      const response = await fetch(
        String(settings.baseUrl || DEFAULTS.baseUrl).replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + settings.hfToken,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: global.CSESReviewPrompts.SYSTEM_PROMPT },
              { role: "user", content: global.CSESReviewPrompts.buildPrompt(payload) },
            ],
            max_tokens: accepted ? 6500 : 500,
            temperature: 0.15,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        }
      );
      const raw = await response.text();
      let json;
      try { json = JSON.parse(raw); } catch (_) { json = null; }
      if (!response.ok) {
        const message = (json && (json.error && (json.error.message || json.error) || json.message)) || raw || response.statusText;
        const error = new Error(message);
        error.status = response.status;
        error.failureType = "provider";
        throw error;
      }

      const data = extractJson(messageContent(json && json.choices && json.choices[0]));
      const problem = global.CSESReviewSchema.validate(data, accepted);
      if (problem) {
        const error = new Error(problem);
        error.failureType = "validation";
        throw error;
      }
      return {
        data,
        timing: {
          ms: Date.now() - startedAt,
          requestCount: 1,
          model: (json && json.model) || model,
        },
      };
    } catch (error) {
      if (!error.failureType) {
        error.failureType = error.name === "AbortError" || error.name === "TimeoutError" ? "timeout" : "response";
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  global.CSESReviewHF = { DEFAULTS, review };
})(typeof self !== "undefined" ? self : globalThis);
