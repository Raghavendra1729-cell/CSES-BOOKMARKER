import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./hf-client.js", import.meta.url), "utf8");

describe("Hugging Face review client", () => {
  it("uses the documented novita MiniMax model in its single request", async () => {
    const calls = [];
    const context = {
      CSESReviewPrompts: { SYSTEM_PROMPT: "system", buildPrompt: () => "prompt" },
      CSESReviewSchema: { validate: () => null },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          text: async () => JSON.stringify({
            model: "MiniMaxAI/MiniMax-M3:novita",
            choices: [{ message: { content: JSON.stringify({ verdict_summary: "WA", tiny_hint: "Check the boundary." }) } }],
          }),
        };
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
    };
    context.self = context;
    vm.runInNewContext(source, context);

    await context.CSESReviewHF.review(
      { hfToken: "test-token" },
      { accepted: false },
      { controller: { signal: {}, abort: () => {} } }
    );

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].init.body).model).toBe("MiniMaxAI/MiniMax-M3:novita");
  });
});
