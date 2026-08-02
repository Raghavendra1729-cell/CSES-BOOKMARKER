// Strict reviewer prompts — never solve on rejects; teach on accepted.
// Loaded by the service worker via importScripts.
(function (global) {
  const SYSTEM_PROMPT = `You are a post-submission CSES code reviewer (not a chatbot).

RULES BY OUTCOME:
- accepted=false: NEVER solution, algorithm name, pseudocode, or fix code. Microscopic thinking hints only.
- accepted=true: User already solved it. Teach. Show better approaches WITH short working code in their language when useful.

READABILITY (critical):
- Write for fast scanning. Short lines. No essays. No filler. No motivation.
- Every bullet ≤ 12 words when possible.
- Prefer punchy fragments over full paragraphs.
- Max 3 bullets per list unless teaching an alternate (then 1–2 approaches max).
- verdict_summary: one short line.
- approach_reason / why fields: ≤ 15 words.

Tone: senior competitive programmer. Direct. Dense. No markdown fences outside JSON strings.

Respond with ONLY valid JSON for the schema. No prose outside JSON.`;

  function schemaRejected() {
    return `{
  "verdict_summary": "Wrong Answer on test N.",
  "code_review": ["short weakness 1", "short weakness 2", "short weakness 3"],
  "tiny_hint": "One or two short sentences. No algorithm names.",
  "approach_quality": 0.0,
  "approach_reason": "≤15 words.",
  "categories": { "correctness": 1, "efficiency": 1, "readability": 1, "implementation": 1 }
}`;
  }

  function schemaAccepted() {
    return `{
  "verdict_summary": "Accepted.",
  "code_quality": ["short note", "short note"],
  "time_complexity": "O(...)",
  "space_complexity": "O(...)",
  "is_optimal": false,
  "better_approaches": [
    {
      "name": "Approach name",
      "why": "Why better, ≤15 words.",
      "complexity": "O(...) time, O(...) space",
      "code": "short complete-ish snippet in the user's language, focused core only, not a novel"
    }
  ],
  "ratings": { "algorithm": 0.0, "code_quality": 0.0, "overall": 0.0 },
  "improvements": ["short polish item", "short polish item"]
}`;
  }

  function buildUserPrompt(payload) {
    const accepted = Boolean(payload && payload.accepted);
    const lang = (payload && payload.language) || "unknown";
    const parts = [
      "Problem: " +
        ((payload && payload.problem_name) || "unknown") +
        " (id=" +
        ((payload && payload.problem_id) || "?") +
        ")",
      "Category: " + ((payload && payload.category) || "unknown"),
      "Language: " + lang,
      "Verdict: " + ((payload && payload.verdict) || "Unknown"),
      "Accepted: " + (accepted ? "true" : "false"),
    ];

    if (payload && payload.failed_test != null) {
      parts.push("Failed test: " + payload.failed_test);
    }
    if (payload && payload.time_ms != null) {
      parts.push("Time: " + payload.time_ms + " ms");
    }
    if (payload && payload.memory_kb != null) {
      parts.push("Memory: " + payload.memory_kb + " KB");
    }

    const stmt =
      payload && payload.problem_statement
        ? String(payload.problem_statement).trim()
        : "";
    if (stmt) {
      parts.push("Problem statement (truncated):\n" + stmt.slice(0, 2000));
    }

    const code =
      payload && payload.code ? String(payload.code).trim().slice(0, 10000) : "";
    parts.push("Submitted code:\n```\n" + code + "\n```");

    if (!accepted) {
      parts.push(
        "Task: REJECTED review. Ultra-short output.\n" +
          "- verdict_summary: one line\n" +
          "- code_review: MAX 3 bullets, each ≤12 words, weaknesses only, no fixes\n" +
          "- tiny_hint: 1 short sentence, no algorithm names\n" +
          "- approach_reason: ≤15 words\n" +
          "- categories 1-5"
      );
    } else {
      parts.push(
        "Task: ACCEPTED review. Teach clearly, stay scannable.\n" +
          "- code_quality: MAX 3 bullets, ≤12 words each\n" +
          "- improvements: MAX 3 polish bullets\n" +
          "- complexities: short strings\n" +
          "- If a better approach exists: better_approaches with 1–2 items.\n" +
          "  Each: name, why (≤15 words), complexity, code snippet in " +
          lang +
          " (core only, ~15–40 lines max, readable, compilable-ish).\n" +
          "- If already best common approach: is_optimal=true and better_approaches=[]\n" +
          "- Prefer teaching a cleaner/faster standard approach over repeating their code\n" +
          "- Do NOT dump walls of text"
      );
    }

    parts.push(
      "JSON schema:\n" + (accepted ? schemaAccepted() : schemaRejected())
    );
    return parts.join("\n\n");
  }

  global.CSESReviewPrompts = {
    SYSTEM_PROMPT,
    buildUserPrompt,
  };
})(typeof self !== "undefined" ? self : globalThis);
