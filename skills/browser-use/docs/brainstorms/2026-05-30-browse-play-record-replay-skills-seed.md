---
title: "browse + play — lean record/replay browser skills (brainstorm seed)"
type: brainstorm
status: seed
updated: 2026-05-30
summary: "Seed for a fresh /ce-brainstorm: two lean skills in claude-code-config — browse (freestyle + record a session) and play (replay it). Built on the steipete browser-use skill, NOT the side-quest BA plugin. Tape format RESOLVED by research: deterministic JSON tape + variable slots + tiered self-heal with human-review gate."
related:
  - skills/browser-use/docs/research/2026-05-30-tape-format-record-replay-browser-automation.md
  - docs/research/2026-05-30-skill-composability-handoff-observability.md
  - docs/brainstorms/2026-05-30-skill-composability-handoff-principle.md
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

## Tape format — RESOLVED by research (2026-05-30)

Was the big open question; the newsroom sweep is decision-grade. Full evidence:
`skills/browser-use/docs/research/2026-05-30-tape-format-record-replay-browser-automation.md`.

**Answer: hybrid, deterministic JSON tape as the spine.** Not pure-deterministic (too brittle), not
LLM-replay (peer-reviewed: temp=0 LLMs vary ~15%/run → true LLM-loop replay is impossible + costly).
The consensus heuristic: "have an agent write a deterministic program, then run that" = browse writes
the tape once, play replays it deterministically.

Design the tape this way:
- **Format:** deterministic JSON step list (Chrome Recorder / `@puppeteer/replay` shape: navigate /
  click / change / waitForElement). Readable, editable, thin runner.
- **Selectors:** capture the **fallback array** (AX/aria first — most drift-resistant), not one CSS path.
- **Parameters:** add a **variable-slot layer** the base schema lacks (dates/hours as `{{vars}}`,
  resolved at replay) — the timesheet-date problem. (Workflow Use's "variable slots" is prior art.)
- **Replay:** deterministic fast-path, **zero LLM** on the happy path.
- **On failure:** tier-2 deterministic re-heal (AX-tree re-resolve) → tier-3 LLM only if that fails →
  **flag the healed step + ask the human. Never silent-substitute** (the dominant industry failure
  mode: a "close-enough" element keeps the run green while clicking the wrong control).

So the brainstorm's job shifts from "pick a format" to **"design the tape schema + variable-slot +
the tiered-heal-with-human-gate"** against this resolved direction.

Reference implementations to study: Skyvern (compile-to-Playwright), Workflow Use (record→variable
slots), AgentRR (two-level experience store), arXiv 2603.20358 (zero-cost AX-tree self-heal).

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
- cli-author ↔ cli-command-facade pattern (skill produces spec, package enforces): same repo's
  `docs/brainstorms/2026-05-29-002-facade-aware-cli-author-integration.md`

## Skill choreography — browse + domain-checker + capture-run (Nathan, 2026-05-30; corrected by research)

browse stays a lean driver holding NO domain knowledge; the other two are thin skills over one
per-domain ledger. **Wiring corrected by research** (`docs/research/2026-05-30-skill-composability-handoff-observability.md`):
skills do NOT reliably auto-trigger each other from descriptions (~0-50%; no documented skill→skill
auto-handoff exists). So handoff is **explicit `Skill()` from the driver + a Stop hook for
end-of-run** — NOT emergent peer-to-peer auto-firing.

```
You: "go to <site> and fill my timesheet"
  → browse (freestyle; = browser-use, already exists) drives
  → hits a domain → browse EXPLICITLY calls Skill(domain-checker):
       "ledger entry for this domain? auth pointer / runbook tape / selectors?"
       → hands back → browse keeps driving (auth via one-password closed box)
  → run finishes → capture-run fires on a STOP HOOK (reliable; a description-trigger is ~20-50%)
       → records the run → feeds the ledger
  → next run: domain-checker finds more. Loop compounds.
```

- **browse** — the driver (browser-use). Holds no domain knowledge. Makes the explicit handoff call.
- **domain-checker** — invoked by browse when a domain appears; reads the per-domain ledger (auth
  pointer, flow tape, selectors); hands back. Thin skill over a deterministic ledger read.
- **capture-run** — fired by a Stop hook at end-of-run; writes what happened into the ledger. Thin
  skill over a deterministic ledger write. (Hook, not description-trigger — a hook reliably knows a
  run finished.)

The ledger is the **same per-domain substrate** as the tape work above (auth pointer + `<flow>.json`
tapes + selector ledger). Three skills read/write one ledger; the loop compounds. Keep the skill
count low — there's a ~15k-char metadata budget; too many skills degrade routing (cap ~8-12).

## Open questions for the brainstorm (beyond tape format)

- Tape storage: per-domain folder like the thesis's `auth.json` + `<flow>.json`? Where do tapes live?
- Parameterization: how do recorded literals (dates, hours) become replay variables — at save time
  ("which of these is variable?") or by convention?
- Does `play` reuse the `one-password` skill for the auth step, or is auth its own recorded tape?
- Selector capture that survives DOM drift (role/text/test-id over brittle CSS).
- Self-healing: on a failed step, fall back to Claude to re-derive + offer to re-record that step?
- Discovery: how does `play` find saved tapes? How does `browse` offer "save this as a runbook?"
