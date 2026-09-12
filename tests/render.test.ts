import { describe, expect, it } from "vitest";
import { renderReport } from "../src/core/render.js";
import type { Finding, ReviewReport, Totals } from "../src/core/types.js";

const totals = (): Totals => ({ sloc: 100, functions: 5, decisions: 8, mass: 50, complexMass: 0, erosion: 0, flaggedLines: 0, cloneLines: 0, verboseLines: 0, verbosity: 0 });
const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "complexity:parse", category: "complexity", title: "parse: decision load increased",
  evidence: [{ file: "src/parser.ts", line: 42, relation: "callable", witness: "parse" }],
  before: 8, after: 12, unit: "decisions (CC = decisions + 1)", question: "Is this branching required?", blocking: false,
  exposure: [0.5, 2, 8].map(time => ({ time, sourceMass: 1, conservedMass: 1, outsideRegion: 0.125, neighbors: [{ file: "src/neighbor.ts", mass: 0.125 }] })),
  ...overrides,
});
const report = (findings: Finding[] = []): ReviewReport => ({
  schemaVersion: 1, id: "report", root: "/fixture", target: "staged", baseline: "aaaaaaaaaaaaaaaa", snapshot: "bbbbbbbbbbbbbbbb",
  changed: ["src/parser.ts"], before: totals(), after: { ...totals(), sloc: 118, decisions: 12 }, regions: [], findings,
  totalFindings: findings.length, blockingFindings: findings.filter(f => f.blocking).length,
  coverage: { before: [], after: [], notes: [] }, configHash: "config",
});

describe("checkpoint visual vocabulary", () => {
  it("separates structural changes, source witnesses, modeled exposure, and review questions", () => {
    const input = report([finding()]), original = structuredClone(input);
    const rendered = renderReport(input), text = rendered.text;
    expect(text).toContain("Contour · staged · aaaaaaaaaaaa → bbbbbbbbbbbb");
    expect(text).toContain("Δ SLOC +18; decisions +4;");
    expect(text).toContain("Δ Verbose lines 0 → 0; complex mass 0.0 → 0.0");
    expect(text).toContain("Δ [complexity; advisory] parse: decision load increased");
    expect(text).toContain("  ▪ src/parser.ts:42 [callable] — parse");
    expect(text).toContain("  8 → 12 decisions (CC = decisions + 1)");
    expect(text).toContain("  ↗ Exposure (modeled): t=0.5: 12.5% outside source region; t=2: 12.5% outside source region; t=8: 12.5% outside source region");
    expect(text).toContain("  ? Is this branching required?");
    expect(text).not.toContain("▪ src/neighbor.ts");
    expect(text).toContain("Heat means exposure, not defect probability.");
    expect(text).not.toContain("⚠"); expect(rendered.displayed).toBe(1); expect(input).toEqual(original);
  });

  it("keeps explicit policy labels separate from advisory and coverage markers", () => {
    const text = renderReport(report([finding({ category: "policy", blocking: true, title: "Forbidden dependency", exposure: undefined })])).text;
    expect(text).toContain("1 policy violations"); expect(text).toContain("Δ [policy; explicit policy] Forbidden dependency");
    expect(text).not.toContain("advisory"); expect(text).not.toContain("↗"); expect(text).not.toContain("⚠");
  });

  it("labels gaps in both snapshots and puts their witnesses before regional summaries", () => {
    const input = report();
    input.coverage.before = [{ file: "legacy.ts", reason: "Parse failed" }];
    input.coverage.after = [{ file: "worker/job.py", reason: "Unsupported language: .py" }];
    input.regions = [{ region: "src", before: input.before, after: input.after }];
    const text = renderReport(input).text;
    expect(text).toContain("2 file/extraction gaps");
    expect(text).toContain("⚠ Coverage incomplete; absence of findings is not approval.");
    expect(text).toContain("⚠ Gap (baseline): legacy.ts — Parse failed");
    expect(text).toContain("⚠ Gap (target): worker/job.py — Unsupported language: .py");
    expect(text).toContain("Δ Region src: decisions 8 → 12; functions 5 → 5");
    expect(text.indexOf("⚠ Gap (target)")).toBeLessThan(text.indexOf("Δ Region"));
    expect(text).toContain("No quality score or correctness guarantee.");
  });

  it("warns even when only the baseline is incomplete and no finding is available", () => {
    const input = report(); input.coverage.before = [{ file: "old.ts", reason: "Unreadable baseline" }];
    const text = renderReport(input).text;
    expect(text).toContain("0 findings"); expect(text).toContain("⚠ Coverage incomplete");
    expect(text).toContain("⚠ Gap (baseline): old.ts — Unreadable baseline");
  });

  it("does not invent exposure, warnings, or findings for an empty comparison", () => {
    const input = report(); input.changed = []; input.after = totals();
    const text = renderReport(input).text;
    expect(text).toContain("0 changed source files · 0 findings · 0 policy violations · 0 file/extraction gaps");
    for (const marker of ["Δ [", "▪", "↗", "  ?", "⚠"]) expect(text).not.toContain(marker);
    expect(text).toContain("No quality score or correctness guarantee.");
    expect(renderReport(report([finding({ exposure: [] })])).text).not.toContain("↗");
  });

  it("escapes controls in witnesses, questions, units, relations, and coverage text", () => {
    const esc = String.fromCharCode(27);
    const input = report([finding({ title: `parse${esc}`, unit: "decisions\nspoof", question: "May\nwe simplify?", evidence: [{ file: `src/${esc}.ts`, line: 4, relation: "import\ttarget", witness: `call${esc}` }] })]);
    input.coverage.after = [{ file: "bad\nfile.ts", reason: `unknown${esc}` }];
    const text = renderReport(input).text;
    expect(text).not.toContain(esc); expect(text).not.toContain("\t");
    expect(text).toContain(String.raw`▪ src/\u001b.ts:4 [import\u0009target] — call\u001b`);
    expect(text).toContain(String.raw`? May\u000awe simplify?`);
    expect(text).toContain(String.raw`decisions\u000aspoof`);
    expect(text).toContain(String.raw`⚠ Gap (target): bad\u000afile.ts — unknown\u001b`);
  });

  it("fits supported budgets and keeps a monotonic, unskipped finding prefix", () => {
    const findings = Array.from({ length: 8 }, (_, i) => finding({ id: `f${i}`, title: `finding-${i}`, exposure: i % 2 ? [] : finding().exposure }));
    const input = report(findings); input.totalFindings = 12;
    input.coverage.after = [{ file: "worker.py", reason: "Unsupported language" }];
    let displayed = 0;
    for (const budget of [...Array.from({ length: 250 }, (_, i) => 256 + i * 7), 2500, 16000]) {
      const result = renderReport(input, budget);
      expect(result.tokens).toBe(Math.ceil(result.text.length / 4)); expect(result.tokens).toBeLessThanOrEqual(budget);
      expect(result.displayed).toBeGreaterThanOrEqual(displayed); displayed = result.displayed;
      expect(result.text.split("\n").filter(line => line.startsWith("Δ ["))).toEqual(findings.slice(0, displayed).map(f => `Δ [complexity; advisory] ${f.title}`));
      expect(result.text).toContain(`${12 - displayed} findings not displayed`);
      expect(result.text).toContain("⚠ Coverage incomplete");
    }
    expect(displayed).toBe(8);
  });

  it("retains policy and coverage counts even when the first finding cannot fit", () => {
    const input = report([finding({ category: "policy", blocking: true, title: "long".repeat(1000) }), finding()]);
    input.coverage.before = [{ file: "old.ts", reason: "No baseline facts" }];
    const result = renderReport(input, 256);
    expect(result.tokens).toBeLessThanOrEqual(256); expect(result.displayed).toBe(0);
    expect(result.text).toContain("1 policy violations"); expect(result.text).toContain("2 findings not displayed");
    expect(result.text).toContain("⚠ Coverage incomplete"); expect(result.text).not.toContain("Δ [complexity");
  });

  it("rejects unsupported budgets without silently clamping them", () => {
    for (const budget of [255, 16001, NaN, Infinity, 256.5]) expect(() => renderReport(report(), budget)).toThrow("maxTokens");
  });
});
