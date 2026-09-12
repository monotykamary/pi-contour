import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ContourEngine } from "../src/core/engine.js";
import { renderReport } from "../src/core/render.js";
import { complex, git, put, repo } from "./helpers.js";

describe("patch-oriented review", () => {
  it("finds new complexity, clones, coupling and cycles with conserved exposure", async () => {
    const root = await repo({ "parser/a.ts": "export function parse(n:number){return n;}", "transport/b.ts": "import { parse } from '../parser/a'; export const b = parse(1);" });
    await put(root, "parser/a.ts", "import { b } from '../transport/b';\n" + complex());
    await put(root, "parser/copy.ts", complex("copy")); await git(root, ["add", "."]);
    const report = await new ContourEngine().review(root, "staged", { maxFindings: 32 });
    expect(new Set(report.findings.map(f => f.category))).toEqual(new Set(["complexity", "duplication", "coupling", "cycle"]));
    expect(report.blockingFindings).toBe(0);
    const coupling = report.findings.find(f => f.category === "coupling")!;
    expect(coupling.evidence[0]!.line).toBe(1); expect(coupling.evidence[0]!.witness).toContain("../transport/b");
    for (const finding of report.findings) for (const exposure of finding.exposure ?? []) {
      expect(exposure.conservedMass).toBeCloseTo(exposure.sourceMass, 6);
      expect(exposure.outsideRegion).toBeGreaterThanOrEqual(-1e-8); expect(exposure.outsideRegion).toBeLessThanOrEqual(1 + 1e-8);
    }
    expect(coupling.exposure!.at(-1)!.outsideRegion).toBeGreaterThan(0);
  });
  it("keeps baseline issues quiet and shows decision redistribution across helpers", async () => {
    const root = await repo({ "src/a.ts": complex("parse", 12) });
    const engine = new ContourEngine();
    expect((await engine.review(root)).totalFindings).toBe(0);
    await put(root, "src/a.ts", complex("partA", 6) + complex("partB", 6)); await git(root, ["add", "."]);
    const report = await engine.review(root);
    expect(report.before.decisions).toBe(report.after.decisions); expect(report.after.functions).toBe(2);
    expect(report.after.erosion).toBeLessThan(report.before.erosion); expect(report.regions[0]!.after.decisions).toBe(12);
  });
  it("does not reflag unchanged complexity or patterns when only line numbers move", async () => {
    const text = complex() + "function bool(x:number) { return x ? true : false; }";
    const root = await repo({ "a.ts": text }); await put(root, "a.ts", "// header\n\n" + text); await git(root, ["add", "."]);
    expect((await new ContourEngine().review(root)).totalFindings).toBe(0);
  });
  it("reuses no-change generations and reparses only a changed file", async () => {
    const root = await repo({ "a.ts": "export const a = 1;", "b.ts": "export const b = 2;" }), engine = new ContourEngine();
    const first = await engine.review(root, "working-tree");
    const parses = engine.metrics.stats.parses, models = engine.stats.models, reads = engine.reader.stats.workReads;
    const second = await engine.review(root, "working-tree");
    expect(second.id).toBe(first.id); expect(engine.metrics.stats.parses).toBe(parses); expect(engine.stats.models).toBe(models);
    expect(engine.reader.stats.workReads).toBe(reads); expect(engine.stats.reportHits).toBe(1);
    await put(root, "a.ts", "export const a = 3;");
    await engine.review(root, "working-tree"); expect(engine.metrics.stats.parses).toBe(parses + 1);
    const otherProcess = new ContourEngine(); await otherProcess.review(root, "working-tree");
    expect(otherProcess.metrics.stats.parses).toBe(0); expect(otherProcess.metrics.stats.diskHits).toBeGreaterThan(0);
  });
  it("binds report identity to policies and never blocks on a heuristic", async () => {
    const root = await repo({ "core/a.ts": "export const a = 1;", "ui/b.ts": "export const b = 2;" });
    await put(root, "core/a.ts", "import { b } from '../ui/b'; export const a = b;"); await git(root, ["add", "."]);
    const engine = new ContourEngine(), advisory = await engine.review(root);
    const policy = await engine.review(root, "staged", { boundaries: [{ from: "core", to: "ui", reason: "Core cannot depend on presentation." }] });
    expect(policy.id).not.toBe(advisory.id); expect(advisory.blockingFindings).toBe(0); expect(policy.blockingFindings).toBe(1);
    expect(policy.findings[0]!.category).toBe("policy");
    await expect(engine.review(root, "staged", { boundaries: [{ from: "core", to: "ui", reason: "" }] })).rejects.toThrow();
  });
  it("keeps all text budgets bounded and output-prefix selection monotonic", async () => {
    const root = await repo({ "a.ts": "export const a = 1;" }); await put(root, "a.ts", complex()); await git(root, ["add", "."]);
    const report = await new ContourEngine().review(root);
    let displayed = 0;
    for (const budget of [256, 320, 512, 1024, 2500]) {
      const result = renderReport(report, budget); expect(result.tokens).toBeLessThanOrEqual(budget); expect(result.displayed).toBeGreaterThanOrEqual(displayed); displayed = result.displayed;
    }
  });
  it("rejects a snapshot that changes during analysis and leaves the index untouched otherwise", async () => {
    const root = await repo({ "a.ts": "const a = 1;" }), engine = new ContourEngine();
    const original = engine.reader.capture.bind(engine.reader); let captures = 0;
    vi.spyOn(engine.reader, "capture").mockImplementation(async (...args) => {
      if (++captures === 2) { await put(root, "a.ts", "const a = 2;"); await git(root, ["add", "."]); }
      return original(...args);
    });
    await expect(engine.review(root)).rejects.toThrow("changed during analysis");
    const index = await readFile(join(root, ".git/index")); await engine.review(root);
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
  });
  it("updates baseline identity on an empty commit without rebuilding the model", async () => {
    const root = await repo({ "a.ts": "const a = 1;" }), engine = new ContourEngine();
    const before = await engine.review(root); const models = engine.stats.models;
    await git(root, ["commit", "--allow-empty", "-m", "test(fixture): advance identical tree"]);
    const after = await engine.review(root);
    expect(after.id).not.toBe(before.id); expect(after.baseline).not.toBe(before.baseline); expect(engine.stats.models).toBe(models);
  });
  it("does not invent regressions when the baseline could not be extracted", async () => {
    const root = await repo({ "a.ts": "export function ( {" });
    await put(root, "a.ts", complex()); await git(root, ["add", "."]);
    const report = await new ContourEngine().review(root);
    expect(report.findings.filter(f => f.category === "complexity")).toEqual([]);
    expect(report.coverage.before.length).toBeGreaterThan(0);
    expect(renderReport(report).text).toContain("Coverage incomplete");
  });
  it("reports zero previous copies when an entire clone group is introduced", async () => {
    const root = await repo(); await put(root, "a.ts", complex("a")); await put(root, "b.ts", complex("b")); await git(root, ["add", "."]);
    const finding = (await new ContourEngine().review(root)).findings.find(f => f.category === "duplication")!;
    expect(finding.before).toBe(0); expect(finding.after).toBe(2);
  });
  it("keeps anonymous callback identity stable across comment-only line motion", async () => {
    const text = "export const values = [1].map(" + complex("callback").replace("export function callback(n: number)", "(n: number) =>") + ");";
    const root = await repo({ "a.ts": text }); await put(root, "a.ts", "// header\\n".replace("\\n", "\n") + text); await git(root, ["add", "."]);
    expect((await new ContourEngine().review(root)).totalFindings).toBe(0);
  });
  it("does not let callers mutate cached reports", async () => {
    const root = await repo({ "a.ts": "const a = 1;" }), engine = new ContourEngine();
    const result = await engine.review(root); result.after.sloc = 999; result.coverage.notes.length = 0;
    const next = await engine.review(root); expect(next.after.sloc).toBe(1); expect(next.coverage.notes.length).toBeGreaterThan(0);
  });
});
