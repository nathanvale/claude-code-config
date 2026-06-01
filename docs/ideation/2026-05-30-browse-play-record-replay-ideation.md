---
date: 2026-05-30
topic: browse-play-record-replay-skills
focus: wide-open re-examine of the two-skill record/replay browser thesis, landed lean
mode: repo-grounded
related:
  - docs/brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md
  - skills/browser-use/SKILL.md
  - skills/one-password/SKILL.md
---

# Ideation: browse + play record/replay — re-examined, landed at steipete weight

/ ce-ideate, wide-open re-examine stance. ~49 raw candidates → adversarial filter →
three architectural tensions resolved → **then Nathan named the real constraint (no complexity;
steipete prose-trust lean, like agent-scripts) and the whole heavy spine collapsed to one
knowledge skill.** This doc records both the journey and the lean landing.

## The landing (read this first)

**Two skills: `browser-use` + `browser-domain-memory`, steipete prose-trust weight.**

`browser-use` remains the live browser driver. `browser-domain-memory` owns durable per-domain
browser knowledge: Auth Pointers, Browser Runbooks, Browser Gotchas, retained Scratch Evidence, and
Run Outcomes.

There is **no deterministic replay engine, no tape schema, no walker in v1**. Browser Runbooks are
agent-playable prose paths. Scratch Evidence may retain selectors and Recorder-shaped JSON, but only
as evidence. Run Outcomes create the promotion trail for future Machine Play Candidates.

```
skills/browser-use/
  SKILL.md                live Chrome driver. Consults memory only on friction/repeat/auth/danger.

skills/browser-domain-memory/
  SKILL.md                per-domain memory owner. Captures and tidies durable browser knowledge.
  domains/<domain>/
    auth.md               Auth Pointers only. No secret values.
    gotchas.md            Browser Gotchas.
    runbooks/<flow>.md    agent-playable prose path.
    runbooks/<flow>.runs.jsonl
                          Run Outcomes for promotion evidence.
    scratch/<run-id>.json retained Scratch Evidence, redacted, not executable.
```

This composes three skills steipete already ships — confirmed net-new only by *combination*:
- `browser-use` — live CDP driving (already in this repo).
- `github-author-context` — the append-read-next-time memory loop (read notes first → act →
  append a dated terse note **only if it creates future value**; "Do not record ordinary noise").
  Key by **domain** instead of GitHub login.
- `agent-transcript` — fail-closed redaction (allow-list what to keep, deny-list
  secrets/cookies/auth-URLs, sanitize before write).
- `one-password` — shape-not-value secret logging (presence/length/prefix, never the value).

steipete's safety model is **prose-trust**: rules are bullets the model follows; the only
automated gate is frontmatter shape (name+description). That prose-trust is the leanness. The
BA-plugin trap was this repo's deterministic-contract reflex applied where it wasn't needed.

## Do NOT build (the complexity-trap list — earned from the adversarial round)

Every "landed" attack below dissolved into **refuse-in-prose** or **out-of-scope, use `browser-use` live** —
NOT new machinery. This list is the value: conscious refusals, not features.

- **No `play` deterministic walker / tape schema / step contract.** LLM reads history, re-drives live.
- **No predicate-selection schema** (the wrong-row content-variation case). Out of scope: pick-a-row-
  by-data is a live `browser-use` task. Prose line, not a feature.
- **No mid-flow re-auth step / auth topology engineering.** Auth is a prefix; mid-flow auth wall → stop.
- **No wait-for-condition language / criticality taxonomy / dry-run pass.** At most one `wait_for` field.
- **No recording→skill distillation compiler.** Cleanup is a prose end-of-session step done with the agent.
- **No tape composition / tapes-as-CI-fixtures / formal library manifest.** This IS the BA-plugin seed.
  At most: tapes live in a folder.
- **No constraint+witness self-healing** (interpreter-model healing). Drift → stop → recapture.
- **No network-layer recording.** Never reached for; flows are SPA-computed + token-dense.
- **No "computer-task memoization" backend-agnostic abstraction.** It's a browser skill. Name it browser.
- **No shareability/portability claim.** Runbooks and Scratch Evidence are yours (vault path +
  username bind to you).

## The journey (how the heavy version collapsed)

Started from a 376-line thesis (BUILD SPEC + live receipts + "compiler not interpreter"). Wide-open
re-examine surfaced ~49 ideas across 6 frames. Adversarial filtering + three resolved tensions:

- **T1 — LLM on replay?** Resolved (given rarely-drifting enterprise portals): zero LLM on a
  deterministic walker. **BUT then superseded** — Nathan's lean reframe deletes the walker entirely;
  the LLM reads history and drives live (interpreter model on purpose).
- **T2 — immutable vs editable tape?** Resolved as two layers (immutable steps + authored
  annotations). **Superseded** — no tape to execute. Browser Runbooks are prose. Scratch Evidence is
  evidence, not trusted instructions.
- **T3 — DOM vs network capture?** DOM. **Superseded** — no capture-for-replay. Recorder-shaped
  Scratch Evidence can help later distillation and future tooling.

The adversarial round found two **silent-failure** modes (content-variation clicks the wrong row;
recording→skill distillation can silently produce a bad tape). Both dissolve in the lean version
because nothing executes a tape — a live LLM reads context and a human is in the loop.

## Topic Axes (from the heavy phase, retained for provenance)
- Tape representation · Replay determinism & LLM boundary · Auth & secret handling ·
  Parameterization · Authoring & discovery UX

## What survives into a lean brainstorm

### 1. browser-use + browser-domain-memory
**Description:** Drive live with `browser-use`; consult `browser-domain-memory` only when auth,
repeat-language, portal friction, or risk makes prior domain knowledge useful.
**Basis:** `direct:` — Nathan's #5 reframe + steipete `github-author-context` read-then-append loop +
`browser-use` live driving, all in-repo or in agent-scripts.
**Rationale:** Gives the live agent memory without an execution engine — the entire complexity delete.
**Downsides:** Interpreter model still costs LLM calls per run (no zero-cost replay). Accepted.
**Confidence:** 85% · **Complexity:** Low

### 2. Password rejection + fail-closed redaction as prose
**Description:** "Record the field, never the value." Append only sanitized actions; fail closed on
secrets/cookies/auth-URLs. Shape-not-value if a token must be referenced.
**Basis:** `direct:` — `one-password` shape-only + `agent-transcript` fail-closed `## Contract`.
**Confidence:** 90% · **Complexity:** Low

### 3. Durable Browser Knowledge per domain
**Description:** Auth Pointers, Browser Runbooks, Browser Gotchas, retained Scratch Evidence, and Run
Outcomes. No raw transcript write. No secret values.
**Basis:** `direct:` — Nathan's ask-when-unsure live findings + steipete gotchas convention.
**Confidence:** 82% · **Complexity:** Low

### 4. "Do not capture ordinary noise"
**Description:** Persist only when it creates future value. The single discipline that keeps domain
memory from becoming a swamp.
**Basis:** `direct:` — `github-author-context` verbatim rule.
**Confidence:** 80% · **Complexity:** Low (it's a sentence)

## Decision addendum: browser-use stays the port of call

Nathan's follow-up correction: the cleanest v1 is **not** a new `browse` driver and not a separate
`play` front door. It is existing `browser-use` as the thing the user invokes, with a composable
`browser-domain-memory` skill underneath.

### Strongest candidate: browser-use + browser-domain-memory

**Description:** `browser-use` remains the browser-driving skill. When it sees a domain or the user
asks for a repeat-ish task, it can explicitly consult `browser-domain-memory`: "what do we know
about this domain?" That skill owns per-domain memory and hands back. `browser-use` keeps driving
live.

**Why it is better than new `browse`:**
- Avoids a near-duplicate browser front door.
- Keeps "open browser, inspect page, click, fill" in the already-known skill.
- Makes the new surface domain knowledge, not browser driving.
- Preserves composability: driver skill + one memory skill + capture workflow.
- Keeps `play` from implying a replay engine.

**Basis:** `direct:` — `skills/browser-use/SKILL.md` already owns live Chrome DevTools driving.
`context/skill-design-philosophy.md` says one lean driver explicitly hands off; no auto-fire.
This ideation's lean landing says domain memory is a cheat sheet the LLM reads, not a tape.

**Complexity:** Low. One existing driver edit + one thin memory skill, maybe no script at v1.

### Candidate shape

```
skills/browser-use/SKILL.md
  ## Domain Memory
  Drive freely by default.
  Call Skill(browser-domain-memory) on auth, repeat-language, portal friction, or risky submit.
  Use returned context while driving live. Hand back useful discoveries.

skills/browser-domain-memory/SKILL.md
  ## Source
  domains/<domain>/auth.md
  domains/<domain>/gotchas.md
  domains/<domain>/runbooks/<flow>.md
  domains/<domain>/runbooks/<flow>.runs.jsonl
  domains/<domain>/scratch/<run-id>.json

  ## Workflow
  Read domain memory. Return only useful context.
  After a run, propose tidy durable memory. Do not capture ordinary noise.
```

### Decision pressure

This resolves the "one skill or two?" question differently:
- **One user-facing browser skill:** `browser-use`.
- **One composable knowledge skill:** `browser-domain-memory`.
- **No `play` in v1.** "Repeat this" is an intent handled by `browser-use` after reading memory.

### Rejected variants from this pass

- **New `browse` wrapper around `browser-use`:** likely duplicate front door. Name churn without
  enough value.
- **Thin `play` front door:** useful word, dangerous affordance. Users and agents infer a replay
  engine.
- **Per-domain skills:** too much skill metadata and routing load. Domain data belongs in folders.
- **Auto-discover via descriptions:** still phantom routing. `browser-use` explicitly calls
  `browser-domain-memory`.
- **browser-domain-memory calls one-password itself:** fan-out risk. It returns "auth needed" to
  `browser-use`; driver decides whether to invoke auth.

## Capture pattern deep dive

Nathan's follow-up: capture remains undercooked. Original seed had a handover skill at the end,
either invoked by the browser driver or discovered, offering to capture everything. That direction
has value, but "capture everything" is the trap door back to raw traces and machinery.

Repo constraint: `skills/capture/SKILL.md` already owns Memory OS capture. Avoid a new top-level
browser skill named `capture` or `capture-run`; routing ambiguity is too likely.

### Option A: inline capture inside browser-use

**Description:** `browser-use` finishes a domain task, then asks: "Anything worth saving for this
domain?" If yes, it appends clean entries itself.

**Good:**
- Smallest surface.
- No handoff choreography.
- Easy for user to understand.

**Bad:**
- Browser-use starts owning domain memory rules.
- Harder to reuse memory logic from other browser-ish skills later.
- Risks bloating the browser driver.

**Verdict:** viable, but not the best composability story.

### Option B: explicit end handoff to browser-domain-memory

**Description:** `browser-use` drives live. At the end, when it finds reusable domain knowledge, it
calls `browser-domain-memory` with a short session summary and asks it to propose clean entries. User
approves or edits; `browser-domain-memory` writes.

**Good:**
- One memory owner.
- Browser-use stays driver, not ledger maintainer.
- Capture remains a prose review, not a compiler.
- Handoff is explicit, aligned with the composability principle.
- Works for future drivers without inventing a framework.

**Bad:**
- Requires browser-use to remember the end-of-session offer.
- `browser-domain-memory` needs two modes: read before run, tidy after run.

**Verdict:** strongest v1.

### Option C: Stop hook invokes browser-domain-memory

**Description:** A lifecycle hook fires after browser work and asks `browser-domain-memory` whether
to capture.

**Good:**
- Reliable end-of-run trigger.
- Reduces driver forgetfulness.

**Bad:**
- Hook setup is machinery.
- Hooks may fire after unrelated browser-use tasks.
- Needs filtering to avoid annoying prompts.
- Filtering becomes policy machinery fast.

**Verdict:** keep as later option. Not v1 unless manual capture is too easy to forget.

### Option D: user-invoked save command

**Description:** User says "save what you learned" after a run. `browser-use` calls
`browser-domain-memory`.

**Good:**
- No surprise prompts.
- No hook or automatic decision.
- Great escape hatch.

**Bad:**
- Weak compounding; depends on user remembering.
- Fails the "future agent gets faster" loop when user is tired.

**Verdict:** include as a manual path, not the only path.

### Option E: append-as-you-go

**Description:** Browser-use writes ledger entries during the run whenever it acts.

**Good:**
- Nothing to remember at the end.

**Bad:**
- Records ordinary noise.
- Turns history into a trace.
- Requires redaction pressure on every action.
- Encourages schema creep.

**Verdict:** reject.

### Recommended capture shape

Use **Option B + Option D**:

- `browser-use` reads domain memory before acting.
- `browser-use` drives live.
- If reusable knowledge appeared, `browser-use` explicitly calls `browser-domain-memory` in `tidy`
  mode.
- `browser-domain-memory` proposes clean Auth Pointer, Browser Runbook, Browser Gotcha, Run Outcome,
  or Scratch Evidence updates.
- User approves, edits, or discards.
- User may also ask "save what you learned" manually.
- No raw transcript write.
- No automatic "capture everything."
- No Stop hook in v1.

## Consult gate: browser-use stays freestyle until friction

Nathan's correction: `browser-use` should not become a memory-bound browser orchestrator. It should
drive freely by default and consult `browser-domain-memory` only when the task starts acting like a
known domain problem.

### Decision

Default to **friction-triggered consult**:

- Do not preflight ordinary browsing.
- Do not check memory just because a domain exists.
- Consult `browser-domain-memory` when the run hits friction or the user signals repeatability.
- Allow early consult for obvious login-heavy portals.

### Acceptance criteria for the consult gate

`browser-use` should consult `browser-domain-memory` when at least one is true:

- Login, SSO, MFA, account picker, tenant picker, or 1Password auth is needed.
- The user says or implies prior repetition: "again", "same as before", "we've done this", "timesheet",
  "portal", "admin", "bank", "payroll", "invoice", or similar domain-work language.
- The agent gets stuck, loops, retries, or cannot find the next page action after ordinary inspection.
- The page presents a fork where a wrong choice could waste time or change account/context.
- The action is submit/destructive/financial/admin and prior gotchas would materially reduce risk.
- The user asks to save, remember, reuse, or build from what just happened.

`browser-use` should not consult `browser-domain-memory` when all are true:

- The task is ordinary browsing, search, reading, or one-off inspection.
- The page is already clear from the current snapshot.
- No auth, portal flow, destructive action, or repeated workflow is involved.
- The user did not imply this is a known/repeated domain.

### Boundary wording

Put the rule in `browser-use` as a tiny section, not a workflow rewrite:

```md
## Domain Memory

Drive freely by default.
Call `browser-domain-memory` only when login/auth, portal friction, repeated workflow language, or
dangerous submit context makes prior domain knowledge useful.
You may hand over short redacted observations during a confusing run.
At the end, ask `browser-domain-memory` whether useful learning should become durable memory.
Do not create runbooks or decide durable memory here.
```

### Open brainstorm item

The fresh brainstorm should refine these gate criteria against concrete scenarios and decide whether
the gate lives entirely in prose or earns one tiny helper prompt/script later.

## Scratch format: Chrome Recorder-shaped, not replay-owned

Research update: Chrome DevTools Recorder exports and imports JSON user flows. The Chrome
DevTools-team-maintained `@puppeteer/replay` package parses the same user-flow shape and can replay
or transform it. That makes Chrome Recorder JSON a useful scratch format because agents and tools may
already recognize it.

### Decision

Use a **hybrid scratch model**:

- Durable browser memory stays prose.
- Scratch Evidence may use Chrome Recorder-shaped JSON.
- Store Scratch Evidence only under a `scratch/` area.
- Retain Scratch Evidence when it has evidence value.
- Redact secret values before write.
- Do not expose a replay command in v1.
- Treat Scratch Evidence as source evidence for browser capture, not trusted memory.
- Keep selectors in Scratch Evidence, not Browser Runbooks.

Candidate layout:

```
domains/<domain>/
  auth.md
  gotchas.md
  runbooks/<flow>.md
  runbooks/<flow>.runs.jsonl
  scratch/YYYY-MM-DD-HHMMSS-<flow-slug>.json
```

Recorder-shaped scratch can include:

- `title`
- `steps`
- `navigate`
- `click`
- `change`
- `waitForElement`
- `selectors`
- `assertedEvents`

Secret rule:

- Never store password, OTP, cookie, token, or bearer values.
- Use shape-only placeholders such as `redacted:password-field`, `redacted:totp-field`, or
  `shape:6-digit-otp`.
- Scratch Evidence may be valid-shaped JSON while intentionally not replayable.

Run Outcome sidecar:

```json
{"at":"2026-05-30T14:23:17+10:00","result":"success","evidence":"../scratch/2026-05-30-142317-submit-timesheet.json"}
```

Why this matters:

- Browser Runbooks stay clean prose.
- Run Outcomes track success/failure dates and evidence.
- Repeated successful outcomes can mark a Machine Play Candidate.
- Future machine-play tooling has evidence without making v1 executable.

### Store helper implication

The v1 helper can do mechanical reads over scratch without owning capture judgment:

```text
browser-domain-memory scratch summarize <file>
browser-domain-memory scratch fields <file>
browser-domain-memory scratch pages <file>
browser-domain-memory scratch auth-hints <file>
```

Allowed helper work:

- parse Recorder-shaped JSON
- count steps
- group steps by action type
- list changed fields
- list clicked labels/selectors
- list page/navigation events
- identify likely auth/MFA/account-picker markers by simple matching

Not allowed in v1:

- replay
- self-heal
- selector validation
- runbook generation without model judgment
- selectors as durable instructions

### Agent-playable vs machine-playable

V1 Browser Runbooks are **agent-playable**:

- reasoning agent reads prose path
- live Chrome inspection stays required
- Scratch Evidence is available as clues
- selectors are evidence, not instructions

Future machine-play stays alive through **Machine Play Candidates**:

- repeated workflow
- retained Scratch Evidence
- successful Run Outcomes in `<flow>.runs.jsonl`
- clear repetition value

Do not create a Machine Playbook type in v1.

### Puppeteer skill leverage

Fresh brainstorm should explore a possible `puppeteer` capability as an adjacent helper, not as the
browser-domain-memory runtime.

Possible useful jobs:

- inspect Chrome Recorder JSON shape
- stringify Recorder-shaped scratch into readable summaries
- validate that scratch parses with `@puppeteer/replay`
- transform scratch into a human-readable draft for the agent to edit
- explain why a scratch file is not replay-safe

Non-goals:

- no v1 replay runner
- no Puppeteer replacement for `browser-use`
- no headless browser default for login-heavy sites
- no generated CI tests

Boundary:

`browser-use` remains live Chrome driver. `browser-domain-memory` owns compound browser knowledge.
A future `puppeteer` skill may provide mechanical Recorder/Puppeteer tooling, but does not own memory
or live browser work.

### Capture prompt language

Keep this exact idea, but not necessarily exact wording:

> "I found a few things that may save future browser work on this domain. Want me to tidy them into
> domain memory?"

If yes:
- show proposed entries
- show proposed gotchas
- ask for approve/edit/discard
- write only approved clean memory

If no:
- write nothing

If routine:
- do not ask

### Capture decision rule

Ask to capture only when at least one happened:

- user chose between auth/account/tenant/MFA forks
- agent found a stable path through a confusing flow
- agent learned field names or form order needed for future runs
- agent learned a submit confirmation or destructive-action guard
- agent hit a trap future runs should avoid
- user explicitly says the task repeats

Do not ask for:

- normal navigation
- one-off research
- ordinary clicks
- scrolls
- retries
- snapshots
- transient selectors
- failed guesses, unless the failure is a future trap

### Rejected capture complexity

- No capture compiler.
- No trace-to-ledger converter.
- No automatic transcript ingestion.
- No hook filter policy in v1.
- No confidence score.
- No promotion lifecycle.
- No separate browser `capture` skill name.

## Open for brainstorm (the only real questions left)
1. **Confirm v1 surface:** `browser-use` + `browser-domain-memory`, no `browse`, no `play`.
2. **`browser-domain-memory` layout shape** + exactly how "do not capture ordinary noise" is phrased.
3. **End-of-session cleanup UX** — how `browser-use` asks `browser-domain-memory` to tidy a messy session
   into Durable Browser Knowledge.
4. **Fan-out rule:** handed-to skill hands back to driver. For v1, no third-skill calls.

## Rejection Summary (heavy-phase survivors cut by the lean reframe)

| Idea | Reason |
|------|--------|
| Deterministic play walker / tape schema | Lean reframe: LLM reads domain memory, drives live. No engine. |
| Constraint+witness self-healing (#3) | Interpreter-model healing — complexity. Cut. |
| Checkable-plan: dry-run + criticality (#4) | Collapsed to "stop on miss + type-to-confirm submit". |
| Predicate selection (pressure-test) | Out of scope; live `browser-use` task. Prose line, not schema. |
| Compounding: composition + fixtures (#7) | BA-plugin seed. Cut to retained Scratch Evidence and Run Outcomes. |
| Computer-task memoization (#5) | Premature abstraction. It's a browser skill. |
| Network-layer capture (T3) | Never reached for. Gone. |
| Two-skills re-litigation (#8) | Resolved as `browser-use` + `browser-domain-memory`. |
| Recording→skill auto-compiler (#2 risk) | No auto-emit; cleanup is a prose step with the agent. |

## Provenance
Heavy thesis + research: side-quest-engineering/docs/brainstorms/2026-05-29-001-*.md and
docs/research/2026-05-29-lean-record-replay-browser-automation.md. steipete patterns: github.com/
steipete/agent-scripts (browser-use, one-password, agent-transcript, github-author-context, obsidian).
