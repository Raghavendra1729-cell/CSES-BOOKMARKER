"""Local review API for the CSES Bookmarker extension (personal use only)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Load .env from repo root (parent of server/)
_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT / ".env")

from .reviewer import review_submission  # noqa: E402

app = FastAPI(title="CSES Submission Reviewer", docs_url=None, redoc_url=None)

# Extension background worker may hit localhost; keep CORS open for personal use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReviewRequest(BaseModel):
    stage: str = "summary"
    requestId: str | None = None
    schemaVersion: int = 2
    force: bool = False
    problem_id: str | None = None
    problem_name: str | None = None
    category: str | None = None
    language: str | None = None
    verdict: str | None = None
    accepted: bool = False
    failed_test: str | int | None = None
    time_ms: int | float | None = None
    memory_kb: int | float | None = None
    time_limit: str | None = None
    memory_limit: str | None = None
    problem_statement: str | None = None
    code: str = Field(default="", min_length=1)
    result_id: str | None = None


@app.get("/health")
def health():
    has_token = bool(os.environ.get("HF_TOKEN", "").strip())
    return {
        "ok": True,
        "has_token": has_token,
        "model": os.environ.get("REVIEW_MODEL", ""),
        "base_url": os.environ.get("HF_BASE_URL", ""),
    }


@app.post("/review")
def review(req: ReviewRequest):
    if not os.environ.get("HF_TOKEN", "").strip():
        raise HTTPException(
            status_code=503,
            detail="HF_TOKEN missing. Add it to .env and restart the server.",
        )
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="No submitted code provided.")

    try:
        data = review_submission(req.model_dump(), req.stage)
        return {"ok": True, "stage": req.stage, "data": data, "fromCache": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Review failed: {e}") from e


def main():
    import uvicorn

    host = os.environ.get("REVIEW_HOST", "127.0.0.1")
    port = int(os.environ.get("REVIEW_PORT", "8765"))
    uvicorn.run("server.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
