# Findings — Adapter Session Lease live spike (pre-build falsify)

Date: 2026-08-11 · Lane: pre-build (falsify) · Adapter: agent-browser 0.31.2
Harness: `browser-connect connect agent-browser --json` → Verified Handoff
Envelope (ws on `:9242`, Chrome PID 1567). Fixture served over
`http://localhost:<ephemeral>`. One owned session per run
(`lease-spike-<epoch>`); no existing session or tab touched.

Run: `bun skills/browser-use/src/prototypes/2026-08-11-adapter-session-lease/live-spike.ts`
(`--planted` for Q4). Companion state-model demo: `lease-demo.html`
(double-click; per-run vs per-invocation lifetime walkthroughs).

## Verdicts

| Q | Claim | Verdict |
|---|-------|---------|
| Q1 | A daemon session created by one CLI invocation holds the same live page instance in a separate invocation | **PASS** — `window.__leaseProbe` minted at load read identical (`alive-e0og68sz`) by invocation A and invocation B (separate processes); url matched the fixture |
| Q2 | The instance survives an idle hold (blocked→resume shape) | **PASS** — same probe value after 5s hold in a third invocation |
| Q3 | `close` with `--session <owned>` and no `--cdp` releases exactly the owned session | **PASS** — `{success:true}`, inventory 56→57→56, owned name absent, all 56 baseline sessions intact, Chrome PID stable (1567), page targets 2→1 back to baseline |
| Q4 | Planted regression: skipping release flips the absence assertion to FAIL | **PASS** — assertion evaluated FAIL with the leak visible (57 sessions, owned present); repaired by named close of the planted session only |

## Call sequence (Q1–Q3)

1. `browser-connect connect agent-browser --json` → take `data.endpoint.ws` + `data.attachment.probe_executable` verbatim.
2. Baseline: `agent-browser session list --json` (56), `lsof :9242` PID, `GET <http>/json/list` page count.
3. Invocation A: `agent-browser --cdp <ws> --session <owned> tab new --json`, then `open <fixture> --json`, then `eval window.__leaseProbe --json`.
4. Invocation B (separate process): `get url --json` + `eval window.__leaseProbe --json` → Q1.
5. 5s hold, invocation C: `eval` again → Q2.
6. `tab close --json` (own tab), then release: `agent-browser --session <owned> close --json` — **no `--cdp`** → Q3 with bounded re-read (≤6×1s) before asserting inventory.

## Findings that shape the implementation

1. **Per-run lease is viable end to end.** Create in one invocation, reuse across
   invocations and an idle hold, release once at terminal — all proven live.
   The lease model's premise (daemon-held stateful session, `--session <name>` as
   the continuity key) holds.
2. **Release truth settles asynchronously.** An inventory read immediately after
   `close` can still show the session (observed on the Q4 repair path); the Q3
   settle loop (bounded re-read, ≤6s) converged every time. The implementation's
   release verification must bound-re-read, never single-read.
3. **`get url --json` returns a rich lifecycle envelope**, not `{data: {result}}`
   — response parsing per subcommand differs (`eval` uses `data.result`). Adapter
   response shapes belong behind the registry seam, not in callers.
4. **Baseline confirms the leak at scale**: 56 live sessions, ~45 of them
   orphaned `browser-use-<uuid>` names plus one `browser-connect-probe-*` —
   the orphan-sweep candidate (ICA candidate 4) has a real population waiting.

## Graduation

Proven mechanics → acceptance criteria for implementing ICA candidates 1+2:
registry `releaseSession` mechanic (browser-connect AdapterDefinition) and a
browser-use Adapter Session Lease with per-run lifetime, release at the terminal
seam, bounded re-read verification, release truth reported separately from task
truth. Refuted: nothing. Open (not spiked, by design): lane-neutral release on
`playwright-cdp`/`chrome-devtools-mcp` — candidate 1's registry shape covers it;
prove per-adapter when each mechanic is implemented.
