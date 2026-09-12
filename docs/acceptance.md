# Acceptance ledger

This ledger defines v0.1; tests and direct probes are the evidence, not this checklist alone.

- Snapshot correctness: HEAD/index/worktree differ; partial staging, initial commits, deletions, renames, unusual paths, symlinks, conflicts, cancellation, and concurrent snapshot changes are handled explicitly. Reviewing never modifies repository content or index.
- Measurable evidence: JS/TS syntax-tree SLOC, decision counts, CC mass/erosion, explicit verbosity rules, exact-token callable clones. Absolute totals and ratios; unsupported and failed extraction visible.
- Shared physics: versioned Fovea facts/heat API; no duplicate graph engine. Multi-scale conserved mass, isolated nodes, boundary leakage, deterministic ranking, typed relationship witnesses. Separate category units; no quality score.
- Structural deltas: new clones, increasing complex callables, new import cycles, new cross-region imports. Baseline findings do not become new regressions merely by moving lines. Region totals reveal decision redistribution.
- Incremental engine: content-addressed bounded facts cache, snapshot/config-bound report identity, quiet debounced background refresh independent of edit tool path, shutdown and obsolete-result cancellation.
- Interfaces: contour_review tool, /contour review command, CLI JSON/text reviews, explicitly installed non-destructive Git hook. Staged is default; working-tree explicit. Bounded output and actionable questions.
- Policy: advisory default, optional explicit forbidden-import boundaries only; no score gating. Coverage failure never appears as a clean pass. Repeated automatic advisory for identical snapshot suppressed; explicit reviews reproducible.
- Delivery: documented scope and physics, runnable tests, clean typecheck/dead-code gate, bundled CLI and extension load probes. No GitHub writes, installation in user settings, or commits without request.

## Verification evidence

- `tests/snapshot.test.ts`: immutable Git/index/worktree comparisons, partial staging, unchanged dependency blobs, unborn HEAD, deletions/renames, unusual names, symlinks, untracked exclusions, caps, stat/blob reuse, alternate indexes, conflicts, and cancellation.
- `tests/metrics.test.ts`: syntax (not regex) decisions, nested callable accounting, exact token clones, union-of-lines verbosity, absolute erosion mass, parser/generated omissions, TSX and empty input.
- `tests/engine.test.ts`: witnessed structural deltas, conserved multiscale exposure, regional redistribution, comment/anonymous identity stability, warm and single-file cache paths, persisted facts, configuration/baseline identities, incomplete baselines, accurate clone counts, budgets, concurrent analysis drift, and report immutability.
- `tests/background.test.ts`: no factory timers, debouncing, single in-flight scan, obsolete-work cancellation, non-preempting polls, shutdown cleanup, and bounded LRU retention.
- `tests/interfaces.test.ts`: exact public registrations, read-only staged tool execution, explicit non-steering command output, CLI advisory/policy exits, checkpoint suppression, hook opt-in/ownership/checksum protection, symlinks, and custom hooksPath.
- `scripts/smoke.ts`: copied bundles without node_modules, executable symlink, immutable staged review, an actual advisory Git commit, a blocked explicit-policy commit, and built extension registrations. All writes/commits occur in disposable fixtures.
- `tests/startup.test.ts`: no analysis import during startup, deferred scans, opt-out, tool-result coalescing, no self-triggering review loop, and reload/shutdown cleanup.
- `scripts/verify-package.ts`: actual Pi resource loader and lazy review from isolated production-only npm/Git layouts, with no compiler/substrate runtime install.
- `scripts/bench.ts`: executable work-count assertions and measured timing; see performance.md. Zero-change passes do not read/parse source, rebuild models, or recompute reviews/heat. Staging analyzed bytes reuses the model.
- Companion `pi-fovea/tests/substrate.test.ts`: versioned snapshot-only graph assembly, invalid-input rejection, multi-scale agreement and conserved/isolated mass. The Fovea suite also checks the underlying heat solver against its independent scaled-Taylor reference.

The release verification ran 41 Contour tests and 237 Fovea tests, plus both typecheck/dead-code gates and the standalone smoke probe. The release is intentionally JS/TS-scoped; branch-base review, semantic near-clones, cross-language metrics, co-change scoring, and stronger physics-response hypotheses remain future work, not implied capabilities.
