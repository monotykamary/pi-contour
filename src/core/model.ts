import { assembleFactGraph, type SnapshotFacts } from "pi-fovea/substrate";
import { MetricsCache } from "./metrics.js";
import { yieldLoop } from "./util.js";
import { regionOf, type FileAnalysis, type Model, type Snapshot, type Totals } from "./types.js";

export const emptyTotals = (): Totals => ({ sloc: 0, functions: 0, decisions: 0, mass: 0, complexMass: 0, erosion: 0, flaggedLines: 0, cloneLines: 0, verboseLines: 0, verbosity: 0 });

export async function buildModel(snapshot: Snapshot, cache: MetricsCache, signal?: AbortSignal): Promise<Model> {
  const files = new Map<string, FileAnalysis>(), facts = new Map<string, SnapshotFacts>();
  const omissions = [...snapshot.omissions];
  let symbols = 0, sites = 0;
  for (const [file, source] of snapshot.files) {
    signal?.throwIfAborted();
    await yieldLoop();
    if (/.d.[cm]?ts$/i.test(file) || /.min.[cm]?js$/i.test(file) || /(?:@generated|automatically generated|do not edit)/i.test(source.text.slice(0, 512))) {
      omissions.push({ file, reason: "declaration/generated source excluded from metrics" }); continue;
    }
    let analysis: FileAnalysis;
    try { analysis = cache.get(source); }
    catch (error) { omissions.push({ file, reason: `syntax extraction failed: ${String(error)}` }); continue; }
    const nextSymbols = analysis.facts.symbols.length;
    const nextSites = analysis.facts.imports.length + analysis.facts.calls.length;
    if (symbols + nextSymbols > 20_000 || sites + nextSites > 80_000) { omissions.push({ file, reason: "graph symbol/site budget" }); continue; }
    symbols += nextSymbols; sites += nextSites;
    for (const diagnostic of analysis.diagnostics) omissions.push({ file, reason: diagnostic });
    // Parser recovery is not an authoritative measurement. Computed-import gaps alone keep syntax metrics.
    if (analysis.diagnostics.some(d => !d.includes("computed import"))) continue;
    files.set(file, analysis); facts.set(file, analysis.facts);
  }
  signal?.throwIfAborted();
  const graph = await assembleFactGraph(facts);
  const groups = new Map<string, Model["clones"][number]>();
  for (const [file, analysis] of files) for (const callable of analysis.callables) {
    if (callable.tokenCount < 30 || callable.cloneLines.length < 4) continue;
    const group = groups.get(callable.cloneHash) ?? [];
    group.push({ file, callable }); groups.set(callable.cloneHash, group);
  }
  const clones = [...groups.values()].filter(group => group.length > 1);
  const cloneLines = new Map<string, Set<number>>();
  for (const group of clones) for (const { file, callable } of group) {
    const lines = cloneLines.get(file) ?? new Set<number>();
    for (const line of callable.cloneLines) lines.add(line);
    cloneLines.set(file, lines);
  }
  const totals = emptyTotals(), regions: Record<string, Totals> = Object.create(null);
  for (const [file, analysis] of files) {
    const flagged = new Set<number>();
    for (const pattern of analysis.patterns) for (const line of analysis.sourceLines) if (line >= pattern.line && line <= pattern.endLine) flagged.add(line);
    const cloned = cloneLines.get(file) ?? new Set<number>();
    const verbose = new Set([...flagged, ...cloned]);
    const region = regionOf(file), regional = regions[region] ??= emptyTotals();
    for (const out of [totals, regional]) {
      out.sloc += analysis.sloc; out.functions += analysis.callables.length; out.decisions += analysis.decisions;
      out.flaggedLines += flagged.size; out.cloneLines += cloned.size; out.verboseLines += verbose.size;
      for (const callable of analysis.callables) { out.mass += callable.mass; if (callable.cc > 10) out.complexMass += callable.mass; }
    }
  }
  for (const out of [totals, ...Object.values(regions)]) { out.erosion = out.mass ? out.complexMass / out.mass : 0; out.verbosity = out.sloc ? out.verboseLines / out.sloc : 0; }
  return { snapshot, files, graph, totals, regions, clones, omissions };
}
