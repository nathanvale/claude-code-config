# Runbook Generation activation contract findings

Lane: `prototype` logic. Persistence is the question, so a clearly-marked scratch
temp store under the OS temp dir is used and cleaned up. No tests. Full state
printed after every action. Every verdict check derives from a real outcome.

## Question

Can the source-to-runtime model (ADR 0031) represent committed catalog
provenance, whole-catalog digest review, immutable generation staging, atomic
activation, bootstrap cutover, and post-cutover no-fallback behavior WITHOUT a
second authoring source?

## Exact call sequence

```text
cd skills/browser-use
bun run prototype:runbook-generation-activation
```

The runner creates a scratch generation store (`mkdtemp` under the OS temp dir),
drives every scenario against real on-disk staged generations and an atomic
pointer file, prints full active state after each action, then removes the
scratch store.

## Results (verdict: PASS — 8/8)

| Scenario | Outcome |
| --- | --- |
| Catalog + action bytes match one commit; unrelated dirt present | Does not block (dirt ignored) |
| activate with stale reviewed digest | Refused `catalog-drift` before any staging |
| activate with unpromoted action | Refused `action-unpromoted` before selection |
| bootstrap cutover (first activation) | Stages + atomically selects generation A; `changed:true`, `previous:null`, cutover flag set |
| re-activate the active digest | `changed:false` no-op |
| activate a later valid digest (catalog B) | Selects generation B, retains A as `previous`; both staged immutably |
| post-cutover missing active generation | Typed `activation-required`; reads no repo/package/compat-XDG bytes |
| public package projection | runtime + schema files only; zero private runbook/action assets |

## What this proves

- One whole-catalog closure digest (runbooks + referenced action bytes, commit
  scoped) is the review + activation unit; drift from the reviewed digest refuses
  before staging.
- Action closure (missing / unpromoted / bytes-mismatch / digest-mismatch) blocks
  activation before any generation is selected.
- Activation is stage-then-atomic-select: an immutable generation directory is
  written, then the active pointer flips. Re-activating the active digest is an
  idempotent no-op.
- A later valid digest selects a new generation and retains the prior one as
  `previous` (rollback-capable); generations are immutable and accumulate.
- Bootstrap cutover verifies + stages + selects the first generation, then sets a
  no-fallback flag. After cutover, a missing active generation returns typed
  `activation-required` and never reads repo, package, or compatibility-XDG bytes.
- The public package projection carries only runtime/schema bytes; private catalog
  and action assets are excluded by construction (zero private assets).
- No second authoring source is needed: source commit is the only provenance, the
  generation records it beside the content digest.

## Limits

- Scratch temp store, deterministic non-crypto digest, and stubbed commit ids —
  not the real Git provenance check or the real content-addressing scheme.
- "Atomic select" here is a pointer rewrite in a temp dir; the real
  implementation must use a genuine atomic rename on the target filesystem.
- Public projection is asserted by construction (a fixed included/excluded list),
  not by running the real packaging/build. Prove the real `dist`/tarball excludes
  private assets at build time.

## Plan effect

- Confirmed: activation dependency-order item 1 (Runbook Generation activation +
  cutover) is representable with one source and no second authoring path.
  Acceptance criteria: whole-catalog reviewed digest gates activation; drift and
  incomplete action closure refuse before selection; first activation bootstraps +
  atomically selects; re-activate is a no-op; later digest selects a new
  generation retaining previous; post-cutover missing-active is typed
  `activation-required` with zero fallback; public projection has zero private
  assets.
- Open (named): real Git commit-provenance verification, real atomic-rename
  activation on the XDG filesystem, and a build-time proof that the published
  package excludes private assets.
