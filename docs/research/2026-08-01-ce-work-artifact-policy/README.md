# CE Work Artifact Policy Module — prototype + falsification

ICA research: replace the ce-work controller's undifferentiated ignored-state
snapshot (512-entry / 64 MiB caps, unusable in warm Bun checkouts) with a typed
Artifact Policy Module: classify ignored paths first (precious override >
repository regenerable rule > built-in `node_modules` > unknown precious),
give precious entries exact custody, give regenerable trees stat-manifest
disclosure plus an owner repair argv, and report both through one truthful
`artifact-policy.receipt.v1`.

Upstream seam: EveryInc/compound-engineering-plugin issue #1300
(`unit_workspace_transaction.py`, branch `codex/issue-1300-preflight-probe`).

## Layout

- `prototype/` — runnable standard-library prototype (2026-08-01).
  `./run-demo` runs 4 tests, a synthetic custody transaction, and a read-only
  probe of a warm 68 MB Bun fixture. `ARCHITECTURE.md` holds the ICA map and
  verdict; `HANDOFF.md` the observed evidence and deletion test.
- `falsification/` — the falsification experiment (2026-08-01, verdict: NOT
  falsified, 96/96 checks).
  - `FALSIFICATION.md` — method, crash matrix, findings, residuals.
  - `controller-wiring.patch` — unified diff wiring the Module into a
    disposable copy of the 3.21.0 controller (`_verify_run_locked` seam,
    durable phase record, 5 hard-crash points, `artifact-resume` command).
    Apply to the plugin cache scripts to reproduce.
  - `harness.py` — fixtures (Bun link farm, pnpm hardlinks, opaque nested
    repo, transport `.gitignore` change, introduced precious), crash matrix,
    assertions.
  - `report.json` — the 96 check results.

## Status

Prototype validated; production adoption findings recorded in
`FALSIFICATION.md` (capture-time journaling, resume must force verification
re-run, symmetric directory-proof filtering, orphan-custody cleanup).
Residuals: `cmd_integrate` cherry-pick window, Windows semantics, large-scale
fixtures.
