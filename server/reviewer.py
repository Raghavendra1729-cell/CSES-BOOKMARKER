"""Single-call MiniMax client via the Hugging Face OpenAI-compatible router."""

from __future__ import annotations

import json
import os
import re
from typing import Any

from openai import OpenAI

from .prompts import SYSTEM_PROMPT, build_user_prompt


def _client() -> OpenAI:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise RuntimeError("HF_TOKEN is missing. Set it in .env")
    base_url = os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1").strip()
    return OpenAI(base_url=base_url, api_key=token)


def _model() -> str:
    # Fireworks supports strict JSON Schema for this model; Novita does not.
    return "MiniMaxAI/MiniMax-M3:fireworks-ai"


def _response_format(accepted: bool) -> dict[str, Any]:
    short = {"type": "string"}
    if not accepted:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["verdict_summary", "tiny_hint"],
            "properties": {
                "verdict_summary": short,
                "tiny_hint": {"type": "string"},
            },
        }
    else:
        complexity = {"type": "string"}
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["verdict_summary", "current_analysis", "code_quality", "improvements", "approaches"],
            "properties": {
                "verdict_summary": short,
                "current_analysis": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["correctness", "time_complexity", "space_complexity", "is_optimal"],
                    "properties": {
                        "correctness": {"type": "string"},
                        "time_complexity": complexity,
                        "space_complexity": complexity,
                        "is_optimal": {"type": "boolean"},
                    },
                },
                "code_quality": {"type": "array", "items": {"type": "string"}},
                "improvements": {"type": "array", "items": {"type": "string"}},
                "approaches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["name", "idea", "time_complexity", "space_complexity", "tradeoffs", "code"],
                        "properties": {
                            "name": {"type": "string"},
                            "idea": {"type": "string"},
                            "time_complexity": complexity,
                            "space_complexity": complexity,
                            "tradeoffs": {"type": "string"},
                            "code": {"type": "string"},
                        },
                    },
                },
            },
        }
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "cses_accepted_review" if accepted else "cses_rejected_review",
            "strict": True,
            "schema": schema,
        },
    }


def _extract_json(text: str) -> dict[str, Any]:
    value = (text or "").strip()
    if not value:
        raise ValueError("Empty MiniMax response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", value)
    if fence:
        value = fence.group(1).strip()
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        start, end = value.find("{"), value.rfind("}")
        if start >= 0 and end > start:
            return json.loads(value[start : end + 1])
        raise


def _non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _within(value: Any, maximum: int) -> bool:
    return _non_empty(value) and len(value) <= maximum


def _only_keys(value: dict[str, Any], keys: set[str]) -> bool:
    return set(value).issubset(keys)


def validate_review(value: Any, accepted: bool) -> str | None:
    """Keep the optional server response contract aligned with the extension."""
    if not isinstance(value, dict) or not _within(value.get("verdict_summary"), 240):
        return "Verdict summary is missing."
    if not accepted:
        if not _only_keys(value, {"verdict_summary", "tiny_hint"}):
            return "Rejected review has unexpected fields."
        if not _within(value.get("tiny_hint"), 280):
            return "Tiny hint is missing."
        leak = json.dumps(value).lower()
        if re.search(r"```|#include|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\bpublic\s+static\s+void\b|\bfor\s*\(|\bwhile\s*\(", leak):
            return "Rejected review contains solution-like code."
        return None

    required = {"verdict_summary", "current_analysis", "code_quality", "improvements", "approaches"}
    if not _only_keys(value, required):
        return "Accepted review has unexpected fields."
    current = value.get("current_analysis")
    current_keys = {"correctness", "time_complexity", "space_complexity", "is_optimal"}
    if not isinstance(current, dict) or not _only_keys(current, current_keys):
        return "Current solution analysis is incomplete."
    if (
        not _within(current.get("correctness"), 600)
        or not _within(current.get("time_complexity"), 120)
        or not _within(current.get("space_complexity"), 120)
        or not isinstance(current.get("is_optimal"), bool)
    ):
        return "Current solution analysis is incomplete."
    for key, maximum in (("code_quality", 3), ("improvements", 3)):
        rows = value.get(key)
        if not isinstance(rows, list) or len(rows) > maximum or not all(_within(row, 240) for row in rows):
            return "Accepted review lists are missing."
    approaches = value.get("approaches")
    if not isinstance(approaches, list) or len(approaches) != 1:
        return "Accepted review needs exactly one alternative approach."
    approach_keys = {"name", "idea", "time_complexity", "space_complexity", "tradeoffs", "code"}
    for approach in approaches:
        if not isinstance(approach, dict) or not _only_keys(approach, approach_keys):
            return "An alternative approach is incomplete."
        if (
            not _within(approach.get("name"), 120)
            or not _within(approach.get("idea"), 600)
            or not _within(approach.get("time_complexity"), 120)
            or not _within(approach.get("space_complexity"), 120)
            or not _within(approach.get("tradeoffs"), 360)
            or not _within(approach.get("code"), 8000)
        ):
            return "An alternative approach is incomplete."
        if len(approach["code"].strip()) < 20:
            return "An alternative has no complete code."
    return None


def review_submission(payload: dict[str, Any]) -> dict[str, Any]:
    """Make exactly one generation request. The caller decides whether to retry."""
    accepted = bool(payload.get("accepted"))
    completion = _client().chat.completions.create(
        model=_model(),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(payload)},
        ],
        max_tokens=2400 if accepted else 220,
        temperature=0.15,
        response_format=_response_format(accepted),
    )
    data = _extract_json(completion.choices[0].message.content or "")
    problem = validate_review(data, accepted)
    if problem:
        raise ValueError(problem)
    return data
