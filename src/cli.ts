#!/usr/bin/env node
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ContourEngine } from "./core/engine.js";
import { renderReport } from "./core/render.js";
import { installHook, uninstallHook } from "./core/hook.js";
import { optionsFor } from "./core/review.js";
import { digest } from "./core/util.js";
import type { BoundaryPolicy, Target } from "./core/types.js";

// The distribution build bakes the manifest version in; a source checkout reads the manifest itself.
declare const __CONTOUR_VERSION__: string | undefined;
async function packageVersion(): Promise<string> {
  if (typeof __CONTOUR_VERSION__ === "string") return __CONTOUR_VERSION__;
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version) throw new Error("package.json does not declare a version");
  return manifest.version;
}

const USAGE = `contour review [--staged|--working-tree] [--json] [--root DIR]
               [--max-tokens N] [--max-findings N] [--policy FILE] [--checkpoint]
contour hook install [--root DIR] [--policy FILE]
contour hook uninstall [--root DIR]
contour --version

Reviews compare HEAD with an immutable target snapshot. No source or index writes.
Exit 0: advisory; 2: explicit boundary policy violations; 1: analysis/usage failure.
Hooks are opt-in, never overwrite existing hooks, and do not intercept shell commands.
`;

export async function main(argv: string[], io = { out: (text: string) => process.stdout.write(text), error: (text: string) => process.stderr.write(text) }): Promise<number> {
  if (!argv.length || argv.includes("--help") || argv[0] === "help") { io.out(USAGE); return 0; }
  try {
    if (argv.includes("--version")) { io.out(`contour ${await packageVersion()}\n`); return 0; }
    const args = [...argv], command = args.shift();
    const action = command === "hook" ? args.shift() : undefined;
    let root = process.cwd(), target: Target = "staged", explicitTarget = false, json = false, checkpoint = false, policyFile: string | undefined;
    let maxTokens = 2500, maxFindings = 8;
    while (args.length) {
      const arg = args.shift();
      if (arg === "--json") json = true;
      else if (arg === "--checkpoint") checkpoint = true;
      else if (arg === "--staged" || arg === "--working-tree") {
        if (explicitTarget) throw new Error("Choose exactly one target");
        explicitTarget = true; target = arg === "--staged" ? "staged" : "working-tree";
      } else if (["--root", "--policy", "--max-tokens", "--max-findings"].includes(arg ?? "")) {
        const value = args.shift(); if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
        if (arg === "--root") root = resolve(value);
        else if (arg === "--policy") policyFile = value;
        else if (arg === "--max-tokens") maxTokens = Number(value);
        else maxFindings = Number(value);
      } else throw new Error(`Unknown argument: ${arg}`);
    }
    const policy = policyFile ? resolve(root, policyFile) : undefined;
    let boundaries: BoundaryPolicy[] = [];
    if (policy) {
      const text = await readFile(policy, "utf8");
      if (text.length > 65536) throw new Error("Policy file exceeds 64KiB");
      const data = JSON.parse(text) as { boundaries?: BoundaryPolicy[] };
      if (!data || !Array.isArray(data.boundaries) || Object.keys(data).some(key => key !== "boundaries")) throw new Error("Policy must contain only a boundaries array");
      boundaries = data.boundaries;
    }
    const options = optionsFor({ maxTokens, maxFindings, boundaries });
    if (command === "hook") {
      if (json || checkpoint || explicitTarget) throw new Error("Review flags do not apply to hook management");
      if (action === "install") io.out(await installHook(root, fileURLToPath(import.meta.url), policy) + "\n");
      else if (action === "uninstall") io.out(await uninstallHook(root) + "\n");
      else throw new Error("Use hook install or hook uninstall");
      return 0;
    }
    if (command !== "review") throw new Error(`Unknown command: ${command}`);
    if (checkpoint && target !== "staged") throw new Error("Commit checkpoints require the staged target");
    const controller = new AbortController();
    const cancel = (): void => controller.abort(new Error("Review cancelled"));
    process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
    try {
      const report = await new ContourEngine().review(root, target, options, controller.signal);
      let disclose = true;
      if (checkpoint && !json) {
        disclose = report.totalFindings > 0 || report.coverage.before.length > 0 || report.coverage.after.length > 0;
        const path = join(tmpdir(), `pi-contour-${process.getuid?.() ?? "user"}`, `checkpoint-${digest(report.root)}.txt`);
        // Suppression affects automatic advisory display only, never enforcement or explicit review.
        try { if (!report.blockingFindings && (await readFile(path, "utf8")) === report.id) disclose = false; } catch {}
        if (disclose) { try { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, report.id, { mode: 0o600 }); } catch {} }
      }
      if (disclose) io.out(json ? JSON.stringify(report, null, 2) + "\n" : renderReport(report, maxTokens).text + "\n");
      return report.blockingFindings ? 2 : 0;
    } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
  } catch (error) { io.error(`Contour: ${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => "") === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
