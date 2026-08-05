import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const panelSource = fs.readFileSync(new URL("./panel.js", import.meta.url), "utf8");
let window;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "outside-only",
    url: "https://cses.fi/problemset/result/1",
  });
  window = dom.window;
  window.eval(panelSource);
});

describe("review panel", () => {
  it("shows accepted alternatives directly with complete code", () => {
    window.CSESReviewPanel.renderReview({
      verdict_summary: "Accepted and optimal.",
      current_analysis: { correctness: "Correct.", time_complexity: "O(n)", space_complexity: "O(1)", is_optimal: true },
      code_quality: ["Clear naming."],
      improvements: ["Use a const."],
      approaches: [{ name: "Equivalent scan", idea: "Scan once.", time_complexity: "O(n)", space_complexity: "O(1)", tradeoffs: "Simpler state.", code: "int main() { return 0; }" }],
    }, { accepted: true }, {});

    expect(window.document.querySelector(".csesbm-rv-approach").textContent).toContain("Equivalent scan");
    expect(window.document.querySelector("pre").textContent).toContain("int main");
    expect(window.document.querySelector("details")).toBeNull();
  });

  it("shows only a compact hint for a rejected submission", () => {
    window.CSESReviewPanel.renderReview({
      verdict_summary: "Wrong Answer.",
      tiny_hint: "Recheck the smallest boundary.",
    }, { accepted: false, verdict: "Wrong Answer" }, {});

    expect(window.document.querySelector(".csesbm-rv-hint-card").textContent).toContain("smallest boundary");
    expect(window.document.querySelector("pre")).toBeNull();
    expect(window.document.querySelector(".csesbm-rv-approach")).toBeNull();
  });
});
