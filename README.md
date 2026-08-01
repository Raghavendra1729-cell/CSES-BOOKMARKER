# CSES Bookmarker + AI Reviewer

Chrome extension for [CSES Problem Set](https://cses.fi/problemset/):

- ☆ bookmark problems
- per-problem solve timer
- **AI post-submission code review** (after every result)

Personal use only. Reviews use a **local Python server** that calls the Hugging Face OpenAI-compatible router. Your `HF_TOKEN` never leaves your machine except to HF.

## Security

| File | Purpose |
|------|---------|
| `.env` | Your secrets (gitignored) |
| `.env.example` | Template — safe to commit |

**Never commit `.env` or paste tokens into the extension.**

## Setup

### 1. Token + model

```bash
cp .env.example .env
# edit .env and set:
# HF_TOKEN=hf_...
```

Defaults (already in `.env.example`):

```
HF_BASE_URL=https://router.huggingface.co/v1
REVIEW_MODEL=MiniMaxAI/MiniMax-M3:novita
REVIEW_PORT=8765
```

### 2. Local review server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m server.app
```

Health check: [http://127.0.0.1:8765/health](http://127.0.0.1:8765/health)

### 3. Load the extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this repo folder
4. Open the popup → **Check server** (should show token present)

## How review works

1. You submit on CSES → land on `/problemset/result/...`
2. Extension scrapes verdict + source code
3. Background worker `POST`s to `http://127.0.0.1:8765/review`
4. Server calls HF router with a strict **reviewer-only** system prompt
5. Panel appears (green = Accepted, red = rejected)

### Rejected (WA / TLE / MLE / RE / CE)

- Verdict summary  
- Weaknesses only (no fixes)  
- Tiny non-algorithmic hint  
- Approach score + category stars  

### Accepted

- Code quality notes  
- Complexity  
- Optimal? + alternative approach **names** only  
- Ratings + improvement checklist  

The model is instructed **never** to solve the problem or leak algorithms on rejects.

## Popup settings

- **Auto-review after submit** — on/off  
- **Local server** URL (default `http://127.0.0.1:8765`)

## LLM interface

Matches the HF router OpenAI client:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=os.environ["HF_TOKEN"],
)

completion = client.chat.completions.create(
    model="MiniMaxAI/MiniMax-M3:novita",
    messages=[...],
)
```

## Scope

- **CSES only** (`cses.fi/problemset/*`)
- Not a general chatbot
