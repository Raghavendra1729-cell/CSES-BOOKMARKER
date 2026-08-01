"""Strict reviewer prompts — never solve, never leak algorithms on rejects."""

SYSTEM_PROMPT = """You are an AI-powered post-submission code reviewer for CSES (competitive programming).
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

Respond with ONLY valid JSON matching the schema in the user message. No markdown fences."""


def build_user_prompt(payload: dict) -> str:
    accepted = bool(payload.get("accepted"))
    verdict = payload.get("verdict") or "Unknown"
    schema = _schema_rejected() if not accepted else _schema_accepted()

    parts = [
        f"Problem: {payload.get('problem_name') or 'unknown'} (id={payload.get('problem_id') or '?'})",
        f"Category: {payload.get('category') or 'unknown'}",
        f"Language: {payload.get('language') or 'unknown'}",
        f"Verdict: {verdict}",
        f"Accepted: {str(accepted).lower()}",
    ]
    if payload.get("failed_test") is not None:
        parts.append(f"Failed test: {payload['failed_test']}")
    if payload.get("time_ms") is not None:
        parts.append(f"Time: {payload['time_ms']} ms")
    if payload.get("memory_kb") is not None:
        parts.append(f"Memory: {payload['memory_kb']} KB")
    if payload.get("time_limit"):
        parts.append(f"Time limit: {payload['time_limit']}")
    if payload.get("memory_limit"):
        parts.append(f"Memory limit: {payload['memory_limit']}")

    stmt = (payload.get("problem_statement") or "").strip()
    if stmt:
        # Keep metadata short to control tokens
        parts.append("Problem statement (truncated):\n" + stmt[:2500])

    code = (payload.get("code") or "").strip()
    parts.append("Submitted code:\n```\n" + code[:12000] + "\n```")

    if not accepted:
        parts.append(
            "Task: Rejected submission review.\n"
            "- verdict_summary: very short (e.g. 'Wrong Answer on Test 18.')\n"
            "- code_review: list weaknesses only (assumptions, edge cases, overflow, "
            "off-by-one, invariant issues, unnecessary work). Never explain the fix.\n"
            "- tiny_hint: 1-2 sentences max. Microscopic. Never name algorithms "
            "(no prefix sum, segment tree, BFS, binary lifting, etc.).\n"
            "- approach_quality 0-10 + short reason\n"
            "- categories stars 1-5 each"
        )
    else:
        parts.append(
            "Task: Accepted submission review.\n"
            "- code_quality notes (naming, redundant work, memory, readability)\n"
            "- time_complexity and space_complexity strings\n"
            "- is_optimal boolean; alternative_approaches as names only if better exist\n"
            "- ratings algorithm/code_quality/overall 0-10\n"
            "- improvements: short checklist items only"
        )

    parts.append("JSON schema (fill all required fields for this case):\n" + schema)
    return "\n\n".join(parts)


def _schema_rejected() -> str:
    return """{
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
}"""


def _schema_accepted() -> str:
    return """{
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
}"""
