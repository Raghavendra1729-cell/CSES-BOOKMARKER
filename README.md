# CSES Bookmarker + AI Reviewer

Chrome extension for [CSES Problem Set](https://cses.fi/problemset/):

- ☆ bookmark problems
- per-problem solve timer
- **AI post-submission code review** (after every result)

Personal use only. Reviews call the **Hugging Face OpenAI-compatible router directly** from the extension background worker. **No local server to keep running.**

## Why `.env` does not work

Chrome extensions **cannot read `.env`**. Putting `HF_TOKEN` only in `.env` has no effect.

Use **one** of these instead:

| Method | How |
|--------|-----|
| **Popup (easiest)** | Open extension popup → paste `hf_…` → **Save** → **Test API** |
| **`config.local.js`** | Copy `config.local.example.js` → `config.local.js`, put token, **Reload** extension |

Both stay on your machine. `config.local.js` and `.env` are gitignored.

## Setup

### 1. Load the extension

1. Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder (or click **Reload** after changing `config.local.js`)

### 2. Add your Hugging Face token

**Option A — popup**

1. Click the extension icon  
2. Paste token from https://huggingface.co/settings/tokens  
3. **Save** → **Test API** (should say OK)

**Option B — file** (if you prefer files over the popup)

```bash
cp config.local.example.js config.local.js
# edit config.local.js → set hfToken: "hf_..."
```

Then **Reload** the extension on `chrome://extensions`.

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
  → quick review panel (then detailed hints or approaches)
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

- Fast diagnosis, evidence and complexity
- Layered hints only — never code, pseudocode, corrections, or algorithm names

### Accepted

- Immediate correctness/quality/complexity summary
- 2–4 collapsible practical approaches with proof, trade-offs and complete code
- Separate fast and detailed models in the popup; quick model defaults to `:fastest`

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
