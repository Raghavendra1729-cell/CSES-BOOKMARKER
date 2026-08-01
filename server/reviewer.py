"""LLM client via Hugging Face OpenAI-compatible router."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from openai import OpenAI

from .prompts import SYSTEM_PROMPT, build_user_prompt

MAX_RETRIES = 3
BACKOFF_BASE_S = 0.8


def _client() -> OpenAI:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise RuntimeError("HF_TOKEN is missing. Set it in .env")
    base_url = os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1").strip()
    return OpenAI(base_url=base_url, api_key=token)


def _model() -> str:
    return os.environ.get("REVIEW_MODEL", "MiniMaxAI/MiniMax-M3:novita").strip()


def _max_tokens() -> int:
    try:
        return int(os.environ.get("REVIEW_MAX_TOKENS", "400"))
    except ValueError:
        return 400


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty model response")

    # Strip markdown fences if the model ignored instructions
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def review_submission(payload: dict[str, Any]) -> dict[str, Any]:
    """Call HF router once (retry only on transient API failures)."""
    client = _client()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(payload)},
    ]

    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            completion = client.chat.completions.create(
                model=_model(),
                messages=messages,
                max_tokens=_max_tokens(),
                temperature=0.2,
            )
            raw = completion.choices[0].message.content or ""
            data = _extract_json(raw)
            data["_meta"] = {
                "model": _model(),
                "accepted": bool(payload.get("accepted")),
                "verdict": payload.get("verdict"),
            }
            return data
        except Exception as e:
            # Only retry likely-transient failures; not parse errors on final attempt
            last_err = e
            msg = str(e).lower()
            transient = any(
                k in msg
                for k in (
                    "timeout",
                    "rate",
                    "429",
                    "502",
                    "503",
                    "504",
                    "connection",
                    "temporarily",
                )
            )
            if not transient or attempt == MAX_RETRIES - 1:
                raise
            time.sleep(BACKOFF_BASE_S * (2**attempt))

    raise RuntimeError(str(last_err) if last_err else "Review failed")
