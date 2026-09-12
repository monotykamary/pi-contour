# pi-contour

Evidence-first structural review, not a universal quality score.

## Verification

Run `bun run check` (typecheck, tests, dead-code gate), then `bun run build`, `bun run smoke`, and `bun run verify:package` when entrypoints/packaging change. No build alone counts as completion. Commit regenerated `dist/` alongside source: production-only Git installs require it. `bun run cover` regenerates the standalone SVG.

## Invariants

- Commit reviews use HEAD versus the Git index, never live worktree bytes.
- Immutable, content-addressed snapshots own findings and heat fields.
- Incremental background discovery is silent; only checkpoints disclose findings.
- Heat is conserved exposure, not defect probability. Categories retain separate units.
- Reuse `pi-fovea/substrate`; do not fork graph resolution or numerical solvers.
- Unsupported, capped, unreadable, and unresolved inputs are visible coverage gaps.
- Advisory by default; no automatic edits, commits, hook installation, or agent continuation.
- Version extraction semantics and cache keys together.
- Heavy analysis dependencies are registry-pinned dev dependencies bundled into distribution artifacts. Never ship a sibling path. Pi supplies typebox.
- Startup must not import the analysis engine or perform Git I/O. Keep the full static bundle graph small; honor `CONTOUR_BACKGROUND=0`.
- Conventional commits. Plain comments, no decorative separators.
