import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./review-cache.js", import.meta.url), "utf8");

function installStorage(initial = {}) {
  const values = { ...initial };
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          if (keys == null) return callback({ ...values });
          const list = Array.isArray(keys) ? keys : [keys];
          callback(Object.fromEntries(list.filter((key) => key in values).map((key) => [key, values[key]])));
        },
        set(next, callback) {
          Object.assign(values, next);
          callback();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete values[key]);
          callback();
        },
      },
    },
  };
  return values;
}

beforeEach(() => {
  delete globalThis.CSESReviewCache;
});

describe("review cache", () => {
  it("removes a stale problem pointer when its review is pruned", async () => {
    const initial = {};
    for (let index = 0; index < 50; index += 1) {
      const resultId = `old-${index}`;
      const problemId = `p-${index}`;
      initial[`csesbm:rev:r:${resultId}`] = {
        result_id: resultId,
        problem_id: problemId,
        savedAt: index,
      };
      initial[`csesbm:rev:p:${problemId}`] = { result_id: resultId };
    }
    const values = installStorage(initial);
    globalThis.eval(source);

    await globalThis.CSESReviewCache.save(
      { result_id: "new", problem_id: "new-problem", code: "int main() {}" },
      { verdict_summary: "ok" }
    );

    expect(values["csesbm:rev:r:old-0"]).toBeUndefined();
    expect(values["csesbm:rev:p:p-0"]).toBeUndefined();
    expect(values["csesbm:rev:p:new-problem"].result_id).toBe("new");
  });

  it("uses source content rather than source length for fallback keys", () => {
    installStorage();
    globalThis.eval(source);
    const first = globalThis.CSESReviewCache.fallbackResultId({
      problem_id: "1068",
      verdict: "Wrong Answer",
      code: "abc",
    });
    const second = globalThis.CSESReviewCache.fallbackResultId({
      problem_id: "1068",
      verdict: "Wrong Answer",
      code: "xyz",
    });

    expect(first).not.toBe(second);
  });
});
