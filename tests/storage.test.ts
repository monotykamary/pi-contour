import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TemporaryStorage, STORAGE_LIMITS, pruneTemporaryStorage } from "../src/core/storage.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), lstat: vi.fn(actual.lstat), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink), readdir: vi.fn(actual.readdir) };
});
const parents: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); await Promise.all(parents.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
async function fixture(limits: Partial<typeof STORAGE_LIMITS> = {}) {
  const parent = await fs.mkdtemp(join(tmpdir(), "contour-storage-")); parents.push(parent);
  const directory = join(parent, `pi-contour-${process.getuid!()}`);
  await fs.mkdir(directory, { mode: 0o700 });
  const store = new TemporaryStorage(directory, { ...STORAGE_LIMITS, ...limits });
  const path = (root: string, kind: "facts" | "checkpoint" = "facts") => join(directory, store.name(root, kind));
  const put = async (root: string, data = "facts", age = 0, kind: "facts" | "checkpoint" = "facts") => {
    const file = path(root, kind); await fs.writeFile(file, data, { mode: 0o600 });
    const time = new Date(Date.now() - age); await fs.utimes(file, time, time); return file;
  };
  return { parent, directory, store, path, put };
}
const exists = async (file: string) => fs.lstat(file).then(() => true, () => false);
const DAY = 86_400_000;

describe("bounded, owned temporary storage", () => {
  it("previews an explicit directory by default with accounting and no mutation", async () => {
    const { directory, store, put, path } = await fixture();
    await put("stale", "1234", 8 * DAY); await put("current", "1234", 8 * DAY);
    await fs.writeFile(join(directory, "unknown"), "unmanaged");
    const before = await fs.stat(path("stale"));
    const preview = await pruneTemporaryStorage(directory, { keepRoot: "current" });
    expect(preview).toMatchObject({ dryRun: true, filesBefore: 2, bytesBefore: 8, filesAfter: 1, bytesAfter: 4,
      removedFiles: 0, removedBytes: 0, skipped: 1, failed: 0, candidates: [store.name("stale", "facts")] });
    expect((await fs.stat(path("stale"))).mtimeMs).toBe(before.mtimeMs);
    expect(await fs.readdir(directory)).toHaveLength(3);
    const applied = await pruneTemporaryStorage(directory, { dryRun: false, keepRoot: "current" });
    expect(applied).toMatchObject({ dryRun: false, removedFiles: 1, removedBytes: 4, filesAfter: 1, bytesAfter: 4 });
    expect(await exists(path("stale"))).toBe(false); expect(await exists(path("current"))).toBe(true);
    expect((await pruneTemporaryStorage(join(directory, "unknown"))).error).toContain("Unsafe cache directory name");
  });
  it("reports cleanup failures in explicit maintenance without rejecting", async () => {
    const { directory, put } = await fixture(); await put("stale", "old", 8 * DAY);
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("denied"));
    expect(await pruneTemporaryStorage(directory, { dryRun: false })).toMatchObject({ failed: 1, removedFiles: 0, filesAfter: 1 });
  });
  it("finally removes a partially written exclusive temp when writing fails", async () => {
    const { directory, store } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => { await handle.write("partial"); throw new Error("disk full"); });
      return handle;
    });
    expect(await store.write("a", "facts", "new")).toBe(false);
    expect(await fs.readdir(directory)).toEqual([]);
    const [, flags, mode] = vi.mocked(fs.open).mock.calls.at(-1)!;
    const { constants } = await import("node:fs");
    expect(Number(flags) & constants.O_EXCL).toBe(constants.O_EXCL); expect(mode).toBe(0o600);
  });
  it("is inert at construction and coalesces/throttles actual housekeeping", async () => {
    const { directory, store } = await fixture(); vi.mocked(fs.readdir).mockClear(); vi.mocked(fs.lstat).mockClear();
    new TemporaryStorage(directory);
    expect(fs.lstat).not.toHaveBeenCalled(); expect(fs.readdir).not.toHaveBeenCalled();
    const first = store.housekeep("a"), second = store.housekeep("b");
    expect(first).toBe(second); await first;
    await store.housekeep("a"); expect(fs.readdir).toHaveBeenCalledTimes(1);
    await store.write("a", "checkpoint", "report"); expect(fs.readdir).toHaveBeenCalledTimes(2);
  });
  it("expires old facts/checkpoints but keeps the current pair and unrelated names", async () => {
    const { directory, store, put, path } = await fixture();
    await put("old", "old", 8 * DAY); await put("old", "old", 8 * DAY, "checkpoint");
    await put("current", "current", 8 * DAY); await put("current", "report", 8 * DAY, "checkpoint");
    for (const name of ["notes.txt", "facts-nohash.json", `${store.name("bad", "facts")}.backup`, "arbitrary.tmp"]) await fs.writeFile(join(directory, name), "user");
    await store.housekeep("current");
    expect(await exists(path("old"))).toBe(false); expect(await exists(path("old", "checkpoint"))).toBe(false);
    expect(await exists(path("current"))).toBe(true); expect(await exists(path("current", "checkpoint"))).toBe(true);
    expect(await fs.readdir(directory)).toHaveLength(6);
  });
  it.each([{ bytes: 8, files: 128 }, { bytes: 1000, files: 2 }])("evicts oldest non-current entries under pressure %j", async limits => {
    const { store, put, path } = await fixture(limits);
    await put("oldest", "1234", 3000); await put("middle", "1234", 2000); await put("current", "1234", 4000);
    await store.housekeep("current");
    expect(await exists(path("oldest"))).toBe(false); expect(await exists(path("middle"))).toBe(true); expect(await exists(path("current"))).toBe(true);
  });
  it("enforces write pressure without waiting for the read throttle", async () => {
    const { store, put, path } = await fixture({ files: 2 });
    await put("old", "old", 3000); await store.housekeep("old");
    await store.write("middle", "facts", "middle"); await store.write("new", "facts", "new");
    expect(await exists(path("old"))).toBe(false); expect(await exists(path("new"))).toBe(true);
  });
  it("reaps only stale dead-writer or legacy temps, preserving fresh/live/unknown temps", async () => {
    const { directory, store } = await fixture({ files: 1, bytes: 1 });
    const name = store.name("temp", "facts"), base = Date.now();
    const dead = `${name}.2147483647.${randomUUID()}.tmp`, live = `${name}.${process.pid}.${randomUUID()}.tmp`;
    const legacy = `${name}.${randomUUID()}.tmp`, youngLegacy = `${store.name("young", "facts")}.${randomUUID()}.tmp`;
    const fresh = `${store.name("fresh", "facts")}.2147483647.${randomUUID()}.tmp`, unknown = `${name}.0.${randomUUID()}.tmp`;
    for (const file of [dead, live, legacy, youngLegacy, fresh, unknown]) await fs.writeFile(join(directory, file), "temp", { mode: 0o600 });
    const future = base + 8 * DAY;
    for (const [file, time] of [[fresh, future], [youngLegacy, future - 2 * DAY]] as const) await fs.utimes(join(directory, file), new Date(time), new Date(time));
    vi.spyOn(Date, "now").mockReturnValue(future);
    const kill = vi.spyOn(process, "kill").mockImplementation(pid => {
      if (pid === process.pid) return true;
      throw Object.assign(new Error("dead"), { code: "ESRCH" });
    });
    await store.housekeep("current");
    expect((await fs.readdir(directory)).sort()).toEqual([live, youngLegacy, fresh, unknown].sort());
    expect(kill.mock.calls.every(([, signal]) => signal === 0)).toBe(true);
  });
  it("treats permission errors probing a writer as live, not dead", async () => {
    const { directory, store } = await fixture();
    const file = `${store.name("temp", "facts")}.1234.${randomUUID()}.tmp`;
    await fs.writeFile(join(directory, file), "temp", { mode: 0o600 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 8 * DAY);
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    await store.housekeep("current"); expect(await exists(join(directory, file))).toBe(true);
  });
  it("never follows file symlinks or removes directories, hardlinks or unsafe modes", async () => {
    const { parent, store, path, directory } = await fixture({ files: 0 });
    const outside = join(parent, "outside"); await fs.writeFile(outside, "outside", { mode: 0o600 });
    await fs.symlink(outside, path("link")); await fs.mkdir(path("directory")); await fs.link(outside, path("hardlink"));
    await fs.writeFile(path("public"), "public", { mode: 0o644 });
    expect(await store.read("link", "facts")).toBeUndefined(); expect(await store.write("link", "facts", "bad")).toBe(false);
    expect(await store.read("hardlink", "facts")).toBeUndefined(); expect(await store.write("hardlink", "facts", "bad")).toBe(false);
    await store.housekeep("current", true);
    expect(await fs.readdir(directory)).toHaveLength(4); expect(await fs.readFile(outside, "utf8")).toBe("outside");
  });
  it("rejects symlinked, wrong-owner, public and other-user cache roots", async () => {
    const { parent, directory, store } = await fixture();
    const elsewhere = join(parent, "elsewhere"); await fs.mkdir(elsewhere);
    await fs.rmdir(directory); await fs.symlink(elsewhere, directory);
    expect(await store.write("a", "facts", "bad")).toBe(false); expect(await fs.readdir(elsewhere)).toEqual([]);
    await fs.unlink(directory); await fs.mkdir(directory, { mode: 0o755 });
    expect(await store.write("a", "facts", "bad")).toBe(false);
    await fs.chmod(directory, 0o700);
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.lstat).mockImplementationOnce(async file => Object.assign(await actual.lstat(file), { uid: process.getuid!() + 1 }));
    expect(await store.write("a", "facts", "bad")).toBe(false);
    const other = new TemporaryStorage(join(parent, `pi-contour-${process.getuid!() + 1}`));
    expect(await other.write("a", "facts", "bad")).toBe(false);
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it("skips wrong-owner files", async () => {
    const { store, put, path } = await fixture({ files: 0 }); await put("other");
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.lstat).mockImplementation(async file => {
      const stat = await actual.lstat(file); return String(file) === path("other") ? Object.assign(stat, { uid: stat.uid + 1 }) : stat;
    });
    await store.housekeep("current"); expect(await exists(path("other"))).toBe(true);
    vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  });
  it("rechecks inode/metadata before unlink and preserves concurrent replacements", async () => {
    const { store, put, path } = await fixture({ files: 0 }); await put("replace");
    const actual = await vi.importActual<typeof fs>("node:fs/promises"); let seen = 0;
    vi.mocked(fs.lstat).mockImplementation(async file => {
      if (String(file) === path("replace") && ++seen === 2) {
        const replacement = path("replacement"); await fs.writeFile(replacement, "new", { mode: 0o600 }); await actual.rename(replacement, path("replace"));
      }
      return actual.lstat(file);
    });
    await store.housekeep("current"); expect(await fs.readFile(path("replace"), "utf8")).toBe("new");
    vi.mocked(fs.lstat).mockImplementation(actual.lstat);
  });
  it("continues after unlink failures and retries on later use", async () => {
    const { store, put, path } = await fixture({ files: 0, intervalMs: 0 });
    await put("a", "a", 3000); await put("b", "b", 2000);
    vi.mocked(fs.unlink).mockRejectedValueOnce(new Error("denied"));
    await expect(store.housekeep("current")).resolves.toBeUndefined();
    expect(await exists(path("a"))).toBe(true); expect(await exists(path("b"))).toBe(false);
    await store.housekeep("current"); expect(await exists(path("a"))).toBe(false);
  });
  it("uses private atomic writes and finally removes its temp on failed rename", async () => {
    const { store, directory, path } = await fixture();
    expect(await store.write("a", "checkpoint", "previous")).toBe(true);
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error("rename failed"));
    expect(await store.write("a", "checkpoint", "next")).toBe(false);
    expect(await fs.readFile(path("a", "checkpoint"), "utf8")).toBe("previous");
    expect(await fs.readdir(directory)).toEqual([store.name("a", "checkpoint")]);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path("a", "checkpoint"))).mode & 0o777).toBe(0o600);
  });
  it("bounds per-file reads/writes and removes oversized non-current files", async () => {
    const { store, directory, path, put } = await fixture();
    await put("big", "x"); await fs.truncate(path("big"), 64 * 1024 * 1024 + 1);
    expect(await store.read("big", "facts")).toBeUndefined();
    expect(await store.write("marker", "checkpoint", "x".repeat(1025))).toBe(false);
    expect(await store.write("big", "facts", "x".repeat(64 * 1024 * 1024 + 1))).toBe(false);
    await store.housekeep("current", true); expect(await fs.readdir(directory)).toEqual([]);
  });
  it("survives concurrent writers without partial data or lingering own temps", async () => {
    const { store, directory } = await fixture();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.write("same", "checkpoint", `report-${i}`)));
    expect(results.some(Boolean)).toBe(true); expect(await store.read("same", "checkpoint")).toMatch(/^report-[0-7]$/);
    expect(await fs.readdir(directory)).toEqual([store.name("same", "checkpoint")]);
  });
});
