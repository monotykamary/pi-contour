import { afterEach, describe, expect, it, vi } from "vitest";
import { SilentObserver } from "../src/core/background.js";
import { Lru } from "../src/core/util.js";
afterEach(() => vi.useRealTimers());

describe("quiet incremental scheduler", () => {
  it("allocates no timers until startup, coalesces bursts, and stops cleanly", async () => {
    vi.useFakeTimers();
    const scan = vi.fn(async () => {}), observer = new SilentObserver(scan, 20, 1000);
    expect(vi.getTimerCount()).toBe(0);
    observer.start(); observer.start();
    for (let i = 0; i < 20; i++) observer.wake();
    await vi.advanceTimersByTimeAsync(19); expect(scan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1020); expect(scan).toHaveBeenCalledTimes(2);
    await observer.stop(); await observer.stop(); expect(vi.getTimerCount()).toBe(0);
    observer.wake(); await vi.advanceTimersByTimeAsync(2000); expect(scan).toHaveBeenCalledTimes(2);
  });
  it("aborts obsolete work without overlapping scans or retaining a timer", async () => {
    vi.useFakeTimers(); let active = 0, maximum = 0;
    const signals: AbortSignal[] = [];
    const observer = new SilentObserver(signal => new Promise<void>(resolve => {
      signals.push(signal); active++; maximum = Math.max(maximum, active);
      signal.addEventListener("abort", () => { active--; resolve(); }, { once: true });
    }), 20, 1000);
    observer.start(); await vi.advanceTimersByTimeAsync(20);
    observer.wake(); observer.wake(); await vi.advanceTimersByTimeAsync(40);
    expect(signals[0]!.aborted).toBe(true); expect(signals.length).toBe(2); expect(maximum).toBe(1);
    await observer.stop(); expect(active).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not starve a long-running scan merely because a poll fires", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const observer = new SilentObserver(s => { signal = s; return new Promise<void>(resolve => s.addEventListener("abort", () => resolve(), { once: true })); }, 10, 100);
    observer.start(); await vi.advanceTimersByTimeAsync(500);
    expect(signal?.aborted).toBe(false); await observer.stop();
  });
  it("bounds retention by entries and bytes with LRU rather than FIFO eviction", () => {
    const cache = new Lru<string>(2, 5); cache.set("a", "a", 2); cache.set("b", "b", 2); cache.get("a"); cache.set("c", "c", 2);
    expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")).toBe("a");
    cache.set("huge", "huge", 6); expect(cache.get("huge")).toBeUndefined();
    expect(cache.snapshot()).toHaveLength(2);
  });
});
