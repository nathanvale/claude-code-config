---
date: 2026-06-11
type: feat
title: Skill-observability v0 — facade + capture adapters
origin: docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md
status: ready
depth: standard
execution_posture: redaction-test-first
supersedes: this file's prior revision (thin prose skill + inline redaction)
---

# feat: Skill-observability v0 — facade + capture adapters

## Summary

Capture a durable, structured observability record each time a skill run reaches its close, and write it to a gitignored `.skill-feedback/` inbox the user reads by hand. The record is shaped like an OpenTelemetry `gen_ai.evaluation.result` event (`name`, `score`, `label`, `explanation`, run-id correlation) plus warehouse-style tags (skill version, git SHA, model, outcome, token usage) — aligning the pilot with how Claude Code already emits telemetry and how Anthropic stores eval rows internally.

`skill-feedback` is a **runtime-backed Bun workspace package**, not a prose skill. It **reuses** the existing `@side-quest/cli-command-facade` infrastructure (the Facade) rather than inventing one. Per-harness telemetry differences (Claude Code OTel spans vs Codex `codex exec --json` events) are absorbed by a **CaptureAdapter** seam (the Adapter pattern), with **both** adapters shipping in v0 so the second implementation proves the seam holds. Redaction, the gitignore fail-closed gate, deterministic timestamps, and the untrusted-evidence marker are carried as first-class, code-enforced, test-backed units.

This revision supersedes the prior thin-prose plan. It moves the safety contract from prose-plus-fixtures into a typed runtime package on rails the repo already runs (fallow, test-runner), routes the CLI through `create-cli`'s facade-backed lane, and gates shipping on the existing `cli-execution-auditor`.

---

## Problem Frame

Skill runs finish with useful but fleeting evidence — what confused the agent, what the user corrected, what context was missing — and that evidence dies in the transcript. The origin brainstorm proposes a durable learning loop; its 2026-06-11 review flagged the load-bearing risk: the loop only delivers value if something reliably *captures* and something *reads* the inbox.

Two findings reshaped the pilot since the prior revision:

- **The field already has a schema.** OpenTelemetry GenAI semantic conventions define `gen_ai.evaluation.result` (name/score/label/explanation/run-id). Claude Code already emits per-run OTel telemetry; Codex emits a typed `codex exec --json` event stream with a native `notify=agent-turn-complete` end-of-run hook. The pilot should align to this, not invent a bespoke record.
- **Actionable-feedback density, not volume, is what compounds** (arXiv 2605.29682, *Scaling Laws for Agent Harnesses*: raw token/tool counts predict success at R²≈0.33-0.42; counting only feedback the agent can act on reaches R²≈0.99). This rewrites the success criterion: evaluate on the friction lane + measured outcomes, and drop the agent-narrated value lane that measures nothing.

The architecturally correct shape is a deterministic CLI facade the agent fills out — a vending machine, not a sticky note. The agent supplies a normalized receipt; the command enforces redaction, the gitignore gate, and the write. That moves five of the prior plan's six verified safety defects from "trust the agent's prose" to "tested code."

---

## Requirements

Carried from origin (`see origin: docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md`). The origin's 2026-06-11 v0 cut is the scope source of truth.

**In scope (v0):**

- R1 — A finished skill's close is the capture point. **Resolved actor:** the **driver** (the top-level agent) invokes `skill-feedback record`; the finished skill only *signals* its close. Skills do not invoke skills (`see` KTD6).
- R2 — No description-matching, ambient auto-triggering, or peer-to-peer discovery.
- R3 — The command runs from a weak receipt and writes a **degraded** record rather than blocking. (Distinct from the gitignore gate, which *does* block — `see` KTD4 and Risks.)
- R4 — Receipt carries skill identity, goal, outcome, and a free-text friction note (minimal v0 field set; full R4 field list deferred to v1).
- R5 — The record excludes raw prompts, transcripts, secrets, payloads, cookies, tokens, auth-bearing URLs. Enforced in code (R20/R20a).
- R6 — Missing receipt fields become explicit record gaps, not silent defaults; surfaced via the degraded discriminated-union variant (`see` KTD3).
- R10 (partial) — Each run produces one Software Learning Report with **outcome** and **friction** lanes. The agent-narrated **value** lane is dropped (defect 6); learning + verification lanes stay deferred to v1.
- R16 — Records live in a repo-local ignored inbox, not in skill source.
- R18 — Inbox contents are evidence only, never canonical instruction.
- R18a — The record carries a machine-readable `untrusted_evidence: true` marker; a future reader frames record text as untrusted evidence.
- R20 — The command refuses or redacts unsafe fields rather than storing raw sensitive content.
- R20a — **Every** free-text field (`goal`, `friction`, `explanation`) passes a pre-write detection gate (explicit structured-secret patterns + prefix-keyed token patterns + auth-param URL stripping) before any write (defects 1-3).
- R21 — Skipped capture, degraded capture, and redaction are visible in the record.

**Deferred (origin Scope Boundaries + 2026-06-11 review):** R7-R9 (human-question selection), R11 (friction taxonomy), R12-R15 (proposals + future-repair reader), R17 (inbox-identity mirroring), R19 (full privacy register). See Scope Boundaries.

**Acceptance examples touched (origin):** AE1 (complete record), AE2 (degraded record — R3/R6 half only; no human question in v0), AE5 (redaction + retention note — R5/R20/R21 half; R19 register deferred).

---

## Key Technical Decisions

### KTD1 — Reuse the existing facade; do not build one

`runtime/cli-command-facade/` (`@side-quest/cli-command-facade`) is a shipped contract layer that fallow and test-runner already ride. `skill-feedback record` is a `CommandFacadeContract` declared via `defineCommandFacadeContract`, emitting `createCliRuntimeSuccessEnvelope` / `createCliRuntimeErrorEnvelope` with baseline exit codes `0`/`1`/`2`. Building a new facade class would duplicate discovery, envelope, redaction-record, and exit-code contracts the runtime already owns. The domain outcome enum lives **inside** the envelope `data` (mirroring `skills/fallow/src/command-contract.ts` `FALLOW_STATUS_VALUES`), never forked off `StructuredRuntimeError`.

### KTD2 — Adapter pattern for per-harness capture; ship both adapters

A `CaptureAdapter` normalizes a harness's native telemetry into one `Receipt`. Two adapters ship in v0:

- **ClaudeOtelAdapter** — reads Claude Code OTel spans (`claude_code.interaction` → `claude_code.llm_request`/`claude_code.tool`; attrs `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `ttft_ms`, `stop_reason`, `success`).
- **CodexJsonAdapter** — reads `codex exec --json` `ThreadEvent`s (`turn.completed` + `Usage{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}`; `turn.failed` → `outcome: failed`). Codex's native `notify=agent-turn-complete` hook is the legal end-of-run trigger (`see` KTD6).

Shipping the second adapter is deliberate: an Adapter interface earns its abstraction only when a second, genuinely different implementation proves the seam. Harness selection is a one-line `selectAdapter(harness)` switch in the core module — **never inside the facade handler**, which stays harness-agnostic.

### KTD2a — Receipt is flat; trust boundary is the `NARRATED_FIELDS` constant (grilled 2026-06-11)

The `Receipt` is one flat object (mirroring `RunOutcome` in `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts`), not a nested `{ telemetry, narrated }` shape — nesting would be the repo's first nested-trust record and cuts against KTD3's flat-union commitment. The trust boundary is a single exported constant `NARRATED_FIELDS = ['goal', 'friction', 'explanation']`. Adapter-derived telemetry (usage, outcome, model, git_sha, generated_ts) is trusted and never redacted; the narrated fields are the only ones the redactor scrubs. This makes "telemetry untouched, narration redacted" a unit-testable invariant and makes the git_sha false-positive guard structural, not pattern-luck.

**Merge seam:** the adapter emits a telemetry-only `CaptureResult`; the driver supplies narrated fields as CLI flags (`--goal`/`--friction`/`--explanation`, using the facade `flags` mechanism per `skills/fallow/src/command-contract.ts`); `record` merges them into the flat Receipt and redacts the narrated flags at the CLI boundary where the facade redactor already runs. The adapter never sees narration — it stays purely mechanical and fixture-testable.

### KTD3 — Degraded capture as a discriminated union (Null Object), not a class

`CaptureResult = { kind: "receipt"; receipt } | { kind: "degraded"; receipt; degraded: DegradedReason[] }`, modeled on the `Failure<A>` union in `skills/browser-use/src/browser-use-core.ts`. This is the honest-missing-data representation R21 needs — degraded capture is a typed, visible variant, not a silent default or a polymorphic Null Object hierarchy.

### KTD4 — Hard pre-write gitignore gate, exit-code-correct

The command refuses to write unless `git check-ignore --quiet .skill-feedback/` returns **exit 0**. Every non-zero status refuses — exit 1 (not ignored) **and** exit 128 (not a git repo / bad path) alike. The gate predicate must not collapse to a bare boolean that cannot represent the error case (defect 4). String-grep of `.gitignore` is disallowed: a negation entry (`!.skill-feedback/`) or `.git/info/exclude` override fools a grep while `git` does not. The gate and redaction run on **every** write path, including the degraded branch.

### KTD5 — Deterministic record; passed-in timestamps

Timestamps are inputs, never ambient-clock reads. Trends derive from record **order**, not the wall clock (mirrors `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts`). This keeps records reproducible from fixtures and lets the redaction suite assert byte-identity on structured fields.

### KTD6 — Harness hooks fire `record`; detection is harness-level, no per-skill breadcrumb (regrilled 2026-06-11, supersedes prior driver-recall design — see ADR-0014)

Capture fires from the harness end-of-run hook on both harnesses, not from an agent remembering to call `record`. Agent recall is ~20-50% reliable (single-skill) / ~0% (multi-skill); the hook path is 84-100% (`docs/research/2026-05-30-skill-composability-handoff-observability.md`, bug #20986). A finished skill still must not call `Skill("skill-feedback", …)` itself (runbook + fallow safety + composition research all forbid skill-to-skill).

**Detection is harness-level — no `## Close` breadcrumb, zero per-skill maintenance:**
- **Codex** — `codex exec --json` emits documented typed events: `turn.completed` (+ `Usage` struct), `turn.failed` → `outcome: failed`, and `item.completed` with typed `ThreadItemDetails` (`McpToolCall`, `CommandExecution`, …). The `notify=agent-turn-complete` hook is the legal trigger. First-class, documented (verified `/openai/codex` 2026-06-11).
- **Claude** — the Stop hook fires every turn and exposes only `transcript_path` (8 documented fields, no tool-call list). Detection parses that JSONL for a completed `Skill` tool call. The transcript JSONL shape is **undocumented** (verified against code.claude.com/docs 2026-06-11), so the Claude adapter carries a drift smoke-test that fails loud if the format changes.

`## Close` is dropped entirely — detection no longer needs a skill to announce itself. Optional per-skill close enrichment (clean/failed/handoff signal) is a v1 fork, left open, not built.

### KTD7 — Redaction is content-owned; Strategy seam deferred but stubbed

The always-redact set is owned by `skills/agent-reliability-guardrails/references/logging-redaction-rules.md` (cite, do not re-derive). v0 implements **one** redaction policy as explicit, testable patterns — structured-secret shapes (bearer, JWT, PEM, DSN) **plus** prefix-keyed cloud tokens (`ghp_`, `xoxb-`, `AKIA`, `sk-`, `glpat-`) — with no undefined "entropy scan" (defects 2-3). Per-harness swappable policy is a GoF **Strategy**, deferred: the facade already exposes the hook (`CliDiagnosticRedactor`, `runtime/cli-command-facade/src/cli-diagnostics.ts`), and the seam is marked at `prototypes/skill-feedback-architecture/redaction-strategy.stub.ts`. Promotion trigger: a harness needs a stricter scrub than the shared set.

### KTD8 — Storage owner is context-advisor's storage-routing

The inbox is learned mutable skill state + append-only event history. `skills/context-advisor/references/storage-routing.md` owns the rule (store outside skill source, prefer repo-local ignored state, allow-list schema / **reject** unknown fields — not silently drop, name data class + retention + redaction owner). Cite it; do not copy the contract.

### Patterns rejected as YAGNI (stated so nobody adds them)

- **Factory / Abstract Factory** — adapter selection is a one-line switch until adapter #3.
- **Builder** — the Receipt is a flat literal validated against the schema.
- **Template Method** — the `validate → redact → gate → write` pipeline is a 4-line straight function, not an inheritance skeleton.
- **Chain of Responsibility** — the gate stages are fixed-order, not dynamically composed handlers.
- **Observer** — `record` is a synchronous call; pub/sub would invert a simple call for zero benefit.

---

## High-Level Technical Design

```mermaid
flowchart TB
  subgraph Harness capture
    A1[Claude Code OTel spans] --> AD1[ClaudeOtelAdapter]
    A2["codex exec --json ThreadEvents"] --> AD2[CodexJsonAdapter]
  end
  AD1 --> SEL{"selectAdapter(harness)"}
  AD2 --> SEL
  SEL --> R["CaptureResult\n receipt | degraded"]
  R --> CMD["skill-feedback record\n(CommandFacadeContract on @side-quest/cli-command-facade)"]
  CMD --> V[validate against allow-list schema]
  V --> RED["redact ALL free-text fields\n(goal, friction, explanation)"]
  RED --> G{"git check-ignore --quiet .skill-feedback/\nexit 0 ?"}
  G -->|exit 0| W[write record 0600 to .skill-feedback/ 0700]
  G -->|exit 1 OR 128| REF[refuse + StructuredRuntimeError repair hint] --> STOP[no file written]
  W --> ENV["CliRuntimeSuccessEnvelope<SoftwareLearningReport>"]
  ENV --> H[human reads record by hand]
```

Record shape (directional, not implementation spec) — one flat record inside the success envelope's `data`:

```
gen_ai.evaluation.name: skill-feedback
untrusted_evidence: true          # R18a machine-readable marker
generated_ts: <passed-in ISO>     # KTD5 — never ambient clock
skill: <id>                       # warehouse tag
skill_version: <semver|sha>       # warehouse tag
git_sha: <HEAD sha>               # warehouse tag
model: <id>                       # warehouse tag
score.value: 0..1 | null
score.label: confirmed | failed | ambiguous   # domain outcome enum (inside data)
usage: { input_tokens, output_tokens, cache_read_tokens }  # from adapter
degraded: false | true            # R21
redactions: <count>               # R21
explanation: <free-text — redacted>
## Outcome lane
## Friction lane  (free-text — redaction applies)
## Gaps           (R6 — missing receipt fields listed explicitly)
```

---

## Output Structure

```
skills/skill-feedback/
  package.json                # name skill-feedback-scripts, private, type module,
                              #   dep @side-quest/cli-command-facade: workspace:*,
                              #   scripts: test, typecheck
  tsconfig.json               # strict, types ["bun"], extends ../../tsconfig.base.json
  src/
    command-contract.ts       # domain enums + defineCommandFacadeContract (Contract owner)
    skill-feedback-runner.ts  # Runtime + createDefaultSkillFeedbackRuntime + CLI entry + engine
    capture-adapters.ts       # CaptureAdapter interface + ClaudeOtel + CodexJson + selectAdapter
    redaction.ts              # explicit secret patterns + prefix-keyed tokens + auth-URL strip
    command-contract.test.ts  # schema / degraded / reject-unknown / determinism / marker
    skill-feedback.test.ts    # leak fixtures (assert on-disk bytes) + gitignore-gate + perms
    capture-adapters.test.ts  # OTel-span → Receipt, Codex-json → Receipt, degraded paths
  references/
    redaction.md              # cites logging-redaction-rules owner; v0 patterns + retention note
    report-shape.md           # record template + Truth Stance / untrusted-evidence header
  SKILL.md                    # trigger, boundary, owner paths, fail-closed gate, next safe action
  PROVENANCE.md               # lineage: fallow anatomy, skill-self-audit-loop truth-stance, origin

package.json                  # + skills/skill-feedback in workspaces.packages (U1)
.gitignore                    # + .skill-feedback/ block (U1)
skills/fallow/SKILL.md        # + ## Close signal section (U7)
prototypes/skill-feedback-architecture/redaction-strategy.stub.ts  # (exists — Strategy seam marker)
```

The per-unit `**Files:**` sections are authoritative; this tree is a scope declaration.

---

## Implementation Units

Units run U1 → U7. Gaps in numbering are intentional (U-IDs are never renumbered).

### U1. Workspace scaffold, gitignore entry, and registration

**Goal:** A runtime-backed `skill-feedback` package exists, registered in the workspace, with the inbox un-committable.

**Requirements:** R16, R18 (precondition).

**Dependencies:** none — land first.

**Files:**
- `skills/skill-feedback/package.json` (create)
- `skills/skill-feedback/tsconfig.json` (create)
- `package.json` (modify — add `skills/skill-feedback` to `workspaces.packages`, alphabetical after `skills/fallow`)
- `.gitignore` (modify)

**Approach:** Mirror `skills/fallow/` anatomy: `package.json` (`name: skill-feedback-scripts`, `private`, `type: module`, dep `@side-quest/cli-command-facade: workspace:*`, scripts `test` / `typecheck`), strict `tsconfig.json` with `types: ["bun"]`. Add the package to root `workspaces.packages`. Add a commented, path-scoped `.gitignore` block mirroring the existing `skills/fallow/scripts/.fallow/` and `.review/` precedents:
```
# Skill feedback inbox (generated, evidence-only, never canonical)
.skill-feedback/
```

**Patterns to follow:** `skills/fallow/package.json`, `skills/fallow/tsconfig.json`; existing generated-state entries in root `.gitignore`.

**Test scenarios:** `Test expectation: none — scaffolding/config. Verified by U6's gitignore-gate test (the entry exists) and by check:workspace-facade resolving the workspace dep.`

**Verification:** `git check-ignore .skill-feedback/probe` resolves; the package resolves under the workspace (`check:workspace-facade` passes); `tsc` typechecks the empty `src/`.

---

### U2. Receipt schema, record shape, and domain contract

**Goal:** The receipt allow-list and the `SoftwareLearningReport` record shape are typed, testable constants owned by `command-contract.ts`.

**Requirements:** R4 (minimal field set), R6, R10 (outcome + friction lanes), R18a (untrusted marker), R21 (degraded + redaction count fields).

**Dependencies:** U1.

**Files:**
- `skills/skill-feedback/src/command-contract.ts` (create — domain enums + `defineCommandFacadeContract`)
- `skills/skill-feedback/src/command-contract.test.ts` (create)

**Approach:** Define the v0 receipt allow-list as a **flat** set of typed constants (mirror `RunOutcome`, not a nested shape — KTD2a) — `skill`, `goal` (free-text), `outcome` (`confirmed`/`failed`/`ambiguous`), `friction` (free-text), `explanation` (free-text, optional), warehouse tags (`skill_version`, `git_sha`, `model`, `usage`), plus passed-in `generated_ts`. Export `NARRATED_FIELDS = ['goal', 'friction', 'explanation']` — the single trust-boundary constant the redactor (U6) iterates; everything not in it is adapter-trusted telemetry. **Reject** unknown fields (storage-routing rule — not silently drop). Define the `SoftwareLearningReport` record including `untrusted_evidence: true` (R18a), `degraded`, and `redactions` count (R21). Carry the outcome enum inside the facade envelope `data` (mirror `FALLOW_STATUS_VALUES`). Declare the `record` command via `defineCommandFacadeContract` (Contract owner). No redaction or writing here — schema + shape only. Read `skills/create-skill/references/skill-design-decision-runbook.md` before authoring (AGENTS.md hard rule).

**Patterns to follow:** `skills/fallow/src/command-contract.ts` (enum constants + `defineCommandFacadeContract`); `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts` (flat record, passed-in ts, 3-way outcome).

**Test scenarios:**
- Happy path: a complete valid receipt parses into the full field set.
- Edge — degraded: a receipt with only `skill` + `goal` + `outcome` parses, with `friction` listed as a gap (`Covers R6.`).
- Edge — reject unknown: a receipt carrying an unexpected key is **rejected** (fail-loud), not silently dropped or stored.
- Determinism: same receipt + same passed-in `generated_ts` produces byte-identical structured record fields across two runs, including a fresh-process run (no module-level cached state) (`Covers KTD5.`).
- Marker present: every produced record carries `untrusted_evidence: true` (`Covers R18a.`).
- Outcome enum lives in `data`: the record's outcome is inside the envelope `data`, not on `StructuredRuntimeError`.

**Verification:** Schema suite green via `skills/test-runner/scripts/test-runner.sh`; `tsc_check` MCP runner clean.

---

### U4. CaptureAdapter seam and both harness adapters

**Goal:** Claude OTel telemetry and Codex `--json` events both normalize into one `CaptureResult`, proving the Adapter seam.

**Requirements:** R1 (capture point), R3 (degraded variant), R4 (receipt fields from real telemetry), R21.

**Dependencies:** U2.

**Files:**
- `skills/skill-feedback/src/capture-adapters.ts` (create — `CaptureAdapter` interface, `ClaudeOtelAdapter`, `CodexJsonAdapter`, `selectAdapter`)
- `skills/skill-feedback/src/capture-adapters.test.ts` (create)

**Approach:** Define `CaptureAdapter = { harness: HarnessId; capture(raw): Promise<CaptureResult> }` and the `CaptureResult` discriminated union (KTD3). `ClaudeOtelAdapter` maps `claude_code.*` span attrs → Receipt fields; `CodexJsonAdapter` maps `turn.completed` + `Usage` → Receipt, `turn.failed` → `outcome: failed`. Missing/partial telemetry yields the `degraded` variant with explicit `DegradedReason[]`, never a silent default. `selectAdapter(harness)` is a one-arm-per-harness switch (not a Factory). Adapters take the injected `Runtime` (U5 seam) so tests drive them with fixture telemetry, no live harness needed.

**Patterns to follow:** `skills/browser-use/src/browser-use-core.ts` (`Failure<A>` union shape for `CaptureResult`); `skills/browser-use/src/browser-use-transport.ts` (neutral-input → domain-result mapping).

**Test scenarios:**
- Claude happy path: a fixture `claude_code.interaction` span tree → a complete Receipt with usage tokens populated.
- Codex happy path: a fixture `turn.completed` event + `Usage` → a complete Receipt.
- Codex failure: a `turn.failed` event → `outcome: failed`.
- Degraded — Claude: a span tree missing token attrs → `{ kind: "degraded" }` with a `DegradedReason` naming the missing field (`Covers R6/R21.`).
- Degraded — Codex: a truncated event stream → degraded with reason.
- Selection: `selectAdapter("claude-otel")` and `selectAdapter("codex-json")` return the right adapter; an unknown harness is rejected (not silently defaulted).

**Verification:** Adapter suite green; both adapters produce the identical `Receipt` shape from different inputs (the seam proof).

---

### U6. Redaction gate + hard gitignore pre-write check

**Goal:** No secret reaches a written record, and no record is written while the inbox is committable.

**Requirements:** R5, R20, R20a, R16 (runtime half), R21.

**Dependencies:** U1 (ignore entry), U2 (schema), U4 (receipt source).

**Files:**
- `skills/skill-feedback/src/redaction.ts` (create — explicit patterns)
- `skills/skill-feedback/src/skill-feedback-runner.ts` (create — `Runtime`, `createDefaultSkillFeedbackRuntime`, CLI entry, `validate → redact → gitignoreGate → write` pipeline)
- `skills/skill-feedback/src/skill-feedback.test.ts` (create — leak fixtures asserting on-disk bytes)
- `skills/skill-feedback/references/redaction.md` (create — cites owner; v0 patterns + retention note)

**Approach:** Implement redaction as **explicit, testable patterns** over the fields named by the `NARRATED_FIELDS` constant (`goal`, `friction`, `explanation`) before any write (defect 1, R20a). The Receipt is flat (KTD2a) so iteration is over those top-level keys, not a recursive walk; telemetry fields (`usage`, `git_sha`, `model`, `outcome`) are adapter-trusted and never scrubbed — this makes the git_sha false-positive guard structural. structured-secret shapes (bearer token, JWT `eyJ…`, PEM block, DSN with inline creds) **plus** prefix-keyed cloud tokens (`ghp_`, `xoxb-`, `AKIA`, `sk-`, `glpat-`) **plus** auth-param URL stripping (`?token=…`, `#frag`, non-http schemes dropped). No undefined "entropy scan" (defect 2); if a future shape needs entropy detection, define threshold/alphabet/window in code with a test. Cite `skills/agent-reliability-guardrails/references/logging-redaction-rules.md` as the always-redact owner; reuse the recursive-redact approach from `skills/browser-use/src/browser-use-core.ts`.

The gitignore gate uses `git check-ignore --quiet .skill-feedback/` and passes **only on exit 0**; exit 1 **and** exit 128 both refuse with a `StructuredRuntimeError` repair hint (defect 4). The gate's ignore-check is an injectable `Runtime` method returning the **exit status** (not a bare boolean), so the 128 / not-a-repo case is representable and testable; the production path shells out to `git check-ignore`. Resolve `.skill-feedback/` relative to the repo root, not CWD, so checked-path equals written-path under nested invocation. The gate + redaction run on **every** write path including the degraded branch (no early-return bypass). Record `redactions` count (R21). Files written `0600`, inbox dir `0700`, with restrictive perms set at create (no create-then-chmod world-readable window).

`references/redaction.md` carries a one-line retention note: inbox files are transient evidence; purge `.skill-feedback/` after each review session.

**Execution note:** Write the secret-leak fixture tests first (red) — asserting on the **bytes written to disk**, not the in-memory object (defect 5) — then implement the gate to pass.

**Patterns to follow:** `skills/browser-use/src/browser-use-core.ts` (recursive redaction); `skills/test-runner/src/test-runner.ts` (the `Runtime` + `createDefault…Runtime(overrides)` injection seam — copy verbatim for fs/clock/git-check); `runtime/cli-command-facade/src/testing.ts` `assertNoRuntimeContractFixtureLeaks` (throw-on-leak test shape).

**Test scenarios:**
- Leak — bearer token in `friction`: the written **file on disk** never contains the token; `redactions` ≥ 1 (`Covers AE5 / R20/R21.`).
- Leak — JWT (`eyJ…` three-segment) in `friction`: redacted on disk.
- Leak — PEM block (`-----BEGIN PRIVATE KEY-----`) in `friction`: redacted on disk.
- Leak — DSN `postgresql://user:secret@host/db` in `friction`: credential stripped on disk.
- Leak — prefix-keyed tokens (`ghp_`, `xoxb-`, `AKIA`, `sk-`, `glpat-`) in `friction`: each redacted on disk (`Covers defect 3.`).
- Leak — `goal` field: a token in `goal` (not just `friction`) is redacted on disk (`Covers defect 1 / R20a all-fields.`).
- Leak — `explanation` field: a token in `explanation` is redacted on disk.
- False-positive guard: a legitimate 40-char git SHA / content hash in `friction` is **not** over-redacted (preserves the friction signal).
- Pre-redaction containment: a schema-reject of a receipt whose `friction` carries a token does **not** echo the raw token in the error output.
- Determinism: clean free text passes through unchanged, `redactions: 0`.
- Gate — fail closed (complete path): ignore-check stubbed to exit 1 → refuse, no file created, repair hint returned.
- Gate — fail closed (degraded path): same with a degraded receipt → refuse, no file (gate not bypassed on the degraded branch).
- Gate — error status: ignore-check stubbed to exit **128** (not-a-repo) → refuse, no file (`Covers defect 4.`).
- Gate — negation: a tmp repo with `!.skill-feedback/` → `git check-ignore` reports not-ignored → refuse (predicate is not a naive grep).
- Gate — real git integration: against a tmp `git init` repo with a real `.gitignore`, the real `git check-ignore` shell-out passes (exit 0) and refuses without the entry — exercises the production path, not just the stub (`Covers defect 5 confidence gap.`).
- Perms: after a successful write, file mode is `0o600` and inbox dir mode is `0o700`, set at create.
- Visibility: a redacted record carries a non-zero `redactions` count (`Covers R21.`).
- Malformed timestamp: a non-ISO / missing `generated_ts` is rejected before write (no injection into frontmatter).

**Verification:** Suite green via `skills/test-runner/scripts/test-runner.sh` including all on-disk leak fixtures and the exit-128 + real-git cases; `tsc_check` clean. Manual: a hand-crafted receipt with an embedded token writes a record with the token absent on disk and the redaction noted.

---

### U7. Author `SKILL.md`, wire fallow's close, and pass create-cli + cli-execution-auditor

**Goal:** The command is invocable and discoverable; fallow signals its close for the driver to act on; the facade CLI passes its contract and audit gates.

**Requirements:** R1, R2, R3, R18a, R21; KTD6.

**Dependencies:** U2, U4, U6.

**Files:**
- `skills/skill-feedback/SKILL.md` (create)
- `skills/skill-feedback/references/report-shape.md` (create — record template + Truth Stance / untrusted-evidence header)
- `skills/skill-feedback/PROVENANCE.md` (create)
- Claude Stop-hook handler + Codex `notify` handler wiring (create — each shells out to `skill-feedback record`; Claude handler carries the transcript-parse drift smoke-test)

**Approach:** Author `SKILL.md` per the runbook and `create-cli`'s facade-backed lane: first screen carries trigger, boundary, owner paths (point at `references/report-shape.md` and `references/redaction.md` — the stable docs, not `src/` test artifacts; do not copy contracts), the fail-closed gate, and the next safe action. `description:` double-quoted, trigger-shaped, no personal names, `role: tool-workflow`. Name the **six owners** (Contract / Model / Engine / Discovery / CLI / Test) and produce the **Command Surface Alignment Proof** across the four drift surfaces (discovery metadata, rendered help, public argv accept/reject, runtime semantics). Embed the Truth Stance / untrusted-evidence header in `references/report-shape.md` (copy the stance text into the template, mirroring `skills/skill-self-audit-loop`'s `## Loop File Template`). **No `## Close` edit to fallow** — detection is harness-level (KTD6 / ADR-0014). Instead wire the end-of-run hooks: a Claude Stop-hook handler that parses `transcript_path` for a completed `Skill` call (carry a drift smoke-test that fails loud if the undocumented JSONL shape changes) and a Codex `notify=agent-turn-complete` handler reading documented `turn.completed`/`item.completed` events. Both shell out to `skill-feedback record`. Run `cli-execution-auditor` over the facade CLI as the ship gate.

**Patterns to follow:** `skills/fallow/SKILL.md` and `skills/test-runner/SKILL.md` (`## Owner` section shape, facade CLI prose); `skills/skill-self-audit-loop/SKILL.md` (Truth Stance + Safety blocks); `skills/create-cli/references/cli-command-facade.md` (facade-lane requirements).

**Test scenarios:**
- Frontmatter: after editing, `description` is double-quoted and the file YAML-parses (AGENTS.md rule).
- Command Surface Alignment Proof: discovery metadata, rendered `--help`, public argv accept/reject, and runtime semantics agree (no drift across the four surfaces).
- cli-execution-auditor: exit codes, help alignment, redaction, runner discipline, and `--json`-under-failure pass.
- Manual end-to-end (`Covers R1, R3.`): a real fallow close fires the harness hook, which invokes `skill-feedback record` with a degraded receipt (skill+goal+outcome only); one degraded record lands in `.skill-feedback/` with missing fields marked and the untrusted marker present.
- Claude detection smoke-test (`Covers KTD6 undocumented-format risk.`): a fixture fallow-close transcript JSONL parses to a `Skill` detection; the test fails loud if the transcript shape drifts. No skill is instructed to invoke another skill (`Covers R2.`).

**Verification:** `cli-execution-auditor` green; Command Surface Alignment Proof passes; ≥1 real driver-invoked capture lands a readable, untrusted-marked, secret-free record from a real fallow close; test + `tsc_check` green.

---

## Scope Boundaries

### Deferred for later (origin Scope Boundaries — carried verbatim intent)

- Full transcript / session-summary capture.
- Automatic source repair.
- Cross-repo aggregation.
- Clustering reports by repeated signatures.
- Product dashboards / analytics views.

### Deferred to v1 (origin 2026-06-11 review + this plan)

- R7-R9: multi-topic human-question selection (v0 captures only the receipt's free-text friction note).
- R10 (partial): origin names five lanes (outcome, friction, learning, verification, value); v0 ships **two** (outcome, friction). Value is dropped (defect 6); learning + verification deferred with the full R4 field set.
- R11: the 13-category friction taxonomy (premature before the record shape stabilizes).
- R12: evidence/recommendation separation (v0 has no recommendations).
- R13-R15: candidate repair proposals and the future-repair reader.
- R17: inbox-identity mirroring (v0 is a flat inbox).
- R19: the full privacy register; v0 carries only the data-class + redaction-owner + retention note via `references/redaction.md`.

### Deferred to Follow-Up Work (plan-local)

- Promote the **Strategy** redaction stub to a real per-harness policy when a harness needs a stricter scrub than the shared set. Stub at `prototypes/skill-feedback-architecture/redaction-strategy.stub.ts`; facade hook at `runtime/cli-command-facade/src/cli-diagnostics.ts`.
- Promote **adapter selection** from a `switch` to a registry map at adapter #3.
- Resurrect or re-home `context/skill-design-philosophy.md` — named as the composability-principle owner by the 2026-05-30 research but the file does not exist (dangling reference).
- Optional per-skill **close enrichment** (a skill opts in to emit a clean/failed/handoff signal at its close) — detection works harness-level without it; enrichment adds richer signal. v1 fork.
- **Mandatory fleet-wide close emission** as skill-authoring policy (a `create-cli`/`create-skill` gate) — a governance decision deferred to v1; v0 is built so either future is reachable.

(Note: the Claude Stop hook is now **in v0 scope**, not deferred — see KTD6 / ADR-0014. The rough second emitter, `cli-execution-auditor`, is also in v0 — see Risks and Success Criterion.)

---

## Risks & Dependencies

- **Wrong subject skill (confounds the go/no-go).** fallow is mature and fluently run → the least likely skill to generate friction. A null result may mean *wrong subject*, not *no value*. Mitigation: v0 ships **two** emitters — fallow (mature, proves the wiring on the happy path) and **`cli-execution-auditor`** (born 2026-06-11, runtime-backed, actively churning → proves the loop catches real friction). The rough emitter is in v0, not deferred.
- **Claude detection parses an undocumented transcript format.** The Stop hook exposes only `transcript_path`; detecting a completed `Skill` call means parsing JSONL whose schema Anthropic does not document. Works today (84-100%) but can drift. Mitigation: the Claude adapter carries a drift smoke-test (known fallow-close transcript → expected `Skill` detection) that fails loud if the format changes. Codex detection rides documented typed events and carries no such risk — making Codex the firmer v0 proving ground.
- **Friction is agent-narrated (residual confound).** Even after dropping the value lane, friction is authored by the agent post-hoc. Evaluate against the **friction lane + measured outcomes** (token usage, `turn.failed`, redaction events), not agent self-assessment — actionable-feedback density, not volume (arXiv 2605.29682).
- **Redaction cannot catch every human-pasted secret.** Explicit patterns cover bearer/JWT/PEM/DSN + prefix-keyed tokens, but a novel secret shape can slip through. Residual risk is mitigated by `0600` files + the gitignore gate + the post-session purge note, not eliminated. Flagged for the user.
- **Adapter scope is two harnesses, one emitter.** Both adapters prove the *seam*; one emitter (fallow) proves only per-skill value. Broad adoption is a v1 concern gated on the pilot's verdict.
- **Dangling owner reference.** `context/skill-design-philosophy.md` is missing; cite the 2026-05-30 research as de-facto owner until resolved.

---

## Success Criterion

EFC-grounded (arXiv 2605.29682): actionable-feedback **density** predicts value, not telemetry volume.

**Go** = across the pilot run set, at least one record surfaces an **actionable friction signal** that drives a **concrete action** — an edit to a `SKILL.md` / `references/` / `context/` file, or a recorded repair candidate. Evaluate on the **friction lane + measured outcomes** only (token usage, `turn.failed`, redaction events), never the agent's self-assessment.

**No-go** = no record clears that bar across **both** emitters (fallow + `cli-execution-auditor`). Because v0 already ships the rough emitter, a null result is not confounded by *wrong subject* — if neither a mature nor a young, churning skill surfaces an actionable signal, that is a real no-go. Do not build v1 on a null result.

---

## Sources & Research

- Origin: `docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md` (reviewed 2026-06-11; v0 cut is the scope source of truth).
- OpenTelemetry GenAI semantic conventions — `gen_ai.evaluation.result` (name/score/label/explanation/run-id), `execute_tool` / `invoke_agent` spans (status: Development as of 2026-06).
- Claude Code Monitoring (OTel) — `claude_code.interaction` span hierarchy + per-request attrs; Anthropic self-service-analytics post — eval rows tagged skill-version + git-SHA + per-assertion pass/fail.
- Codex `codex exec --json` `ThreadEvent` schema + `Usage` struct; `notify=agent-turn-complete` end-of-run hook.
- arXiv 2605.29682 — *Scaling Laws for Agent Harnesses*: Effective Feedback Compute; actionable-feedback density (R²≈0.99) over raw volume (R²≈0.33-0.42).
- `runtime/cli-command-facade/src/` — Facade contract (`defineCommandFacadeContract`, `createCliRuntime*Envelope`, baseline exit codes, `CliDiagnosticRedactor` Strategy hook).
- `skills/fallow/` — runtime-backed skill anatomy (`command-contract.ts`, `package.json`, `tsconfig.json`, runner).
- `skills/test-runner/src/test-runner.ts` — `Runtime` + `createDefault…Runtime(overrides)` injection seam.
- `skills/browser-use/src/browser-use-core.ts` — `Failure<A>` union (Null Object) + recursive redaction.
- `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts` — deterministic one-record shape (passed-in ts, 3-way outcome).
- `prototypes/skill-feedback-architecture/redaction-strategy.stub.ts` — deferred Strategy seam marker.
- `skills/agent-reliability-guardrails/references/logging-redaction-rules.md` — always-redact set owner.
- `skills/context-advisor/references/storage-routing.md` — ignored-inbox storage rule + safety defaults.
- `skills/create-cli/references/cli-command-facade.md` — facade-backed lane requirements (six owners, four drift surfaces).
- `skills/cli-execution-auditor/SKILL.md` — facade CLI ship-gate audit.
- `skills/skill-self-audit-loop/SKILL.md` — Truth Stance header (R18a), Safety/redaction block.
