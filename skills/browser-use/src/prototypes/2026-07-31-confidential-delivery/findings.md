# 2026-07-31 confidential-delivery spikes

Throwaway spikes that falsified the confidential-delivery plan's browser
mechanics before implementation. Captured per the `browser-use-prototyper`
contract; the graduated receipt is the single source of truth:

**Findings note:** `skills/browser-use/docs/research/2026-07-31-confidential-delivery-prototype-findings.md`
**Plan they fed:** `docs/plans/2026-07-31-001-feat-browser-use-confidential-delivery-wiring-plan.md`

All spikes ran against live Agent Chrome via `browser-connect`, secret-free
except the operator-present real-vault reads (dummy sentinels or `op read`
piped straight into the custody child — the agent never bound the bytes).

## What each spike answered

| Spike | Question | Verdict |
|-------|----------|---------|
| `cdp-spike.mjs` + `cdp-spike-fixture.html` | 2nd CDP client, flat-session attach, insertText vs Angular, tab↔target, field bridge, origin re-read | all PASS |
| `plan-e2e-spike.mjs` | full custody choreography control flow (all fail-closed paths) | all PASS |
| `login-shapes-fixture.html` | generic login across 6 structural shapes | identical by role+name |
| `runbook-lifecycle-spike.mjs` / `runbook-distill-spike.mjs` | self-optimizing runbook lifecycle; real distill | 20x fewer round-trips |
| `custody-seam-spike.mjs` + `custody-child.mjs` | secret-never-seen seam, leak-sweep (planted-regression flips verdict) | SEAM HOLDS |
| `vault-e2e-spike.mjs` / `vault-unhappy-spike.mjs` | real 1Password vault path, both portals; unhappy fail-closed | all correct |
| `adapter-neutral-spike.mjs` | lane-neutral custody across all 3 adapters | LANE-NEUTRAL |
| `timesheet-fixture.html` + `timesheet-fill-spike.mjs` | fill-by-date + fail-closed guards | all PASS |
| `multistep-login-*.{mjs,html}` | multi-step / OTP login engine, no hardcoded flow | PASS |
| `pause-resume-spike.mjs` | pause/resume continuity; visibility-based staleness | PASS |
| `portal-login-verify.mjs` / `deliver-one-field.mjs` | live FastTrack + Oncore login (operator present) | verified |
| `serve.mjs` | Bun http static server so harness discovery (http-only) sees fixtures | — |
| `diag-*.mjs` | throwaway diagnostics (click/signin/clear investigations) | — |

Throwaway: kept as a worked example for the `browser-use-prototyper` skill.
Do not import from here; the validated decisions live in the plan and note.
