import { describe, expect, it } from "vitest";
import { extractMetrics, MetricsCache } from "../src/core/metrics.js";
import { buildModel } from "../src/core/model.js";
import { digest } from "../src/core/util.js";
import { complex, snapshot } from "./helpers.js";
const extract = (text: string, file = "a.ts") => extractMetrics({ file, text, hash: digest(text) });

describe("syntax metrics", () => {
  it("counts syntax, not branch words in comments, strings, or regexes", () => {
    const value = extract("// if while catch &&\n/** if */\nexport function a(x: string) {\n const s = 'if || while';\n const r = /https?:\\/\\//;\n if (x && s) return r;\n return null;\n}\n");
    expect(value.sloc).toBe(6); expect(value.decisions).toBe(2); expect(value.callables[0]!.cc).toBe(3);
    expect(value.callables[0]!.mass).toBeCloseTo(3 * Math.sqrt(6));
  });
  it("counts nested decisions once at file level and separates callable CC", () => {
    const value = extract("function outer(x: number) {\n function inner() { if(x) return 1; return 0; }\n if(x) return inner();\n return 0;\n}");
    expect(value.decisions).toBe(2); expect(value.callables.map(c => c.cc)).toEqual([2, 2]);
  });
  it("extracts import witnesses and narrow verbosity patterns", () => {
    const value = extract("import { a as b } from './a';\nexport function x(n: number) { try { b(); } catch (e) { throw e; } return n ? true : false; }");
    expect(value.facts.calls[0]!.callee).toBe("a"); expect(value.patterns.map(p => p.rule)).toEqual(["catch-rethrow", "boolean-conditional"]);
    expect(extract("function x(){try { x() } catch(e) { log(e); throw e; }}").patterns).toHaveLength(0);
  });
  it("keeps absolute mass/line counts alongside ratios and unions overlapping lines", async () => {
    const value = await buildModel(snapshot({ "a.ts": complex() }), new MetricsCache());
    expect(value.totals.erosion).toBe(1); expect(value.totals.complexMass).toBe(value.totals.mass);
    const diluted = await buildModel(snapshot({ "a.ts": complex(), "b.ts": "function b(){return 1;}" }), new MetricsCache());
    expect(diluted.totals.erosion).toBeLessThan(1); expect(diluted.totals.complexMass).toBe(value.totals.complexMass);
    const body = "{\n try {\n  if (n > 0) return n + 1;\n  return n ? true : false;\n } catch (e) { throw e; }\n}";
    const clone = await buildModel(snapshot({ "a.ts": `function a(n:number) ${body}\nfunction b(n:number) ${body}` }), new MetricsCache());
    expect(clone.clones).toHaveLength(1); expect(clone.totals.verboseLines).toBeLessThanOrEqual(clone.totals.sloc);
    expect(clone.totals.verboseLines).toBeLessThan(clone.totals.flaggedLines + clone.totals.cloneLines);
  });
  it("detects comment/whitespace-insensitive exact tokens but preserves literal differences", async () => {
    const body = "{\n let out = n + 1;\n out += n + 2;\n if (out > 10) out = 0;\n return out * 2;\n}";
    const same = await buildModel(snapshot({ "a.ts": `function a(n:number) ${body}`, "b.ts": `function b(n:number) ${body.replace("let", "/* explanation */ let")}` }), new MetricsCache());
    expect(same.clones).toHaveLength(1);
    const different = await buildModel(snapshot({ "a.ts": `function a(n:number) ${body}`, "b.ts": `function b(n:number) ${body.replace("10", "11")}` }), new MetricsCache());
    expect(different.clones).toHaveLength(0);
  });
  it("reports parser recovery and generated source as gaps", async () => {
    const model = await buildModel(snapshot({ "broken.ts": "export function ( {", "generated.ts": "// @generated\nconst x = 1;", "types.d.ts": "declare const x: number;" }), new MetricsCache());
    expect(model.files.size).toBe(0); expect(model.omissions.length).toBeGreaterThanOrEqual(3);
  });
  it("parses TSX and handles empty files without division by zero", async () => {
    expect(extract("export const View = () => <div>Hello</div>;", "view.tsx").diagnostics).toEqual([]);
    const empty = await buildModel(snapshot({ "empty.ts": "// nothing\n" }), new MetricsCache());
    expect(empty.totals.erosion).toBe(0); expect(empty.totals.verbosity).toBe(0);
  });
});
