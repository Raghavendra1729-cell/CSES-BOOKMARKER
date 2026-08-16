import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const context = {};
vm.runInNewContext(fs.readFileSync(new URL("./request-key.js", import.meta.url), "utf8"), context);
const requestKey = context.CSESReviewRequestKey;

describe("review request key", () => {
  it("coalesces the same result and distinguishes fallback submissions by code", () => {
    expect(requestKey.forSubmission({ result_id: "42", code: "a" })).toBe("result:42");
    expect(requestKey.forSubmission({ problem_id: "1068", verdict: "WA", code: "a" }))
      .not.toBe(requestKey.forSubmission({ problem_id: "1068", verdict: "WA", code: "b" }));
  });
});
