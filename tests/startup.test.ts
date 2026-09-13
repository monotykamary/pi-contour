import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { repo } from "./helpers.js";
const mocks = vi.hoisted(() => ({ imported: vi.fn(), constructed: vi.fn(), review: vi.fn(async (root:string, _target?:unknown, _options?:unknown, _signal?:AbortSignal) => ({root})) }));
vi.mock("../src/core/engine.js", () => {
  mocks.imported(); return { ContourEngine: class { constructor() { mocks.constructed(); } review = mocks.review; } };
});
import contour from "../src/index.js";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function registered() {
  const api = { on: vi.fn(), registerTool: vi.fn(), registerCommand: vi.fn(), sendMessage: vi.fn() };
  contour(api as unknown as ExtensionAPI);
  const event = (name: string) => api.on.mock.calls.find(call => call[0] === name)![1];
  return { api, start: event("session_start"), stop: event("session_shutdown"), toolResult: event("tool_result") };
}
describe("many-root scheduling", () => {
  it("gives quieter roots a turn despite continuous activity in one project", async () => {
    const roots=await Promise.all(Array.from({length:4},async()=>realpath(await repo({"a.ts":"export const a=1;"}))));
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND","1"); const ext=registered(),ctx={cwd:"/unused"};
    await ext.start({},ctx);
    try {
      for(const root of roots)await ext.toolResult({toolName:"read",input:{path:join(root,"a.ts")},isError:false},ctx);
      for(let i=0;i<10;i++) {
        await ext.toolResult({toolName:"read",input:{path:join(roots[0]!,"a.ts")},isError:false},ctx);
        const calls=mocks.review.mock.calls.length;
        await vi.advanceTimersByTimeAsync(600);
        await vi.waitFor(()=>expect(mocks.review.mock.calls.length).toBeGreaterThan(calls));
      }
      expect(new Set(mocks.review.mock.calls.map(call=>call[0]))).toEqual(new Set(roots));
    } finally {await ext.stop({});}
  });
  it("aborts an explicit checkpoint when its session shuts down", async () => {
    const root=await realpath(await repo({"a.ts":"export const a=1;"})); vi.stubEnv("CONTOUR_BACKGROUND","0");
    const ext=registered(),ctx={cwd:root}; await ext.start({},ctx);
    mocks.review.mockImplementationOnce((_root,_target,_options,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener("abort",()=>reject(signal!.reason),{once:true})));
    const tool=ext.api.registerTool.mock.calls[0]![0];
    const pending=expect(tool.execute("checkpoint",{root},undefined,undefined,ctx)).rejects.toThrow("session shut down");
    await vi.waitFor(()=>expect(mocks.review).toHaveBeenCalledTimes(1));
    await ext.stop({}); await pending; expect(ext.api.sendMessage).not.toHaveBeenCalled();
  });
});

describe("lazy, silent coordinator startup", () => {
  it("never imports analysis or probes the launch directory on idle polls", async () => {
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "1"); const ext=registered();
    expect(mocks.imported).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    await ext.start({}, {cwd:"/unused"}); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.imported).not.toHaveBeenCalled(); expect(mocks.constructed).not.toHaveBeenCalled();
    await ext.start({}, {cwd:"/different"}); expect(vi.getTimerCount()).toBe(1);
    await ext.stop({}); expect(vi.getTimerCount()).toBe(0); expect(ext.api.sendMessage).not.toHaveBeenCalled();
  });
  it("keeps on-demand mode silent even after successful project enrollment", async () => {
    const root=await realpath(await repo({"a.ts":"export const a=1;"}));
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "0"); const ext=registered(),ctx={cwd:root};
    await ext.start({},ctx);
    await ext.toolResult({toolName:"read",input:{path:join(root,"a.ts")},isError:false},ctx);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.getTimerCount()).toBe(0); expect(mocks.constructed).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
    await ext.stop({}); expect(ext.api.sendMessage).not.toHaveBeenCalled();
  });
  it("ignores blocked/opaque activity and coalesces successful child access", async () => {
    const root=await realpath(await repo({"a.ts":"export const a=1;"}));
    vi.useFakeTimers(); vi.stubEnv("CONTOUR_BACKGROUND", "1"); const ext=registered(),ctx={cwd:"/unused"};
    await ext.start({},ctx);
    for(const event of [{toolName:"contour_review"},{toolName:"fabric_exec"},{toolName:"read",input:{path:join(root,"a.ts")},isError:true}]) await ext.toolResult(event,ctx);
    await vi.advanceTimersByTimeAsync(6000); expect(mocks.review).not.toHaveBeenCalled();
    for(let i=0;i<10;i++) await ext.toolResult({toolName:"read",input:{path:join(root,"a.ts")},isError:false},ctx);
    await vi.advanceTimersByTimeAsync(399); expect(mocks.review).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(()=>expect(mocks.review).toHaveBeenCalledTimes(1));
    expect(mocks.review.mock.calls[0]![0]).toBe(root);
    await ext.stop({}); expect(vi.getTimerCount()).toBe(0); expect(ext.api.sendMessage).not.toHaveBeenCalled();
  });
});
