---
title: "browse + play — lean record/replay browser skills (brainstorm seed)"
type: brainstorm
status: seed
updated: 2026-05-30
summary: "Seed for a fresh /ce-brainstorm: two lean skills in claude-code-config — browse (freestyle + record a session) and play (replay it). Built on the steipete browser-use skill, NOT the side-quest BA plugin. Tape format deliberately left open."
related:
  - skills/browser-use/SKILL.md
  - skills/browser-use/scripts/launch-agent-chrome.sh
  - skills/one-password/SKILL.md
  - skills/peekaboo/SKILL.md
---

# browse + play — lean record/replay browser skills (seed)

Picked up cold in a fresh session via `/ce-brainstorm`. This is a SEED, not a plan — it locks the
few decisions already made and leaves the real open question (tape format) for the brainstorm.

## What this is

Two lean skills in `claude-code-config/skills/`, in the steipete style (prompt + thin scripts, no
governance machinery):

- **`browse`** — drive the browser live/freestyle AND record the session.
- **`play`** — replay a saved session, stop on a failed step.

## Hard constraint

**Build in `claude-code-config`. Nothing to do with the side-quest browser-automation (BA) plugin.**
This is the lean, divorced-from-BA thing. Do not import BA-plugin machinery (surface-manager,
managed-domain contracts, preflight, migration forks, BSS). The whole point is to escape that.

## Decisions already made (Nathan, 2026-05-30)

1. **Two separate skills** — `browse` (freestyle + record) and `play` (replay). Not one dual-mode
   skill. Clean separation; replay is its own front door.
2. **Driver: build on the existing `browser-use` skill** (already in `claude-code-config/skills/`,
   steipete-pulled). browser-use handles raw driving (mcporter → chrome-devtools MCP, attach to the
   agent Chrome). The new skills add the **record/replay layer** on top — they don't re-implement
   browser driving.

## The big OPEN question (the reason this is a brainstorm, not a build)

**What does a recorded session/tape look like, and who reads it on replay?** Deliberately left open.
The two poles from the thesis:
- **Plain JSON step list** — lean, hand-readable, replayed by a thin script walking steps
  (navigate/click/fill/wait + success check). No LLM on replay (the "compiler" win). Hard part:
  selector stability + parameterizing values (this-week's dates).
- **Claude-driven replay** — tape is a structured record, but replay is Claude re-reading it and
  re-driving via MCP. Simpler to build; replay still costs LLM calls.
- (Or a hybrid: deterministic steps with LLM fallback on a failed step — the "self-healing" pattern
  the research found in Stagehand/Skyvern.)

Resolve this in the brainstorm. It determines almost everything downstream.

## Proven substrate to build on (all validated live 2026-05-29)

- Agent Chrome on :9223, dedicated profile `~/.cache/chrome-agent` — launch via
  `skills/browser-use/scripts/launch-agent-chrome.sh` (idempotent; writes DevToolsActivePort).
- chrome-devtools MCP `--auto-connect` to that profile (config already wired).
- Auth: the `one-password` skill — op fetch + shell-side CDP inject (username/password/TOTP), secret
  never enters the agent's tool stream. Proven across Oncore, Manpower/FT360, prod Monash (Okta+MFA),
  matest QA (SAML+Okta+MFA), all warm in ONE browser.
- `peekaboo` skill for native browser dialogs CDP can't see (e.g. Save-password).

## Design principles earned from the live session (carry into the brainstorm)

- **Secret fill stays inside the auth boundary** — never route a password/OTP through an agent tool
  call. The auth step is a closed box: secret in, session out.
- **Ask the human when unsure** — MFA factor choice, account-type/tenant pickers, ambiguous sign-in
  forks. On first-run record: ask + record the choice; on replay: follow the tape, ask only if the
  recorded option is missing.
- **Verify by DOM, not URL** — URLs lie on redirects/expired sessions.
- **Warm vs cold** — log in once per service, stay warm across the session (proven: Oncore payslips
  with no re-login). cold → inject via one-password; warm → skip auth.

## Full design context (read these in the brainstorm)

- Thesis + BUILD SPEC + dual-mode + ask-when-unsure findings:
  `side-quest-engineering/docs/brainstorms/2026-05-29-001-two-skill-browser-automation-thesis.md`
- Research record (field converged on "compiler not interpreter"; Skyvern/Stagehand/Workflow Use
  reference implementations): `side-quest-engineering/docs/research/2026-05-29-lean-record-replay-browser-automation.md`
- create-cli ↔ cli-command-facade pattern (skill produces spec, package enforces): same repo's
  `docs/brainstorms/2026-05-29-002-facade-aware-create-cli-integration.md`

## Open questions for the brainstorm (beyond tape format)

- Tape storage: per-domain folder like the thesis's `auth.json` + `<flow>.json`? Where do tapes live?
- Parameterization: how do recorded literals (dates, hours) become replay variables — at save time
  ("which of these is variable?") or by convention?
- Does `play` reuse the `one-password` skill for the auth step, or is auth its own recorded tape?
- Selector capture that survives DOM drift (role/text/test-id over brittle CSS).
- Self-healing: on a failed step, fall back to Claude to re-derive + offer to re-record that step?
- Discovery: how does `play` find saved tapes? How does `browse` offer "save this as a runbook?"
