import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const source = fs.readFileSync(new URL("./scrape.js", import.meta.url), "utf8");
let window;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    runScripts: "outside-only",
    url: "https://cses.fi/problemset/result/123",
  });
  window = dom.window;
  window.eval(source);
});

describe("CSES result scraper", () => {
  it("does not treat an earlier solved sidebar task as an accepted re-submission", () => {
    window.document.body.innerHTML = `
      <a href="/problemset/task/1068">Weird Algorithm</a>
      <a class="current" href="/problemset/task/1068"><span class="task-score icon full"></span>Weird Algorithm</a>
      <pre>int main() { return 0; }</pre>
    `;

    const submission = window.CSESReviewScrape.scrapeSubmission();
    expect(submission.verdict).toBe("Unknown");
    expect(submission.accepted).toBe(false);
  });

  it("uses the result table verdict for an accepted submission", () => {
    window.document.body.innerHTML = `
      <a href="/problemset/task/1068">Weird Algorithm</a>
      <table><tr><th>Result</th><td>Accepted</td></tr></table>
      <pre>int main() { return 0; }</pre>
    `;

    const submission = window.CSESReviewScrape.scrapeSubmission();
    expect(submission.verdict).toBe("Accepted");
    expect(submission.accepted).toBe(true);
  });
});
