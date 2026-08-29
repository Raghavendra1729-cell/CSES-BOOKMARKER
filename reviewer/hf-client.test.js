import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./hf-client.js", import.meta.url), "utf8");

describe("Hugging Face review client", () => {
  it("uses one token-capped strict-schema request through the HF Fireworks route", async () => {
    const calls = [];
    const context = {
      CSESReviewPrompts: { SYSTEM_PROMPT: "system", buildPrompt: () => "prompt" },
      CSESReviewSchema: {
        validate: () => null,
        jsonSchema: () => ({ name: "rejected", strict: true, schema: { type: "object" } }),
      },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          text: async () => JSON.stringify({
            model: "MiniMaxAI/MiniMax-M3:fireworks-ai",
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            choices: [{ message: { content: JSON.stringify({ verdict_summary: "WA", tiny_hint: "Check the boundary." }) } }],
          }),
        };
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
    };
    context.self = context;
    vm.runInNewContext(source, context);

    const result = await context.CSESReviewHF.review(
      { hfToken: "test-token" },
      { accepted: false },
      { controller: { signal: {}, abort: () => {} } }
    );

    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe("MiniMaxAI/MiniMax-M3:fireworks-ai");
    expect(body.max_tokens).toBe(220);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(result.timing.totalTokens).toBe(120);
  });
});
