import type { SnapshotFacts, Graph } from "pi-fovea/substrate";

export type Target = "staged" | "working-tree";
export interface Omission { file: string; reason: string }
export interface SourceFile { file: string; hash: string; text: string }
export interface Snapshot {
  id: string;
  revision: string;
  files: ReadonlyMap<string, SourceFile>;
  omissions: Omission[];
  listed: number;
}
export interface Comparison {
  root: string;
  target: Target;
  before: Snapshot;
  after: Snapshot;
  changed: string[];
}
export interface Callable {
  id: string;
  name: string;
  line: number;
  endLine: number;
  sloc: number;
  decisions: number;
  cc: number;
  mass: number;
  cloneHash: string;
  cloneLines: number[];
  tokenCount: number;
}
export interface Pattern { rule: string; line: number; endLine: number; question: string }
export interface FileAnalysis {
  facts: SnapshotFacts;
  callables: Callable[];
  sloc: number;
  decisions: number;
  sourceLines: number[];
  patterns: Pattern[];
  diagnostics: string[];
}
export interface Totals {
  sloc: number;
  functions: number;
  decisions: number;
  mass: number;
  complexMass: number;
  erosion: number;
  flaggedLines: number;
  cloneLines: number;
  verboseLines: number;
  verbosity: number;
}
export interface Model {
  snapshot: Snapshot;
  files: ReadonlyMap<string, FileAnalysis>;
  graph: Graph;
  totals: Totals;
  regions: Record<string, Totals>;
  clones: Array<Array<{ file: string; callable: Callable }>>;
  omissions: Omission[];
}
export interface Evidence { file: string; line: number; endLine?: number; relation?: string; witness?: string }
type Category = "complexity" | "duplication" | "verbosity" | "coupling" | "cycle" | "policy";
export interface Finding {
  id: string;
  category: Category;
  title: string;
  evidence: Evidence[];
  before: number;
  after: number;
  unit: string;
  question: string;
  blocking: boolean;
  exposure?: Array<{ time: number; sourceMass: number; conservedMass: number; outsideRegion: number; neighbors: Array<{ file: string; mass: number }> }>;
}
export interface BoundaryPolicy { from: string; to: string; reason: string }
export interface AnalysisOptions {
  scales: number[];
  maxFindings: number;
  maxTokens: number;
  boundaries: BoundaryPolicy[];
}
export interface ReviewReport {
  schemaVersion: 1;
  id: string;
  root: string;
  target: Target;
  baseline: string;
  snapshot: string;
  changed: string[];
  before: Totals;
  after: Totals;
  regions: Array<{ region: string; before: Totals; after: Totals }>;
  findings: Finding[];
  totalFindings: number;
  blockingFindings: number;
  coverage: { before: Omission[]; after: Omission[]; notes: string[] };
  configHash: string;
}
export const regionOf = (file: string): string => file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "(root)";
