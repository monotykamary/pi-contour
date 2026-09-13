---
name: pi-contour
description: Evidence-first structural review of a coherent code patch. Use at explicit review or commit checkpoints, not after every edit. Distinguishes witnessed source findings from diffused review exposure.
---

# pi-contour

Call `contour_review({ target: "staged" })` before reviewing a commit candidate, or `contour_review({ target: "working-tree" })` for unfinished/uncommitted work including non-ignored untracked source files.

- Project selection follows successful native/Fabric path access; use `root: "/projects/service"` for explicit or parallel checkpoints. Omitted roots use the most recently selected project, not the launch directory. `/contour review staged --root "/projects/service"` is equivalent.
- Native paths still resolve from Pi's cwd. Root labels identify the actual worktree; `agentOrigin` is metadata, not a mutation-author claim. Aliases unify and linked worktrees stay distinct.
- A 32-root recency ring retires the least recently used project. Branch-local selections survive compaction/reload; old analysis does not. Retirement/re-entry is an observation gap, not an approval. Non-Git targets fail explicitly rather than reviewing another project.
- `CONTOUR_BACKGROUND=0` disables polling, not selection or explicit reviews. `CONTOUR_MAX_ROOTS` can lower the 32-root cap. Discovery never grants project trust or executes arbitrary program text.
- Staged means HEAD versus index, including partially staged content. Never substitute live-worktree checks for staged evidence.
- Read the finding's exact witnesses and coverage gaps before proposing changes.
- Heat ranks modeled exposure, not defect probability. Complexity and duplication can be intentional.
- Keep correctness tests and acceptance criteria in the host workflow. Contour does not certify code or replace tests.
- No automatic rewrite to improve a score, no commit without permission, no agent continuation loop.
- Background discovery is silent. Repeated tool calls during intermediate editing are unnecessary.
- v0.1 measures JS/TS syntax and exact-token callable clones. Unsupported files and unresolved relationships are not clean results.
- `maxTokens` is a bounded 4-characters/token estimate; `maxFindings` controls the candidate count. The CLI `contour review --json` exposes structured report details.
