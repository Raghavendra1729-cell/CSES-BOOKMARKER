// Strict reviewer prompts — never solve, never leak algorithms on rejects.
// Loaded by the service worker via importScripts.
(function (global) {
  const SYSTEM_PROMPT = `You are an AI-powered post-submission code reviewer for CSES (competitive programming).
You are NOT a chatbot, tutor, or solution generator.

Trigger: only after a submission. Verdicts: Accepted, Wrong Answer, TLE, MLE, RE, CE, etc.

NEVER:
- Generate a complete solution or pseudocode for the correct algorithm
- Write replacement code
- Reveal the exact algorithm if the user has NOT solved it (accepted=false)
- Explain step-by-step how to solve the problem
- Slowly leak the solution
- Answer unrelated questions
- Provide implementation details that solve the problem

If accepted=false: help them think with microscopic hints only. User must solve 99% themselves.
If accepted=true: thorough professional review, name alternative approaches without long explanations.

Tone: senior competitive programmer. Professional. Direct. Minimal. Not motivational.
Keep total output under ~250 tokens of prose where possible. No fluff.

Respond with ONLY valid JSON matching the schema in the user message. No markdown fences.`;

  function schemaRejected() {
    return `{
  "verdict_summary": "string",
  "code_review": ["string"],
  "tiny_hint": "string",
  "approach_quality": 0.0,
  "approach_reason": "string",
  "categories": {
    "correctness": 1,
    "efficiency": 1,
    "readability": 1,
    "implementation": 1
  }
}`;
  }

  function schemaAccepted() {
    return `{
  "verdict_summary": "string",
  "code_quality": ["string"],
  "time_complexity": "string",
  "space_complexity": "string",
  "is_optimal": true,
  "alternative_approaches": ["string"],
  "ratings": {
    "algorithm": 0.0,
    "code_quality": 0.0,
    "overall": 0.0
  },
  "improvements": ["string"]
}`;
  }

  function buildUserPrompt(payload) {
    const accepted = Boolean(payload && payload.accepted);
    const parts = [
      "Problem: " +
        ((payload && payload.problem_name) || "unknown") +
        " (id=" +
        ((payload && payload.problem_id) || "?") +
        ")",
      "Category: " + ((payload && payload.category) || "unknown"),
      "Language: " + ((payload && payload.language) || "unknown"),
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
    if (payload && payload.time_limit) {
      parts.push("Time limit: " + payload.time_limit);
    }
    if (payload && payload.memory_limit) {
      parts.push("Memory limit: " + payload.memory_limit);
    }

    const stmt = payload && payload.problem_statement
      ? String(payload.problem_statement).trim()
      : "";
    if (stmt) {
      parts.push("Problem statement (truncated):\n" + stmt.slice(0, 2500));
    }

    const code =
      payload && payload.code ? String(payload.code).trim().slice(0, 12000) : "";
    parts.push("Submitted code:\n```\n" + code + "\n```");

    if (!accepted) {
      parts.push(
        "Task: Rejected submission review.\n" +
          "- verdict_summary: very short (e.g. 'Wrong Answer on Test 18.')\n" +
          "- code_review: list weaknesses only (assumptions, edge cases, overflow, " +
          "off-by-one, invariant issues, unnecessary work). Never explain the fix.\n" +
          "- tiny_hint: 1-2 sentences max. Microscopic. Never name algorithms " +
          "(no prefix sum, segment tree, BFS, binary lifting, etc.).\n" +
          "- approach_quality 0-10 + short reason\n" +
          "- categories stars 1-5 each"
      );
    } else {
      parts.push(
        "Task: Accepted submission review.\n" +
          "- code_quality notes (naming, redundant work, memory, readability)\n" +
          "- time_complexity and space_complexity strings\n" +
          "- is_optimal boolean; alternative_approaches as names only if better exist\n" +
          "- ratings algorithm/code_quality/overall 0-10\n" +
          "- improvements: short checklist items only"
      );
    }

    parts.push(
      "JSON schema (fill all required fields for this case):\n" +
        (accepted ? schemaAccepted() : schemaRejected())
    );
    return parts.join("\n\n");
  }

  global.CSESReviewPrompts = {
    SYSTEM_PROMPT,
    buildUserPrompt,
  };
})(typeof self !== "undefined" ? self : globalThis);
