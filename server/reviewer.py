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
    # One fixed model keeps extension and optional local server behavior identical.
    return "MiniMaxAI/MiniMax-M3:novita"


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


def review_submission(payload: dict[str, Any]) -> dict[str, Any]:
    """Make exactly one generation request. The caller decides whether to retry."""
    accepted = bool(payload.get("accepted"))
    completion = _client().chat.completions.create(
        model=_model(),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_user_prompt(payload)},
        ],
        max_tokens=6500 if accepted else 500,
        temperature=0.15,
        response_format={"type": "json_object"},
    )
    return _extract_json(completion.choices[0].message.content or "")
