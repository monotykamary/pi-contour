import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { ContourEngine } from "../src/core/engine.js";
import { run } from "../src/core/util.js";

const root = await mkdtemp(join(tmpdir(), "contour-bench-"));
const git = (args: string[]) => run("git", args, root);
const source = (file: number) => Array.from({ length: 12 }, (_, i) => `export function f${file}_${i}(x:number) {\n  if (x < ${i + file}) return x + ${i};\n  return x * ${file + i + 1};\n}`).join("\n");
const delay = monitorEventLoopDelay({ resolution: 10 });
try {
  await git(["init", "-b", "main"]); await git(["config", "user.name", "Contour benchmark"]); await git(["config", "user.email", "benchmark@example.invalid"]);
  await git(["config", "core.hooksPath", ".git/hooks"]); await git(["config", "commit.gpgSign", "false"]);
  await mkdir(join(root, "src"));
  for (let i = 0; i < 120; i++) await writeFile(join(root, `src/f${i}.ts`), source(i));
  await git(["add", "."]); await git(["commit", "-m", "test(benchmark): initialize corpus"]);
  const engine = new ContourEngine();
  const capture = () => ({ parses: engine.metrics.stats.parses, workReads: engine.reader.stats.workReads, blobReads: engine.reader.stats.blobReads, models: engine.stats.models, reviews: engine.stats.reviews });
  const delta = (a: ReturnType<typeof capture>, b: ReturnType<typeof capture>) => Object.fromEntries(Object.keys(a).map(key => [key, b[key as keyof typeof b] - a[key as keyof typeof a]]));
  const timed = async (target: "staged" | "working-tree") => { const start = performance.now(); await engine.review(root, target); return Math.round(performance.now() - start); };
  delay.enable();
  const coldMs = await timed("working-tree"), initial = capture();
  const warmMs = await timed("working-tree"), warm = capture();
  await writeFile(join(root, "src/f0.ts"), source(0) + "\nexport const changed = 1;\n");
  const incrementalMs = await timed("working-tree"), edited = capture();
  await git(["add", "src/f0.ts"]);
  const stagedMs = await timed("staged"), staged = capture();
  assert.equal(warm.parses, initial.parses); assert.equal(warm.workReads, initial.workReads); assert.equal(warm.models, initial.models); assert.equal(warm.reviews, initial.reviews);
  assert.equal(edited.parses - warm.parses, 1); assert.equal(edited.workReads - warm.workReads, 1); assert.equal(staged.models, edited.models);
  const independent = new ContourEngine(); await independent.review(root, "staged"); assert.equal(independent.metrics.stats.parses, 0);
  delay.disable();
  console.log(JSON.stringify({ files: 120, functions: 1440, coldMs, warmMs, incrementalMs, stagedMs, cold: initial, warmDelta: delta(initial, warm), incrementalDelta: delta(warm, edited), stagingDelta: delta(edited, staged), independentProcessParses: independent.metrics.stats.parses, eventLoopP99Ms: +(delay.percentile(99) / 1e6).toFixed(1) }, null, 2));
} finally { delay.disable(); await rm(root, { recursive: true, force: true }); }
