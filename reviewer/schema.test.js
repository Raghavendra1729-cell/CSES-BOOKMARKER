import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const context = {};
vm.runInNewContext(fs.readFileSync(new URL("./schema.js", import.meta.url), "utf8"), context);
const schema = context.CSESReviewSchema;

describe("single review schema", () => {
  it("rejects solution-like hints for an incorrect submission", () => {
    expect(schema.validate({ verdict_summary: "WA", tiny_hint: "Try `for (i=0; i<n; i++)`" }, false)).toMatch(/solution-like/);
  });

  it("accepts a microscopic rejected review", () => {
    expect(schema.validate({ verdict_summary: "Wrong Answer on a hidden test.", tiny_hint: "Look at what happens at the smallest boundary." }, false)).toBeNull();
  });

  it("requires complete code for accepted alternatives", () => {
    const review = {
      verdict_summary: "Accepted",
      current_analysis: { correctness: "Correct", time_complexity: "O(n)", space_complexity: "O(1)", is_optimal: true },
      code_quality: [],
      improvements: [],
      approaches: [{ name: "Alternative", idea: "Idea", time_complexity: "O(n)", space_complexity: "O(1)", tradeoffs: "Simpler", code: "short" }],
    };
    expect(schema.validate(review, true)).toMatch(/complete code/);
  });

  it("exposes strict accepted and rejected schemas", () => {
    expect(schema.jsonSchema(true).schema.additionalProperties).toBe(false);
    expect(schema.jsonSchema(false).schema.additionalProperties).toBe(false);
  });
});
