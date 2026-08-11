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

## Acceptance receipt (post-build)

Date: 2026-08-11 · Lane: post-build (accept) · Operator-run only ·
Adapter: agent-browser 0.31.2

`acceptance.ts` graduates the throwaway argv spike into a repeatable receipt for
the built code. The normal variant creates and reuses one
`browser-use-<run_id>` session, then drives the U3 task terminal seam and U4
discovery terminal seam. Both seams resolve
`findAdapterDefinition("agent-browser").releaseSession` with
`deriveSessionName(runId)`. The planted variant skips terminal release, proves
the absence assertion fails, then repairs through that built registry mechanic.

### Acceptance claims

| Claim | Built owner | Operator assertion |
|---|---|---|
| Owned session is created once and reused by separate invocations | U1 lease name; U3/U4 consumers | Fixture URL and `window.__leaseProbe` remain identical; owned name appears beside every baseline session |
| Terminal task release | U3 `executeAgentBrowserTask` terminal seam | Task remains `confirmed`; release debt absent; inventory returns to baseline |
| Discovery and operation release | U4 discovery/operation terminal seams | The receipt drives discovery live; release debt absent. Both discovery and operation resolve the same U2 registry mechanic |
| Release uses named close with no endpoint injection (R3) | U2 agent-browser `AdapterDefinition.releaseSession` | Captured release argv is exactly `--session <owned> close --json`; every release command excludes `--cdp` |
| Release truth uses bounded inventory re-read (R6) | U2 agent-browser `AdapterDefinition.releaseSession` | Captured `session list --json` count is 1–6 before `released=true` |
| Release is named-scope only (R7) | U2 mechanic; U3/U4 callers derive only their run's name | Final inventory equals baseline by exact names; all foreign sessions remain |
| Agent Chrome is the only browser touched (DDA-F26 / R8) | Browser Connect verified handoff | Handoff environment is `agent-chrome`; listener PID stays stable; page targets return to baseline |
| Absence assertion is falsifiable | Post-build planted variant | `--planted` skips release; owned name remains visible and the baseline-absence assertion must fail before built cleanup |

U4 operation does not need a second live mutation to prove release argv: its
terminal seam calls the same registry definition as the live-driven discovery
seam. Production tests remain the deterministic seam proof; this receipt adds
Agent Chrome evidence for the shared mechanic. A receipt failure is a built-code
bug, not a pre-build open question.

### Exact operator run

Run from the repository root with live **Agent Chrome** available. Never point
the receipt at default Chrome. The fixture is served over an ephemeral
`http://localhost` port and contains no credentials.

```bash
handoff_path="$(mktemp -t adapter-session-lease.XXXXXX.json)"
browser-connect connect agent-browser --json --run-id "acceptance-$(date +%s)" > "$handoff_path"
bun skills/browser-use/src/prototypes/2026-08-11-adapter-session-lease/acceptance.ts --handoff "$handoff_path"

browser-connect connect agent-browser --json --run-id "acceptance-planted-$(date +%s)" > "$handoff_path"
bun skills/browser-use/src/prototypes/2026-08-11-adapter-session-lease/acceptance.ts --handoff "$handoff_path" --planted

rm "$handoff_path"
```

Expected: both runs exit 0. The normal run prints PASS for continuity, U3 task
release, U4 discovery release, bounded re-read, exact baseline restoration, and
stable Chrome PID. The planted run prints PASS only when the deliberately
skipped release makes the absence assertion fail, then restores baseline through
the built U2 mechanic.
