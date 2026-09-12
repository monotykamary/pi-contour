import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContourEngine } from "./core/engine.js";
import { SilentObserver } from "./core/background.js";
import { renderReport } from "./core/render.js";

export default function contour(pi: ExtensionAPI): void {
  let engine: Promise<ContourEngine> | undefined;
  const getEngine = (): Promise<ContourEngine> => {
    if (!engine) {
      const pending = import("./core/engine.js").then(({ ContourEngine }) => new ContourEngine());
      engine = pending;
      void pending.catch(() => { if (engine === pending) engine = undefined; });
    }
    return engine;
  };
  let observer: SilentObserver | undefined;
  pi.on("session_start", async (_event, ctx) => {
    await observer?.stop();
    engine = undefined;
    observer = new SilentObserver(async signal => {
      signal.throwIfAborted();
      const current = await getEngine();
      signal.throwIfAborted();
      return current.review(ctx.cwd, "working-tree", {}, signal);
    });
    // No parser import, Git process, scan, or awaited analysis on Pi startup.
    // Discovery begins on the first poll or post-start tool activity.
    if (process.env.CONTOUR_BACKGROUND !== "0") observer.start(false);
  });
  pi.on("session_shutdown", async () => { await observer?.stop(); observer = undefined; engine = undefined; });
  pi.on("tool_result", event => { if (event.toolName !== "contour_review") observer?.wake(); });

  pi.registerTool({
    name: "contour_review", label: "Contour review",
    description: "Review HEAD against the staged patch (default) or working tree, including non-ignored untracked sources. Returns bounded structural-change evidence and multiscale exposure, not a quality score or correctness approval. Read-only; no edits or commits. JS/TS metrics in v0.1; coverage gaps are explicit. Budget estimate: 4 characters per token.",
    promptSnippet: "Evidence-first structural review of a coherent patch",
    parameters: Type.Object({
      target: Type.Optional(Type.String({ enum: ["staged", "working-tree"], description: "staged compares HEAD to the index, never live worktree content" })),
      maxTokens: Type.Optional(Type.Integer({ minimum: 256, maximum: 16000 })),
      maxFindings: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const target = params.target ?? "staged";
      if (target !== "staged" && target !== "working-tree") throw new Error("Unknown review target");
      const options = { ...(params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens }), ...(params.maxFindings === undefined ? {} : { maxFindings: params.maxFindings }) };
      const report = await (await getEngine()).review(ctx.cwd, target, options, signal);
      const rendered = renderReport(report, params.maxTokens);
      return { content: [{ type: "text", text: rendered.text }], details: {
        schemaVersion: report.schemaVersion, id: report.id, root: report.root, target: report.target, baseline: report.baseline,
        snapshot: report.snapshot, configHash: report.configHash, before: report.before, after: report.after,
        totalFindings: report.totalFindings, displayed: rendered.displayed, tokens: rendered.tokens,
        coverage: { beforeCount: report.coverage.before.length, afterCount: report.coverage.after.length,
          examples: report.coverage.after.slice(0, 8), notes: report.coverage.notes },
        findings: report.findings.slice(0, rendered.displayed),
      } };
    },
  });
  pi.registerCommand("contour", {
    description: "Review structural changes: /contour review [staged|working-tree]",
    async handler(args, ctx) {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts[0] !== "review" || parts.length > 2 || (parts[1] && !["staged", "working-tree"].includes(parts[1]))) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /contour review [staged|working-tree]", "info");
        return;
      }
      const report = await (await getEngine()).review(ctx.cwd, parts[1] === "working-tree" ? "working-tree" : "staged");
      pi.sendMessage({ customType: "contour-review", content: renderReport(report).text, display: true }, { triggerTurn: false });
    },
  });
}
