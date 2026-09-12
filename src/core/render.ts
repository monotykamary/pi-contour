import type { Finding, ReviewReport } from "./types.js";

const clean = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n}`;
const renderFinding = (finding: Finding): string => {
  const evidence = finding.evidence.map(e => `  ▪ ${clean(e.file)}:${e.line}${e.relation ? ` [${clean(e.relation)}]` : ""}${e.witness ? ` — ${clean(e.witness).slice(0, 180)}` : ""}`).join("\n");
  const exposure = finding.exposure?.map(e => `t=${e.time}: ${(100 * e.outsideRegion).toFixed(1)}% outside source region`).join("; ");
  return `Δ [${finding.category}${finding.blocking ? "; explicit policy" : "; advisory"}] ${clean(finding.title)}\n${evidence}\n  ${finding.before} → ${finding.after} ${clean(finding.unit)}`
    + (exposure ? `\n  ↗ Exposure (modeled): ${exposure}` : "")
    + `\n  ? ${clean(finding.question)}`;
};

/** A monotonic candidate-prefix fit. 4 chars/token is an estimate, not a tokenizer guarantee. */
export function renderReport(report: ReviewReport, maxTokens = 2500): { text: string; tokens: number; displayed: number } {
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16000) throw new Error("maxTokens must be 256..16000");
  const gaps = report.coverage.before.length + report.coverage.after.length;
  const header = `Contour · ${report.target} · ${report.baseline.slice(0, 12)} → ${report.snapshot.slice(0, 12)}\n`
    + `${report.changed.length} changed source files · ${report.totalFindings} findings · ${report.blockingFindings} policy violations · ${gaps} file/extraction gaps\n`
    + `Δ SLOC ${signed(report.after.sloc - report.before.sloc)}; decisions ${signed(report.after.decisions - report.before.decisions)}; `
    + `erosion ${report.before.erosion.toFixed(3)} → ${report.after.erosion.toFixed(3)}; verbosity ${report.before.verbosity.toFixed(3)} → ${report.after.verbosity.toFixed(3)}\n`
    + `Δ Verbose lines ${report.before.verboseLines} → ${report.after.verboseLines}; complex mass ${report.before.complexMass.toFixed(1)} → ${report.after.complexMass.toFixed(1)}\n`;
  const details = report.findings.map(renderFinding);
  const footer = (n: number): string => `\n${report.totalFindings - n} findings not displayed (CLI --json for details).\n`
    + (gaps ? "⚠ Coverage incomplete; absence of findings is not approval.\n" : "")
    + "No quality score or correctness guarantee. Graph resolution is partial. Heat means exposure, not defect probability.";
  let text = header + footer(0), displayed = 0;
  for (let i = 1; i <= details.length; i++) {
    const candidate = header + "\n" + details.slice(0, i).join("\n\n") + footer(i);
    if (Math.ceil(candidate.length / 4) > maxTokens) break;
    text = candidate; displayed = i;
  }
  // Coverage witnesses from either snapshot precede optional regional summaries.
  const extras = [...report.coverage.before.slice(0, 3).map(gap => `⚠ Gap (baseline): ${clean(gap.file)} — ${clean(gap.reason).slice(0, 200)}`),
    ...report.coverage.after.slice(0, 3).map(gap => `⚠ Gap (target): ${clean(gap.file)} — ${clean(gap.reason).slice(0, 200)}`),
    ...report.regions.slice(0, 5).map(r => `Δ Region ${clean(r.region)}: decisions ${r.before.decisions} → ${r.after.decisions}; functions ${r.before.functions} → ${r.after.functions}`)];
  for (const extra of extras) { if (Math.ceil((text.length + extra.length + 1) / 4) > maxTokens) break; text += `\n${extra}`; }
  return { text, tokens: Math.ceil(text.length / 4), displayed };
}
