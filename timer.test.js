import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./timer.js", import.meta.url), "utf8");

function installStorage(initial = {}) {
  const values = { ...initial };
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(key, callback) {
          callback(key in values ? { [key]: values[key] } : {});
        },
        set(next, callback) {
          Object.assign(values, next);
          callback();
        },
      },
    },
  };
  globalThis.eval(source);
  return values;
}

beforeEach(() => {
  delete globalThis.CSESTimer;
});

describe("solve timer storage", () => {
  it("rejects corrupt restored timer state", async () => {
    installStorage({
      "csesbm-timer:1068": { status: "running", accumulatedMs: -5, lastResumeAt: 1 },
    });
    expect(await globalThis.CSESTimer.get("1068")).toBeNull();
  });

  it("never reports negative elapsed time after a clock change", () => {
    installStorage();
    expect(globalThis.CSESTimer.elapsedMs({
      status: "running",
      accumulatedMs: 250,
      lastResumeAt: Date.now() + 10000,
    })).toBe(250);
  });
});
