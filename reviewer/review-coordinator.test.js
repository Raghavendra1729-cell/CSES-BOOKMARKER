import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";

describe("review request coordinator", () => {
  let coordinator;

  beforeEach(() => {
    const context = { globalThis: {}, AbortController, Promise, Map, Set };
    vm.runInNewContext(fs.readFileSync("reviewer/review-coordinator.js", "utf8"), context);
    coordinator = context.globalThis.CSESReviewCoordinator.create();
  });

  it("keeps a shared request alive until every caller cancels", async () => {
    let resolveTask;
    let sharedController;
    const start = vi.fn((controller) => new Promise((resolve) => {
      sharedController = controller;
      resolveTask = resolve;
      controller.signal.addEventListener("abort", () => resolve("aborted"));
    }));

    const first = coordinator.acquire("same", "request-a", start);
    const second = coordinator.acquire("same", "request-b", start);
    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(1);
    expect(coordinator.cancel("request-a")).toBe(true);
    expect(sharedController.signal.aborted).toBe(false);

    expect(coordinator.cancel("request-b")).toBe(true);
    expect(sharedController.signal.aborted).toBe(true);
    expect(await first).toBe("aborted");
    expect(await second).toBe("aborted");
    resolveTask("done");
  });

  it("starts a new request after the previous one finishes", async () => {
    const start = vi.fn().mockResolvedValue("done");
    await coordinator.acquire("same", "request-a", start);
    await Promise.resolve();
    await coordinator.acquire("same", "request-b", start);
    expect(start).toHaveBeenCalledTimes(2);
  });
});
