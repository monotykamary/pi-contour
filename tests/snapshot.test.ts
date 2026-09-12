import { describe, expect, it } from "vitest";
import { readFile, rm, symlink, copyFile, utimes, stat } from "node:fs/promises";
import { join } from "node:path";
import { SnapshotReader } from "../src/core/snapshot.js";
import { git, put, repo } from "./helpers.js";

describe("immutable Git comparisons", () => {
  it("uses index bytes under partial staging and includes unchanged dependencies", async () => {
    const root = await repo({ "a.ts": "export const a = 1;", "b.ts": "export const b = 1;" });
    await put(root, "a.ts", "import { b } from './b'; export const a = b + 2;"); await git(root, ["add", "a.ts"]);
    await put(root, "a.ts", "export const a = 999;"); await put(root, "b.ts", "export const b = 999;");
    const index = await readFile(join(root, ".git/index"));
    const reader = new SnapshotReader();
    const staged = await reader.capture(root);
    expect(staged.before.files.get("a.ts")!.text).toContain("a = 1");
    expect(staged.after.files.get("a.ts")!.text).toContain("b + 2");
    expect(staged.after.files.get("b.ts")!.text).toContain("b = 1");
    const work = await reader.capture(root, "working-tree");
    expect(work.after.files.get("a.ts")!.text).toContain("999");
    expect(work.changed).toEqual(["a.ts", "b.ts"]);
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
  });
  it("supports unborn HEAD and empty index", async () => {
    const root = await repo({}, false), reader = new SnapshotReader();
    expect((await reader.capture(root)).changed).toEqual([]);
    await put(root, "new.ts", "const n = 1;"); await git(root, ["add", "."]);
    const result = await reader.capture(root);
    expect(result.before.revision).toBe("unborn"); expect(result.before.files.size).toBe(0); expect(result.changed).toEqual(["new.ts"]);
  });
  it("handles deletion and unusual renamed paths without shell interpolation", async () => {
    const root = await repo({ "old.ts": "export const x = 1;" });
    const path = "nested/quote '$()\nname.ts";
    await put(root, path, "export const x = 1;"); await git(root, ["rm", "old.ts"]); await git(root, ["add", "--", path]);
    const result = await new SnapshotReader().capture(root);
    expect(result.after.files.get(path)!.text).toContain("x = 1"); expect(result.changed).toEqual([path, "old.ts"].sort());
    await rm(join(root, path));
    expect((await new SnapshotReader().capture(root, "working-tree")).after.files.has(path)).toBe(false);
  });
  it("includes only nonignored untracked files in working-tree mode", async () => {
    const root = await repo({ ".gitignore": "ignored.ts\n" });
    await put(root, "new.ts", "const n = 1;"); await put(root, "ignored.ts", "const n = 2;");
    const reader = new SnapshotReader();
    expect((await reader.capture(root)).changed).toEqual([]);
    expect((await reader.capture(root, "working-tree")).changed).toEqual(["new.ts"]);
  });
  it("does not follow staged or working-tree symlinks", async () => {
    const root = await repo({ "real.ts": "export const x = 1;" });
    await symlink("real.ts", join(root, "link.ts")); await git(root, ["add", "link.ts"]);
    const reader = new SnapshotReader();
    const staged = await reader.capture(root);
    expect(staged.after.files.has("link.ts")).toBe(false);
    expect(staged.after.omissions.some(o => o.file === "link.ts" && /symlink/.test(o.reason))).toBe(true);
    await rm(join(root, "real.ts")); await symlink("link.ts", join(root, "real.ts"));
    expect((await reader.capture(root, "working-tree")).after.files.has("real.ts")).toBe(false);
  });
  it("reports file/byte caps and unsupported code instead of a clean graph", async () => {
    const root = await repo({ "a.ts": "const a = 1;", "b.ts": "x".repeat(80), "worker.py": "print('x')" });
    const byte = await new SnapshotReader({ maxFiles: 10, maxFileBytes: 30, maxTotalBytes: 100 }).capture(root);
    expect(byte.after.omissions).toEqual(expect.arrayContaining([expect.objectContaining({ file: "b.ts", reason: "file byte cap" }), expect.objectContaining({ file: "worker.py" })]));
    const count = await new SnapshotReader({ maxFiles: 1, maxFileBytes: 100, maxTotalBytes: 100 }).capture(root);
    expect(count.after.omissions).toContainEqual({ file: "b.ts", reason: "file count cap" });
  });
  it("reuses blobs and stat-proven worktree bytes without rereading", async () => {
    const root = await repo({ "a.ts": "const a = 1;" }), reader = new SnapshotReader();
    await reader.capture(root, "working-tree"); const counts = { ...reader.stats };
    await reader.capture(root, "working-tree");
    expect(reader.stats.blobReads).toBe(counts.blobReads); expect(reader.stats.workReads).toBe(counts.workReads); expect(reader.stats.statHits).toBeGreaterThan(counts.statHits);
    const prior = await stat(join(root, "a.ts")); await put(root, "a.ts", "const a = 2;"); await utimes(join(root, "a.ts"), prior.atime, prior.mtime);
    expect((await reader.capture(root, "working-tree")).after.files.get("a.ts")!.text).toContain("a = 2");
  });
  it("honors an alternate index, as used by some Git commit modes", async () => {
    const root = await repo({ "a.ts": "const a = 1;" });
    const alternate = join(root, ".git/alternate-index"); await copyFile(join(root, ".git/index"), alternate);
    const previous = process.env.GIT_INDEX_FILE;
    try {
      process.env.GIT_INDEX_FILE = alternate;
      await put(root, "a.ts", "const a = 2;"); await git(root, ["add", "a.ts"]);
      expect((await new SnapshotReader().capture(root)).after.files.get("a.ts")!.text).toContain("a = 2");
    } finally { if (previous === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = previous; }
    expect((await new SnapshotReader().capture(root)).after.files.get("a.ts")!.text).toContain("a = 1");
  });
  it("rejects unmerged indexes and respects pre-aborted signals", async () => {
    const root = await repo({ "a.ts": "const a = 1;" });
    const oid = (await git(root, ["rev-parse", "HEAD:a.ts"])).trim();
    await git(root, ["update-index", "--index-info"], `0 ${"0".repeat(40)}\ta.ts\n100644 ${oid} 1\ta.ts\n100644 ${oid} 2\ta.ts\n`);
    await expect(new SnapshotReader().capture(root)).rejects.toThrow("Unmerged");
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(new SnapshotReader().capture(root, "staged", controller.signal)).rejects.toThrow("cancelled");
  });
});
