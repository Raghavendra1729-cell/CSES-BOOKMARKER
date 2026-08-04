import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const context = {};
vm.runInNewContext(fs.readFileSync(new URL("./schema.js", import.meta.url), "utf8"), context);
const schema = context.CSESReviewSchema;

describe("review schema", () => {
  it("rejects solution-like rejected details", () => {
    expect(schema.validate("rejectedDetails", { critique: ["line 3"], hints: ["Try `for (i=0; i<n; i++)`"] }, false)).toMatch(/solution-like/);
  });
  it("requires complete accepted approach fields", () => {
    const partial = { name: "x", idea: "x", steps: ["a", "b"], correctness: "x", time_complexity: "O(n)", space_complexity: "O(1)", tradeoffs: "x", code: "short" };
    expect(schema.validate("acceptedDetails", { improvements: [], approaches: [partial, partial] }, true)).toMatch(/complete code/);
  });
  it("creates strict schemas", () => {
    expect(schema.jsonSchema("acceptedDetails").schema.additionalProperties).toBe(false);
  });
});
