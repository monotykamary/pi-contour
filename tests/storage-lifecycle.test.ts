import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetricsCache, METRICS_VERSION } from "../src/core/metrics.js";
import { ContourEngine } from "../src/core/engine.js";
import { temporaryStorage, TemporaryStorage, STORAGE_LIMITS } from "../src/core/storage.js";
import { digest } from "../src/core/util.js";
import { main } from "../src/cli.js";
import { git, put, repo } from "./helpers.js";
import type { FileAnalysis, SourceFile } from "../src/core/types.js";

const parents: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(parents.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const source = (file: string, text = "export function a() { return 1; }"): SourceFile => ({ file, text, hash: digest(text) });
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "contour-lifecycle-")); parents.push(parent);
  const directory = join(parent, `pi-contour-${process.getuid!()}`); await mkdir(directory, { mode: 0o700 });
  const storage = new TemporaryStorage(directory, { ...STORAGE_LIMITS, intervalMs: 0 });
  const path = (root: string, kind: "facts" | "checkpoint" = "facts") => join(directory, storage.name(root, kind));
  const entries = async (root: string): Promise<Array<[string, FileAnalysis]>> => JSON.parse(await readFile(path(root), "utf8")).entries;
  return { directory, storage, path, entries };
}
function wire(storage: TemporaryStorage) {
  vi.spyOn(temporaryStorage, "read").mockImplementation((...args) => storage.read(...args));
  vi.spyOn(temporaryStorage, "write").mockImplementation((...args) => storage.write(...args));
  vi.spyOn(temporaryStorage, "housekeep").mockImplementation((...args) => storage.housekeep(...args));
}
const output = () => { const values = { out: "", error: "" }; return { values, io: { out: (text: string) => { values.out += text; return true; }, error: (text: string) => { values.error += text; return true; } } }; };

describe("temporary storage lifecycle wiring", () => {
  it("persists root-local comparison membership, not the global LRU or old revisions", async () => {
    const { storage, entries } = await fixture(), cache = new MetricsCache(storage);
    const a = source("a.ts"), b = source("b.ts"), old = source("a.ts", "export const a = 0;");
    cache.get(old); cache.get(a); cache.get(b);
    await cache.persist("root-a", [old, a]); await cache.persist("root-b", [b]);
    expect((await entries("root-a")).map(([key]) => key)).toEqual(expect.arrayContaining([expect.stringContaining("\0a.ts\0")]));
    expect(await entries("root-a")).toHaveLength(2); expect(await entries("root-b")).toHaveLength(1);
    await cache.persist("root-a", [a]); expect(await entries("root-a")).toHaveLength(1);
    // Shared memory hits still get persisted for a second root with no additional parse.
    const parses = cache.stats.parses; cache.get(a); await cache.persist("root-copy", [a]);
    expect(cache.stats.parses).toBe(parses); expect(await entries("root-copy")).toEqual(await entries("root-a"));
    const fresh = new MetricsCache(storage); await fresh.hydrate("root-a"); expect(fresh.get(a)).toEqual(cache.get(a));
    expect(fresh.stats.parses).toBe(0); expect(fresh.stats.diskHits).toBe(1);
  });
  it("regenerates legacy global envelopes, wrong-root envelopes and corrupted facts", async () => {
    const { storage, path } = await fixture(), a = source("a.ts"), cache = new MetricsCache(storage);
    cache.get(a); await cache.persist("a", [a]);
    const good = JSON.parse(await readFile(path("a"), "utf8"));
    for (const invalid of [{ ...good, format: undefined, root: undefined }, { ...good, root: digest("other") }, { ...good, checksum: "bad" }, { ...good, version: METRICS_VERSION + "-old" }]) {
      await storage.write("a", "facts", JSON.stringify(invalid));
      const fresh = new MetricsCache(storage); await fresh.hydrate("a"); fresh.get(a);
      expect(fresh.stats.diskHits).toBe(0); expect(fresh.stats.parses).toBe(1);
    }
  });
  it("wires real engine hydrate/persist, cross-root model hits, and no-change maintenance", async () => {
    const fixtureData = await fixture(); wire(fixtureData.storage);
    const a = await realpath(await repo({ "a.ts": "export const a = 1;" }));
    const b = await realpath(await repo({ "b.ts": "export const b = 2;" }));
    const copy = await realpath(await repo({ "b.ts": "export const b = 2;" }));
    const engine = new ContourEngine();
    await engine.review(a); await engine.review(b);
    const models = engine.stats.models, parses = engine.metrics.stats.parses;
    await engine.review(copy); expect(engine.stats.models).toBe(models); expect(engine.metrics.stats.parses).toBe(parses);
    expect(await fixtureData.entries(a)).toHaveLength(1); expect(await fixtureData.entries(b)).toHaveLength(1);
    expect(await fixtureData.entries(copy)).toEqual(await fixtureData.entries(b));
    const fresh = new ContourEngine(); await fresh.review(copy); expect(fresh.metrics.stats.parses).toBe(0); expect(fresh.metrics.stats.diskHits).toBe(1);
    await writeFile(fixtureData.path("stale"), "old", { mode: 0o600 });
    const old = new Date(Date.now() - 8 * 86_400_000); await utimes(fixtureData.path("stale"), old, old);
    await engine.review(copy); expect(engine.stats.reportHits).toBe(1);
    expect(await readdir(fixtureData.directory)).not.toContain(fixtureData.storage.name("stale", "facts"));
  });
  it("atomically retains CLI checkpoint suppression, renews reads, and never suppresses policy enforcement", async () => {
    const { storage, path } = await fixture(); wire(storage);
    const root = await realpath(await repo({ "core/a.ts": "export const a=1;", "ui/b.ts": "export const b=2;" }));
    await put(root, "core/a.ts", "import { b } from '../ui/b'; export const a=b;"); await git(root, ["add", "."]);
    const first = output(); expect(await main(["review", "--root", root, "--checkpoint"], first.io)).toBe(0); expect(first.values.out).toContain("coupling");
    const marker = await readFile(path(root, "checkpoint"), "utf8"); expect(marker).toMatch(/^[a-f0-9]{64}$/);
    const old = new Date(Date.now() - 8 * 86_400_000); await utimes(path(root, "checkpoint"), old, old);
    const second = output(); expect(await main(["review", "--root", root, "--checkpoint"], second.io)).toBe(0); expect(second.values.out).toBe("");
    await put(root, "policy.json", JSON.stringify({ boundaries: [{ from: "core", to: "ui", reason: "independent" }] }));
    for (let i = 0; i < 2; i++) {
      const policy = output(); expect(await main(["review", "--root", root, "--checkpoint", "--policy", "policy.json"], policy.io)).toBe(2);
      expect(policy.values.out).toContain("Forbidden dependency");
    }
    // Failed marker storage affects advisory repetition only, not the completed evidence or exit code.
    vi.spyOn(storage, "write").mockResolvedValue(false);
    const explicit = output(); expect(await main(["review", "--root", root, "--json"], explicit.io)).toBe(0);
    expect(JSON.parse(explicit.values.out).target).toBe("staged");
  });
});
