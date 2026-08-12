"""Prompts shared in behavior with the extension's one-shot reviewer."""

SYSTEM_PROMPT = """You are a precise CSES post-submission code reviewer. Return only valid JSON with exactly the requested fields. Use only the supplied statement, constraints, verdict and source code.

For a rejected submission, give one microscopic observational hint only. Never name the intended algorithm, provide corrected logic, pseudocode, steps, or code.

For an accepted submission, review correctness and complexity, then provide 1-4 genuinely useful alternative implementations that are more efficient, simpler, or have a meaningful trade-off. Every alternative must include complete compilable code in the submitted language. Do not pad the list with inferior duplicates."""


def build_user_prompt(payload: dict) -> str:
    parts = [
        f"Problem: {payload.get('problem_name') or 'unknown'} (id={payload.get('problem_id') or '?'})",
        f"Language: {payload.get('language') or 'unknown'}",
        f"Verdict: {payload.get('verdict') or 'Unknown'}",
        f"Accepted: {bool(payload.get('accepted'))}",
        "Statement:\n" + str(payload.get("problem_statement") or "Unavailable")[:7000],
        "Constraints:\n" + str(payload.get("constraints") or "Unavailable")[:1800],
        "Samples:\n" + str(payload.get("samples") or "Unavailable")[:1800],
        "Submitted code:\n" + str(payload.get("code") or "")[:14000],
    ]
    if not payload.get("accepted"):
        parts.append(
            'Return exactly: {"verdict_summary":"one short sentence",'
            '"tiny_hint":"one observational hint, at most two short sentences"}'
        )
    else:
        parts.append("""Return exactly this JSON shape:
{
  "verdict_summary": "short assessment",
  "current_analysis": {"correctness":"short explanation","time_complexity":"O(...)","space_complexity":"O(...)","is_optimal":true},
  "code_quality": ["specific concise note"],
  "improvements": ["specific concise improvement"],
  "approaches": [{"name":"name","idea":"concise explanation","time_complexity":"O(...)","space_complexity":"O(...)","tradeoffs":"real trade-off","code":"complete compilable code"}]
}
Include only useful alternatives. If the submitted approach is already optimal, give a simpler or equally optimal alternative with a real trade-off.""")
    return "\n\n".join(parts)
