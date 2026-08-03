# Artifact Policy Module architecture

## Verdict

Adopt the Module boundary. Keep the existing Git transaction engine. Replace its undifferentiated ignored snapshot helper with one typed Interface spanning prepare, integrate, verify-run, restoration, receipts, and repair hints.

Confidence: high for the policy boundary and common Bun/npm dependency shapes; medium for production hardlink, opaque-directory, race, and cross-platform restoration semantics.

## Thesis

Ignored is a Git visibility fact, not a lifecycle type.

The controller currently treats every ignored entry as if it shares one owner, cost model, representation, and restoration promise. That collapses user databases, local configuration, package-manager dependency trees, build output, symlinks, and opaque directories into one bounded byte snapshot.

Introduce one Artifact Policy Module:

```text
Git ignored inventory
        |
        v
Artifact Policy Module
  classify first
  precious override > regenerable rule > unknown precious
        |
        +--> PreciousCustody Interface
        |      exact-by-contract bytes/type/mode/link restoration
        |
        +--> RegenerableLifecycle Interface
               stat divergence evidence
               explicit owner
               deterministic repair action
        |
        v
ArtifactReceipt Interface
  truth for controller state, user disclosure, and recovery
```

## ICA map

| ICA term | Candidate |
|---|---|
| Module | `ArtifactPolicyModule` owns classification, custody eligibility, lifecycle delegation, receipts, and repair actions. |
| Interface | `inspect(phase)` returns `artifact-policy.preflight.v1`. `run_authoritative_verification(...)` returns `artifact-policy.receipt.v1`. |
| Implementation | `ExactPreciousCustody` copies regular bytes and records symlink payloads. `_manifest` records non-following stat evidence for regenerable entries. |
| Depth | Callers pass repo, phase, and verification argv. Policy precedence, resource gates, entry semantics, repair routing, and receipt truth stay behind the Module. |
| Seam | Ignored inventory policy across advisory prepare, authoritative integration/verify-run, restoration, durable receipt, and recovery display. |
| Adapter | Git inventory adapter uses `git ls-files --others --ignored --exclude-standard -z`. Lockfile adapter maps root `node_modules` to Bun, pnpm, Yarn, or npm lifecycle argv. |
| Leverage | One classification decision removes warm dependency trees from byte custody, preserves precious safety, and gives every caller the same repair vocabulary. |
| Locality | Artifact-policy decisions live in one Module. Git semantic snapshots stay in integration. Package installation stays with package managers. |
| Deletion test | Removing the Module forces classification, precedence, custody promises, divergence fields, and repair hints back into init, prepare, integrate, verify-run, and resume. The controller becomes inconsistent or returns to the current refusal. |

## Stable policy Interface

Built-in policy:

- Regenerable root: repository-root `node_modules` only.
- Lifecycle owner: detected lockfile owner.
- Divergence consequence: disclose after successful verification.
- Unknown path: precious.

Repository override:

- `precious_roots`: path-prefix rules.
- `regenerable_roots`: path-prefix, owner, and direct repair argv.
- `regenerable_divergence`: `disclose` or `block`.

Precedence:

```text
precious override
    > repository regenerable rule
    > built-in node_modules rule
    > unknown precious
```

Classification occurs before these enforcement rules:

- Precious entry cap: 512.
- Precious regular-byte cap: 64 MiB.
- Precious supported types: regular and symlink.
- Precious regular hardlink rule: one link only.
- Precious ownership: effective user.
- Regenerable manifest cap: 200,000 entries.

This ordering lets a 2,946-entry Bun dependency tree with 13 symlinks reach dispatch while five unknown build artifacts still receive exact custody.

## Stable receipt Interface

`artifact-policy.receipt.v1` separates claims that the current generic `cleaned: true` shape conflates:

- `precious_restoration_proven`
- `precious_restored`
- `precious_introduced`
- `bulk_changed`
- `bulk_deleted`
- `bulk_introduced`
- `bulk_divergence_detected`
- `bulk_observation_complete`
- `bulk_restored`
- `canonical_ignored_state_preserved`
- `repair_actions`

Exact precious contract in this prototype:

- Starting path set.
- Final entry type.
- Regular-file bytes.
- Regular-file mode.
- Regular-file mtime.
- Symlink payload.
- Precious parent-directory mode.

Inode and ctime identity are excluded because atomic restoration replaces filesystem objects. Production receipts must keep this boundary explicit rather than saying “filesystem restored exactly.”

Regenerable evidence is a stat/type manifest containing type, device, inode, size, mode, link count, mtime, ctime, and symlink payload. It is an accidental-divergence detector. It is not byte proof and cannot restore state.

## Transaction placement

### Prepare advisory

1. Load built-in and tracked repository policy.
2. Inventory and classify.
3. Enforce precious custody and regenerable manifest bounds.
4. Refuse before worker dispatch only when the typed policy cannot meet its contract.
5. Store policy digest and preflight summary.

### Integrate authoritative

1. Acquire existing integration lock.
2. Apply transport without verification.
3. Reload policy after apply because transport may change ignore rules or policy.
4. Inventory and classify again.
5. Capture precious custody and regenerable manifest.
6. Run authoritative verification.
7. Restore precious state and prove the declared exact contract.
8. Compare regenerable manifests.
9. Emit durable receipt and apply `disclose` or `block` consequence.
10. Let the existing Git semantic proof decide commit eligibility independently.

### Verify-run authoritative

Use the same Artifact Policy Interface. Do not maintain a second ignored-state implementation.

### Restoration and recovery

- Block and retain controller state when precious restoration is unproven.
- Preserve introduced unknown precious paths; require inspection instead of destructive cleanup.
- Leave regenerable divergence in place by default.
- Emit one owner action per affected root.
- Never use `canonical_ignored_state_preserved: true` while any bulk divergence remains.

## Current seam evidence

Inspected at branch `codex/issue-1300-preflight-probe`, commit `b990c4f22153f7a8373f79c4a1eccd8a03e60675`:

- `skills/ce-work/scripts/unit_workspace_ignored.py`
  - `ignored_paths`
  - `inspect_ignored_snapshot_capability`
  - `preflight_ignored_artifacts`
  - `require_ignored_snapshot_capability`
  - `MAX_IGNORED_SNAPSHOT_ENTRIES = 512`
  - `MAX_IGNORED_SNAPSHOT_BYTES = 64 MiB`
- `skills/ce-work/scripts/unit_workspace_state.py`
  - run initialization calls `require_ignored_snapshot_capability` before `READY`.
- `skills/ce-work/scripts/unit-workspace.py`
  - CLI dispatches `verify-run`, `integrate`, and `restore` to their current owners; the proposed Module stays behind those commands.
- `skills/ce-work/scripts/unit_workspace_jobs.py`
  - `cmd_prepare` repeats the undifferentiated capability probe before workspace creation.
- `skills/ce-work/scripts/unit_workspace_transaction.py`
  - `_snapshot_ignored_artifacts`
  - `_restore_ignored_artifacts`
  - `_verify_run_locked`
  - `cmd_integrate`
  - current receipt fields `cleaned_paths` and `cleaned: true`.
- `skills/ce-work/scripts/unit_workspace_integration.py`
  - `semantic_snapshot`
  - `restore`
  - Git semantic state excludes ignored bytes.
- `skills/ce-work/references/cross-model-execution.md`
  - prepare advisory probe at step 3.
  - authoritative integration and exact restoration language at steps 7 to 10.
- `skills/ce-work/references/execution-engines.md`
  - fixed route selection and host-owned verification boundaries.
- `tests/skills/ce-work-unit-workspace.test.ts`
  - ignored restoration test near “unit and plan-wide verification restore existing ignored artifacts”.
  - full blocker test near “init reports every ignored snapshot blocker”.
  - prepare recheck and entry-limit tests.
- `tests/skills/ce-work-cross-model-integration.test.ts`
  - controller-owned integration and preflight paths.
- `tests/skills/ce-work-cross-model-routes.test.ts`
  - fixed dispatch authorization remains outside this proposal.
- `tests/skills/peer-job-runner.test.ts` and `skills/ce-work/scripts/peer-job-runner.py`
  - runner supervision remains outside this proposal.
- `skills/ce-work/scripts/unit_workspace_lifecycle.py`
  - `pending_plan_wide_verification` and `receipted_plan_wide_verification` remain recovery owners and need the new receipt fields.

Also inspected `/private/tmp/issue-1300-blind-assessment-result.md` and `/private/tmp/issue-1300-spike-results.md`. The latter establishes 7/7 accidental mutation detection for the stat manifest and explicitly rejects calling it restoration.

## Ownership boundaries

Controller owns:

- Policy evaluation under the transaction lock.
- Precious custody.
- Receipt truth.
- Divergence consequence.
- Repair action emission.

Package manager owns:

- Dependency materialisation.
- Store and link-farm topology.
- Repair execution.

Git integration owns:

- Expected apply tree.
- Tracked/index semantic proof.
- Canonical commit.

The Artifact Policy Module emits repair argv. It never runs package installation automatically.

## Assumptions

- The integration lock gives the controller exclusive intended authority, but not OS-level isolation.
- Ignored inventory remains Git's `--others --ignored --exclude-standard` representation, including possible opaque entries.
- Root `node_modules` is safe to classify as package-manager-owned only when a repair owner is explicit.
- Stat evidence addresses accidental mutation, not privileged or raw-disk adversaries.
- Precious symlink payload custody does not follow the target.
- Unknown introduced precious paths may be concurrent user data, so automatic deletion is unsafe.

## Failure modes and next work

- External hardlink aliases: refuse precious custody. A controller cannot restore an alias outside its authority.
- Opaque precious directory: refuse. The inventory entry does not expose hidden contents.
- Parent symlink: refuse before lstat traversal can escape policy scope.
- Policy changed after prepare: authoritative integration reload wins.
- Policy changed during capture: fail-stop custody capture.
- Regenerable divergence under `disclose`: verification may pass, but receipt marks canonical ignored state unpreserved.
- Regenerable divergence under `block`: commit blocks, but state remains divergent and repair still belongs to the owner.
- Introduced precious entry: preserve and block; do not call it cleaned.
- Windows link and timestamp behavior: unproven by this macOS prototype.

Next falsification: integrate the Module behind the current controller Interface, then run mutation/race fixtures for nested package-local `node_modules`, pnpm explicit hardlinks, opaque nested repos, `.gitignore` changes introduced by transport, and crash recovery after precious restore but before receipt persistence.
