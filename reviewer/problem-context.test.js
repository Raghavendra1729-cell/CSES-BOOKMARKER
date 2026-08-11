import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./problem-context.js", import.meta.url), "utf8");

describe("CSES problem context extraction", () => {
  it("extracts the current CSES md statement, limits, and sample instead of the whole page", () => {
    const context = {};
    context.self = context;
    vm.runInNewContext(source, context);
    const html = `
      <html><head><title>CSES Problem Set</title></head><body>
      <ul class="task-constraints"><li><b>Time limit:</b> 1.00 s</li><li><b>Memory limit:</b> 512 MB</li></ul>
      <div class="md"><p>Find the answer for n.</p><h1>Input</h1><p>An integer n.</p><h1>Constraints</h1><ul><li>1 &lt;= n &lt;= 10^6</li></ul><h1>Example</h1><pre>3</pre></div>
      <div class="nav sidebar">Many unrelated tasks and account text</div>
      </body></html>`;

    const result = context.CSESReviewProblemContext.extract(html);
    expect(result.problem_statement).toContain("Find the answer for n.");
    expect(result.problem_statement).not.toContain("Many unrelated tasks");
    expect(result.constraints).toContain("Time limit: 1.00 s");
    expect(result.constraints).toContain("1 <= n <= 10^6");
    expect(result.samples).toContain("Example");
    expect(result.samples).toContain("3");
  });
});
