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
      <a href="/problemset/task/1083">Unrelated navigation task</a>
      <a class="current" href="/problemset/task/1068"><span class="task-score icon full"></span>Weird Algorithm</a>
      <pre>int main() { return 0; }</pre>
    `;

    const submission = window.CSESReviewScrape.scrapeSubmission();
    expect(submission.problem_id).toBe("1068");
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

  it("does not report problem limits as submission usage", () => {
    window.document.body.innerHTML = `
      <a class="current" href="/problemset/task/1068">Weird Algorithm</a>
      <table>
        <tr><th>Result</th><td>Wrong Answer</td></tr>
        <tr><th>Time limit</th><td>1.00 s</td></tr>
        <tr><th>Memory limit</th><td>512 MB</td></tr>
      </table>
      <pre>int main() { return 0; }</pre>
    `;

    const submission = window.CSESReviewScrape.scrapeSubmission();
    expect(submission.time_ms).toBeNull();
    expect(submission.memory_kb).toBeNull();
  });

  it("reads explicit runtime and memory usage fields", () => {
    window.document.body.innerHTML = `
      <a class="current" href="/problemset/task/1068">Weird Algorithm</a>
      <table>
        <tr><th>Status</th><td>Accepted</td></tr>
        <tr><th>Execution time</th><td>0.08 s</td></tr>
        <tr><th>Memory usage</th><td>4.5 MB</td></tr>
      </table>
      <pre>int main() { return 0; }</pre>
    `;

    const submission = window.CSESReviewScrape.scrapeSubmission();
    expect(submission.time_ms).toBe(80);
    expect(submission.memory_kb).toBe(4608);
  });
});
