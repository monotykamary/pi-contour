# Incremental performance

Run `bun run bench`. The corpus contains 120 files / 1,440 callables. It measures cold discovery, a no-change poll, one changed working-tree file, and staging those same bytes. It also starts a separate engine to check persistent-fact reuse.

A local development run measured:

| Path | Elapsed | Reparsed files | Source rereads | Graph models rebuilt |
|---|---:|---:|---:|---:|
| Cold | 256ms | 120 | 120 worktree + 120 Git blobs | 1 |
| No change | 55ms | 0 | 0 | 0 |
| One-file change | 116ms | 1 | 1 | 1 |
| Stage the same bytes | 90ms | 0 | 1 new Git blob | 0 |

An independent engine reused persisted facts with zero parses. Event-loop delay p99 was 13.7ms in this run. These timings exclude loading the TypeScript module and are observations, not CI thresholds or universal guarantees. The benchmark uses Git subprocesses and results depend on OS, storage, and competing work.

The executable acceptance criteria are work counts, not brittle timing assertions: a no-change pass must perform zero parses, source/blob rereads, model rebuilds, and review/heat recomputations. A one-file edit must parse/read only that file. Staging already analyzed bytes must reuse the model. Content and configuration changes must never reuse stale reports.

## Startup is a separate budget

The v0.1.1 interface's complete static bundle graph measured **7,840 bytes**, excluding Pi's supplied TypeBox and loader. Build metadata guards against any static parser, Fovea, or analysis-engine import; a 32KiB ceiling makes regressions explicit.

An isolated package probe with Pi 0.85.1 and Node 26.5.0 measured `session_start` at **0.038–0.041ms**. The full `DefaultResourceLoader.reload()` path, including package/resource discovery and Jiti loading, took **64–127ms**. These are local observations, not a latency guarantee or a measurement of Contour alone versus a baseline Pi startup.

No scan occurs in either the factory or `session_start`. Analysis loads at the first deferred scan or explicit review; first-use loading remains synchronous in-process. `CONTOUR_BACKGROUND=0` disables all automatic discovery. `bun run verify:package` reports fresh measurements and proves that a standalone production install does not pull in a compiler, Fovea, tsx, or another Pi host.

## Patterns transferred from Fovea

- Content-addressed facts with explicit parser/semantic versions.
- Stat manifests as a read-avoidance proof, not an mtime-only guess.
- Bounded batch I/O and shared in-flight directory metadata requests.
- Immutable generation ownership and separate source-model/report identities.
- Byte/entry LRUs; two retained graph generations, small report retention.
- Cooperative event-loop yields during file and finding sweeps.
- Shared Chebyshev recurrence vectors across diffusion scales.
- Quiet, debounced background work with cancellation and a periodic correctness backstop.

Limits are intentionally visible. An oversized or unmodeled region becomes a coverage gap, never an apparently small or clean repository. The parser is synchronous within one bounded file; very large/deep source can still consume a noticeable timeslice. Heavy batch deployments should benchmark representative repositories before increasing limits.
