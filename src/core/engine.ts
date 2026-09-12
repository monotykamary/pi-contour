import { SnapshotReader } from "./snapshot.js";
import { MetricsCache } from "./metrics.js";
import { buildModel } from "./model.js";
import { configId, optionsFor, reviewModels } from "./review.js";
import { digest, Lru } from "./util.js";
import type { AnalysisOptions, Model, ReviewReport, Target } from "./types.js";

/** Session-scoped engine. Completed immutable generations are reusable; partial results are not. */
export class ContourEngine {
  readonly reader = new SnapshotReader();
  readonly metrics = new MetricsCache();
  readonly stats = { models: 0, reviews: 0, reportHits: 0 };
  private models = new Lru<Model>(2);
  private reports = new Lru<ReviewReport>(8);
  private tail: Promise<unknown> = Promise.resolve();

  async review(root: string, target: Target = "staged", input: Partial<AnalysisOptions> = {}, signal?: AbortSignal): Promise<ReviewReport> {
    const options = optionsFor(input);
    const task = this.tail.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      const comparison = await this.reader.capture(root, target, signal);
      const key = `${comparison.root}\0${target}\0${comparison.before.revision}\0${comparison.before.id}\0${comparison.after.id}\0${configId(options)}`;
      const hit = this.reports.get(key);
      if (hit) { this.stats.reportHits++; return structuredClone(hit); }
      await this.metrics.hydrate(comparison.root);
      const models: Model[] = [];
      for (const snapshot of [comparison.before, comparison.after]) {
        // Graph identity depends on extraction content, not staging metadata. Identical
        // worktree/index bytes share a model, while the report still pins the exact target.
        const modelKey = digest(JSON.stringify({ files: [...snapshot.files].map(([file, source]) => [file, source.hash]).sort(), omissions: snapshot.omissions }));
        let model = this.models.get(modelKey);
        if (!model) { model = await buildModel(snapshot, this.metrics, signal); signal?.throwIfAborted(); this.models.set(modelKey, model); this.stats.models++; }
        models.push({ ...model, snapshot });
      }
      const report = await reviewModels(comparison, models[0]!, models[1]!, options, signal);
      signal?.throwIfAborted();
      await this.metrics.persist(comparison.root);
      signal?.throwIfAborted();
      // Analysis can take time. A checkpoint must not describe an index that moved meanwhile.
      const verified = await this.reader.capture(root, target, signal);
      if (verified.before.id !== comparison.before.id || verified.after.id !== comparison.after.id) throw new Error("Repository changed during analysis; retry review");
      this.reports.set(key, report); this.stats.reviews++;
      return structuredClone(report);
    });
    this.tail = task; return task;
  }
}
