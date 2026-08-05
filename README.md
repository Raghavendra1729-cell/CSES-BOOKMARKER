# CSES Bookmarker + MiniMax Reviewer

Chrome extension for [CSES Problem Set](https://cses.fi/problemset/):

- bookmark problems and add notes
- track per-problem solve time
- manually request a focused post-submission review
- sync bookmarks through Chrome and create portable backups

## Review behavior

Reviews are never automatic. On a CSES result page, click **Review submission**.
The extension makes exactly one Hugging Face generation request using
`MiniMaxAI/MiniMax-M3:novita`.

- **Rejected:** verdict summary plus one small hint. No solution, algorithm name,
  pseudocode, steps, or replacement code.
- **Accepted:** correctness, time/space complexity, code-quality improvements, and
  1–4 useful alternative approaches with complete code. Alternatives are shown
  directly in the panel.
- **Saved review:** clicking **Open review** reads the local cache and makes no
  model request. **Review again** explicitly makes one new request.

MiniMax-M3 is the only review model; there is no separate quick-model call or
automatic repair/retry call.

## Setup

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Open the extension popup, paste a Hugging Face token with Inference Providers
   access, click **Save**, then **Test API**.

Chrome extensions cannot read `.env`. The popup is the only token input: paste
the token, click **Save**, and use **Clear token** when you want to remove it.

The request goes directly to Hugging Face's OpenAI-compatible router:

```text
CSES result → Review submission button
  → POST https://router.huggingface.co/v1/chat/completions
  → MiniMaxAI/MiniMax-M3:novita
  → one accepted review or one tiny rejected hint
```

## Persistence and privacy

- Bookmarks, notes, solved state, and final solve times use `chrome.storage.sync`.
  Chrome restores them when Sync is enabled and the same extension identity is
  installed.
- Active timers, saved reviews, and submitted source code stay in
  `chrome.storage.local`; Chrome clears local extension data on uninstall.
- Use **Backup** before uninstalling for a reliable portable copy. **Restore**
  imports bookmarks, timers, and reviews after reinstalling.
- Backup files can contain submitted source code. The Hugging Face token is never
  exported or put in Chrome Sync.

## Optional local Python API

Normal extension use does not need a local server. For CLI/dev use only:

```bash
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m server.app
```

The optional API uses the same one-call MiniMax-M3 behavior.
