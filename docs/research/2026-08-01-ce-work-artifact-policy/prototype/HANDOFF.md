# Artifact Policy Module handoff

## Run command

```bash
cd /private/tmp/ica-ce-work-artifact-policy.ZJhlo3 && ./run-demo
```

Observed: exit 0. Four tests passed. Demo completed without network access or warm-fixture writes.

## Observed result

Warm fixture `/private/tmp/ce-work-react-prototype.bHxwD7`:

- Dispatch eligible: yes.
- Ignored inventory: 2,951 entries.
- Regular bytes: 68,359,805.
- Types: 2,938 regular, 13 symlinks.
- Regenerable `node_modules`: 2,946 entries, 68,107,277 bytes, 13 symlinks.
- Precious unknown state: 5 entries, 252,528 bytes.
- Lifecycle owner: Bun.
- Deterministic owner action: `bun install --frozen-lockfile`.
- Git status before and after read-only probe: byte-equal.

The supplied evidence described 68,359,532 bytes. The read-only fixture measured 273 bytes more at execution time. Entry and symlink counts matched. This point-in-time byte drift does not affect the verdict.

Synthetic authoritative verification:

- Precious captured: 3.
- Precious restored: file bytes/mode/mtime, symlink payload, and a precious override inside `node_modules`.
- Precious restoration proven: yes.
- Regenerable changed: `node_modules/changed.js`.
- Regenerable deleted: `node_modules/deleted.js`.
- Regenerable introduced: `node_modules/introduced.js`.
- Bulk restored: false.
- `canonical_ignored_state_preserved`: false.
- Outcome: `VERIFIED_WITH_REGENERABLE_DIVERGENCE`.
- Repair action: Bun owns regeneration via direct argv.

## Files created

- `README.md`
- `ARCHITECTURE.md`
- `HANDOFF.md`
- `artifact_policy.py`
- `demo.py`
- `run-demo`
- `tests/test_artifact_policy.py`

No source-repository, warm-fixture, issue, PR, plugin-cache, or user-config files changed.

## Architecture verdict

Use the Artifact Policy Module boundary.

Keep current Git integration and runner supervision. Route advisory prepare and authoritative integrate/verify-run through one typed artifact Interface. Persist `artifact-policy.receipt.v1` with explicit precious and bulk claims.

Confidence:

- High: classification-before-enforcement fixes the warm Bun dependency seam without weakening unknown-state custody.
- High: precious override precedence and truthful receipt fields belong together in one Module.
- Medium: stat manifests provide useful accidental-divergence disclosure, not byte proof.
- Medium: production recovery requires crash-window integration with the existing manifest owner.
- Low until tested: Windows metadata, external hardlink aliases, opaque directory contents, and concurrent mutation attribution.

## Deletion test against current Modules

Delete the candidate Module and these consequences follow:

- `unit_workspace_state.cmd_init` and `unit_workspace_jobs.cmd_prepare` fall back to `require_ignored_snapshot_capability`.
- A warm dependency tree again trips whole-inventory entry, byte, and symlink blockers.
- `unit_workspace_transaction._snapshot_ignored_artifacts` must regain classification and lifecycle logic or copy every ignored path.
- `cmd_integrate` and `_verify_run_locked` can no longer share one receipt boundary.
- Repair hints regress to “remove or reduce ignored artifacts”.
- `cleaned: true` can again obscure remaining regenerable divergence.

Delete current `unit_workspace_ignored.py` after adopting the Module and only its Git inventory adapter is still needed. Its whole-inventory capability policy has no independent reason to survive. This is a strong deletion result: one deeper Module replaces policy duplicated across four controller phases while leaving Git and runner owners intact.

## Failure modes

- Precious entry exceeds byte or entry limits: refuse before verification.
- Precious hardlink has external topology: refuse; authority cannot restore the external alias.
- Precious opaque directory: refuse; hidden bytes lack custody representation.
- Unsafe parent symlink: refuse before traversal.
- Precious restoration mismatch: block and retain recovery state.
- Introduced unknown precious entry: preserve and block; never auto-delete.
- Regenerable divergence with `disclose`: pass successful verification, disclose state, emit owner action.
- Regenerable divergence with `block`: block commit, disclose that no restoration occurred.
- Owner repair fails: remain divergent; package manager owns diagnosis and materialisation.
- Crash between restore and receipt: production controller needs an idempotent custody/receipt phase record.

## Trade-offs

- Gains warm-checkout availability and avoids dependency byte snapshots.
- Keeps precious unknown state conservative by default.
- Weakens the old blanket restoration claim only for explicitly regenerable roots.
- Makes that weakening visible in policy, receipt, result word, and repair action.
- Leaves package-manager topology outside controller ownership.
- Adds a policy schema and durable receipt migration.
- Requires maintainers to choose `disclose` or `block`; prototype default is `disclose`.

## Next falsification experiment

Wire this Interface into a disposable copy of the current controller, without changing routing or Git integration. Inject crashes and mutations at five points:

1. After authoritative reclassification.
2. During precious capture.
3. After verification, before precious restore.
4. After precious restore, before receipt write.
5. After receipt write, before integration-lock release.

Use Bun root and package-local link farms, pnpm explicit hardlinks, an opaque nested repository, a transport-added `.gitignore` change, and an introduced unknown precious path. Falsify the design if resume cannot produce one idempotent receipt without deleting unowned state or falsely claiming canonical ignored-state preservation.
