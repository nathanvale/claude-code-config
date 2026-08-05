# CE Work Artifact Policy Module prototype

Runnable alternative architecture for ignored state. It treats ignored paths as typed artifacts, not one snapshot set.

## Run

```bash
./run-demo
```

The command runs four tests, exercises exact precious restoration plus detect-and-disclose regenerable divergence, then performs a read-only eligibility probe against `/private/tmp/ce-work-react-prototype.bHxwD7`.

No network or third-party Python packages.

## Interfaces

```bash
# Advisory prepare probe
python3 artifact_policy.py inspect --repo /path/to/repo --phase prepare

# Authoritative verification transaction
python3 artifact_policy.py verify \
  --repo /path/to/repo \
  --state-parent /private/controller-state \
  --summary "tests" \
  -- bun test
```

The `verify` exit is successful when verification passes and regenerable divergence uses the default `disclose` policy. The receipt still reports `canonical_ignored_state_preserved: false` and `bulk_restored: false`.

## Policy override

Optional tracked `.ce-artifact-policy.json`:

```json
{
  "schema": "artifact-policy.repo.v1",
  "precious_roots": ["node_modules/local.db", ".local-state"],
  "regenerable_roots": [
    {
      "root": "dist",
      "owner": "project-build",
      "repair_argv": ["bun", "run", "build"]
    }
  ],
  "regenerable_divergence": "disclose"
}
```

Rules:

- Default unknown ignored paths to precious.
- Classify before entry, byte, type, ownership, or link enforcement.
- Let precious overrides beat built-in and repository regenerable rules.
- Treat root `node_modules` as the sole built-in regenerable root.
- Detect its lifecycle owner from the repository lockfile.
- Copy precious regular bytes and symlink payloads without following final symlinks.
- Use stat manifests only to detect and disclose regenerable divergence.
- Never claim stat manifests restored bytes.
- Preserve introduced precious paths and block instead of deleting unknown data.

## Files

- `artifact_policy.py`: Module, policy loader, custody Implementation, manifest Implementation, receipt Interface, CLI.
- `demo.py`: synthetic transaction and read-only warm-fixture proof.
- `tests/test_artifact_policy.py`: precedence, caps, restoration, divergence, hardlink, and strict-policy tests.
- `run-demo`: one-command proof.
- `ARCHITECTURE.md`: ICA map and seam design.
- `HANDOFF.md`: observed evidence and integration consequences.
