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
            model: "zai-org/GLM-5.3:fireworks-ai",
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
    expect(body.model).toBe("zai-org/GLM-5.3:fireworks-ai");
    expect(body.max_tokens).toBe(220);
    expect(body.reasoning_effort).toBe("low");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(result.timing.totalTokens).toBe(120);
  });

  it("uses high reasoning and returns copy-ready source for accepted reviews", async () => {
    const calls = [];
    const review = {
      verdict_summary: "Accepted",
      current_analysis: {
        correctness: "Correct.",
        time_complexity: "O(n)",
        space_complexity: "O(1)",
        is_optimal: true,
      },
      code_quality: [],
      improvements: [],
      approaches: [{
        name: "Equivalent scan",
        idea: "Scan once.",
        time_complexity: "O(n)",
        space_complexity: "O(1)",
        tradeoffs: "Simple.",
        code: "```cpp\nint main() { return 0; }\n```",
      }],
    };
    const context = {
      CSESReviewPrompts: { SYSTEM_PROMPT: "system", buildPrompt: () => "prompt" },
      CSESReviewSchema: { validate: () => null, jsonSchema: () => ({ strict: true }) },
      fetch: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return {
          ok: true,
          text: async () => JSON.stringify({
            choices: [{ message: { content: JSON.stringify(review) } }],
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
      { accepted: true },
      { controller: { signal: {}, abort: () => {} } }
    );

    expect(calls[0].reasoning_effort).toBe("high");
    expect(calls[0].max_tokens).toBe(2400);
    expect(result.data.approaches[0].code).toBe("int main() { return 0; }");
  });
});
