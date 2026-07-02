---
date: 2026-06-04
topic: test-runner-compact-runner
focus: issue-172
mode: repo-grounded
---

# Ideation: Test Runner Compact Runner

## Grounding Context

- Issue #172 asks for a local `test-runner` skill that proves compact Bun test output before implementation.
- `context/bun-runner.md` and `rules/code-quality.md` currently prefer MCP runners over raw `bun test`.
- `context/skill-design-philosophy.md` says skill prose routes workflow while scripts, help, tests, and generated outputs own deterministic behavior.
- Bun docs expose compact pass-oriented reporting through `dots`, JUnit output, and `--bail`; they do not provide an agent-focused compact failure envelope by themselves.
- Recent cli-author docs separate agent-native standards from runtime backends; the same distinction applies here: the compact envelope is the value, not MCP transport.

## Topic Axes

- Primary user and invocation mode.
- Runner comparison and benchmark gates.
- Output envelope and failure fidelity.
- Skill/script ownership boundary.
- Adoption path and current MCP preference.

## Ranked Ideas

### 1. Benchmark-gated local runner proof

**Description:** Build the product shape around a proof gate, not an immediate preference change. The local script becomes worth adopting only when token count, runtime, exit correctness, and failure fidelity beat or match the current alternatives.

**Axis:** Runner comparison and benchmark gates.

**Basis:** direct: issue #172 requires comparing native shell `bun test`, existing MCP Bun runner, skill-local script wrapper, and optional published CLI wrapper when available.

**Rationale:** This keeps the existing MCP preference intact until the local runner proves it saves enough context in real agent loops.

**Downsides:** Benchmark work adds one unit before the visible skill exists.

**Confidence:** 95%

**Complexity:** Medium

**Status:** Explored

### 2. Bun-test-only v1

**Description:** Keep v1 focused on Bun tests. Defer lint and typecheck until the runner envelope pattern proves value on the highest-frequency, highest-noise command family.

**Axis:** Primary user and invocation mode.

**Basis:** direct: issue #172 asks whether scope starts with Bun test only, or test plus lint/typecheck.

**Rationale:** Test output has the clearest compaction pain and existing MCP comparison path. Adding lint/typecheck early would widen parser and envelope semantics before the core bet is proven.

**Downsides:** Agents still need MCP runners for lint and typecheck.

**Confidence:** 90%

**Complexity:** Low

**Status:** Unexplored

### 3. Plain-first, JSON-backed output

**Description:** Make compact plain text the default agent-consumption path, with JSON as the stable contract for tests, benchmarks, and future automation.

**Axis:** Output envelope and failure fidelity.

**Basis:** direct: issue #172 asks whether agents should consume compact plain text, JSON, or both; `context/bun-runner.md` prefers JSON for MCP tools.

**Rationale:** Plain output gives agents the token savings that motivated the issue. JSON gives deterministic checks a machine-owned contract without making `SKILL.md` copy schemas.

**Downsides:** Two output modes need alignment tests.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 4. Failure budget policy

**Description:** Treat failure output as a budgeted summary: enough file, test, assertion, and nearby context for repair, capped so repeated failures do not flood the agent context.

**Axis:** Output envelope and failure fidelity.

**Basis:** direct: issue #172 says failures should preserve enough context without flooding tokens, and evidence shows failing native Bun output stays near 2k tokens even with compact reporter flags.

**Rationale:** The hard product problem is failure path compaction. Pass output can already be tiny; the runner earns its keep when red runs stay useful.

**Downsides:** Parser heuristics can drop details a human would have wanted unless tests cover representative failures.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 5. Thin skill, script-owned contract

**Description:** Keep `skills/test-runner/SKILL.md` as route prose and next-safe-action guidance. Put flags, parsing, timeout behavior, exit handling, help text, and output contracts in scripts and tests.

**Axis:** Skill/script ownership boundary.

**Basis:** direct: `context/skill-design-philosophy.md` says deterministic behavior belongs in code, CLI help, tests, and scripts, not copied into `SKILL.md`.

**Rationale:** This prevents the new skill from becoming stale prose around a hidden CLI contract.

**Downsides:** The script help and tests need to be good enough for agents to discover exact behavior without bloating the skill.

**Confidence:** 94%

**Complexity:** Low

**Status:** Unexplored

### 6. Local-only first, published CLI later

**Description:** Prove the runner as a repo-local skill script. Treat a published CLI in `side-quest-runners` as a later extraction path if multiple repos want the same envelope.

**Axis:** Adoption path and current MCP preference.

**Basis:** direct: issue #172 asks whether this should remain local-only or later feed a published CLI, and says not to publish in this issue.

**Rationale:** Local proof lowers packaging cost and keeps the learning loop short. Extraction only earns its way when reuse pressure appears.

**Downsides:** Other repos cannot consume it until extraction happens.

**Confidence:** 92%

**Complexity:** Low

**Status:** Unexplored

## Rejection Summary

- Another MCP server: rejected; issue explicitly excludes it and the problem is envelope value, not transport.
- Replace MCP preference immediately: rejected; `context/bun-runner.md` remains source of current preference until benchmark gates pass.
- Include lint and typecheck in v1: rejected for scope overrun; test output is the clearest first proof.
- JSON-only output: rejected; it misses the compact text path that saves agent tokens in daily loops.
- Human-first runner UX: rejected as primary framing; humans benefit, but agents are the first user.
