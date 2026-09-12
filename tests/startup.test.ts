import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const mocks = vi.hoisted(() => ({ imported: vi.fn(), constructed: vi.fn(), review: vi.fn(async () => ({})) }));
vi.mock("../src/core/engine.js", () => {
  mocks.imported();
  return { ContourEngine: class { constructor() { mocks.constructed(); } review = mocks.review; } };
});
import contour from "../src/index.js";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function registered() {
  const api = { on: vi.fn(), registerTool: vi.fn(), registerCommand: vi.fn(), sendMessage: vi.fn() };
  contour(api as unknown as ExtensionAPI);
  const event = (name: string) => api.on.mock.calls.find(call => call[0] === name)![1];
  return { api, start: event("session_start"), stop: event("session_shutdown"), toolResult: event("tool_result") };
}
describe("lazy, silent startup", () => {
  it("does not import or construct analysis until a deferred poll; restart/shutdown release timers", async () => {
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "1");
    const ext = registered();
    expect(mocks.imported).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await ext.start({}, { cwd: "/unused" });
    expect(vi.getTimerCount()).toBe(1); expect(mocks.constructed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5399); expect(mocks.imported).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.imported).toHaveBeenCalledTimes(1);
    expect(mocks.constructed).toHaveBeenCalledTimes(1); expect(mocks.review).toHaveBeenCalledTimes(1);
    await ext.start({}, { cwd: "/different" }); expect(vi.getTimerCount()).toBe(1);
    await ext.stop({}); expect(vi.getTimerCount()).toBe(0); expect(ext.api.sendMessage).not.toHaveBeenCalled();
  });
  it("supports entirely on-demand operation, including tool-result activity", async () => {
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "0");
    const ext = registered(); await ext.start({}, { cwd: "/unused" });
    ext.toolResult({ toolName: "bash" }); await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.getTimerCount()).toBe(0); expect(mocks.constructed).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled(); expect(ext.api.sendMessage).not.toHaveBeenCalled();
    await ext.stop({});
  });
  it("coalesces post-start activity and never recursively wakes itself", async () => {
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "1");
    const ext = registered(); await ext.start({}, { cwd: "/unused" });
    ext.toolResult({ toolName: "contour_review" }); expect(vi.getTimerCount()).toBe(1);
    for (let i = 0; i < 10; i++) ext.toolResult({ toolName: "fabric_exec" });
    await vi.advanceTimersByTimeAsync(399); expect(mocks.review).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.review).toHaveBeenCalledTimes(1);
    await ext.stop({}); expect(vi.getTimerCount()).toBe(0);
  });
});
