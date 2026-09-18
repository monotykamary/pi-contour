# Temporary-storage lifecycle

Contour's runtime temporary writers are syntax-fact persistence and CLI advisory
checkpoint suppression. Both use `src/core/storage.ts`, in the current user's
`tmpdir()/pi-contour-<uid>/` only. They never traverse other user roots. There is
no storage I/O, timer, or analysis import added to extension registration or idle
startup. Tests use a private run directory, removed when their controller exits.

## Retention and regeneration

- Shared best-effort targets: **128MiB, 128 recognized files, 7 days**. Oldest
  eligible files go first under pressure; oversized inactive files also go.
- Facts: `facts-<SHA256 canonical root>.json`, at most **64MiB** per read/write,
  including the envelope. Each contains only entries belonging to that root's
  immutable before/after comparison, not the session-wide memory LRU. Shared
  content may still be reused in memory. Historical revisions outside the
  current comparison are not copied forward. Memory remains 4,000 entries / 48MiB.
- Checkpoints: `checkpoint-<SHA256 canonical root>.txt`, at most **1KiB**. These
  remember the last disclosed report ID for advisory suppression only. Blocking
  policy findings and explicit reviews are never suppressed.
- The currently used root's facts and checkpoint are protected for each sweep.
  Successful disk reads renew retention. Cached/no-change engine reviews also
  request maintenance. Concurrent requests coalesce; read-only requests scan at
  most once per minute per process, while successful writes request another
  pass. There is no periodic cleanup while idle. Operations await their bounded
  lifecycle work; there is no detached task requiring session-shutdown teardown.
- Disk misses, eviction, corruption, incompatible envelopes and failed writes
  only affect reuse. Facts are regenerated from immutable source snapshots. The
  root-scoped envelope format is version 1; old global envelopes are deliberately
  ignored and replaced on the next completed review. Parser/metric semantics
  remain versioned separately in `METRICS_VERSION`.
- Removing a checkpoint may allow the next advisory to print again. It never
  weakens policy enforcement. No source, Git index, or report evidence is deleted.

These are soft retention bounds, not a filesystem quota: current roots, fresh or
live-writer temps, permission failures, and concurrent replacement may prevent
reaching them. Unrecognized or unsafe entries are ignored, not counted as managed
bytes or deleted. Concurrent processes may briefly exceed the targets; subsequent
use converges when safety permits. Removing an in-memory-reused disk cache need
not recreate it until a later cold/changed review.

## Atomic writes and safety

The directory must be a real current-UID directory with no group/other access
(`0700` on creation). Files must be regular, current-UID, single-link, and private
(`0600` on creation). Symlinks, hardlinks, directories, unknown names, different
owners and unsafe modes are refused, never repaired or recursively removed.
Platforms without UID verification fail closed: reviews still work without disk
reuse/suppression. Reads use no-follow handles, descriptor checks and bounded
buffers. Writes use exclusive no-follow temporary creation and atomic rename;
existing targets must also be safe. Each writer finally attempts to remove only
its own temporary inode, including when writing or renaming fails.

New temporary names append `.PID.UUID.tmp` to a recognized facts/checkpoint name.
Abandoned temps are eligible only after **24 hours** since both mtime and ctime,
plus a signal-0 probe proving the PID is gone (`ESRCH`). A live PID, PID reuse,
permission-denied probe, or unknown probe result keeps the temp. Legacy
`.UUID.tmp` files carry no writer PID and get the full **7-day grace** instead.
Fresh temps are never evicted for pressure. Unknown temp naming schemes are left
alone. Failed finally-cleanup is retried only by these conservative rules.

Before unlink, directory identity and file device/inode/owner/mode/link count/
size/mtime/ctime are rechecked. A changed candidate is skipped. This reduces
ordinary concurrent-writer races; portable Node path-based unlink/rename cannot
eliminate the final syscall race against a hostile process with the same UID.
The private directory is not a security boundary against that same user.

## Explicit safe preview

For maintenance tooling, the internal source module exposes:

```ts
import { pruneTemporaryStorage } from "./src/core/storage.js";
const preview = await pruneTemporaryStorage(explicitUidDirectory, {
  keepRoot: canonicalWorktree, // optional: protect this root's facts + checkpoint
});
```

The directory argument is required and its basename must match the current UID.
**Dry-run is the default**: it does not write, touch retention times, or delete.
Pass `{ dryRun: false, keepRoot: canonicalWorktree }` only after reviewing the
preview. No public CLI or extension registration is added. This is an internal
source helper, not an exported package entrypoint.

The result includes recognized `filesBefore`/`bytesBefore`, `candidates` (direct
basenames only), `filesAfter`/`bytesAfter` (projected for a dry-run), actual
`removedFiles`/`removedBytes`, `skipped`, `failed`, and an optional directory
`error`. Unknown/unsafe entries contribute to `skipped`, not the managed totals.
A preview is an observation, not authorization to bypass rechecks later. No
production cleanup is performed merely by importing the helper.
