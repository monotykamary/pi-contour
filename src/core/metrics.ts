import ts from "typescript";
import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { digest, Lru } from "./util.js";
import type { Callable, FileAnalysis, Pattern, SourceFile } from "./types.js";

// Change with parser conventions, callable identity, clone normalization, or rules.
export const METRICS_VERSION = `ts-ast-v2:${ts.version}`;
const isCallable = (node: ts.Node): node is ts.FunctionLikeDeclaration => ts.isFunctionLike(node) && "body" in node && !!node.body;
const isDecision = (node: ts.Node): boolean => ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node)
  || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isConditionalExpression(node)
  || ts.isCatchClause(node) || ts.isCaseClause(node) || (ts.isBinaryExpression(node)
    && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));

/** AST leaves preserve regex/template/string contents; comments and whitespace are not clone tokens. */
function leaves(node: ts.Node, source: ts.SourceFile): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  const visit = (current: ts.Node): void => {
    if (current.kind >= ts.SyntaxKind.FirstJSDocNode && current.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = current.getChildren(source);
    if (children.length) { children.forEach(visit); return; }
    if (current.kind !== ts.SyntaxKind.EndOfFileToken && current.end > current.getStart(source)) {
      out.push({ start: current.getStart(source), end: current.end, text: `${current.kind}:${current.getText(source)}` });
    }
  };
  visit(node); return out;
}

export function extractMetrics(input: SourceFile): FileAnalysis {
  const kind = /\.tsx$/i.test(input.file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(input.file) ? ts.ScriptKind.JSX
    : /\.[cm]?js$/i.test(input.file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(input.file, input.text, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = ((source as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? []).map(d =>
    `line ${source.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const line = (position: number): number => source.getLineAndCharacterOfPosition(position).line + 1;
  const tokens = leaves(source, source);
  // Binary-search token windows instead of rescanning the entire file per callable.
  const tokenRange = (start: number, end: number): typeof tokens => {
    let lo = 0, hi = tokens.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (tokens[mid]!.start < start) lo = mid + 1; else hi = mid; }
    const out: typeof tokens = [];
    for (let i = lo; i < tokens.length && tokens[i]!.end <= end; i++) out.push(tokens[i]!);
    return out;
  };
  const sourceLines = new Set<number>();
  for (const token of tokens) for (let i = line(token.start); i <= line(Math.max(token.start, token.end - 1)); i++) sourceLines.add(i);
  const facts: FileAnalysis["facts"] = { sha1: input.hash, symbols: [], imports: [], calls: [], literals: [], anchors: [] };
  const callables: Callable[] = [], patterns: Pattern[] = [];
  const nameCounts = new Map<string, number>();
  const imports = new Map<string, string>();
  let decisions = 0;
  const pattern = (node: ts.Node, rule: string, question: string): void => {
    patterns.push({ rule, line: line(node.getStart(source)), endLine: line(node.end - 1), question });
  };
  const visit = (node: ts.Node): void => {
    if (isDecision(node)) decisions++;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      facts.imports.push({ file: input.file, line: line(node.getStart(source)), spec: node.moduleSpecifier.text });
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imports.set(element.name.text, element.propertyName?.text ?? element.name.text);
      }
    }
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
        facts.imports.push({ file: input.file, line: line(node.getStart(source)), spec: (node.arguments[0] as ts.StringLiteral).text });
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        diagnostics.push(`line ${line(node.getStart(source))}: computed import target not modeled`);
      } else {
        const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : undefined;
        if (name) facts.calls.push({ file: input.file, line: line(node.getStart(source)), callee: imports.get(name) ?? name });
      }
    }
    if (isCallable(node)) {
      const body = node.body!;
      const parent = node.parent;
      let name = node.name?.getText(source) ?? (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ? parent.name.getText(source) : "callback");
      if ((ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
        && (ts.isClassDeclaration(parent) || ts.isClassExpression(parent))) name = `${parent.name?.text ?? "anonymous"}.${ts.isConstructorDeclaration(node) ? "constructor" : name}`;
      const ordinal = nameCounts.get(name) ?? 0; nameCounts.set(name, ordinal + 1);
      const id = ordinal ? `${name}#${ordinal + 1}` : name;
      let ownDecisions = 0;
      const count = (child: ts.Node): void => { if (child !== body && isCallable(child)) return; if (isDecision(child)) ownDecisions++; ts.forEachChild(child, count); };
      count(body);
      const start = node.getStart(source), end = node.end;
      const ownedLines = new Set<number>();
      // Count lines with syntax in this callable; nested callable source remains physical source.
      for (const token of tokenRange(start, end)) {
        for (let i = line(token.start); i <= line(Math.max(token.start, token.end - 1)); i++) ownedLines.add(i);
      }
      const bodyTokens = tokenRange(body.getStart(source), body.end);
      const cloneLines = new Set<number>();
      for (const token of bodyTokens) for (let i = line(token.start); i <= line(Math.max(token.start, token.end - 1)); i++) cloneLines.add(i);
      const sloc = ownedLines.size, cc = ownDecisions + 1;
      callables.push({ id, name, line: line(start), endLine: line(end - 1), sloc, decisions: ownDecisions, cc, mass: cc * Math.sqrt(sloc), cloneHash: digest(JSON.stringify(bodyTokens.map(t => t.text))), cloneLines: [...cloneLines], tokenCount: bodyTokens.length });
      facts.symbols.push({ file: input.file, name: id, kind: ts.isMethodDeclaration(node) ? "method" : "function", line: line(start), sig: input.text.slice(start, body.getStart(source)).replace(/\s+/g, " ").slice(0, 180), lang: kind === ts.ScriptKind.JS || kind === ts.ScriptKind.JSX ? "JavaScript" : "TypeScript" });
    }
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)
      && node.block.statements.length === 1 && ts.isThrowStatement(node.block.statements[0]!)) {
      const expression = (node.block.statements[0] as ts.ThrowStatement).expression;
      if (ts.isIdentifier(expression) && expression.text === node.variableDeclaration.name.text) pattern(node, "catch-rethrow", "Does this catch add behavior, or can the original exception propagate directly?");
    }
    if (ts.isConditionalExpression(node) && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.whenTrue.kind)
      && [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.whenFalse.kind) && node.whenTrue.kind !== node.whenFalse.kind) {
      pattern(node, "boolean-conditional", "Would an explicit Boolean conversion or negation express the same result more directly?");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // File-level decisions include top-level and nested code once, unlike sum(CC), which grows on extraction.
  return { facts, callables, sloc: sourceLines.size, sourceLines: [...sourceLines].sort((a, b) => a - b), patterns, diagnostics, decisions };
}

export class MetricsCache {
  private cache = new Lru<FileAnalysis>(4000, 48 * 1024 * 1024);
  readonly stats = { parses: 0, hits: 0, diskHits: 0 };
  private loaded = new Lru<boolean>(2);
  private saved = new Lru<number>(2);
  private cachePath(root: string): string { return join(tmpdir(), `pi-contour-${process.getuid?.() ?? "user"}`, `facts-${digest(root)}.json`); }
  async hydrate(root: string): Promise<void> {
    if (this.loaded.get(root)) return;
    this.loaded.set(root, true);
    try {
      if ((await stat(this.cachePath(root))).size > 64 * 1024 * 1024) return;
      const text = await readFile(this.cachePath(root), "utf8");
      if (text.length > 64 * 1024 * 1024) return;
      const stored = JSON.parse(text) as { version: string; checksum: string; entries: Array<[string, FileAnalysis]> };
      if (stored.version !== METRICS_VERSION || !Array.isArray(stored.entries) || stored.entries.length > 4000
        || digest(JSON.stringify(stored.entries)) !== stored.checksum) return;
      for (const [key, value] of stored.entries) {
        if (!key.startsWith(METRICS_VERSION + "\0") || !value.facts || !Array.isArray(value.callables) || !Array.isArray(value.sourceLines) || !Array.isArray(value.diagnostics)) continue;
        this.cache.set(key, value, Buffer.byteLength(JSON.stringify(value))); this.stats.diskHits++;
      }
    } catch { /* Cache misses/corruption affect speed, never the analysis outcome. */ }
  }
  async persist(root: string): Promise<void> {
    if (!this.stats.parses || this.saved.get(root) === this.stats.parses) return;
    try {
      const entries = this.cache.snapshot();
      const data = JSON.stringify({ version: METRICS_VERSION, checksum: digest(JSON.stringify(entries)), entries });
      const path = this.cachePath(root), temp = `${path}.${randomUUID()}.tmp`;
      await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
      await writeFile(temp, data, { mode: 0o600 }); await rename(temp, path);
      this.saved.set(root, this.stats.parses);
    } catch { /* An unwritable cache never invalidates completed evidence. */ }
  }
  get(source: SourceFile): FileAnalysis {
    const key = `${METRICS_VERSION}\0${source.file}\0${source.hash}`;
    const cached = this.cache.get(key);
    if (cached) { this.stats.hits++; return cached; }
    const value = extractMetrics(source);
    this.cache.set(key, value, Buffer.byteLength(JSON.stringify(value))); this.stats.parses++;
    return value;
  }
}
