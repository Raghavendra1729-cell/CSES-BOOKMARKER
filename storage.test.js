import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./storage.js", import.meta.url), "utf8");

function installStorage(initial = {}) {
  const values = { ...initial };
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      sync: {
        get(keys, callback) {
          if (keys == null) return callback({ ...values });
          callback(keys in values ? { [keys]: values[keys] } : {});
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
  globalThis.eval(source);
  return values;
}

beforeEach(() => {
  delete globalThis.CSESBM;
});

describe("bookmark storage", () => {
  it("canonicalizes CSES URLs and bounds imported text", async () => {
    installStorage();
    const saved = await globalThis.CSESBM.put({
      id: "1068",
      name: "n".repeat(250),
      category: "Introductory Problems",
      note: "x".repeat(1200),
      url: "javascript:alert(1)",
    });

    expect(saved.url).toBe("https://cses.fi/problemset/task/1068");
    expect(saved.name).toHaveLength(200);
    expect(saved.note).toHaveLength(1000);
  });

  it("ignores corrupt synced entries without hiding valid bookmarks", async () => {
    installStorage({
      "csesbm:1068": { id: "1068", name: "Weird Algorithm" },
      "csesbm:bad": { id: "not-a-problem", name: "Bad" },
    });

    const rows = await globalThis.CSESBM.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("1068");
  });

  it("surfaces Chrome storage write failures", async () => {
    installStorage();
    globalThis.chrome.storage.sync.set = (_next, callback) => {
      globalThis.chrome.runtime.lastError = { message: "quota exceeded" };
      callback();
      globalThis.chrome.runtime.lastError = null;
    };

    await expect(globalThis.CSESBM.put({ id: "1068" })).rejects.toThrow("quota exceeded");
  });
});
