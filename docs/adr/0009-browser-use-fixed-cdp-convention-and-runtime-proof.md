---
status: accepted
date: 2026-06-02
supersedes: 0008-browser-use-owns-warm-chrome-binding-lifecycle.md
---

# browser-use Uses Fixed CDP Convention And Runtime Proof

`browser-use` uses the current Warm Chrome convention: CDP on `9222`, a
dedicated Agent Chrome profile, and proof on every run.

## Current owners: 2026-08-14

- Warm Chrome owns Browser proof, dedicated-profile policy, verified target
  creation, and safe failure.
- Browser Connect consumes Warm Chrome proof for external adapter entry and
  injects only the verified endpoint.
- Browser Use owns the developer job and authentication policy.
- The native Agent Chrome launcher owns labelled entry and exact-pid
  activation. It does not own proof or credentials.

## Historical decision: 2026-06-02

- Use the then-current Warm Chrome Preflight as browser-entry authority.
- Use the then-current Browser Adapter Proof as second-stage adapter authority.
- Keep `--port` and `--endpoint` as current-run inputs only.
- Do not write or read durable Warm Chrome Binding state.
- Do not add leases, allocator ranges, mutation locks, or ownership records.
- Treat `DevToolsActivePort` as adapter hint material, not lifecycle state.
- Fail with diagnostics when an adapter points at stale config.
- Forbid adapter or cold-browser fallback after proof failure.

## Consequences

- Fresh agents prove reality instead of trusting persisted ownership.
- Stale adapter bindings surface before browser action.
- Multi-profile fleets need a separate decision.
- Durable browser knowledge consumes proof output; it does not own readiness policy.

## Historical path proposal: 2026-08-13

Status: superseded on 2026-08-14 by the native macOS path below.

- Agent Chrome owns durable browser data at
  `$XDG_DATA_HOME/agent-chrome/chrome-user-data`, defaulting to
  `~/.local/share/agent-chrome/chrome-user-data`.
- Migrate the legacy `~/.agent-warm-profile` by explicit preview, stopped-browser
  copy, private verification, atomic promotion, Warm Chrome proof, and session
  continuity proof.
- Retain the legacy path unchanged for rollback. V1 never deletes it.
- Never read, copy, change, or adopt Everyday Chrome during this migration.
- Detail:
  `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.

## Amendment 2026-08-14

- Agent Chrome owns Browser data at
  `~/Library/Application Support/Agent Chrome/Chrome User Data` on macOS.
- The preserving migration passed preview, stopped-Browser copy, metadata
  verification, atomic promotion, exact-profile Warm Chrome proof, session
  continuity, and retained legacy rollback.
- Agent Chrome and Everyday Chrome are paired labelled actions. Everyday
  Chrome carries no profile, CDP, adapter, repair, or cleanup authority.
- Both actions still host Google's `com.google.Chrome` Browser process. The
  labels do not claim global Finder, Dock, or external-link isolation.

## Amendment 2026-08-14

- Nathan accepted the macOS-native profile owner at
  `~/Library/Application Support/Agent Chrome/Chrome User Data`. This
  supersedes the 2026-08-13 XDG destination while retaining its preservation,
  privacy, preview, continuity, and rollback requirements.
- `warm-chrome launch --open` creates a new page target through the verbatim
  browser-level websocket from proof, verifies that target in the same Browser,
  then re-proves the endpoint and profile.
- `Agent Chrome.app` is a copied, signed native launcher with an embedded
  compiled Warm Chrome helper. It activates only the verified Browser pid and
  verifies that pid became macOS foreground.
- The app owns no browser proof, credentials, endpoint derivation, or adapter
  routing. It consumes the helper's proof and target receipt.
- Cold launch uses the existing guarded spawn path before verified target
  creation.
- Everyday Chrome remains outside the launcher and profile path.
- Failed target creation, target verification, post-open proof, or exact-pid
  activation stops without spawning or activating a fallback browser.
- The generated Agent Chrome artwork owns the dedicated profile avatar through
  a stopped-profile helper. Browser-level Google sign-in blocks that write so
  account identity is preserved. Everyday Chrome remains excluded.
- Installed-app cold launch uses `NSWorkspace.OpenConfiguration`, not direct
  Google Chrome process spawn. Warm Chrome retains every pre-launch guard,
  readiness proof, and exact-pid race rule; Agent Chrome does not require App
  Management permission.

## Amendment 2026-07-03

- When `9222` is occupied by a non-Warm-Chrome listener, failure diagnostics
  may include an informational `suggested_explicit_port` from a loopback scan.
- The suggestion is a repair hint, not an allocator: no launch, no
  persistence, no rebinding on the suggested port. It is never authoritative —
  never persisted, never read back, never reused as allocator state.
- The candidate comes from a bounded loopback scan window (a small
  unprivileged range near `9222`, never below `1024`); the scan must not be
  widened to arbitrary ports.
- A suggested port becomes usable only after an explicit rerun with
  `--port`/`--endpoint` and a successful Warm Chrome proof.
- Detail: `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`.
