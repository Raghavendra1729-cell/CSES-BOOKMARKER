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
    # MiniMax-M3 is a reasoning model: low caps (e.g. 400) are spent entirely on
    # reasoning_tokens and content comes back empty (finish_reason=length).
    try:
        n = int(os.environ.get("REVIEW_MAX_TOKENS", "2048"))
    except ValueError:
        n = 2048
    return max(n, 1024)



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


def review_submission(payload: dict[str, Any], stage: str = "summary") -> dict[str, Any]:
    """Call HF router once (retry only on transient API failures)."""
    client = _client()
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _stage_prompt(payload, stage)},
    ]

    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            completion = client.chat.completions.create(
                model=_model(),
                messages=messages,
                max_tokens=900 if stage == "summary" else (7000 if payload.get("accepted") else 1800),
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


def _stage_prompt(payload: dict[str, Any], stage: str) -> str:
    """Python API mirrors the extension stage fields; router strict mode is optional."""
    accepted = bool(payload.get("accepted"))
    if stage == "summary":
        schema = '{"diagnosis":"string","evidence":["string"],"complexity":{"time":"O(...) ","space":"O(...)"},"first_hint":"string","optimality":"string","code_quality":["string"]}'
        task = "Fast summary. " + ("Assess correctness, quality and optimality." if accepted else "Hints only: no algorithm names, fixes, logic, pseudocode, or code.")
    elif accepted:
        schema = '{"improvements":["string"],"approaches":[{"name":"string","idea":"string","steps":["string","string"],"correctness":"string","time_complexity":"O(...) ","space_complexity":"O(...) ","tradeoffs":"string","code":"complete code"}]}'
        task = "Give 2-4 distinct practical approaches with complete code in the submitted language."
    else:
        schema = '{"critique":["string"],"hints":["string"]}'
        task = "Deeper hints only. Never algorithm names, corrected logic, pseudocode, solution steps, or code."
    return build_user_prompt(payload) + "\n\nStage: " + stage + "\n" + task + "\nReturn this JSON shape exactly:\n" + schema
