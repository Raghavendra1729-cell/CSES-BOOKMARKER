# CSES Bookmarker + AI Reviewer

Chrome extension for [CSES Problem Set](https://cses.fi/problemset/):

- ☆ bookmark problems
- per-problem solve timer
- **AI post-submission code review** (after every result)

Personal use only. Reviews call the **Hugging Face OpenAI-compatible router directly** from the extension background worker. **No local server to keep running.**

## Why no server?

Chrome extensions cannot read your shell `.env` file. The previous local Python server existed only as a proxy for that. You do **not** need it anymore.

1. Paste your HF token **once** in the extension popup → Save  
2. Token stays in `chrome.storage.local` on your machine  
3. On each CSES result page, the extension calls HF by itself  

## Setup

### 1. Load the extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder (or click **Reload** if already loaded)

### 2. Add your Hugging Face token

1. Open the extension popup  
2. Paste token from https://huggingface.co/settings/tokens  
3. Confirm model (default `MiniMaxAI/MiniMax-M3:novita`)  
4. **Save** → **Test API**  

### 3. Use it

Submit on CSES → land on `/problemset/result/...` → review panel appears automatically.

## How it works

```
CSES result page
  → scrape verdict + code
  → background service worker
  → POST https://router.huggingface.co/v1/chat/completions
       Authorization: Bearer <token from chrome.storage>
       model: MiniMaxAI/MiniMax-M3:novita
  → review panel (green = AC, red = rejected)
```

Same API shape as:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=os.environ["HF_TOKEN"],
)
client.chat.completions.create(model="MiniMaxAI/MiniMax-M3:novita", messages=[...])
```

## Security

| Where | What |
|-------|------|
| Extension popup → `chrome.storage.local` | Your HF token (not synced to Google account) |
| `.env` / `.env.example` | Optional notes only; **not used by the extension** |
| GitHub | Never commit tokens (`.env` is gitignored) |

Clear the token anytime with **Clear token** in the popup.

## Review behavior

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

## Optional local Python server

`server/` is optional (dev/CLI). Normal use is extension-only. If you still want it:

```bash
cp .env.example .env   # set HF_TOKEN
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m server.app
```

## Scope

- **CSES only** (`cses.fi/problemset/*`)
- Not a general chatbot
