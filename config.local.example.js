// Copy to config.local.js and paste your token.
// Chrome extensions cannot read .env — use this file OR the popup.
// config.local.js is gitignored. Never commit it.
self.CSESBM_LOCAL_CONFIG = {
  hfToken: "hf_your_token_here",
  summaryModel: "Qwen/Qwen2.5-Coder-32B-Instruct:fastest",
  detailModel: "MiniMaxAI/MiniMax-M3:novita",
  baseUrl: "https://router.huggingface.co/v1",
};
