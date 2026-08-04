(function (global) {
  const SYSTEM_PROMPT = `You are a precise CSES post-submission reviewer. Return only JSON matching the requested schema. Use the supplied statement, constraints, samples and code; do not invent them. Rejected submissions are hint-only: never give algorithm names, corrected logic, pseudocode, solution steps, or code. Accepted submissions may teach complete practical solutions.`;
  function context(p) {
    return [
      `Problem: ${p.problem_name || "unknown"} (id=${p.problem_id || "?"})`, `Language: ${p.language || "unknown"}`, `Verdict: ${p.verdict || "Unknown"}`,
      `Statement:\n${String(p.problem_statement || "Unavailable").slice(0, 7000)}`,
      `Constraints:\n${String(p.constraints || "Unavailable").slice(0, 1800)}`,
      `Samples:\n${String(p.samples || "Unavailable").slice(0, 1800)}`,
      `Submitted code:\n${String(p.code || "").slice(0, 14000)}`
    ].join("\n\n");
  }
  function buildStagePrompt(payload, stage) {
    const accepted = Boolean(payload.accepted);
    let task;
    if (stage === "summary") task = accepted
      ? "Give a fast diagnosis: correctness, code-quality evidence, current time/space complexity, and whether it is likely optimal. first_hint may be a concise improvement direction."
      : "Give a fast hint-only diagnosis: likely issue category, suspicious code locations/evidence, current complexity, and one tiny observational hint. Do not name an algorithm or explain a correction.";
    else if (accepted) task = "Give 2–4 meaningfully distinct practical approaches, ordered simple-to-optimal when applicable. Every approach needs an idea, numbered logic, correctness argument, time and space complexity, trade-offs, and COMPLETE compilable code in the submitted language. Include only approaches you can make consistent with the statement.";
    else task = "Give a deeper hint-only critique and 2–4 layered observational hints. Do not use algorithm names, corrected logic, pseudocode, solution steps, or code.";
    return context(payload) + "\n\nTask:\n" + task;
  }
  function buildRepairPrompt(payload, details, problem) {
    return context(payload) + "\n\nThe accepted-review JSON below failed this concrete validation: " + problem + ". Return a repaired acceptedDetails JSON only. Preserve valid approaches, provide complete compilable code for every approach.\n" + JSON.stringify(details);
  }
  global.CSESReviewPrompts = { SYSTEM_PROMPT, buildStagePrompt, buildRepairPrompt };
})(typeof self !== "undefined" ? self : globalThis);
