---
status: proposed
date: 2026-06-01
---

# browser-use Owns Warm Chrome Binding Lifecycle

`browser-use` should own the singleton `Warm Chrome Binding`: user-machine state that
pairs one CDP port with one dedicated Warm Chrome profile. The binding would live outside
the Chrome profile in the XDG state path, and Warm Chrome Preflight would verify it before
any Browser Adapter acts. The binding is a pointer, not readiness proof.

## Proposed Decision

Only `launch` writes or replaces the `Warm Chrome Binding`. `check` and `status` stay
read-only. `repair` stays target-bound: it may fix profile proof such as owner-only
permissions and `DevToolsActivePort` for an explicit endpoint or healthy binding, but it
does not discover, adopt, allocate, or replace the binding. If the bound port is stale or
occupied by non-Warm-Chrome, `launch` may allocate a new free port and replace the binding
only after Warm Chrome proof passes. Read-only stale-binding failures use the existing
`launch_warm_chrome` recovery action rather than introducing a new reclaim action.
When another `launch` already owns the mutation lock, a second `launch` waits briefly,
then re-resolves the binding before deciding. The lock covers allocation, spawn, Warm
Chrome proof, and binding write; it must not block indefinitely.
Corrupt or stale binding files are not renamed aside by read-only commands; `launch`
atomically replaces them only after successful Warm Chrome proof.

Adoption and allocation are separate. `launch` may adopt an existing healthy Warm Chrome
only from resolver-owned bootstrap candidates after proof. Cold allocation may use a small
reserved range for free-port selection, but range ports are not adoption candidates unless
the resolver code explicitly says so. Exact candidates, ranges, and binding schema stay
code-owned; hand-maintained docs describe the resolver and command boundaries, not the
lists.

The binding schema is locator plus last-writer metadata. It may record enough to find the
candidate endpoint/profile and explain who last claimed it, but it does not store websocket
URLs, browser PIDs, target counts, or last-proof snapshots as authority.
`BROWSER_USE_CDP_PORT` and `BROWSER_USE_PROFILE_DIR` stay as bootstrap hints only; they do
not override a healthy binding.
Explicit `--profile` is a current-run expectation, not a rebind request. If it conflicts
with a healthy binding, the command fails with profile mismatch and leaves the binding
untouched.
`launch` may recover from a wrong explicit port by reusing a healthy binding to avoid
spawning a competitor. That recovery returns `browser_ready` with `launch_performed=false`,
not an error. `check`, `status`, and `repair` stay strict about their requested endpoint.
Success data may include `resolution_source` as endpoint-selection provenance if the
existing facade envelope accepts it. It is not readiness proof.
First cold `launch` may use a code-owned default dedicated profile path when no binding,
explicit profile, or env profile exists. That default should have application-support
semantics, not cache semantics, because the profile contains durable login state.
Hand-maintained docs must not restate the exact path.
Existing Chrome profile directories are adopted only by proving a live Warm Chrome; profile
directories are never moved or copied into the default path.

## Consequences

- A hardcoded port is never the authority for Warm Chrome.
- `DevToolsActivePort` remains a Chrome/adapter hint, not lifecycle state.
- Read-only preflight commands cannot silently mutate user-machine state.
- Future multi-profile or second-instance support needs a separate decision; v1 has one
  active `Warm Chrome Binding`.
