---
title: Skill System Decision Log
slug: skill-system
type: decision-log
status: in-progress
date: "2026-06-06"
timezone: Australia/Melbourne
owner: skills/record-decision
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
codex_session_id: "019e9b07-c5f8-7c42-a373-ec68d5e827bc"
decision_metadata_format: fenced-yaml-per-decision
---

# Skill System Decision Log

Use this log for accepted decisions made while hardening the skills system.

## Frame

- Store accepted decisions in `docs/decisions/`.
- Keep ordinary durable decisions separate from ADRs.
- Use decision logs for human-readable decision memory.
- Keep deterministic contracts out of decision prose.

## Notes

- Decide whether the operating manual needs helper machinery.
- Candidate helper: an agent-native CLI for parsing Markdown decision logs with fenced YAML.
- Candidate commands: create a log, append a decision, parse a log, search decisions, and emit a machine-readable projection.
- Keep the CLI surface stable if storage later moves from Markdown to JSON or a database.
- Use `cli-author` before designing or implementing the helper.
- Treat exact parser rules, command contracts, output envelopes, and storage adapters as runtime-owned if the helper is built.
- Current skill-authoring owner paths are set by the latest accepted decisions.
- Historical entries before current owner-path consolidation may name old `context/` owners.
- Use `skills/create-skill/` owner paths when a historical entry conflicts with the current owner split.

## Decision 1: Store Accepted Decisions Only

```yaml
id: decisions-skill-001
status: accepted
decided_at: "2026-06-06"
decision: Store accepted decisions only
owner: skills/decisions
scope: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What is the primary job of the future decisions skill?
  option: manage durable decisions after they are made
  confidence: strong
```

Decision:

- The future `decisions` skill stores accepted decisions or explicit preserve requests.
- It does not own live decision-making.

Rationale:

- A narrow storage workflow avoids overlap with `decision-mode`.
- Accepted decisions need durable memory without turning every choice into ceremony.

Consequences:

- Route unresolved choices to `decision-mode`.
- Return to `decisions` after acceptance or an explicit preserve request.

Next:

- Define the storage format for decision logs.

## Decision 2: Use Decision Logs, Not ADRs, For Ordinary Durable Decisions

```yaml
id: decisions-skill-002
status: accepted
decided_at: "2026-06-06"
decision: Use decision logs, not ADRs, for ordinary durable decisions
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: Are decision logs the same as architectural decision records?
  option: no
  confidence: strong
```

Decision:

- Decision logs are not architectural decision records.
- ADRs stay reserved for huge, hard-to-reverse architectural decisions.

Rationale:

- Everyday choices need memory without ADR weight.
- ADRs lose signal if every preserved decision becomes one.

Consequences:

- Store ordinary durable decisions in `docs/decisions/`.
- Escalate to ADR only when the ADR threshold is met.

Next:

- Keep the ADR threshold visible in the future skill.

## Decision 3: Logs Belong To A Decision Surface

```yaml
id: decisions-skill-003
status: accepted
decided_at: "2026-06-06"
decision: Logs belong to a decision surface
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What should a decision log belong to?
  option: decision surface
  confidence: strong
```

Decision:

- A decision log belongs to the smallest stable future lookup surface.
- That surface is recorded in frontmatter as `owner`.

Rationale:

- Future agents and humans search by the thing being changed or operated.
- Source sessions explain where decisions happened; they do not own the log.

Consequences:

- Use `owner` for the decision surface.
- Use `source` for chats, brainstorms, plans, or other originating material.

Next:

- Decide whether the durable storage format is Markdown, JSON, or a database.

## Decision 4: Keep Required Metadata Small

```yaml
id: decisions-skill-004
status: accepted
decided_at: "2026-06-06"
decision: Keep required metadata small
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: Should v1 require people metadata?
  option: no required people fields
  confidence: strong
```

Decision:

- V1 decision logs do not require `decision_maker`, `participants`, or `stakeholders`.
- People are mentioned in prose only when they change handoff or accountability.

Rationale:

- Required people fields add meeting-template noise.
- The valuable lookup keys are decision surface, rationale, consequences, and next action.

Consequences:

- Keep frontmatter focused on title, type, status, date, timezone, owner, source, and metadata format.
- Do not add people fields until repeated use proves the need.

Next:

- Grill the storage format options.

## Decision 5: Store V1 Decisions In Markdown With Fenced YAML

```yaml
id: decisions-skill-005
status: accepted
decided_at: "2026-06-06"
decision: Store V1 decisions in Markdown with fenced YAML
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What should v1 use as the durable storage format?
  option: Markdown decision logs with fenced YAML
  confidence: strong
```

Decision:

- V1 stores decisions in Markdown files under `docs/decisions/`.
- Each decision uses fenced YAML metadata plus human-readable prose.

Rationale:

- Markdown is readable, reviewable, and already established in this repo.
- Fenced YAML gives agents enough structure without making prose the source of a deterministic schema.

Consequences:

- Do not start v1 with JSON files or a database.
- Consider generated indexes, JSON projections, or a database only after repeated lookup pain.

Next:

- Decide the fenced YAML metadata fields.

V2 Ideas:

- Add a generated JSON index if search across many logs becomes slow.
- Add a database only if cross-repo querying, dashboards, or lifecycle automation earns the machinery.

## Decision 6: Add A Tiny Parser Checker In V1

```yaml
id: decisions-skill-006
status: accepted
decided_at: "2026-06-06"
decision: Add a tiny parser checker in v1
owner: skills/decisions
scope: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What machinery should the operating manual assume?
  option: tiny parser/checker in v1
  confidence: soft
```

Decision:

- V1 may include a tiny parser/checker for Markdown decision logs with fenced YAML.
- The helper can parse logs, read fenced YAML, emit a machine-readable projection, and check shape drift.
- V1 does not include full search, dashboards, database storage, or storage-adapter abstraction.

Rationale:

- A parser/checker proves the chosen storage shape is usable by agents.
- Keeping the helper small avoids turning the skill into a premature storage platform.

Consequences:

- Use `cli-author` before designing any helper command surface.
- Keep exact parser rules, output contracts, and diagnostics in code if the helper is built.

Next:

- Decide the fenced YAML metadata fields.

V2 Ideas:

- Add create, append, search, and export commands after repeated use proves the need.
- Hide future Markdown, JSON, or database storage behind a stable CLI once the storage abstraction earns its keep.

## Decision 7: Use Lean YAML Plus Decision Mode Trace

```yaml
id: decisions-skill-007
status: accepted
decided_at: "2026-06-06"
decision: Use lean YAML plus decision mode trace
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What fields should the fenced YAML require in v1?
  option: lean required fields plus decision-mode trace
  confidence: soft
```

Decision:

- V1 decision YAML includes lean routing metadata plus `decision_mode` trace.
- Required fields are `id`, `status`, `decided_at`, `decision`, `owner`, `source`, and `decision_mode`.
- `decision_mode` includes `question`, `option`, and `confidence`.

Rationale:

- The parser/checker needs enough structure to find, classify, and trace decisions.
- Human-readable prose should own rationale, consequences, next action, notes, and V2 ideas.

Consequences:

- Do not require `evidence`, people fields, tags, review dates, or impact fields in v1 YAML.
- Keep exact parser validation in helper code if the parser/checker is built.

Next:

- Decide status values and whether they stay prose-owned until helper code exists.

V2 Ideas:

- Add optional fields only after repeated lookup or automation needs prove the value.
- Generate richer indexes from prose sections later if search needs it.

## Decision 8: Allow Accepted And Superseded Statuses

```yaml
id: decisions-skill-008
status: accepted
decided_at: "2026-06-06"
decision: Allow accepted and superseded statuses
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: What status values should v1 allow?
  option: accepted and superseded
  confidence: soft
```

Decision:

- V1 decision YAML allows `accepted` and `superseded`.
- Use `accepted` for current decisions.
- Use `superseded` when a later accepted decision replaces an earlier one.

Rationale:

- The skill stores accepted decisions, not proposals.
- Supersession preserves history without turning the log into a full lifecycle tracker.

Consequences:

- Do not use v1 decision logs for `proposed` or `rejected` options.
- If a rejected option needs memory, record it in prose under rationale, consequences, notes, or V2 ideas.

Next:

- Decide whether `superseded` needs a link field in v1 YAML.

V2 Ideas:

- Add richer lifecycle states only if review workflows need them.
- Add machine-checked supersession links if agents start missing replacement decisions.

## Decision 9: Use Optional Supersession Pointers

```yaml
id: decisions-skill-009
status: accepted
decided_at: "2026-06-06"
decision: Use optional supersession pointers
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
decision_mode:
  question: Should superseded decisions require a YAML pointer?
  option: optional superseded_by and supersedes
  confidence: strong
```

Decision:

- Supersession pointers are optional in v1 YAML.
- Add `superseded_by` to a superseded decision.
- Add `supersedes` to a new replacement decision when useful.

Rationale:

- Agents need a lightweight way to follow replacement decisions.
- Optional fields avoid burdening ordinary accepted decisions.

Consequences:

- Keep accepted decisions clean by default.
- Use supersession pointers only when a later decision replaces earlier guidance.

Next:

- Decide whether `source` should accept paths only or path plus chat labels.

V2 Ideas:

- Add parser validation that `superseded_by` and `supersedes` point to existing decision IDs.

## Decision 10: Source Accepts Paths And Human Labels

```yaml
id: decisions-skill-010
status: accepted
decided_at: "2026-06-06"
decision: Source accepts paths and human labels
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What can source contain in v1 YAML?
  option: paths plus human source labels
  confidence: strong
```

Decision:

- V1 `source` is a list of strings.
- Use paths when source files exist.
- Use short human labels when the source is chat, live implementation, or external work.

Rationale:

- Some durable decisions come from chat or live work before a source file exists.
- A list of strings stays easy to parse and easy to write.

Consequences:

- The parser/checker can validate that `source` is present and list-shaped.
- It should not require every source item to resolve to a local file.

Next:

- Decide whether per-decision `owner` is a scalar or a list.

V2 Ideas:

- Add structured source objects only if links, sections, line numbers, or external provenance need automation.

## Decision 11: Use Scalar Owner

```yaml
id: decisions-skill-011
status: accepted
decided_at: "2026-06-06"
decision: Use scalar owner
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should per-decision owner be a scalar or list?
  option: scalar
  confidence: strong
```

Decision:

- Per-decision `owner` is a scalar in v1 YAML.
- Each decision belongs to one decision surface.

Rationale:

- One owner keeps lookup and parser checks simple.
- Cross-surface effects do not need to weaken ownership.

Consequences:

- Put cross-surface effects in prose.
- Do not add `related` in v1.

Next:

- Decide whether `scope` should be required when it matches `owner`.

V2 Ideas:

- Add `related` only if cross-surface lookup becomes painful.

## Decision 12: Make Scope Optional

```yaml
id: decisions-skill-012
status: accepted
decided_at: "2026-06-06"
decision: Make scope optional
owner: skills/decisions
scope: docs/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should scope be required in v1 YAML?
  option: optional scope
  confidence: soft
```

Decision:

- Per-decision `scope` is optional in v1 YAML.
- Use `scope` only when it narrows the decision surface named by `owner`.

Rationale:

- `owner` already names the stable lookup surface.
- Required `scope` would often duplicate `owner`.

Consequences:

- Parser/checker should not require `scope`.
- Decisions may include `scope` when it adds precision.

Next:

- Decide whether `durability` is needed when all entries live in a decision log.

V2 Ideas:

- Add richer scope semantics only if agents need filtered lookup inside large decision surfaces.

## Decision 13: Remove Per-Decision Durability

```yaml
id: decisions-skill-013
status: accepted
decided_at: "2026-06-06"
decision: Remove per-decision durability
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should each decision YAML keep durability?
  option: remove it
  confidence: strong
```

Decision:

- Remove `durability` from per-decision YAML.
- Let the containing file frontmatter own the durability boundary.

Rationale:

- The file already declares `type: decision-log`.
- Repeating `durability: decision-log` in every entry adds no useful routing signal.

Consequences:

- Required v1 YAML fields are `id`, `status`, `decided_at`, `decision`, `owner`, `source`, and `decision_mode`.
- If a decision needs reflection into `CONTEXT.md`, ADR, code, or a plan, say so in prose.

Next:

- Decide whether `decision_mode.confidence` values should stay tied to `decision-mode`.

V2 Ideas:

- Add a generated projection field later only if a downstream index needs storage-owner routing per decision.

## Decision 14: Reuse Decision Mode Confidence Values

```yaml
id: decisions-skill-014
status: accepted
decided_at: "2026-06-06"
decision: Reuse decision mode confidence values
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What confidence values should v1 allow?
  option: reuse decision-mode values
  confidence: strong
```

Decision:

- V1 reuses `decision-mode` confidence values.
- Allowed values are `strong`, `soft`, and `hold`.

Rationale:

- The future `decisions` skill preserves outcomes from decision conversations.
- Reusing the existing confidence language avoids a second local taxonomy.

Consequences:

- Do not introduce `high`, `medium`, or `low` confidence values in decision-log YAML.
- Keep confidence aligned with `decision-mode`.

Next:

- Decide whether `decision_mode` should be required when the decision did not happen through `decision-mode`.

V2 Ideas:

- Add helper validation against the owning `decision-mode` vocabulary if the parser/checker is built.

## Decision 15: Make Decision Mode Trace Optional

```yaml
id: decisions-skill-015
status: accepted
decided_at: "2026-06-06"
decision: Make decision mode trace optional
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should decision_mode be required in every decision YAML block?
  option: optional
  confidence: strong
```

Decision:

- `decision_mode` is optional in v1 decision YAML.
- Include it when the decision came from a `decision-mode` exchange.
- Omit it when the decision came from implementation, a direct preserve request, or another source.

Rationale:

- Decision logs need to store accepted decisions from more than one workflow.
- Requiring `decision_mode` would force fake trace metadata for direct decisions.

Consequences:

- Required v1 YAML fields are `id`, `status`, `decided_at`, `decision`, `owner`, and `source`.
- Parser/checker should validate `decision_mode` shape only when the block exists.

Next:

- Decide whether `id` should include the log slug prefix.

V2 Ideas:

- Add optional `origin` later only if agents need to distinguish chat, implementation, decision-mode, or imported decisions mechanically.

## Decision 16: Use Log Slug Prefixed IDs

```yaml
id: decisions-skill-016
status: accepted
decided_at: "2026-06-06"
decision: Use log slug prefixed IDs
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What should id look like?
  option: log-slug prefix plus number
  confidence: strong
```

Decision:

- Decision IDs use a short log or surface slug plus a zero-padded sequence.
- Example: `decisions-skill-016`.
- IDs stay stable after creation.

Rationale:

- Slug-prefixed IDs are easy to grep and unambiguous across logs.
- Supersession pointers need stable targets.

Consequences:

- Do not use local-only numbers like `016`.
- Do not use date-only IDs as the primary decision ID.

Next:

- Decide whether decision logs need a frontmatter slug.

V2 Ideas:

- Add helper validation that new decision IDs match the log slug and next sequence.

## Decision 17: Add Frontmatter Slug

```yaml
id: decisions-skill-017
status: accepted
decided_at: "2026-06-06"
decision: Add frontmatter slug
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should decision logs have a frontmatter slug?
  option: yes
  confidence: strong
```

Decision:

- Decision logs include a frontmatter `slug`.
- The slug owns the prefix for per-decision IDs.

Rationale:

- The parser/checker can validate decision IDs without guessing from filename or title.
- Stable slug-prefixed IDs make supersession pointers easier to follow.

Consequences:

- New decision logs should include `slug: short-log-slug`.
- Decision IDs should match the log slug prefix.

Next:

- Decide whether the top-level log status values need a separate lifecycle.

V2 Ideas:

- Add helper validation that frontmatter `slug` matches the filename slug closely enough to catch drift.

## Decision 18: Use In-Progress And Complete Log Statuses

```yaml
id: decisions-skill-018
status: accepted
decided_at: "2026-06-06"
decision: Use in-progress and complete log statuses
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What frontmatter status values should decision logs use?
  option: in-progress and complete
  confidence: soft
```

Decision:

- Decision-log frontmatter uses `in-progress` and `complete`.
- Use `in-progress` while a log may receive more decisions.
- Use `complete` when no more decisions are expected for that log.

Rationale:

- The values match the current local pattern and keep lifecycle simple.
- Long-running surfaces can stay `in-progress` indefinitely.

Consequences:

- Do not add `active`, `archived`, or other lifecycle values in v1.
- Parser/checker may validate these two frontmatter values.

Next:

- Decide whether decision-log frontmatter needs `updated`.

V2 Ideas:

- Add archival or review lifecycle only if long-running logs need it.

## Decision 19: Omit Frontmatter Updated

```yaml
id: decisions-skill-019
status: accepted
decided_at: "2026-06-06"
decision: Omit frontmatter updated
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should decision-log frontmatter include updated?
  option: no
  confidence: strong
```

Decision:

- Do not include frontmatter `updated` in v1 decision logs.
- Use latest decision `decided_at` plus git history for freshness.

Rationale:

- `updated` would require frontmatter churn on every append.
- The latest decision entry already gives a human-readable freshness signal.

Consequences:

- Parser/checker should not require `updated`.
- Do not edit frontmatter just because a new decision was appended.

Next:

- Decide whether decision logs need tags in frontmatter.

V2 Ideas:

- Add `updated` only if review workflows or generated indexes need it.

## Decision 20: Omit Tags In V1

```yaml
id: decisions-skill-020
status: accepted
decided_at: "2026-06-06"
decision: Omit tags in v1
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should decision logs include frontmatter tags in v1?
  option: no tags
  confidence: strong
```

Decision:

- Do not include frontmatter `tags` in v1 decision logs.
- Use `owner` as the primary lookup surface.

Rationale:

- Tags invite taxonomy drift before retrieval pain exists.
- Owner, source, prose search, and future generated indexes are enough for v1.

Consequences:

- Parser/checker should not require or validate tags.
- Do not add tags to new decision logs by default.

Next:

- Decide whether the future parser/checker should be scoped to one command or a multi-command CLI.

V2 Ideas:

- Add tags only if real search and retrieval use shows owner/source/prose are insufficient.

## Decision 21: Use One Parser Checker Command In V1

```yaml
id: decisions-skill-021
status: accepted
decided_at: "2026-06-06"
decision: Use one parser checker command in v1
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What should the v1 parser/checker surface be?
  option: one command
  confidence: strong
```

Decision:

- V1 helper machinery uses one command: `decisions check <file> --json`.
- The command parses a decision log, checks shape drift, and emits a machine-readable projection.

Rationale:

- One command proves the Markdown plus fenced YAML storage format.
- A single surface avoids prematurely designing create, append, search, or storage-adapter commands.

Consequences:

- Treat the helper as an Agent-native CLI surface.
- Use `cli-author` before implementation.
- Keep exact parser rules, output shape, and diagnostics in code.

Next:

- Decide whether the v1 helper is read-only.

V2 Ideas:

- Add `create-log`, `append`, `search`, and `export` after repeated usage proves they are needed.

## Decision 22: Keep V1 Helper Read-Only

```yaml
id: decisions-skill-022
status: accepted
decided_at: "2026-06-06"
decision: Keep v1 helper read-only
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should the v1 helper be read-only?
  option: read-only
  confidence: strong
```

Decision:

- The v1 helper is read-only.
- It checks and projects decision logs.
- It does not create, append, rewrite, or migrate decision logs.

Rationale:

- Read-only machinery proves the storage shape without adding write safety concerns.
- Agents can still write Markdown directly while the helper verifies shape.

Consequences:

- No v1 write semantics, dry-run behavior, ID allocation, or formatter rules are needed.
- Parser/checker failures should explain the issue and leave the file unchanged.

Next:

- Decide whether `decisions check` should accept one file or a directory.

V2 Ideas:

- Add write helpers after the read-only checker proves useful and formatting rules stabilize.

## Decision 23: Check One File In V1

```yaml
id: decisions-skill-023
status: accepted
decided_at: "2026-06-06"
decision: Check one file in v1
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What should decisions check accept in v1?
  option: one file only
  confidence: strong
```

Decision:

- `decisions check` accepts one decision-log file in v1.
- It does not accept directories, globs, or multiple paths.

Rationale:

- Single-file checking keeps v1 small and reliable.
- Directory and repo-wide checks need aggregation rules that v1 does not need.

Consequences:

- Agents run the checker against the file they are editing or reading.
- Do not design directory traversal, ignore rules, or multi-file summaries in v1.

Next:

- Decide whether `--json` is required or optional.

V2 Ideas:

- Add directory or repo-wide checking after single-file checks prove stable.

## Decision 24: Require JSON Output In V1

```yaml
id: decisions-skill-024
status: accepted
decided_at: "2026-06-06"
decision: Require JSON output in v1
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should --json be required?
  option: require --json in v1
  confidence: soft
```

Decision:

- `decisions check` requires `--json` in v1.
- JSON is the only supported v1 output mode.

Rationale:

- The v1 helper is an agent-facing parser/checker.
- One output mode keeps implementation and contract surface small.

Consequences:

- Do not implement a human renderer in v1.
- Invalid usage without `--json` should fail with a concise recovery message.

Next:

- Decide baseline exit meanings.

V2 Ideas:

- Add human output after humans start using the command directly.

## Decision 25: Use Three Baseline Exit Meanings

```yaml
id: decisions-skill-025
status: accepted
decided_at: "2026-06-06"
decision: Use three baseline exit meanings
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: What exit meanings should v1 use?
  option: three baseline meanings
  confidence: strong
```

Decision:

- V1 helper exposes three baseline exit meanings:
  - valid decision log
  - invalid usage
  - check failed
- Exact numeric exit codes belong in code.

Rationale:

- Agents need enough routing signal to distinguish usage errors from failed checks.
- The manual should not own deterministic numeric exit code contracts.

Consequences:

- Keep exact numeric codes and JSON diagnostics in the helper implementation.
- Keep the manual at behavior meaning level.

Next:

- Decide whether the checker should validate prose sections as well as YAML.

V2 Ideas:

- Add more exit distinctions only when agent routing needs them.

## Decision 26: Check Required Prose Headings

```yaml
id: decisions-skill-026
status: accepted
decided_at: "2026-06-06"
decision: Check required prose headings
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should decisions check validate prose sections?
  option: YAML plus required section headings
  confidence: strong
```

Decision:

- `decisions check` validates YAML plus required prose section headings.
- Required headings are `Decision`, `Rationale`, `Consequences`, `Next`, and `V2 Ideas`.
- V1 does not judge prose quality.

Rationale:

- The log is useful only when humans can read the decision narrative.
- Heading checks catch missing structure without subjective review.

Consequences:

- Parser/checker should detect missing required sections.
- It should not score, rewrite, or critique prose.

Next:

- Decide whether `Notes` is required at the top level.

V2 Ideas:

- Add prose linting only if repeated low-quality entries create real handoff failures.

## Decision 27: Require Top-Level Notes

```yaml
id: decisions-skill-027
status: accepted
decided_at: "2026-06-06"
decision: Require top-level Notes
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should every decision log have a top-level Notes section?
  option: required
  confidence: strong
```

Decision:

- Every decision log has a top-level `Notes` section.
- Notes capture emerging ideas that are not accepted decisions yet.

Rationale:

- Notes give open thoughts a safe parking lane.
- That prevents half-decisions from polluting accepted decision entries.

Consequences:

- Parser/checker should require a top-level `Notes` section.
- Notes are not decision records and do not need fenced YAML.

Next:

- Decide whether top-level `Frame` should be required.

V2 Ideas:

- Add note-to-decision promotion helpers only after manual usage proves the flow.

## Decision 28: Require Top-Level Frame

```yaml
id: decisions-skill-028
status: accepted
decided_at: "2026-06-06"
decision: Require top-level Frame
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Should every decision log require top-level Frame?
  option: required
  confidence: strong
```

Decision:

- Every decision log has a top-level `Frame` section.
- Frame explains the log boundary, exclusions, and accepted constraints.

Rationale:

- Future readers need to know what the log is for before reading individual decisions.
- Frame keeps boundary context out of individual decision entries.

Consequences:

- Parser/checker should require a top-level `Frame` section.
- Frame should stay short and should not become a spec.

Next:

- Decide whether the future skill scaffold is ready to implement or needs more grilling.

V2 Ideas:

- Add a generated log summary later if frames become stale or too long.

## Decision 29: Scaffold Decisions Skill

```yaml
id: decisions-skill-029
status: accepted
decided_at: "2026-06-06"
decision: Scaffold decisions skill
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill grill"
decision_mode:
  question: Is the skill scaffold ready to create?
  option: yes, scaffold now
  confidence: soft
```

Decision:

- Create `skills/decisions/SKILL.md`.
- Move stable detail into `skills/decisions/references/operating-manual.md`.
- Keep helper implementation as a later `cli-author`-gated slice.

Rationale:

- The storage workflow is clear enough to use as a skill.
- The read-only checker contract still needs a separate CLI design pass.

Consequences:

- Agents can invoke `decisions` for accepted decision storage.
- Helper implementation does not start from this scaffold alone.

Next:

- Validate skill frontmatter and decision-log YAML.

V2 Ideas:

- Implement `decisions check` after a `cli-author` pass.

## Decision 30: Use Facade Runtime Envelopes For V2 CLI Output

```yaml
id: decisions-skill-030
status: accepted
decided_at: "2026-06-06"
decision: Use facade runtime envelopes for v2 CLI output
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-06 decisions skill v2 grill"
  - "side-quest-engineering:packages/cli-command-facade/src/command-facade.ts"
```

Decision:

- The v2 `decisions` CLI must emit the TypeScript runtime envelopes owned by `@side-quest/cli-command-facade`.
- Package-specific decision payloads belong inside facade-owned success or error envelopes.
- `skills/decisions/SKILL.md` should point to the contract owner instead of copying envelope fields.

Rationale:

- The facade already owns run correlation, structured errors, runtime actions, continuation guidance, diagnostic trail pointers, side-effect declarations, and validation of envelope shape.
- Reusing the facade prevents `decisions` from inventing a parallel agent-native output contract.
- Keeping the exact envelope shape in code/help/tests follows the skill design philosophy.

Consequences:

- `decisions record` design must be facade-backed when implemented.
- The command contract, model, engine, discovery, CLI, and tests need named owner files before implementation.
- Missing-input, out-of-scope, duplicate, compatibility, filesystem, and validation failures should map onto facade error envelopes with package-owned data and action vocabulary.

Next:

- Continue grilling the v2 command contract around package-owned data fields and runtime action vocabulary.

V2 Ideas:

- Add a Command Surface Alignment Proof when `decisions record` is implemented.
- Add a package-owned diagnostic command only if record/check failures need environment inspection.

## Decision 31: Update Both Sides Of Supersession

```yaml
id: decisions-skill-031
status: accepted
decided_at: "2026-06-07"
decision: Update both sides of supersession
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record supersession decision"
```

Decision:

- In execute mode, `decisions record` appends the replacement decision and updates each safely resolved superseded entry.
- The replaced entry gets `status: superseded` plus `superseded_by` pointing to the replacement decision.
- Dry-run previews both the append and the old-entry updates.
- If a superseded entry cannot be resolved safely, the command blocks before writing.

Rationale:

- Supersession changes lifecycle state on both sides of the link.
- Leaving replaced entries visually current would mislead future agents.

Consequences:

- The write engine needs an all-or-block supersession path.
- Duplicate, conflict, and legacy-shape checks run before mutation.
- Runtime output reports planned or completed mutations inside facade-owned envelopes.
- Exact action names, payload fields, and error codes live in code, help, and tests.

Next:

- Decide package-owned `data` payloads for dry-run success and execute success.

V2 Ideas:

- Add validation that every executed `supersedes` target has a matching `superseded_by`.

## Decision 32: Describe Success Data As Mutation Plan Or Result

```yaml
id: decisions-skill-032
status: accepted
decided_at: "2026-06-07"
decision: Describe success data as mutation plan or result
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record success data decision"
```

Decision:

- `decisions record` success data describes the mutation plan or completed mutation result.
- Dry-run success data describes the target log, proposed decision identity, planned mutations, and validation summary.
- Execute success data describes the target log, created decision identity, completed mutations, and validation summary.
- The command does not return the full rendered decision entry as its primary success data.

Rationale:

- Mutation evidence gives agents enough proof to continue without scraping rendered Markdown.
- Full rendered entries risk duplicating the storage contract inside the runtime output contract.

Consequences:

- The package-owned success payload should focus on targets, identities, mutation evidence, validation, and next safe action.
- Human-readable rendered Markdown can remain a preview detail when useful.
- Exact payload field names and facade envelope placement live in code, help, and tests.

Next:

- Decide the package-owned error data pattern for missing input and out-of-scope input.

V2 Ideas:

- Add output budget controls if mutation summaries can become token-heavy.

## Decision 33: Describe Missing And Scope Errors As Repair Packets

```yaml
id: decisions-skill-033
status: accepted
decided_at: "2026-06-07"
decision: Describe missing and scope errors as repair packets
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record error data decision"
```

Decision:

- Missing-input and out-of-scope error data describes a repair packet.
- The packet identifies the failed gate, missing or blocked input, no-mutation evidence, and next repair action.
- The command does not echo the full input as primary error data.

Rationale:

- Agents need enough structured guidance to repair the envelope without guessing.
- Full input echoing increases privacy risk and context bloat.

Consequences:

- Missing-input errors point to required fields or anchors that the caller must provide.
- Out-of-scope errors explain the blocked scope and route private or personal decisions away from repo logs.
- Exact field names, privacy codes, action names, and facade envelope placement live in code, help, and tests.

Next:

- Decide package-owned error data for duplicate conflict and legacy log shape.

V2 Ideas:

- Add safe partial input echo only for allow-listed fields if repair loops need it.

## Decision 34: Describe Conflict And Legacy Errors As Case-Specific Repair Packets

```yaml
id: decisions-skill-034
status: accepted
decided_at: "2026-06-07"
decision: Describe conflict and legacy errors as case-specific repair packets
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record conflict and legacy error decision"
```

Decision:

- Duplicate conflict and legacy log shape error data describes case-specific repair packets.
- Duplicate conflict data identifies the conflict basis, affected target, no-mutation evidence, and next repair action.
- Legacy log shape data identifies the incompatible target, blocked shape, no-mutation evidence, and next repair action.
- The command does not auto-repair, migrate, or rewrite legacy logs while recording a decision.

Rationale:

- Conflict and compatibility failures need more repair guidance than a generic block reason.
- Auto-repair would mix decision recording with migration behavior.

Consequences:

- Duplicate conflicts can route to supersession, wording clarification, or no-op.
- Legacy shape failures can route to another log, manual migration, or handoff.
- Exact conflict categories, compatibility checks, action names, and facade envelope placement live in code, help, and tests.

Next:

- Decide package-owned error data for filesystem failure and post-write validation failure.

V2 Ideas:

- Add a separate migration command only if legacy-shape repair becomes common.

## Decision 35: Describe Write Failures As Mutation Safety Packets

```yaml
id: decisions-skill-035
status: accepted
decided_at: "2026-06-07"
decision: Describe write failures as mutation safety packets
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record write failure data decision"
```

Decision:

- Filesystem failure and post-write validation failure data describes a mutation safety packet.
- The packet identifies the failed phase, mutation evidence, rollback or partial-write status, retry safety, and next repair action.
- The command does not create persisted diagnostic artifacts by default.

Rationale:

- Write failures need explicit evidence about what changed, what did not change, and whether retry is safe.
- Persisted diagnostics add artifact cleanup and ownership questions that the v2 record surface does not need by default.

Consequences:

- Filesystem failures report whether mutation started and whether the same input can retry.
- Post-write validation failures report partial-write status and the safest repair route.
- Exact phase names, retry categories, action names, and facade envelope placement live in code, help, and tests.

Next:

- Decide whether execute writes use same-directory atomic replacement.

V2 Ideas:

- Add opt-in diagnostic files only if local debugging repeatedly needs durable failure artifacts.

## Decision 36: Use Same-Directory Atomic Replacement For Execute Writes

```yaml
id: decisions-skill-036
status: accepted
decided_at: "2026-06-07"
decision: Use same-directory atomic replacement for execute writes
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record atomic write decision"
```

Decision:

- Execute mode uses same-directory temp writes followed by atomic replacement.
- The engine renders full replacement content before writing.
- The engine validates replacement content before renaming over the target.
- Dry-run does not create temp files.
- Exact temp naming, cleanup, fsync, permission preservation, and platform behavior live in code and tests.

Rationale:

- Direct rewrites create partial-write risk.
- Same-directory replacement keeps the operation on one filesystem and makes mutation evidence clearer.

Consequences:

- Write failures can report whether the target file was untouched, replaced, or left with cleanup work.
- Multi-file supersession writes need a defined all-or-block plan before mutation starts.
- Post-write validation still reports through mutation safety packets if replacement validation fails after rename.

Next:

- Decide whether multi-file supersession writes are allowed in v2 or blocked until a transaction strategy exists.

V2 Ideas:

- Add implementation tests for temp-file cleanup, rename failure, and same-input retry safety.

## Decision 37: Keep V2 Supersession Writes Same-Log Only

```yaml
id: decisions-skill-037
status: accepted
decided_at: "2026-06-07"
decision: Keep v2 supersession writes same-log only
owner: skills/decisions
scope: skills/decisions/scripts
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 decisions record cross-log supersession decision"
```

Decision:

- V2 `decisions record` execute mode updates superseded entries only when they live in the same decision log as the replacement decision.
- Cross-log supersession blocks before writing and returns repair guidance.
- Dry-run can report cross-log supersession as blocked, not executable.

Rationale:

- Atomic replacement is proven per target file.
- Cross-file all-or-block behavior needs transaction semantics that v2 should not invent.

Consequences:

- Same-log supersession remains useful and safe.
- Cross-log replacements need manual follow-up, a separate command, or a future transaction strategy.
- Runtime output reports cross-log supersession through facade-owned error envelopes.
- Exact target-resolution rules, block categories, and action names live in code, help, and tests.

Next:

- Turn the accepted v2 input/output pattern into the operating manual draft.

V2 Ideas:

- Add cross-log transaction support only after repeated use proves the need.

## Decision 38: Create Agent-Native Skill As Operational Proprietor

```yaml
id: decisions-skill-038
status: accepted
decided_at: "2026-06-07"
decision: Create agent-native skill as operational proprietor
owner: skills/create-agent-native-skill
scope: skills/create-agent-native-skill
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 create agent-native skill owner decision"
```

Decision:

- Create `skills/create-agent-native-skill` as the operational front door for runtime-backed agent-native skill authoring.
- Keep `context/skill-design-philosophy.md` as the canonical rulebook.
- Keep `skills/decisions/references/operating-manual.md` as the worked example.

Rationale:

- Philosophy prose alone is too passive to reliably trigger the workflow.
- A dedicated skill can route from brainstorm to input contract, output contract, facade-backed command design, owner paths, and drift proof.

Consequences:

- Future agents use `create-agent-native-skill` when creating or redesigning skills with helper commands, machine-readable output, durable writes, or runtime recovery behavior.
- `create-agent-native-skill` points to `cli-author` for command-surface design instead of copying CLI contracts.
- Exact TypeScript input contracts and facade output envelope details stay in runtime code, help, and tests.

Next:

- Validate skill frontmatter, decision-log YAML, and instruction delivery checks.

V2 Ideas:

- Add a reference file only if repeated use shows the `SKILL.md` body is too dense.

## Decision 39: Teach Three Skill I/O Shapes In Philosophy

```yaml
id: decisions-skill-039
status: accepted
decided_at: "2026-06-07"
decision: Teach three skill I/O shapes in philosophy
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 skill I/O tier decision"
```

Decision:

- Skill I/O examples cover model-written artifacts.
- Simple operation I/O covers args, flags, stdout, stderr, and exit codes.
- Contract-first operation design covers runtime-backed skills with mutation, machine-readable output, repair, retry, privacy, ownership, acceptance, or durable writes.
- The skill philosophy includes compact `SKILL.md` shape examples for each pattern.
- The examples point to owner paths instead of copying exact contracts.

Rationale:

- Not every skill earns TypeScript input contracts, facade envelopes, or repair packets.
- Agents need a clear skip path for ordinary commands and prose-only artifact drafting.
- Example `SKILL.md` shapes make the distinction easier to apply without copying runtime contracts into skill prose.

Consequences:

- Future skill authors can choose the smallest I/O pattern that fits the risk.
- Runtime-backed skills still keep exact contracts in code, help, generated docs, and tests.
- Simple command skills can rely on command help, stdout, stderr, exit code, and tests.
- Model-written artifact skills can use illustrative examples without turning those examples into contracts.

Next:

- Use the philosophy examples when refining `create-agent-native-skill` and the decisions operating manual.

V2 Ideas:

- Move examples into a reference only if the philosophy guide becomes too long.

## Decision 40: Map Community Skill Categories To Operating Shapes

```yaml
id: decisions-skill-040
status: accepted
decided_at: "2026-06-07"
decision: Map community skill categories to operating shapes
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 community skill research follow-up"
```

Decision:

- Treat community skill categories as examples, not architecture.
- Classify skills by operating shape: artifact output, simple operation, or runtime-backed operation.
- Use the smallest shape that handles the risk.
- Treat community skill lists as discovery, not audit.

Rationale:

- Community skill categories drift quickly.
- Operating shape stays useful across artifact skills, CLI wrappers, domain playbooks, and runtime-backed skills.
- Skill authors need a stable decision rule, not a catalog.

Consequences:

- The philosophy guide adds a community-pattern section.
- The safety prose names community lists as discovery only.
- Third-party skills still require inspection before install or reuse.

Next:

- Apply the operating-shape rule when refining `create-agent-native-skill` and future skill wrappers.

V2 Ideas:

- Add sourced research notes only if future skill-design work needs a living community taxonomy.

## Decision 41: Move Skill Shape Examples To Reference

```yaml
id: decisions-skill-041
status: accepted
decided_at: "2026-06-07"
decision: Move skill shape examples to reference
owner: context/skill-design-philosophy.md
scope: context/references/skill-io-shape-examples.md
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 continue handoff cleanup"
```

Decision:

- Keep `context/skill-design-philosophy.md` as the rulebook.
- Move long `SKILL.md` shape examples into `context/references/skill-io-shape-examples.md`.
- Point `skills/create-agent-native-skill/SKILL.md` at the reference.

Rationale:

- Inline examples made the philosophy guide too dense.
- One-level references preserve progressive disclosure.
- The examples are useful during skill authoring, but they are not rules.

Consequences:

- Agents read the philosophy first.
- Agents load the example reference only when choosing between artifact, simple operation, and contract-first skill shapes.
- Exact contracts still live in runtime code, help, generated docs, and tests.

Next:

- Validate references, frontmatter, decision YAML, and whitespace.

V2 Ideas:

- Add more examples only after observed skill-authoring failures justify them.

## Decision 42: Configure Startup Owner For Multi-Checkout Topology

```yaml
id: decisions-skill-042
status: accepted
decided_at: "2026-06-07"
decision: Configure startup owner for multi-checkout topology
owner: scripts/agent-instructions.sh
scope: agent-instructions.config
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
  - "chat: 2026-06-07 startup symlink topology correction"
```

Decision:

- `scripts/agent-instructions.sh` reads `agent-instructions.config`.
- `startup_owner` names the checkout that owns projected user startup symlinks.
- Relative `startup_owner` values resolve from the current repo root.
- The projection check compares home symlinks against the configured startup owner, not always the current checkout.

Rationale:

- Multiple sibling checkouts intentionally share one active startup owner.
- Treating every non-current symlink as drift creates false failures.
- The check should validate the configured topology instead of rewriting symlinks.

Consequences:

- `claude-code-config-2` can pass instruction health while `~/.codex` and `~/.claude` point at `../claude-code-config`.
- `status` prints the configured startup owner for inspection.
- Unknown config keys warn instead of silently changing check behavior.

Next:

- Keep symlink updates explicit and separate from read-only health checks.

V2 Ideas:

- Promote startup topology config into a typed contract only if more keys appear.

## Decision 43: Treat Skill Descriptions As Routing Evidence

```yaml
id: decisions-skill-043
status: accepted
decided_at: "2026-06-07"
decision: Treat skill descriptions as routing evidence
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-07 skill description routing evidence decision"
decision_mode:
  question: What should the guide call skill descriptions?
  option: routing evidence
  confidence: strong
```

Decision:

- Skill descriptions are routing evidence.
- Skill descriptions are not routing contracts.

Rationale:

- Descriptions help model-side skill routing.
- Descriptions cannot guarantee runtime or user invocation.
- Deterministic contracts stay in code, help, generated docs, checks, or tests.

Consequences:

- The philosophy guide says descriptions provide routing evidence.
- Future skill authors improve descriptions through routing audits, not prose promises of deterministic activation.
- Runtime-backed invocation reliability still belongs to manual fallbacks, driver handoffs, path-scoped rules, hooks, scripts, checks, or command contracts.

Next:

- Continue grilling invocation reliability and missing hardening rules.

V2 Ideas:

- Add a description-audit helper only if repeated routing failures justify runtime support.

## Decision 44: Split Skill-Design Vocabulary Into Scoped Context

```yaml
id: decisions-skill-044
status: accepted
decided_at: "2026-06-07"
decision: Split skill-design vocabulary into scoped context
owner: docs/agents/domain.md
scope: context/skill-design/CONTEXT.md
source:
  - "chat: 2026-06-07 scoped context split request"
```

Decision:

- Keep root `CONTEXT.md` as the global glossary.
- Move skill-design vocabulary to `context/skill-design/CONTEXT.md`.
- Treat scoped `CONTEXT.md` files as local vocabulary owners for their folder.

Rationale:

- Root `CONTEXT.md` had become a dumping ground for local skill-design terms.
- One scoped owner keeps terms close to the philosophy guide.
- Root can point to scoped owners without duplicating definitions.

Consequences:

- Agents read the nearest scoped `CONTEXT.md` before root vocabulary.
- Startup health checks include `context/skill-design/CONTEXT.md` as an owner path.
- Future skill-design terms belong in the scoped context unless they apply globally.

Next:

- Continue moving local terminology out of root only when a clear scoped owner exists.

V2 Ideas:

- Add more scoped contexts after repeated root-glossary clutter shows a stable owner boundary.

## Decision 45: Keep Capability Registry Vocabulary Out Of Skill Design Context

```yaml
id: decisions-skill-045
status: accepted
decided_at: "2026-06-07"
decision: Keep capability registry vocabulary out of skill design context
owner: docs/agents/domain.md
scope: context/capability-registry/CONTEXT.md
source:
  - "chat: 2026-06-07 skills context cleanup"
```

Decision:

- Move capability-registry vocabulary to `context/capability-registry/CONTEXT.md`.
- Keep `context/skill-design/CONTEXT.md` focused on skill authoring, routing, invocation, and progressive disclosure.

Rationale:

- Capability registry terms describe canonical skills and agents as installable capabilities.
- Skill-design terms describe how skills are authored, routed, invoked, and reviewed.
- Mixing them would recreate the root glossary dumping-ground problem under a new path.

Consequences:

- Root `CONTEXT.md` points to both scoped context owners.
- Startup health checks require both scoped context owners.
- Future agents place new terms by owner, not by loose association with skills.

Next:

- Move more root vocabulary only when a stable scoped owner exists.

V2 Ideas:

- Add an agent-native CLI scoped context if CLI runtime terms continue crowding root.

## Decision 46: Require Manual Fallback For Reliability-Sensitive Skill Invocation

```yaml
id: decisions-skill-046
status: accepted
decided_at: "2026-06-07"
decision: Require manual fallback for reliability-sensitive skill invocation
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-07 invocation reliability decision"
decision_mode:
  question: When skill invocation reliability matters, what should the hardening rule require?
  option: explicit manual fallback
  confidence: strong
```

Decision:

- Reliability-sensitive skills require a manual fallback.
- The fallback names a callable route.

Rationale:

- Skill descriptions are routing evidence, not invocation guarantees.
- Runtime hooks only apply when the runtime owns the event.
- A named fallback gives humans and skill drivers a concrete recovery path after missed auto-routing.

Consequences:

- The philosophy guide requires a fallback route when missed invocation would lose data, mutate state, or bypass safety.
- Fallback routes can be commands, slash invocations, driver handoffs, hook owners, or owner paths.
- Better descriptions remain useful but insufficient for reliability-sensitive invocation.

Next:

- Continue grilling progressive disclosure and skill evolution rules.

V2 Ideas:

- Add a routing-audit checklist after repeated missed-invocation failures.

## Decision 47: Optimize Progressive Disclosure For Entry-Screen Route Clarity

```yaml
id: decisions-skill-047
status: accepted
decided_at: "2026-06-07"
decision: Optimize progressive disclosure for entry-screen route clarity
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-07 progressive disclosure decision"
decision_mode:
  question: When progressive disclosure fails, what should the rule optimize for?
  option: entry-screen route clarity
  confidence: strong
```

Decision:

- Optimize progressive disclosure for entry-screen route clarity.
- Keep `SKILL.md` small but route-complete.

Rationale:

- Fully self-contained skill bodies copy detail away from owners.
- Over-splitting into references hides required context.
- Agents need a clear first screen that names what exists and when to load it.

Consequences:

- The philosophy guide says first screens stay small but route-complete.
- `SKILL.md` names relevant references, scripts, and templates plus when to read or use them.
- Reference detail stays in one-level files unless repeated deterministic work earns scripts.

Next:

- Continue grilling skill evolution and gotcha rules.

V2 Ideas:

- Add a route-clarity review checklist only after observed progressive-disclosure failures.

## Decision 48: Harden Skills From Observed Failures First

```yaml
id: decisions-skill-048
status: accepted
decided_at: "2026-06-07"
decision: Harden skills from observed failures first
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-07 skill evolution hardening decision"
decision_mode:
  question: When a skill has repeated failures, what should be the first hardening move?
  option: patch from observed failure
  confidence: strong
```

Decision:

- Harden skills from observed failures first.
- Use the smallest patch that would have prevented the actual miss.

Rationale:

- Hypothetical failures create defensive bloat.
- Broad preventive rules make skill bodies harder to route and follow.
- Runtime machinery should earn its cost through repeated evidence.

Consequences:

- First hardening move is a gotcha, description edit, owner pointer, or example.
- Scripts, checks, and telemetry come after repeated evidence shows prose is not enough.
- Skill reviews distinguish observed failures from theoretical holes.

Next:

- Continue grilling naming and description collision rules.

V2 Ideas:

- Add a failure-log helper only if observed misses become hard to track manually.

## Decision 49: Resolve Skill Collisions In Descriptions First

```yaml
id: decisions-skill-049
status: accepted
decided_at: "2026-06-07"
decision: Resolve skill collisions in descriptions first
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-07 skill collision decision"
decision_mode:
  question: When two skills compete for the same request shape, where should the disambiguation live first?
  option: descriptions first
  confidence: strong
```

Decision:

- Resolve skill collisions in descriptions first.
- Add `when not` trigger conditions only for nearby collisions.

Rationale:

- The model sees descriptions during skill routing.
- Body prose loads too late if the wrong skill wins.
- Driver skills add machinery before repeated collision evidence proves the need.

Consequences:

- Skill authors patch frontmatter descriptions before adding long body exclusions.
- Driver/router skills remain escalation paths, not first fixes.
- Description audits cover under-triggering, over-triggering, and collisions.

Next:

- Continue grilling naming stability and published skill names.

V2 Ideas:

- Add collision fixtures only if description edits cannot stabilize routing.

## Decision 50: Make Skill Rename Bridges Temporary By Default

```yaml
id: decisions-skill-050
status: accepted
decided_at: "2026-06-08"
decision: Make skill rename bridges temporary by default
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill rename bridge cleanup decision"
decision_mode:
  question: When renaming a published skill, should bridges be temporary by default?
  option: temporary by default
  confidence: strong
```

Decision:

- Skill rename bridges are temporary by default.
- Permanent aliases require explicit justification.

Rationale:

- Published skill names can become manual invocation targets, documentation links, aliases, and driver references.
- A bridge prevents silent breakage during rename.
- Permanent bridges create clutter unless they serve a stable compatibility or shorthand need.

Consequences:

- Renaming a published skill requires a bridge, owner, and removal condition.
- Cleanup happens when old references are gone or the named expiry condition is met.
- Permanent aliases are rare and documented as aliases, not second owners.

Next:

- Continue grilling naming stability and alias cleanup rules.

V2 Ideas:

- Add a bridge-audit check if old skill names start accumulating.

## Decision 51: Remove Skill Bridges By Reference Audit

```yaml
id: decisions-skill-051
status: accepted
decided_at: "2026-06-08"
decision: Remove skill bridges by reference audit
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill bridge expiry decision"
decision_mode:
  question: When a bridge expires, what should remove it?
  option: reference audit
  confidence: strong
```

Decision:

- Remove skill bridges after reference audit.
- Time-based expiry is a reminder, not sufficient cleanup evidence.

Rationale:

- Skill names appear in docs, prompts, aliases, manual invocations, and driver handoffs.
- Removing a bridge while live references remain breaks callers.
- Keeping a bridge after references are gone creates clutter.

Consequences:

- Bridge removal requires `rg` or equivalent reference search for the old name.
- Remove when no live old-name references remain, or only expected historical references remain.
- Permanent aliases still require explicit justification.

Next:

- Continue grilling whether bridge metadata needs a fixed shape.

V2 Ideas:

- Add a bridge-audit helper if manual `rg` cleanup becomes noisy.

## Decision 52: Keep Skill Bridge Metadata In Prose For V1

```yaml
id: decisions-skill-052
status: accepted
decided_at: "2026-06-08"
decision: Keep skill bridge metadata in prose for v1
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill bridge metadata decision"
decision_mode:
  question: Do skill bridges need a fixed metadata shape now?
  option: prose for now
  confidence: strong
```

Decision:

- Keep skill bridge metadata in prose for v1.
- Require owner and removal condition.
- Do not introduce fixed bridge YAML yet.

Rationale:

- Bridge rules are new and should stay lightweight.
- A schema or checker is premature without bridge clutter.
- Owner and removal condition are enough to prevent hidden permanent aliases.

Consequences:

- Bridge entries can use terse prose.
- Current philosophy guide does not define exact bridge fields.
- Reference audit remains the cleanup evidence.

Next:

- Continue grilling whether bridge cleanup belongs in skill review.

V2 Ideas:

- Add fixed bridge YAML only if bridge clutter appears.
- Candidate fields: `old_name`, `new_name`, `owner`, `remove_when`, `created_at`.
- Add a bridge-audit check only if manual cleanup becomes noisy.

## Decision 53: Include Nearby Bridge Cleanup In Skill Review

```yaml
id: decisions-skill-053
status: accepted
decided_at: "2026-06-08"
decision: Include nearby bridge cleanup in skill review
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill bridge review decision"
decision_mode:
  question: Should bridge cleanup be part of normal skill review?
  option: lightweight check
  confidence: soft
```

Decision:

- Skill review and healing include a lightweight nearby bridge cleanup check.
- The check stays local to the skill being touched.

Rationale:

- Bridge cleanup prevents rename compatibility routes from accumulating.
- A local check is cheap when already reviewing a skill.
- Repo-wide bridge audits need a stronger signal before they earn tooling.

Consequences:

- Reviewers inspect nearby bridges for expiry or removable old-name references.
- Skill review does not become a broad repo-wide bridge hunt.
- Future bridge-audit tooling remains a V2 option.

Next:

- Continue grilling whether setup/config belongs in skill folders.

V2 Ideas:

- Add bridge-audit automation if local review misses cleanup repeatedly.

## Decision 54: Use Skill Setup Config Only For Local Context

```yaml
id: decisions-skill-054
status: accepted
decided_at: "2026-06-08"
decision: Use skill setup config only for local context
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill setup config decision"
decision_mode:
  question: When should a skill use setup/config files?
  option: user-specific or environment-specific context only
  confidence: strong
```

Decision:

- Use setup/config files only for user-specific or environment-specific skill context.
- Do not use setup/config as a second workflow body.

Rationale:

- Generic workflow belongs in `SKILL.md`.
- Deterministic contracts belong in code, help, generated docs, checks, or tests.
- Local paths, accounts, preferences, installed-tool state, and environment setup may vary by user or machine.

Consequences:

- Setup/config can carry local context that reusable skill prose should not hardcode.
- Skill authors do not move ordinary workflow detail into config just because the skill got long.
- Long generic workflows should be pruned, split through progressive disclosure, or moved to scripts when deterministic.

Next:

- Continue grilling durable skill memory placement.

V2 Ideas:

- Add setup/config examples only after observed skill setup failures.

## Decision 55: Route Durable Skill Memory By Owner First

```yaml
id: decisions-skill-055
status: accepted
decided_at: "2026-06-08"
decision: Route durable skill memory by owner first
owner: context/skill-design-philosophy.md
scope: context/references/skill-memory-storage-routing.md
source:
  - "chat: 2026-06-08 durable skill memory routing decision"
decision_mode:
  question: What should the philosophy guide say about durable skill memory?
  option: owner-first storage routing
  confidence: strong
```

Decision:

- Choose durable skill memory storage by owner first.
- Then choose by memory kind, mutability, privacy, query need, and recovery need.
- Keep the storage routing table in `context/references/skill-memory-storage-routing.md`.

Rationale:

- Durable memory can live in many valid stores.
- A single default would hide ownership, privacy, and recovery trade-offs.
- The philosophy guide should point to the routing map instead of becoming a storage catalog.

Consequences:

- The philosophy guide names owner-first routing as the rule.
- `context/references/skill-memory-storage-routing.md` owns the detailed routing table.
- Future storage choices use the routing reference before adding skill prose or runtime machinery.

Next:

- Add a thin skill that other skills can use when storage ownership is unclear.

V2 Ideas:

- Add examples for common storage choices after observed confusion.

## Decision 56: Create Skill Memory Store Chooser

```yaml
id: decisions-skill-056
status: accepted
decided_at: "2026-06-08"
decision: Create skill memory store chooser
owner: skills/choose-skill-memory-store
scope: skills/choose-skill-memory-store/SKILL.md
source:
  - "chat: 2026-06-08 durable skill memory routing decision"
```

Decision:

- Add `choose-skill-memory-store` as a thin routing skill.
- Other skills can hand off to it when memory storage is unclear.

Rationale:

- Storage choice crosses skill workflow, repo docs, user config, runtime state, external memory, and vendor memory.
- A thin chooser prevents each skill from copying the routing table.
- The chooser keeps the operating manual in `context/references/skill-memory-storage-routing.md`.

Consequences:

- `choose-skill-memory-store` reads the routing reference and recommends a bucket, owner path, rejected nearby buckets, and next safe action.
- It does not own accepted decision storage; accepted repo decisions still route to `decisions`.
- It escalates runtime-backed storage design to `create-agent-native-skill` when side effects, privacy, durability, or recovery change.

Next:

- Use the chooser when future skill memory storage choices are unclear.

V2 Ideas:

- Add scripts or checks only if repeated storage mistakes prove prose routing is not enough.

## Decision 57: Harden Memory Storage Routing With Two-Phase Safety Gates

```yaml
id: decisions-skill-057
status: accepted
decided_at: "2026-06-08"
decision: Harden memory storage routing with two-phase safety gates
owner: context/references/skill-memory-storage-routing.md
scope: skills/choose-skill-memory-store/SKILL.md
source:
  - "chat: 2026-06-08 adversarial memory storage routing review"
```

Decision:

- Memory storage routing is two-phase.
- First choose owner, privacy, canonicity, and write authority.
- Then choose storage shape, query layer, projection, or runtime format.
- Durable stores require sensitivity, retention, deletion, and write-gate checks.

Rationale:

- Adversarial review showed that format buckets could override canonical ownership.
- Secrets, vendor memory, XDG stores, JSON logs, SQLite/vector stores, and cross-repo recall need sharper privacy gates.
- Skill drivers need a recommendation status and assumptions before acting.

Consequences:

- `context/references/skill-memory-storage-routing.md` now has required facts, precedence, tie breakers, safety defaults, runtime add-ons, stronger write gates, and explicit credential routing.
- `choose-skill-memory-store` now returns status, assumptions, safety stance, truth stance, operations needed, and next safe action.
- `context/skill-design-philosophy.md` uses canonical `skill driver` language and scopes refresh/status to mutable stored state.

Next:

- Validate docs and continue using adversarial review when storage routing changes.

V2 Ideas:

- Add a checker only if agents repeatedly choose format before owner or write durable sensitive state without gates.

## Decision 58: Track Skill Philosophy Hardening In Scoped Tasks File

```yaml
id: decisions-skill-058
status: accepted
decided_at: "2026-06-08"
decision: Track skill philosophy hardening in scoped tasks file
owner: context/skill-design/TASKS.md
scope: context/skill-design
source:
  - "chat: 2026-06-08 skill philosophy hardening tracker request"
```

Decision:

- Track the skill philosophy hardening project in `context/skill-design/TASKS.md`.
- Use the tracker for hardened rules, active work, open questions, research queue, candidate audits, decision-log queue, validation, and next safe action.

Rationale:

- Skill philosophy hardening has become a multi-session project.
- A scoped tracker makes progress visible without turning the philosophy guide into a project log.
- Future sessions need a fast map of what is done and what still needs grilling.

Consequences:

- Next sessions start from the tracker before editing the philosophy guide.
- Accepted durable rules still go to this decision log.
- Unresolved branches stay in the tracker until accepted.

Next:

- Create a handoff for the next hardening session.

V2 Ideas:

- Add checklist automation only if manual tracker upkeep drifts.

## Decision 59: Route Project Tracking Memory To Scoped Tasks Files

```yaml
id: decisions-skill-059
status: accepted
decided_at: "2026-06-08"
decision: Route project tracking memory to scoped tasks files
owner: context/references/skill-memory-storage-routing.md
scope: context/skill-design/TASKS.md
source:
  - "chat: 2026-06-08 tasks file durable memory routing decision"
```

Decision:

- Route project tracking memory to scoped `TASKS.md` or project tracker files.
- Treat `TASKS.md` as durable work-state memory.
- Do not use `TASKS.md` as a rulebook, decision log, or domain glossary.

Rationale:

- Skill philosophy hardening has progress, queues, open questions, audits, and next actions that need to survive sessions.
- This memory is durable but not accepted truth.
- Without a tracker bucket, agents may dump work state into `SKILL.md`, `CONTEXT.md`, or decision logs.

Consequences:

- `choose-skill-memory-store` can recommend a tracker route for work queues, progress, open questions, audits, and next actions.
- Accepted decisions still go to `docs/decisions/`.
- Domain terms still go to nearest `CONTEXT.md`.
- Rules still go to the philosophy or rulebook owner.

Next:

- Keep `context/skill-design/TASKS.md` current during philosophy hardening.

V2 Ideas:

- Add tracker shape examples only if multiple task trackers drift.

## Decision 60: Define CONTEXT.md As Domain-Language Owner

```yaml
id: decisions-skill-060
status: accepted
decided_at: "2026-06-08"
decision: Define CONTEXT.md as domain-language owner
owner: context/references/skill-memory-storage-routing.md
scope: CONTEXT.md
source:
  - "chat: 2026-06-08 improve-codebase-architecture context routing decision"
  - "/Users/nathanvale/.agents/skills/improve-codebase-architecture/SKILL.md"
```

Decision:

- Use `CONTEXT.md` for project-specific domain vocabulary.
- Store canonical terms, tight definitions, avoided aliases, explicit ambiguities, and obvious relationships there.
- Use the nearest scoped `CONTEXT.md` before root context.
- Keep architecture vocabulary in the architecture skill owner.
- Keep decisions, project tracking, workflows, research, setup facts, generic programming concepts, and implementation details out of `CONTEXT.md`.

Rationale:

- `improve-codebase-architecture` relies on `CONTEXT.md` to name architecture candidates in domain language.
- Domain language helps agents identify useful seams without inventing names from filenames or implementation details.
- A sharper `CONTEXT.md` boundary prevents it from becoming another dumping ground.

Consequences:

- Memory routing now defines what belongs in `CONTEXT.md`.
- Architecture-aware agents can use `CONTEXT.md` as domain-language input.
- Future storage choices route non-domain material to the proper owner.

Next:

- Keep `CONTEXT.md` updates focused on durable domain language.

V2 Ideas:

- Add examples only after repeated `CONTEXT.md` routing drift.

## Decision 61: Split Agent-Native CLI Vocabulary Into Scoped Context

```yaml
id: decisions-skill-061
status: accepted
decided_at: "2026-06-08"
decision: Split agent-native CLI vocabulary into scoped context
owner: docs/agents/domain.md
scope: context/agent-native-cli/CONTEXT.md
source:
  - "chat: 2026-06-08 agent-native CLI scoped context decision"
```

Decision:

- Move general agent-native CLI and facade vocabulary to `context/agent-native-cli/CONTEXT.md`.
- Keep root `CONTEXT.md` for global, Issue-to-PR, Browser Adapter, and project-wide vocabulary.
- Keep `context/skill-design/CONTEXT.md` focused on skill authoring, routing, invocation, and progressive disclosure.

Rationale:

- Root `CONTEXT.md` had a dense cluster of general CLI runtime terms.
- `context/skill-design/CONTEXT.md` already excludes agent-native CLI and facade vocabulary.
- A scoped owner keeps CLI design language available without making the root glossary carry every runtime term.

Consequences:

- Root `CONTEXT.md` points to `context/agent-native-cli/CONTEXT.md`.
- Startup health checks require the scoped agent-native CLI context owner.
- Future general CLI, facade, discovery, output, repair, retry, safety, and runtime-contract terms belong in the scoped context.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Split more root vocabulary only when a stable scoped owner boundary is evident.

## Decision 62: Route Architecture-Shaped Context Maintenance Through ICA

```yaml
id: decisions-skill-062
status: accepted
decided_at: "2026-06-08"
decision: Route architecture-shaped context maintenance through ICA
owner: docs/agents/domain.md
scope: CONTEXT.md
source:
  - "chat: 2026-06-08 context maintenance ICA routing decision"
  - "/Users/nathanvale/.agents/skills/improve-codebase-architecture/SKILL.md"
```

Decision:

- Mention `improve-codebase-architecture` from `CONTEXT.md` maintenance routing.
- Use `improve-codebase-architecture` when maintaining domain terms for architecture deepening, seam naming, module candidates, or architecture review output.
- Keep architecture vocabulary in the architecture skill owner, not `CONTEXT.md`.

Rationale:

- `CONTEXT.md` helps architecture reviews use durable domain language.
- The ICA skill owns architecture review vocabulary and process.
- A route pointer helps agents maintain the glossary without turning it into an architecture rulebook.

Consequences:

- Root `CONTEXT.md` points at `docs/agents/domain.md` and `improve-codebase-architecture`.
- `docs/agents/domain.md` tells agents when ICA assists glossary maintenance.
- Storage routing keeps the same boundary: domain terms in `CONTEXT.md`, architecture terms in the ICA skill owner.

Next:

- Keep context-maintenance routing short and owner-based.

V2 Ideas:

- Add a context-maintenance checker only if agents keep copying architecture vocabulary into `CONTEXT.md`.

## Decision 63: Keep Skill Description Audits Event-Triggered

```yaml
id: decisions-skill-063
status: accepted
decided_at: "2026-06-08"
decision: Keep skill description audits event-triggered
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 skill description audit decision"
decision_mode:
  question: Should skill descriptions get a periodic audit workflow?
  option: event-triggered only
  confidence: strong
```

Decision:

- Audit skill descriptions after observed routing failure, nearby skill collision, skill rename, or review/healing of the touched skill.
- Do not add calendar-style periodic description audits in v1.
- Add periodic review only after repeated missed routing failures show event-triggered review is insufficient.

Rationale:

- The philosophy guide already patches descriptions when skills under-trigger, over-trigger, or collide.
- A periodic audit workflow adds process before repeated evidence proves event-triggered review is being missed.
- Event-triggered review fits the current rule to harden from observed failures first.

Consequences:

- Skill review stays local and evidence-led.
- The tracker keeps description audits as a candidate audit, not a recurring workflow.
- Future periodic audit machinery needs repeated failure evidence.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a periodic description audit or checker only if local review misses routing failures repeatedly.

## Decision 64: Defer Skill Bridge Checker Until Clutter Appears

```yaml
id: decisions-skill-064
status: accepted
decided_at: "2026-06-08"
decision: Defer skill bridge checker until clutter appears
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 bridge checker evidence review"
decision_mode:
  question: Has bridge clutter earned a checker?
  option: no checker yet
  confidence: strong
```

Decision:

- Do not add a skill bridge checker in v1.
- Keep bridge cleanup as manual reference audit plus nearby review.
- Add a checker only after repeated old-name references, stale bridges, or bridge clutter show manual audit is failing.

Rationale:

- Existing bridge rules are new and lightweight.
- Repo evidence shows bridge concepts and domain aliases, not accumulated skill rename bridges.
- A checker would add machinery before repeated evidence earns it.

Consequences:

- Skill bridge metadata stays prose-only.
- Reviewers keep using `rg` or equivalent reference search for bridge removal.
- Future checker work needs evidence of manual audit drift.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a bridge checker if old skill names accumulate or local review repeatedly misses stale bridges.

## Decision 65: Defer Memory Storage Examples Until Observed Confusion

```yaml
id: decisions-skill-065
status: accepted
decided_at: "2026-06-08"
decision: Defer memory storage examples until observed confusion
owner: context/references/skill-memory-storage-routing.md
scope: context/references/skill-memory-storage-routing.md
source:
  - "chat: 2026-06-08 memory storage examples evidence review"
decision_mode:
  question: Does memory storage routing need examples for common cases now?
  option: defer examples until observed confusion
  confidence: strong
```

Decision:

- Do not add memory-storage examples for common cases yet.
- Add examples only after observed routing confusion shows the current routing map is insufficient.
- Keep future examples in `context/references/skill-memory-storage-routing.md`, not the philosophy rulebook.

Rationale:

- The routing map already names decision order, required facts, precedence, routing buckets, safety defaults, write gates, and next safe actions.
- The tracker still carries research work for XDG patterns and durable agent memory privacy.
- Examples without source research could turn convenience cases into accidental contracts.

Consequences:

- `context/skill-design-philosophy.md` points to the examples rule without becoming a storage catalog.
- Future examples need observed confusion plus source-backed routing.
- The research queue remains the right place for XDG and privacy prep.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add common-case examples after repeated chooser misuse or storage-bucket confusion.

## Decision 66: Defer Project Tracker Shape Examples Until Multiple Trackers Drift

```yaml
id: decisions-skill-066
status: accepted
decided_at: "2026-06-08"
decision: Defer project tracker shape examples until multiple trackers drift
owner: context/references/skill-memory-storage-routing.md
scope: context/references/skill-memory-storage-routing.md
source:
  - "chat: 2026-06-08 project tracker shape example review"
decision_mode:
  question: Does project-tracking memory need a shape example now?
  option: defer until repeated drift across multiple trackers
  confidence: strong
```

Decision:

- Do not add project-tracker shape examples yet.
- Add tracker shape examples only after repeated drift appears across multiple scoped trackers.
- Keep accepted truth out of `TASKS.md` regardless of whether examples exist.

Rationale:

- `context/skill-design/TASKS.md` is the first scoped tracker for this hardening project.
- Decision 59 already defines tracker ownership and boundaries.
- A shape example would be premature before multiple trackers show a shared drift pattern.

Consequences:

- `context/references/skill-memory-storage-routing.md` names the trigger for future tracker examples.
- Current tracker maintenance remains terse and local.
- Future examples need repeated cross-tracker drift evidence.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a tracker-shape reference after multiple scoped trackers accumulate inconsistent sections, queues, or truth boundaries.

## Decision 67: Defer CONTEXT.md Examples Until Routing Drift Appears

```yaml
id: decisions-skill-067
status: accepted
decided_at: "2026-06-08"
decision: Defer CONTEXT.md examples until routing drift appears
owner: context/references/skill-memory-storage-routing.md
scope: CONTEXT.md
source:
  - "chat: 2026-06-08 context examples routing review"
decision_mode:
  question: Do CONTEXT.md examples need a routing reference now?
  option: defer until repeated routing drift
  confidence: strong
```

Decision:

- Do not add `CONTEXT.md` examples yet.
- Add examples only after repeated routing drift shows agents cannot distinguish domain terms from decisions, workflows, research, setup facts, or implementation details.
- Keep future examples in a routing reference, not root `CONTEXT.md`.

Rationale:

- Recent decisions already define `CONTEXT.md` as the project-specific domain-language owner.
- Root `CONTEXT.md` should stay a glossary, not a tutorial or project log.
- Examples can help later, but they carry the risk of becoming copied policy or generic instruction bloat.

Consequences:

- `context/references/skill-memory-storage-routing.md` names the trigger and owner boundary for future examples.
- Root and scoped `CONTEXT.md` files stay focused on vocabulary.
- Future examples need repeated routing drift evidence.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a `CONTEXT.md` routing examples reference after repeated glossary updates land in the wrong owner.

## Decision 68: Maintain Source Note For Community Skill Research

```yaml
id: decisions-skill-068
status: accepted
decided_at: "2026-06-08"
decision: Maintain source note for community skill research
owner: context/references/community-skill-research-sources.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 community skill source note review"
  - "https://code.claude.com/docs/en/skills"
  - "https://code.claude.com/docs/en/agent-sdk/skills"
  - "https://arxiv.org/abs/2605.23904"
decision_mode:
  question: Should community-skill research have a maintained source note?
  option: maintain a source note
  confidence: strong
```

Decision:

- Maintain `context/references/community-skill-research-sources.md` as the source note for community-skill rules.
- Read it before changing community-skill rules in `context/skill-design-philosophy.md`.
- Update it when external docs, papers, marketplace examples, or public repos change a community-skill rule.

Rationale:

- Community-skill rules rely on external docs, research papers, local research, and public examples.
- The philosophy guide should stay a rulebook, not a research dump.
- A source note preserves freshness and provenance without copying external contracts into skill prose.

Consequences:

- Future community-skill rule changes have a named source owner.
- Marketplace, awesome-list, Reddit, blog, and public-repo examples remain examples, not trusted contracts.
- Official docs and papers can inform rules after source-date refresh.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a richer research digest only if source-note maintenance becomes too cramped.

## Decision 69: Keep create-agent-native-skill One-File For Now

```yaml
id: decisions-skill-069
status: superseded
decided_at: "2026-06-08"
decision: Keep create-agent-native-skill one-file for now
owner: skills/create-agent-native-skill/SKILL.md
scope: skills/create-agent-native-skill
source:
  - "chat: 2026-06-08 create-agent-native-skill reference threshold review"
decision_mode:
  question: Does create-agent-native-skill need a reference file now?
  option: keep one-file until repeated use exposes reusable detail
  confidence: strong
```

Decision:

- Keep `skills/create-agent-native-skill/SKILL.md` as a one-file skill for now.
- Add `references/` only after repeated use exposes reusable detail that would bloat `SKILL.md`.
- Continue delegating depth to existing owner paths: skill philosophy, `cli-author` references, I/O shape examples, and the decisions operating manual.

Rationale:

- The current skill body is small and route-complete.
- Existing owner paths already hold the deeper CLI, facade, I/O, and decision-memory guidance.
- A new reference file would add one more place to check before repeated use proves it earns the load.

Consequences:

- Runtime-backed skill creation remains a thin routing skill.
- Future reference extraction needs repeated-use evidence.
- Exact contracts stay in code, help, generated docs, and tests.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Add a one-level reference if repeated runtime-backed skill creation sessions keep needing the same missing detail.

Superseded by Decision 89.

## Decision 70: Keep Existing-Skill Audits Scoped

```yaml
id: decisions-skill-070
status: accepted
decided_at: "2026-06-08"
decision: Keep existing-skill audits scoped
owner: context/skill-design-philosophy.md
scope: context/skill-design/TASKS.md
source:
  - "chat: 2026-06-08 existing skills audit scope review"
decision_mode:
  question: Should existing skills be audited against the hardened philosophy now?
  option: keep audits scoped to selected targets or observed failures
  confidence: strong
```

Decision:

- Do not start a repo-wide audit of existing skills from philosophy changes alone.
- Keep existing-skill audits as scoped candidate audits.
- Run an audit when a target is selected, a skill is touched, or observed failure shows the audit is needed.

Rationale:

- The tracker already lists candidate audits for descriptions, copied contracts, references, scripts, bridges, and memory-writing skills.
- A broad sweep would be high-churn and weakly tied to observed failures.
- Scoped audits preserve momentum and make findings reviewable.

Consequences:

- Philosophy hardening does not silently create a repo-wide cleanup project.
- Candidate audits stay in `context/skill-design/TASKS.md`.
- Future audit work needs a selected target or evidence trigger.

Next:

- Continue grilling unresolved skill philosophy edges one decision at a time.

V2 Ideas:

- Promote one candidate audit to active work when a concrete skill family or failure pattern earns it.

## Decision 71: Gate Old-Skill Alias Cleanup By Evidence

```yaml
id: decisions-skill-071
status: accepted
decided_at: "2026-06-08"
decision: Gate old-skill alias cleanup by evidence
owner: context/skill-design-philosophy.md
scope: context/skill-design-philosophy.md
source:
  - "chat: 2026-06-08 old skill alias cleanup review"
decision_mode:
  question: Do old skills need rename bridges or alias cleanup now?
  option: gate cleanup by rename evidence, old-name references, or selected scoped audit
  confidence: strong
```

Decision:

- Do not run standalone old-skill alias cleanup now.
- Add rename bridges when a published skill is renamed and live old-name references need compatibility.
- Clean up old aliases only when rename evidence, old-name references, or a selected scoped audit shows they are relevant.

Rationale:

- Bridge rules already require owner, removal condition, and reference audit.
- Broad cleanup would duplicate the scoped-audit decision and create churn without a target.
- Evidence-gated cleanup keeps aliases from becoming second owners while preserving compatibility when needed.

Consequences:

- Old-skill cleanup stays local to rename work, reference audit, or selected audit scope.
- Permanent aliases still require explicit justification.
- The tracker has no remaining open question in this batch.

Next:

- Validate the full hardening batch.

V2 Ideas:

- Add alias cleanup tooling only if old names repeatedly survive reference audits.

## Decision 72: Record XDG Runtime And Path Safety In Storage Routing

```yaml
id: decisions-skill-072
status: accepted
decided_at: "2026-06-08"
decision: Record XDG runtime and path safety in storage routing
owner: context/references/skill-memory-storage-routing.md
scope: XDG-backed skill memory stores
source:
  - "chat: 2026-06-08 Firecrawl XDG research"
  - "https://specifications.freedesktop.org/basedir/latest/"
```

Decision:

- Add `runtime` as a storage memory kind.
- Route sockets, named pipes, locks, and per-login runtime files to `$XDG_RUNTIME_DIR`.
- Treat runtime files as logout/reboot scoped.
- Ignore relative XDG environment paths.
- Create missing XDG destination directories with `0700`.
- Keep storage examples deferred until observed routing confusion earns them.

Rationale:

- The official XDG Base Directory Specification separates runtime files from state, data, config, and cache.
- Runtime files do not survive reboot or full logout, so they are not durable memory.
- The spec requires absolute XDG environment paths and private destination directories for writes.
- The existing routing map already had state, data, config, and cache, but missed runtime and path-safety behavior.

Consequences:

- Future skill memory routing can distinguish restartable state from per-login runtime coordination.
- Agents get a repairable rule for invalid relative XDG variables instead of silently trusting them.
- XDG examples remain deferred; this decision records behavior, not example shapes.

Next:

- Continue the research queue with durable agent memory privacy patterns.

V2 Ideas:

- Add sourced XDG examples only after repeated routing confusion appears.

## Decision 73: Add Durable Agent Memory Privacy Gates Before Schemas

```yaml
id: decisions-skill-073
status: accepted
decided_at: "2026-06-08"
decision: Add durable agent memory privacy gates before schemas
owner: context/references/skill-memory-storage-routing.md
scope: durable agent memory privacy
source:
  - "chat: 2026-06-08 durable agent memory privacy decision"
  - "https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html"
decision_mode:
  question: Should durable agent memory privacy add rules now?
  option: privacy gates only
  confidence: strong
```

Decision:

- Add privacy gates before durable agent memory writes.
- Require data class, isolation boundary, retention, deletion route, redaction stance, and write authority before writing.
- Validate and sanitize untrusted content before persistence.
- Bound durable memory with expiration or size limits unless the owner explicitly accepts unbounded retention.
- Defer schema/check machinery until agents rely on fields or repeated privacy-invalid writes show manual gates are failing.

Rationale:

- Durable memory can preserve sensitive data, injected content, or stale private facts across future runs.
- OWASP agent guidance calls out memory poisoning and sensitive data exposure, then recommends validation, sanitization, memory isolation, expiration, size limits, and sensitive-data audit before persistence.
- The routing map already had secret handling and write gates; the missing layer was durable-memory-specific privacy gating.
- Schemas and checkers carry maintenance cost and should wait for field reliance or observed privacy failures.

Consequences:

- Future durable memory writes block earlier when privacy facts are missing.
- Agents can choose Markdown, JSON, SQLite, vector, or vendor memory only after privacy gates pass.
- Schema/check guidance remains evidence-gated, not automatic.

Next:

- Continue the research queue with public skill marketplaces as examples, not contracts, or re-run QMD recall before broadening community-skill rules.

V2 Ideas:

- Add schema/check owners after repeated privacy-invalid writes or field-reliant agents appear.

## Decision 74: Add Description Crossover Audit Script

```yaml
id: decisions-skill-074
status: accepted
decided_at: "2026-06-08"
decision: Add a read-only script for skill description crossover audits
owner: scripts/skill-description-audit.ts
scope: skill description routing hygiene
source:
  - "chat: 2026-06-08 description crossover script request"
decision_mode:
  question: Should future skill description crossovers have a mechanical check?
  option: add a read-only audit script with warning-level crossover findings
  confidence: strong
```

Decision:

- Add `scripts/skill-description-audit.ts` as the owner for mechanical skill-description audits.
- Fail only for malformed, missing, or overlong descriptions.
- Warn for likely routing crossovers.
- Keep `--strict` available when a selected cleanup wants warnings to fail.
- Keep quote-style checks optional through `--check-style`.

Rationale:

- New skills can introduce description overlap after the manual audit is complete.
- A read-only script gives future agents a cheap cross-reference pass without turning every warning into churn.
- Collision warnings still need judgment because overlap can be legitimate between adjacent skills.
- Event-triggered use preserves the earlier choice not to add periodic description audits.

Consequences:

- Future skill additions, renames, and description edits have a repeatable audit path.
- Existing crossover families become visible as review candidates.
- Broken skill symlinks are surfaced without blocking ordinary report-only runs.

Next:

- Run the new script after description changes.
- Continue with the scripts audit when selected.

V2 Ideas:

- Add a baseline file or CI gate only after repeated future description collisions survive manual review.

## Decision 75: Consolidate Skill Authoring Into Create Skill After Archive Cleanup

```yaml
id: decisions-skill-075
status: accepted
decided_at: "2026-06-08"
decision: Consolidate skill authoring into create-skill after archive cleanup
owner: skills/create-skill/SKILL.md
scope: portable skill-authoring bundle
source:
  - "chat: 2026-06-08 archive-first skill cleanup and create-skill consolidation"
decision_mode:
  question: Should scattered skill philosophy and references consolidate into one portable skill?
  option: archive-first cleanup, then consolidate into skills/create-skill
  confidence: strong
```

Decision:

- Create `skills/create-skill/` as the portable owner for skill authoring, cleanup, consolidation, and research portability.
- Run archive-first cleanup before polishing or consolidating deprecated skills.
- Keep `context/` skill-design files as temporary transition sources until `create-skill` owns the reusable material.
- Add handover documents to the project tracker before extracting portable rules.

Rationale:

- Active skill lists are noisy enough that polishing every existing skill would waste effort.
- A portable skill bundle can travel between repos better than scattered `context/` files.
- Archive-first cleanup reduces the consolidation surface.
- Keeping transition sources avoids a broad move before the active skill set is accepted.

Consequences:

- Future skill cleanup starts with `skills/create-skill/references/archive-cleanup.md`.
- Future consolidation starts with `skills/create-skill/references/consolidation-map.md`.
- Future handover and research intake starts with `skills/create-skill/references/research-portability.md`.
- Existing `create-agent-skills`, `create-agent-native-skill`, and `choose-skill-memory-store` are now consolidation candidates.

Next:

- Ask for must-keep-active skills.
- Draft the archive move list.
- Move one owner surface at a time into `skills/create-skill/`.

V2 Ideas:

- Replace old skill-authoring skills with temporary bridges after the active list is accepted.

## Decision 76: Make Create Skill The Single Skill Context Owner

```yaml
id: decisions-skill-076
status: accepted
decided_at: "2026-06-08"
decision: Make create-skill the single owner for skill-authoring context
owner: skills/create-skill/CONTEXT.md
scope: skill-authoring context consolidation
source:
  - "chat: 2026-06-08 consolidate context folders into create-skill"
  - "ica-seam-swarm: 2026-06-08 create-skill context cleanup"
decision_mode:
  question: Should scattered skill context folders become one portable create-skill context?
  option: skills/create-skill owns the consolidated context; old context paths become owner-path redirect stubs
  confidence: strong
```

Decision:

- Make `skills/create-skill/CONTEXT.md` the owner for portable skill-design, capability, and agent-native helper vocabulary.
- Move skill philosophy and supporting references into `skills/create-skill/references/`.
- Move the skill-description audit script into `skills/create-skill/scripts/`.
- Keep root `scripts/skill-description-audit.ts` as a compatibility wrapper.
- Keep old `context/` skill-authoring files as owner-path redirect stubs until external references are gone.

Rationale:

- The user wants one portable skill bundle instead of scattered context islands.
- A single context owner reduces routing drift and duplicate glossary maintenance.
- Owner-path redirect stubs preserve compatibility while blocking new content in old paths.
- The swarm review found detailed CLI runtime vocabulary belonged outside the consolidated glossary.

Consequences:

- Startup checks now require `skills/create-skill/SKILL.md`, `skills/create-skill/CONTEXT.md`, and the bundled philosophy reference.
- Active skill-authoring work starts from `skills/create-skill/`.
- Historical plans and decisions can keep historical paths.
- Future cleanup should replace remaining active references before deleting owner-path redirect stubs.

Next:

- Continue archive-first skill cleanup.
- Review must-keep-active skills before moving skills into `skills/archive/`.
- Remove owner-path redirect stubs only after an active-reference audit is clean.

V2 Ideas:

- Add a redirect-stub expiry checker only if stale owner-path redirect stubs survive repeated cleanup passes.

## Decision 77: Resolve Create Skill Owner Split

```yaml
id: decisions-skill-077
status: superseded
decided_at: "2026-06-08"
decision: Resolve create-skill owner split
owner: skills/create-skill/SKILL.md
scope: skill-authoring capability ownership
source:
  - "chat: 2026-06-08 full ICA swarm hardening review"
  - "ica-seam-swarm: 2026-06-08 create-skill owner split review"
decision_mode:
  question: How should create-skill relate to sibling skill-authoring helpers?
  option: create-skill owns ordinary skill authoring; create-agent-native-skill and choose-skill-memory-store stay specialist helpers
  confidence: strong
```

Decision:

- Make `skills/create-skill/` the canonical capability for ordinary skill authoring, audit, repair, archive, consolidation, and research portability.
- Convert `skills/create-agent-skills/SKILL.md` into a temporary skill bridge to `skills/create-skill/SKILL.md`.
- Keep `skills/create-agent-native-skill/SKILL.md` active as the specialist helper for runtime-backed capability shaping.
- Keep `skills/choose-skill-memory-store/SKILL.md` active as the manual fallback chooser for unclear memory storage routing.
- Keep legacy `create-agent-skills` references and templates for extraction review only.

Rationale:

- The full ICA swarm found `create-agent-skills` still exposed a competing Interface for ordinary skill creation.
- Bridging the old published skill name preserves routing compatibility while removing duplicate ownership.
- Runtime-backed capability shaping and memory storage routing are narrower specialist paths that still earn separate owner paths.

Consequences:

- Ordinary skill-authoring requests start at `skills/create-skill/SKILL.md`.
- Runtime-backed capability design starts at `skills/create-agent-native-skill/SKILL.md`.
- Unclear durable skill memory storage starts at `skills/choose-skill-memory-store/SKILL.md`.
- Old context files remain owner-path redirect stubs with explicit removal conditions.

Next:

- Run active-reference audits before removing redirect stubs or the `create-agent-skills` skill bridge.
- Extract any reusable legacy templates into `create-skill` owner paths before archiving legacy files.

V2 Ideas:

Superseded by Decisions 86 and 89.

- Add a bridge or redirect expiry check only if stale compatibility paths survive repeated cleanup passes.

## Decision 78: Reject Pure XML Skill Body Guidance

```yaml
id: decisions-skill-078
status: accepted
decided_at: "2026-06-08"
decision: Reject pure XML skill body guidance
owner: skills/create-skill/references/skill-design-philosophy.md
scope: skill file structure and prompt boundary guidance
source:
  - "Firecrawl: 2026-06-08 Claude Code skills docs"
  - "Firecrawl: 2026-06-08 Anthropic prompt engineering best practices"
  - "Firecrawl: 2026-06-08 OpenAI prompt engineering docs"
  - "local: skills/create-agent-skills/references/use-xml-tags.md"
decision_mode:
  question: Should XML guidance stay in the skill design philosophy?
  option: reject pure XML skill-body rules; keep XML only as scoped prompt/content boundary guidance
  confidence: strong
```

Decision:

- Use YAML frontmatter plus Markdown instructions as the default `SKILL.md` structure.
- Reject legacy pure XML skill-body rules from `skills/create-agent-skills/`.
- Keep XML-like tags only for prompt packets, examples, quoted inputs, or long-context content boundaries where Markdown is weaker.
- Do not wrap helper-validated YAML, JSON envelopes, Markdown references, CLI help, or generated docs in XML.

Rationale:

- Current Claude Code skills docs define `SKILL.md` as frontmatter plus Markdown content.
- Current Anthropic prompt guidance still supports XML tags for complex prompt boundaries.
- Current OpenAI prompt guidance supports Markdown and XML together for logical prompt boundaries.
- Legacy `create-agent-skills` XML rules conflict with current skill-file shape and duplicate existing contracts.

Consequences:

- `create-skill` philosophy keeps XML as a narrow prompt-boundary tool, not a file-structure contract.
- `create-agent-skills` extraction review records pure XML skill-body material as rejected.
- Future skill examples use Markdown headings unless a runtime or prompt packet earns XML-like boundaries.

Next:

- Continue `create-agent-skills` extraction review.
- Move only scoped prompt-boundary examples that pass source review.

V2 Ideas:

- Add a lint only if pure XML skill-body guidance reappears in active skill owner paths.

## Decision 79: Accept First Keep-Active Skill List

```yaml
id: decisions-skill-079
status: accepted
decided_at: "2026-06-08"
decision: Accept first keep-active skill list
owner: skills/create-skill/references/archive-cleanup.md
scope: archive-first skill cleanup
source:
  - "chat: 2026-06-08 keep-active skill list"
decision_mode:
  question: Which skills must stay active outside skills/archive?
  option: keep the normalized user-selected active list and investigate startup-protected omissions before archive
  confidence: strong
```

Decision:

- Keep these skills active:
  - `browser-domain-memory`
  - `browser-use`
  - `choose-skill-memory-store`
  - `cli-author`
  - `create-skill`
  - `decision-mode`
  - `decisions`
  - `draft-message`
  - `fallow`
  - `grill-with-docs`
  - `handoff`
  - `heal-skill`
  - `improve-codebase-architecture`
  - `productivity-sync`
  - `prototype`
  - `summarize`
  - `to-issues`
  - `to-prd`
  - `triage`
- Normalize user typos to existing skill directory names.
- Move omitted startup-referenced or owner-path skills into protected investigation before any archive move.

Rationale:

- Archive cleanup needs a named active baseline before extraction and move planning.
- Normalizing obvious typos preserves intent without creating duplicate skill names.
- Startup-referenced omissions need review before archive because removing them could break instruction routes.

Consequences:

- `archive-cleanup.md` now owns the accepted keep-active list.
- `productivity-connectors`, `capture`, `issue-to-pr`, `runbook-orchestrator`, `test-runner`, and `work-style-convert` stay protected investigation candidates.
- Remaining skills can be sorted into archive or investigation after reference checks.

Next:

- Audit `create-agent-skills` extraction material against the accepted active baseline.
- Inventory remaining non-kept skills before drafting archive moves.

V2 Ideas:

- Add a generated archive plan only after the first accepted move list is drafted.

## Decision 80: Add Personal Workflow Skills To Keep-Active

```yaml
id: decisions-skill-080
status: accepted
decided_at: "2026-06-08"
decision: Add personal workflow skills to keep-active
owner: skills/create-skill/references/archive-cleanup.md
scope: archive-first skill cleanup
source:
  - "chat: 2026-06-08 keep peekaboo one-password classic-cinema"
decision_mode:
  question: Should selected personal workflow skills stay active?
  option: keep peekaboo, one-password, and classic-cinema active
  confidence: strong
```

Decision:

- Keep `peekaboo` active.
- Keep `one-password` active.
- Keep `classic-cinema` active.
- Remove these skills from personal workflow archive review.

Rationale:

- The user explicitly selected these personal workflow skills to remain active.
- Keeping them named prevents future archive passes from reclassifying them by low reference count alone.

Consequences:

- Archive planning treats these skills as active even if repo references are low.
- Personal usefulness can override reference-count heuristics when explicitly accepted.

Next:

- Continue archive review for remaining personal workflow candidates.

V2 Ideas:

- Add a short owner note only if personal workflow keep decisions become hard to trace.

## Decision 81: Promote Hard-Routed Protected Skills

```yaml
id: decisions-skill-081
status: accepted
decided_at: "2026-06-08"
decision: Promote hard-routed protected skills
owner: skills/create-skill/references/archive-cleanup.md
scope: archive-first skill cleanup
source:
  - "chat: 2026-06-08 protected skill decision"
decision_mode:
  question: Should protected investigation skills become keep-active?
  option: promote hard-routed skills only
  confidence: strong
```

Decision:

- Keep `productivity-connectors` active because startup instructions route calendar, email, and contact work through it.
- Keep `test-runner` active because code-quality rules route Bun tests through it.
- Keep `work-style-convert` active because work-style cleanup depends on it.
- Keep `capture`, `issue-to-pr`, and `runbook-orchestrator` as protected investigation candidates.

Rationale:

- Hard-routed skills need replacement routes before archive.
- Promoting only hard-routed skills avoids keeping every referenced workflow active by default.
- Larger workflow systems still need inspection because they may carry stale runbook or memory behavior.

Consequences:

- Archive planning treats hard-routed skills as active.
- Protected investigation now means dependency risk remains, not user-approved active status.
- `capture`, `issue-to-pr`, and `runbook-orchestrator` stay blocked from archive until reviewed.

Next:

- Inspect `capture`, `issue-to-pr`, and `runbook-orchestrator` before any archive move.

V2 Ideas:

- Add replacement-route notes if any protected investigation skill moves to archive.

## Decision 82: Archive Capture During Memory OS Pivot

```yaml
id: decisions-skill-082
status: accepted
decided_at: "2026-06-08"
decision: Archive capture during Memory OS pivot
owner: skills/create-skill/references/archive-cleanup.md
scope: archive-first skill cleanup
source:
  - "chat: 2026-06-08 archive capture and pivot away from Memory OS"
decision_mode:
  question: Should capture stay active as manual Memory OS capture?
  option: archive capture because Memory OS is being replaced
  confidence: strong
```

Decision:

- Archive `skills/capture/` under `skills/archive/capture/`.
- Treat the old manual Memory OS capture front door as deprecated.
- Keep remaining Memory OS references for a separate replacement-model cleanup pass.

Rationale:

- The user explicitly wants to move away from Memory OS.
- Keeping `capture` active would preserve the old model as a live route.
- Archiving the skill creates a clean boundary while preserving its contents for reference.

Consequences:

- Manual Memory OS capture is no longer an active skill route.
- Remaining Memory OS language in active and candidate skills needs audit before broad cleanup.
- Future replacement memory work needs a new owner model instead of reviving `capture` by default.

Next:

- Continue protected-skill review with `issue-to-pr` and `runbook-orchestrator`.
- Add a Memory OS replacement decision before editing broad memory routes.

V2 Ideas:

- Extract reusable people-note write rules only if the replacement memory model still needs them.

## Decision 83: Seed Memory OS Replacement From Storage Routing

```yaml
id: decisions-skill-083
status: accepted
decided_at: "2026-06-08"
decision: Seed Memory OS replacement from storage routing
owner: skills/create-skill/references/skill-memory-storage-routing.md
scope: Memory OS replacement direction
source:
  - "chat: 2026-06-08 Memory OS pivot to storage routing and context advisor"
decision_mode:
  question: What replaces Memory OS as the storage contract owner?
  option: use skill-memory-storage-routing as the rule seed and evolve choose-skill-memory-store toward context-advisor
  confidence: strong
```

Decision:

- Treat `skills/create-skill/references/skill-memory-storage-routing.md` as the seed for the Memory OS replacement direction.
- Review Memory OS docs before broad cleanup.
- Migrate only reusable storage routing, write-gate, privacy, retention, deletion, and ownership rules.
- Use `skills/choose-skill-memory-store/SKILL.md` as the likely seed for a future `context-advisor` skill.
- Decide the `context-advisor` name and bridge path before renaming or replacing the skill.

Rationale:

- Memory OS was primarily a storage contract and routing system.
- The replacement should keep the storage-routing value while dropping the old manual capture front door.
- `choose-skill-memory-store` already performs the core routing job.
- A rename without a bridge would break current references and accepted decisions.

Consequences:

- Memory OS cleanup is now a migration, not a deletion sweep.
- `capture` remains archived.
- Remaining Memory OS references should not be edited broadly until the replacement owner name lands.
- Future context-advisor work starts from the storage routing reference and chooser skill.

Next:

- Decide whether to rename `choose-skill-memory-store` to `context-advisor`, create a new skill, or keep the current name.
- Review Memory OS docs for reusable storage-contract rules after that ownership decision.

V2 Ideas:

- Add a runtime-backed context store manager only if storage routing needs status, inspect, migrate, repair, or write operations.

## Decision 84: Name The Replacement Skill Context Advisor

```yaml
id: decisions-skill-084
status: accepted
decided_at: "2026-06-08"
decision: Name the replacement skill context-advisor
owner: skills/create-skill/references/archive-cleanup.md
scope: Memory OS replacement naming
source:
  - "chat: 2026-06-08 context advisor naming"
decision_mode:
  question: Should the Memory OS replacement be called context-manager?
  option: use context-advisor because the skill recommends stores rather than managing content
  confidence: strong
```

Decision:

- Use `context-advisor` as the intended replacement skill name.
- Treat the skill as an advisor/router, not a content manager or runtime store.
- Move reusable chooser guidance into `create-skill` references before deciding the bridge or archive path for `choose-skill-memory-store`.

Rationale:

- `manager` implies ownership and mutation.
- The intended role is to advise where context belongs.
- `choose-skill-memory-store` already contains routing guidance that should become reference material inside `create-skill`.

Consequences:

- Future naming work uses `context-advisor`, not `context-manager`.
- The replacement skill should recommend owner paths, safety gates, and next actions.
- Runtime-backed storage management remains out of scope until repeated use earns commands.

Next:

- Extract reusable `choose-skill-memory-store` guidance into `create-skill` references.
- Decide whether `choose-skill-memory-store` becomes a temporary bridge or archives after extraction.

V2 Ideas:

- Add a runtime-backed context store manager only if advisory routing proves insufficient.

## Decision 85: Archive Choose Skill Memory Store Without Bridge

```yaml
id: decisions-skill-085
status: accepted
decided_at: "2026-06-08"
decision: Archive choose-skill-memory-store without bridge
owner: skills/create-skill/references/consolidation-map.md
scope: context-advisor migration
source:
  - "chat: 2026-06-08 no bridge for choose-skill-memory-store"
decision_mode:
  question: Does choose-skill-memory-store need a bridge after context-advisor lands?
  option: no bridge; extract useful guidance, create context-advisor, then archive old chooser
  confidence: strong
```

Decision:

- Extract useful workflow and output guidance from `skills/choose-skill-memory-store/SKILL.md`.
- Move reusable depth into `skills/create-skill/references/skill-memory-storage-routing.md`.
- Create a thin `context-advisor` skill as the new front door.
- Archive `skills/choose-skill-memory-store/` without a compatibility bridge.

Rationale:

- The old skill name is clunky and not worth preserving as a route.
- A bridge would keep stale vocabulary alive.
- The new name is clearer and matches the advisor-only responsibility.

Consequences:

- Active storage placement requests should route to `context-advisor` after creation.
- Historical decisions can keep the old name as history.
- Current references need an active-reference audit before archiving the old chooser.

Next:

- Extract chooser guidance into the storage routing map.
- Create `skills/context-advisor/SKILL.md`.
- Archive `skills/choose-skill-memory-store/`.

V2 Ideas:

- Add an alias only if observed routing failures show users still invoke the old name.

## Decision 86: Make Context Advisor Portable With Fallback

```yaml
id: decisions-skill-086
status: accepted
decided_at: "2026-06-08"
decision: Make context-advisor portable with fallback
owner: skills/context-advisor/SKILL.md
scope: context-advisor migration
source:
  - "chat: 2026-06-08 portability is king"
  - "chat: 2026-06-08 hard dependency or fallback question"
decision_mode:
  question: Should create-skill require context-advisor as a hard dependency?
  option: optional handoff with owner-reference fallback
  confidence: strong
```

Decision:

- Create `skills/context-advisor/SKILL.md` as the storage-routing advisor.
- Move the portable routing map to `skills/context-advisor/references/storage-routing.md`.
- Keep `skills/create-skill/references/skill-memory-storage-routing.md` as a legacy pointer.
- Let `create-skill` use `context-advisor` when available.
- Let `create-skill` read the storage routing reference directly when `context-advisor` is unavailable.
- Archive `skills/choose-skill-memory-store/` without a bridge.

Rationale:

- Portability beats hard dependency coupling.
- A readable owner reference lets the workflow continue when skill invocation fails.
- The old chooser name preserves stale Memory OS vocabulary.

Consequences:

- Active storage placement requests route to `context-advisor`.
- Cross-skill dependency rules need research before broader dependency policy lands.
- Historical decisions can keep old owner names as history.

Next:

- Research hard dependency, optional handoff, owner-reference fallback, bundled reference, and blocked-state rules across skills.
- Audit active skills for cross-skill references.

V2 Ideas:

- Add a dependency checker only after repeated missing-skill failures show manual owner references are insufficient.

## Decision 87: Protect User-Invocable Runbook Control Planes

```yaml
id: decisions-skill-087
status: accepted
decided_at: "2026-06-08"
decision: Protect user-invocable runbook control planes
owner: skills/create-skill/references/archive-cleanup.md
scope: archive cleanup protected boundary
source:
  - "local audit: skills/issue-to-pr/SKILL.md"
  - "local audit: skills/runbook-orchestrator/SKILL.md"
decision_mode:
  question: Should issue-to-pr and runbook-orchestrator be archived with ordinary low-use skills?
  option: keep protected because they are user-invocable runbook control planes with dependent runtime/reference trees
  confidence: medium
```

Decision:

- Treat protected as not ordinary active routing and not archive-safe.
- Keep `issue-to-pr` protected.
- Keep `runbook-orchestrator` protected.
- Keep protected skills out of broad polish.
- Archive a protected skill only after its dependent workflow is explicitly retired or replaced.

Rationale:

- `issue-to-pr` owns a user-invocable ledger workflow backed by `runbooks/issue-to-pr-v2/`.
- `runbook-orchestrator` owns a user-invocable runbook-area workflow backed by its references.
- Archiving either skill would strand workflow entry points and references.

Consequences:

- The keep-active list remains the ordinary active routing list.
- Protected runbook tools remain available but separated from active-skill cleanup.
- Future cleanup needs a retirement decision before moving either skill.

Next:

- Audit protected runbook control planes only when retirement or replacement is requested.

V2 Ideas:

- Add a protected-skill checker only after repeated accidental archive attempts.

## Decision 88: Keep Create Agent Native Skill Protected

```yaml
id: decisions-skill-088
status: superseded
decided_at: "2026-06-08"
decision: Keep create-agent-native-skill protected
owner: skills/create-agent-native-skill/SKILL.md
scope: archive cleanup protected boundary
source:
  - "local audit: skills/create-agent-native-skill/SKILL.md"
  - "local audit: skills/create-agent-native-skill/PROVENANCE.md"
decision_mode:
  question: Should create-agent-native-skill be extracted into create-skill and archived?
  option: keep protected as the runtime-backed skill specialist
  confidence: strong
```

Decision:

- Keep `skills/create-agent-native-skill/SKILL.md` available.
- Treat it as protected, not ordinary active routing and not archive-safe.
- Do not extract material into `create-skill` now.
- Keep it one-file until repeated use exposes reusable detail that would bloat `SKILL.md`.
- Route command-surface design through `cli-author`.

Rationale:

- The skill is already thin and points to owner paths instead of copying contracts.
- It owns the boundary between ordinary skill authoring and runtime-backed capability design.
- `create-skill`, `context-advisor`, and other active docs route runtime-backed skill work through it.
- Archiving it would remove the named specialist for helper commands, machine-readable output, durable writes, repair, retry, and facade envelopes.

Consequences:

- `create-agent-native-skill` moves out of consolidation candidates.
- `create-skill` remains the ordinary skill-authoring owner.
- `cli-author` remains the CLI contract owner.

Next:

- Audit `create-agent-native-skill` again only after repeated use proves it needs references, scripts, or retirement.

V2 Ideas:

- Fold it into `create-skill` only if the runtime-backed path becomes ordinary enough to stop needing a specialist.

Superseded by Decision 89.

## Decision 89: Make Create Skill The Single Skill Runbook

```yaml
id: decisions-skill-089
status: superseded
decided_at: "2026-06-08"
decision: Make create-skill the single skill runbook
owner: skills/create-skill/SKILL.md
scope: skill authoring consolidation
source:
  - "chat: 2026-06-08 create-agent-native-skill should be a create-skill reference"
decision_mode:
  question: Should runtime-backed skill creation remain a separate protected specialist skill?
  option: move runtime-backed skill guidance into create-skill as a reference and bridge the old skill name
  confidence: strong
```

Decision:

- Treat `skills/create-skill/SKILL.md` as the single skill runbook.
- Route every skill-creation request type through `create-skill`.
- Move runtime-backed skill design guidance to `skills/create-skill/references/agent-native-skill-design.md`.
- Keep `skills/create-agent-native-skill/SKILL.md` only as a temporary bridge.
- Keep `cli-author` as the owner for CLI contract design.

Rationale:

- One skill runbook reduces routing scatter.
- Runtime-backed skill creation is a chapter of skill creation, not a separate owner.
- `cli-author` already owns command-surface contracts, so `create-skill` can route without copying CLI contracts.

Consequences:

- `create-agent-native-skill` is no longer protected.
- Active runtime-backed skill requests stay inside `create-skill`.
- The old skill name can archive after active references move.

Next:

- Audit active `create-agent-native-skill` references.
- Archive the bridge after active routes point to `create-skill`.

V2 Ideas:

- Add a tiny route map reference only if `create-skill/SKILL.md` grows too large.

Superseded by Decision 90.

## Decision 90: Archive Create Agent Native Skill Without Bridge

```yaml
id: decisions-skill-090
status: accepted
decided_at: "2026-06-08"
decision: Archive create-agent-native-skill without bridge
owner: skills/create-skill/references/agent-native-skill-design.md
scope: skill authoring consolidation
source:
  - "chat: 2026-06-08 create-agent-native-skill was not used"
decision_mode:
  question: Should unused create-agent-native-skill remain as a bridge?
  option: no bridge; archive the unused skill and keep runtime-backed skill design inside create-skill
  confidence: strong
```

Decision:

- Keep `skills/create-skill/SKILL.md` as the single skill runbook.
- Keep runtime-backed skill design guidance in `skills/create-skill/references/agent-native-skill-design.md`.
- Archive `skills/create-agent-native-skill/` without a bridge.
- Do not preserve an unused skill name as a compatibility route.
- Keep `cli-author` as the owner for CLI contract design.

Rationale:

- A bridge only earns its keep when an old name has real usage.
- `create-agent-native-skill` had not been used as a real route.
- Keeping an unused bridge creates fake compatibility debt and routing noise.

Consequences:

- Runtime-backed skill requests route through `create-skill`.
- The archived directory remains historical source only.
- Active docs should not route users or agents to `create-agent-native-skill`.

Next:

- Keep active-reference audits focused on routes that still exist outside historical docs and archived files.

V2 Ideas:

- Recreate a specialist only if repeated runtime-backed skill work proves the single runbook is too crowded.

## Decision 91: Archive Non-Kept Skill Cleanup Batch

```yaml
id: decisions-skill-091
status: accepted
decided_at: "2026-06-08"
decision: Archive non-kept skill cleanup batch
owner: skills/create-skill/references/archive-cleanup.md
scope: archive cleanup move list
source:
  - "chat: 2026-06-08 finish archive"
decision_mode:
  question: Should the remaining non-kept archive candidates be moved now?
  option: archive the accepted cleanup batch and keep dependency skills protected
  confidence: strong
```

Decision:

- Archive `create-agent-skills` after extraction review.
- Archive low/no-active-route skills listed in `skills/create-skill/references/archive-cleanup.md`.
- Keep protected dependency skills: `agent-reliability-guardrails`, `imessage-reader`, `productivity-setup`, `productivity-tasks`, `prompt-system-router`, and `prompt-system-workflow`.
- Keep accepted keep-active skills and protected runbook control planes live.
- Preserve archived directories under `skills/archive/<name>/`.

Rationale:

- Nathan accepted the keep-active list.
- Archived skills were outside the accepted keep-active list.
- Remaining references are historical, provenance, memory docs, or paired deprecated workflows.
- Protected dependency skills still serve active routes.

Consequences:

- The active skill root contains keep-active skills plus protected dependency and runbook control-plane skills.
- Further archive moves require a new dependency audit or retirement decision.
- Broken symlinks remain a separate cleanup task.

Next:

- Audit broken skill symlinks.
- Decide the Memory OS replacement boundary.
- Remove old context owner-path redirect stubs after active-reference audit passes.

V2 Ideas:

- Add an archive-safety checker only after repeated accidental archive attempts.

## Decision 92: Pivot Memory Placement To Context Advisor

```yaml
id: decisions-skill-092
status: accepted
decided_at: "2026-06-08"
decision: Pivot memory placement to context-advisor
owner: skills/context-advisor/SKILL.md
scope: memory placement routing
source:
  - "chat: 2026-06-08 proceed with Memory OS pivot cleanup"
decision_mode:
  question: Should active memory placement continue to route through Memory OS?
  option: route active placement through context-advisor and keep Memory OS as legacy-store-only
  confidence: strong
```

Decision:

- Route active memory placement through `skills/context-advisor/SKILL.md`.
- Use `skills/context-advisor/references/storage-routing.md` as the owner-reference fallback.
- Treat the old stable memory runtime path as legacy memory-store guidance only.
- Replace active productivity Memory OS reads with owner routing through `context-advisor`.
- Keep repo-local `context/` docs unchanged until an archive, rename, or historical-source decision is accepted.

Rationale:

- Nathan wants to pivot away from Memory OS rather than polish it.
- `context-advisor` already owns owner, privacy, write authority, retention, deletion, recovery, and next-safe-action routing.
- Active productivity skills need placement guidance, not the old Memory OS folder taxonomy.
- Keeping the legacy docs unchanged avoids a broad destructive rename before the replacement boundary is chosen.

Consequences:

- Startup no longer treats Memory OS as the default placement authority.
- Active memory-writing skills route uncertain placement to `context-advisor`.
- Legacy memory docs remain available for historical source review.

Next:

- Decide whether repo-local `context/` legacy docs should archive, rename, or remain as historical source.
- Remove old context owner-path redirect stubs after active-reference audit passes.

V2 Ideas:

- Add a storage-route checker only after repeated placement mistakes show prose routing is insufficient.

## Decision 93: Store Future Memory As Context

```yaml
id: decisions-skill-093
status: superseded
decided_at: "2026-06-08"
decision: Store future memory as context
owner: skills/context-advisor/references/storage-routing.md
scope: future durable recall and synthesis placement
source:
  - "chat: 2026-06-08 all memory should be stored in a context folder going forward"
decision_mode:
  question: Should future durable memory continue to use memory folders?
  option: no; store future durable recall and synthesis under context folders
  confidence: strong
```

Decision:

- Store future durable recall and synthesis under `context/`.
- Do not create new `memory/` folders for durable context.
- Keep `context-advisor` as the active placement router.
- Treat existing `memory/` paths as legacy until audited and moved.

Rationale:

- Nathan wants one context-shaped storage model going forward.
- `context/` matches the new context-advisor language.
- Leaving existing `memory/` paths untouched until audit avoids breaking startup checks, symlinks, scripts, or historical references.

Consequences:

- New storage examples and future skills must use `context/`, not `memory/`.
- Existing repo-local `memory/` docs need a scoped move audit.
- Legacy `~/.config/memory` remains a legacy-store route only until replaced.

Next:

- Audit existing repo-local `memory/` docs and scripts before moving them under `context/`.
- Update startup checks after the existing path move is accepted and performed.

V2 Ideas:

- Add a path checker only after repeated new `memory/` paths appear.

Superseded by Decision 94.

## Decision 94: Hard Cut Memory Folders To Context

```yaml
id: decisions-skill-094
status: accepted
decided_at: "2026-06-08"
decision: Hard cut memory folders to context
owner: skills/context-advisor/references/storage-routing.md
scope: repo durable context migration
source:
  - "chat: 2026-06-08 keep durable memory and archive old framework"
decision_mode:
  question: Should existing memory folders remain as a legacy framework?
  option: move durable content to context and archive old framework machinery
  confidence: strong
```

Decision:

- Move durable note content from repo `memory/` folders into `context/`.
- Move old Memory OS, QMD, NotebookLM, bootstrap, template, and federation framework files into `context/archive/legacy-memory-framework/`.
- Replace path-shaped `memory/` references with `context/`.
- Replace `~/.config/memory` references with `~/.config/context`.
- Remove the `~/.config/memory` runtime path.
- Keep `context-advisor` as the active placement owner.

Rationale:

- Nathan wants a framework rebuild, not a compatibility bridge.
- Durable notes are valuable; the old framework machinery is deprecated.
- Keeping a legacy runtime alias would keep the old vocabulary alive.

Consequences:

- Active repos now use `context/` as the durable recall and synthesis folder.
- Old framework files are preserved in archives rather than deleted.
- Deprecated QMD/NotebookLM/bootstrap scripts may break and are intentionally not protected.
- Residual `memory` wording should be reviewed only when it is not a proper name, historical decision, or runtime/process-memory phrase.

Next:

- Validate startup owner paths against `context-advisor`.
- Scan for residual path-segment `memory/` references.
- Review remaining `Memory OS` wording outside archived framework docs.

V2 Ideas:

- Add a path checker only after repeated new `memory/` folders appear.

## Decision 95: Protect Only Productivity Sync

```yaml
id: decisions-skill-095
status: accepted
decided_at: "2026-06-08"
decision: Protect only productivity-sync
owner: skills/productivity-sync/SKILL.md
scope: productivity workflow cleanup
source:
  - "chat: 2026-06-08 only productivity-sync should still work"
decision_mode:
  question: Which productivity workflow remains live after the context rebuild?
  option: keep productivity-sync live and archive setup/tasks workflows
  confidence: strong
```

Decision:

- Keep `skills/productivity-sync/SKILL.md` as the only protected live productivity workflow.
- Keep `skills/productivity-connectors/SKILL.md` as support reference for `productivity-sync`, not a user workflow.
- Archive `skills/productivity-setup/`.
- Archive `skills/productivity-tasks/`.
- Remove `productivity-sync` handoffs to `/productivity-setup`.
- Treat missing `.productivity.yml`, `TASKS.md`, or `context/` as blocked or degraded sync state.

Rationale:

- Nathan wants the framework rebuilt around one live sync workflow.
- Setup and task-management workflows recreate old framework surface area.
- Sync can report missing prerequisites without preserving retired setup routes.
- Connector maps still help sync dispatch safely without being a user-facing workflow.

Consequences:

- `/productivity-sync` is the productivity entry point.
- `/productivity-setup` and `/productivity-tasks` are not compatibility routes.
- Startup instructions route calendar, email, and contact sync work to `productivity-sync`.

Next:

- Validate `productivity-sync` frontmatter.
- Run startup and description checks.
- Review remaining productivity references only if they route users away from `productivity-sync`.

V2 Ideas:

- Fold connector maps into `productivity-sync` only if support-reference routing causes repeated misses.

## Decision 96: Rename Memory OS Rule To Context Routing

```yaml
id: decisions-skill-096
status: accepted
decided_at: "2026-06-08"
decision: Rename Memory OS rule to context routing
owner: rules/context-routing.md
scope: active startup rules and smoke tests
source:
  - "chat: 2026-06-08 continue context hard cut"
decision_mode:
  question: Should active rules and smoke tests keep Memory OS naming after the hard cut?
  option: no; keep storage guidance but rename active routing to context routing
  confidence: strong
```

Decision:

- Rename `rules/memory-os.md` to `rules/context-routing.md`.
- Replace the multi-agent `memory-os` smoke test with `context-routing`.
- Remove QMD onboarding from the active README.
- Keep historical Memory OS wording only in decisions, archived framework docs, and explicit rejection notes.

Rationale:

- Active routes should teach the new `context-advisor` model.
- Keeping the old rule name makes Memory OS look live.
- QMD and NotebookLM framework setup is archived, not protected.

Consequences:

- Startup checks now exercise context routing, not Memory OS governance.
- New durable recall guidance points to `context/` and `skills/context-advisor/SKILL.md`.
- Historical docs can still explain why the pivot happened.

Next:

- Re-scan active docs for non-historical Memory OS routes.
- Keep path-shaped `memory/` guardrails only where they prevent new folder creation.

V2 Ideas:

- Add a context-path checker only after repeated new `memory/` folders appear.

## Decision 97: Store Skill Role In Frontmatter

```yaml
id: decisions-skill-097
status: accepted
decided_at: "2026-06-08"
decision: Store skill role in frontmatter
owner: skills/create-skill/references/skill-roles.md
scope: active skill metadata
source:
  - "chat: 2026-06-08 every skill needs a role"
decision_mode:
  question: Where should each skill role live?
  option: store one primary role in SKILL.md frontmatter
  confidence: strong
```

Decision:

- Give every active skill one primary role.
- Store the role as `role` in `SKILL.md` frontmatter.
- Define allowed role values in `skills/create-skill/references/skill-roles.md`.
- Use the role to clarify routing, ownership, archive safety, and dependency rules.

Rationale:

- Frontmatter is easy to audit.
- One role keeps the model small.
- Role labels make archive and dependency reviews less fuzzy.

Consequences:

- Active skills now carry role metadata.
- Symlinked live skills also need role metadata because they are part of this repo's active surface.
- Future skill creation and repair should assign a role before validation.

Next:

- Add a role checker only after repeated missing or invalid role labels appear.
- Audit live skills against role runbooks.

V2 Ideas:

- Add a generated role inventory only if manual scans become noisy.

## Decision 98: Add Skill Role Audit Checker

```yaml
id: decisions-skill-098
status: accepted
decided_at: "2026-06-08"
decision: Add skill role audit checker
owner: skills/create-skill/scripts/skill-role-audit.ts
scope: active skill role validation
source:
  - "chat: 2026-06-08 add checker now"
decision_mode:
  question: Should role frontmatter get a mechanical checker now?
  option: add a small role audit script now
  confidence: strong
```

Decision:

- Add `skills/create-skill/scripts/skill-role-audit.ts`.
- Add compatibility wrapper `scripts/skill-role-audit.ts`.
- Validate every active `skills/*/SKILL.md` has one allowed `role`.
- Skip `skills/archive/`.
- Emit JSON for agent validation.

Rationale:

- Role metadata is now part of the active skill contract.
- A small checker prevents silent frontmatter drift.
- The checker is cheaper than manual role scans after every skill change.

Consequences:

- Skill changes can prove role metadata mechanically.
- `create-skill` validation now includes role audit after adding, archiving, or changing active skill roles.
- Archived skills remain historical and are not forced into the new role contract.

Next:

- Audit live skills against role runbooks.
- Audit live skill dependencies against `skill-dependency-rules.md`.

V2 Ideas:

- Add generated role inventory only if humans need a quick visual map.

## Decision 99: Use One Skill Role Plus Small Abilities

```yaml
id: decisions-skill-099
status: accepted
decided_at: "2026-06-08"
decision: Use one skill role plus small abilities
owner: skills/create-skill/references/skill-roles.md
scope: active skill role model
source:
  - "chat: 2026-06-08 skills can mix behaviors"
decision_mode:
  question: Can a skill have mixed behavior without multiple roles?
  option: keep one primary role and add small named abilities
  confidence: strong
```

Decision:

- Keep one primary `role` per active skill.
- Add optional `abilities` for small extra behaviors.
- Validate abilities in `skills/create-skill/scripts/skill-role-audit.ts`.
- Allow `accepted-doc-capture` for accepted glossary, context, ADR, decision, or tracker capture.
- Allow `temp-report-generation` for temporary report artifacts outside the repo.

Rationale:

- Multiple roles per skill create role soup.
- Some skills need small extra powers without changing their main job.
- Named abilities make side effects visible and checkable.

Consequences:

- `grill-with-docs` remains `advisor` with `accepted-doc-capture`.
- `improve-codebase-architecture` remains `advisor` with `accepted-doc-capture` and `temp-report-generation`.
- Future mixed skills should add a small ability before inventing a second role.

Next:

- Continue role-pile audit.
- Add new abilities only when a real skill needs them.

V2 Ideas:

- Add ability runbooks only after repeated confusion about an ability.

## Decision 100: Rename Front-Door Role To Main Entry

```yaml
id: decisions-skill-100
status: accepted
decided_at: "2026-06-08"
decision: Rename front-door role to main-entry
owner: skills/create-skill/references/skill-roles.md
scope: skill role vocabulary
source:
  - "chat: 2026-06-08 front-door wording was confusing"
decision_mode:
  question: Should the front-door role be renamed?
  option: rename front-door to main-entry
  confidence: strong
```

Decision:

- Rename skill role `front-door` to `main-entry`.
- Update active skill frontmatter.
- Update `skill-role-audit.ts` allowed roles.
- Leave historical browser-operation-front-door decision wording unchanged.

Rationale:

- Every skill has a first screen, so `front-door` sounds like it applies to all skills.
- `main-entry` better means the primary entrance for a broad work area.
- The new term reduces role confusion during audits.

Consequences:

- `create-skill`, `cli-author`, and `browser-domain-memory` now use `role: main-entry`.
- Future role checks reject `front-door`.
- Historical decisions keep their original wording.

Next:

- Continue role-pile audit with the renamed main-entry pile.

V2 Ideas:

- Add role rename bridge only if old frontmatter appears again.

## Decision 101: Archive Browser Domain Memory

```yaml
id: decisions-skill-101
status: accepted
decided_at: "2026-06-08"
decision: Archive browser-domain-memory
owner: skills/archive/browser-domain-memory/SKILL.md
scope: browser memory skill routing
source:
  - "chat: 2026-06-08 browser-domain-memory will be deprecated"
decision_mode:
  question: Should browser-domain-memory remain a planned main-entry skill?
  option: no; archive it and move future browser memory work into browser-use
  confidence: strong
```

Decision:

- Archive `skills/browser-domain-memory/`.
- Do not keep `browser-domain-memory` as a planned compatibility route.
- Route future browser memory work to `browser-use`.
- Treat Decision 100's `browser-domain-memory` role note as superseded.

Rationale:

- Nathan wants browser memory to live in the browser view skill.
- Keeping a planned skill active invites agents to polish dead surface area.
- `browser-use` already owns live browser entry and Warm Chrome behavior.

Consequences:

- Active role audits no longer include `browser-domain-memory`.
- Archived prerequisite scripts remain preserved for reference.
- Future browser memory design starts from `skills/browser-use/SKILL.md`.

Next:

- Continue role-pile audit without `browser-domain-memory`.
- Audit whether `browser-use` needs a future browser-memory ability.

V2 Ideas:

- Extract reusable prerequisite-gate code only if browser-use needs it.

## Decision 102: Keep Provenance Only For Source History

```yaml
id: decisions-skill-102
status: accepted
decided_at: "2026-06-08"
decision: Keep provenance only for source history
owner: skills/create-skill/references/skill-roles.md
scope: skill provenance pattern
source:
  - "chat: 2026-06-08 question provenance.md usefulness"
decision_mode:
  question: Should PROVENANCE.md duplicate CONTEXT.md?
  option: no; keep PROVENANCE.md only when source history matters
  confidence: strong
```

Decision:

- Keep `PROVENANCE.md` only when source history matters.
- Use it for imported, copied, adapted, license-bearing, upstream-derived, or lineage-heavy skills.
- Do not use it as a glossary.
- Do not use it as live workflow instructions.
- Put domain words in `CONTEXT.md`.
- Put accepted decisions in decision logs.
- Put operational routes in `SKILL.md`, references, scripts, help, or tests.

Rationale:

- `CONTEXT.md` owns language.
- `PROVENANCE.md` owns source lineage.
- Mixing them makes both harder to trust.

Consequences:

- Imported skills can keep provenance.
- First-party skills need an audit before keeping standalone provenance files.
- Stale adaptation notes should move to tracker, archive, or accepted decision logs.

Next:

- Audit 16 live `PROVENANCE.md` files.
- Separate keep, merge, archive, and delete candidates.

V2 Ideas:

- Add a provenance audit script only after repeated stale provenance causes routing mistakes.

## Decision 103: Shrink Live Provenance Files To Source Notes

```yaml
id: decisions-skill-103
status: accepted
decided_at: "2026-06-08"
decision: Shrink live provenance files to source notes
owner: skills/*/PROVENANCE.md
scope: live skill provenance files
source:
  - "chat: 2026-06-08 shrink every provenance file to source note"
decision_mode:
  question: What should live PROVENANCE.md files contain?
  option: shrink every live provenance file to a tiny source note
  confidence: strong
```

Decision:

- Rewrite live `skills/*/PROVENANCE.md` files as source-only notes.
- Keep upstream source, URL, license, pull date, copy date, requirements path, plan path, or decision trail when useful.
- Remove status, live workflow instructions, adaptation notes, open work, owner routing, and glossary content from provenance files.
- Keep archived provenance files historical.

Rationale:

- Nathan wants provenance to answer only where a skill came from.
- `CONTEXT.md`, references, trackers, and decision logs own the rest.
- Tiny source notes reduce stale instruction risk.

Consequences:

- Future provenance edits stay short.
- Live instruction audits can ignore provenance unless source lineage changes.
- First-party provenance files may still be merged or deleted after a separate audit.

Next:

- Validate the 16 live provenance files contain no workflow/status chatter.
- Continue first-party provenance merge/delete audit.

V2 Ideas:

- Add a provenance-shape checker only after source-only drift repeats.

## Decision 104: Keep First-Party Provenance Only For Useful Origin Trails

```yaml
id: decisions-skill-104
status: accepted
decided_at: "2026-06-08"
decision: Keep first-party provenance only for useful origin trails
owner: skills/create-skill/TASKS.md
scope: first-party skill provenance files
source:
  - "chat: 2026-06-08 continue first-party provenance cleanup"
decision_mode:
  question: Which first-party PROVENANCE.md files still earn standalone files?
  option: keep only files with useful origin trails or referenced evidence
  confidence: medium
```

Decision:

- Keep first-party `PROVENANCE.md` only when it points to an external local origin, historical source trail, or referenced evidence path.
- Keep `skills/decision-mode/PROVENANCE.md` because it names Nathan's local original skill path.
- Keep `skills/test-runner/PROVENANCE.md` because existing plans and brainstorms reference it as runner evidence.
- Remove `skills/decisions/PROVENANCE.md` because `skills/decisions/SKILL.md` and its operating manual already name the source brainstorm and decision trail.

Rationale:

- First-party provenance should still answer where a thing came from.
- A file that only repeats owner paths adds another place to go stale.
- Removing redundant provenance keeps the source-history rule simple.

Consequences:

- Live provenance count drops from 16 to 15.
- Future first-party skills do not need standalone provenance unless source history is useful.
- Existing historical references to `test-runner` provenance stay valid.

Next:

- Continue dependency-rule audit for active live skills.

V2 Ideas:

- Add a provenance reference checker only if future deletes risk breaking historical links.

## Decision 105: Label Live Helper Skill Dependencies

```yaml
id: decisions-skill-105
status: accepted
decided_at: "2026-06-08"
decision: Label live helper skill dependencies
owner: skills/create-skill/references/skill-dependency-rules.md
scope: active skill helper routes
source:
  - "chat: 2026-06-08 continue dependency audit"
decision_mode:
  question: How should live skills name helper-skill dependencies?
  option: label dependency type, missing state, and next repair in the owning skill
  confidence: strong
```

Decision:

- Label active helper-skill routes with dependency type, missing state, and next repair.
- Replace retired `/setup-matt-pocock-skills` routes in `to-issues`, `to-prd`, and `triage` with `docs/agents/` owner paths.
- Replace old `~/.claude/skills/imessage-reader` fallback paths with repo-local `skills/imessage-reader/` owner paths.
- Add dependency labels to `context-advisor`, `decisions`, `prompt-system-workflow`, `runbook-orchestrator`, `triage`, and `improve-codebase-architecture`.
- Keep missing optional handoffs degraded when a safe owner-reference fallback exists.
- Keep hard dependencies blocked when continuing would fake the workflow.

Rationale:

- Hidden helper routes make archived skills look live.
- Missing-state labels let future agents continue safely without guessing.
- Owner paths preserve portability better than copied workflows.

Consequences:

- Live skill bodies no longer route through the retired setup skill.
- `productivity-sync` keeps `productivity-connectors` and `imessage-reader` as labeled support routes.
- Future helper-skill references should include dependency type, missing state, and next repair.

Next:

- Continue role audit for active live skills.

V2 Ideas:

- Add a dependency audit script only after repeated unlabeled helper routes appear.

## Decision 106: Remove Old Context Redirect Stubs

```yaml
id: decisions-skill-106
status: accepted
decided_at: "2026-06-08"
decision: Remove old context redirect stubs
owner: skills/create-skill/references/consolidation-map.md
scope: create-skill consolidation cleanup
source:
  - "chat: 2026-06-08 continue owner-path redirect cleanup"
decision_mode:
  question: Should old context redirect stubs remain after active routes moved?
  option: remove stubs once startup, live skills, rules, and scripts no longer reference them
  confidence: strong
```

Decision:

- Remove old context redirect stubs after active-reference audit.
- Delete moved stubs for skill design philosophy, agent-native CLI vocabulary, capability registry vocabulary, skill I/O examples, skill memory routing, community research sources, and skill-design tracker/context.
- Keep `skills/create-skill/references/consolidation-map.md` as the move receipt.
- Treat historical plans, brainstorms, and decision entries as historical references, not live routes.

Rationale:

- Stubs keep old owner paths visually alive.
- Startup docs, live skills, rules, and scripts now point at `skills/create-skill/` or `skills/context-advisor/`.
- The consolidation map preserves where each old path moved.

Consequences:

- Old context folders no longer carry redirect files.
- Future skill-authoring work starts from `skills/create-skill/`.
- Historical docs may still mention old paths as past context.

Next:

- Continue residual Memory OS wording audit outside archived framework docs and historical decisions.

V2 Ideas:

- Add an owner-path redirect checker only if old moved paths reappear in active startup or skill routes.

## Decision 107: Rename Active Legacy Storage Wording

```yaml
id: decisions-skill-107
status: accepted
decided_at: "2026-06-08"
decision: Rename active legacy storage wording
owner: skills/context-advisor/references/storage-routing.md
scope: active storage-routing language
source:
  - "chat: 2026-06-08 residual Memory OS wording audit"
decision_mode:
  question: Should active surfaces keep the old Memory OS name?
  option: no; use legacy storage framework unless citing history
  confidence: strong
```

Decision:

- Use `legacy storage framework` for active references to the deprecated storage system.
- Keep old proper-name wording only in historical docs, archived framework files, and decision history.
- Keep `context-advisor` and `context/` as the active storage-routing language.
- Keep `memory/` wording only for path guards, historical path names, or process-memory concepts.

Rationale:

- The old name makes deprecated routes feel alive.
- Nathan wants the replacement model to speak in context language.
- A generic legacy label keeps the audit clear without reviving the old brand.

Consequences:

- Startup and active skill docs no longer teach the old storage name.
- Historical docs can still explain the migration trail.
- Future cleanup scans should distinguish active routing language from historical references.

Next:

- Continue protected runbook control-plane audit only if retirement or replacement is requested.

V2 Ideas:

- Add a wording scanner only if the old storage name reappears in active startup or skill routes.

## Decision 108: Route Saved Message Archives Through Context Safety

```yaml
id: decisions-skill-108
status: accepted
decided_at: "2026-06-08"
decision: Route saved message archives through context safety
owner: skills/imessage-reader/SKILL.md
scope: durable message archive writes
source:
  - "chat: 2026-06-08 memory-writing skill audit"
decision_mode:
  question: How should iMessage saved archives choose a durable home?
  option: use context-advisor when save ownership or privacy is unclear
  confidence: strong
```

Decision:

- Treat saved iMessage markdown archives as durable sensitive context.
- Use `--no-save` for one-off inspection without durable files.
- Route unclear save directory, owning repo, privacy boundary, retention, deletion, or cross-repo promotion through `context-advisor`.
- Use `skills/context-advisor/references/storage-routing.md` as fallback when the advisor skill is unavailable.
- Do not save raw message archives into a project repo unless that repo is the accepted owner.

Rationale:

- Read-through persistence can create durable private records.
- Storage ownership and privacy matter more than convenience for message archives.
- `context-advisor` already owns the routing gates.

Consequences:

- `imessage-reader` now names storage safety on its first screen.
- Future message archive examples should use explicit safe save directories.
- Privacy-sensitive archive writes do not rely on implicit defaults alone.

Next:

- Continue script owner audit.

V2 Ideas:

- Add a storage-write audit script only if more skills silently add durable writes.

## Decision 109: Name Script Verification Paths

```yaml
id: decisions-skill-109
status: accepted
decided_at: "2026-06-08"
decision: Name script verification paths
owner: skills/create-skill/references/skill-design-philosophy.md
scope: script-backed active skills
source:
  - "chat: 2026-06-08 script owner audit"
decision_mode:
  question: How should script-backed skills expose validation?
  option: name owner scripts and a focused verification path on the first screen
  confidence: strong
```

Decision:

- Name script owner files in `SKILL.md`.
- Add focused `## Verification` paths for script-backed active skills.
- Use script-local `test`, `typecheck`, or narrow smoke commands when available.
- Use focused test targets when broad suites include intentional failure fixtures.
- Use local file dependencies for private facade packages so script-local installs and typechecks can run.
- Keep exact flags, schemas, parser states, and output envelopes in scripts, help, tests, or command contracts.
- Treat generated caches, output folders, and dependency folders as non-owner artifacts unless promoted as evidence.
- Run environment-sensitive checks only when the changed behavior needs that environment.

Rationale:

- Hidden validation paths make skill repairs slower.
- Copying command contracts into prose creates drift.
- First-screen verification lets future agents check the smallest relevant surface.

Consequences:

- Script-backed active skills now show how to verify changed scripts.
- `create-skill` philosophy now requires a first-screen verification path for script-backed skills.
- Future script-backed skills should expose focused verification without copying deterministic contracts.

Next:

- Continue tracker cleanup or context-doc audit.

V2 Ideas:

- Add a script-owner audit only if future script-backed skills miss owner or verification paths again.

## Decision 110: Keep Dependency Sections As Routing Cards

```yaml
id: decisions-skill-110
status: accepted
decided_at: "2026-06-08"
decision: Keep dependency sections as routing cards
owner: skills/create-skill/references/skill-dependency-rules.md
scope: active skill dependency sections
source:
  - "chat: 2026-06-08 dependency section drift concern"
decision_mode:
  question: How do we stop dependency sections becoming a maintenance nightmare?
  option: keep dependency sections tiny and shrink drift before adding machinery
  confidence: strong
```

Decision:

- Treat dependency sections as routing cards.
- Include only type, missing state, owner path, fallback, and next repair.
- Do not copy another skill's command list, state machine, flags, schemas, or full workflow.
- Move extra detail to the owner path.
- When dependency prose drifts or grows, shrink it before adding a checker.
- Add a dependency audit script only after repeated unlabeled or stale helper routes survive manual review.

Rationale:

- Copied dependency prose creates two owners for one workflow.
- Two owners drift.
- Tiny routing cards preserve portability without making every skill maintain every other skill.

Consequences:

- Dependency sections stay cheap to maintain.
- Future dependency edits should delete copied detail, not add more prose.
- Checker work waits for repeated manual-review failure.

Next:

- Continue repo-local `context/` legacy docs audit.

V2 Ideas:

- Build a dependency audit script only if stale helper routes repeat.

## Decision 111: Separate Portable Payload From Local Project State

```yaml
id: decisions-skill-111
status: accepted
decided_at: "2026-06-08"
decision: Separate portable payload from local project state
owner: skills/create-skill/references/research-portability.md
scope: create-skill portability audit
source:
  - "chat: 2026-06-08 portability task next"
decision_mode:
  question: What travels when create-skill is exported?
  option: export reusable skill owners; keep tracker and decisions as local project state
  confidence: strong
```

Decision:

- Treat `SKILL.md`, `CONTEXT.md`, `references/`, `scripts/`, templates, and assets as the portable payload.
- Treat `TASKS.md`, decision logs, handover paths, cleanup queues, and historical receipts as local project state by default.
- Promote accepted reusable rules into the portable owner paths before export.
- Keep unresolved work and local-only facts in the tracker.
- Treat absolute local paths in portable owner files as blockers unless marked as historical receipts or examples.

Rationale:

- A portable skill bundle should not carry this repo's work queue as if it were reusable law.
- Decision logs and trackers explain how the bundle was built, but they are not the skill runtime.
- Separating payload from project state makes future installs smaller and less Nathan-specific.

Consequences:

- `research-portability.md` now defines export surface and audit checks.
- `consolidation-map.md` separates working folder shape from portable export payload.
- `archive-cleanup.md` avoids hard-coded user-scope symlink paths.
- Portability audit continues with scans for hidden local coupling.

Next:

- Continue portability audit over portable owner files.

V2 Ideas:

- Add a portability audit script only after repeated hidden local coupling survives manual review.

## Decision 112: Use Runtime Portability Reference For Bun And Non-Bun Skills

```yaml
id: decisions-skill-112
status: accepted
decided_at: "2026-06-08"
decision: Use runtime portability reference for Bun and non-Bun skills
owner: skills/create-skill/references/runtime-portability.md
scope: runtime-backed portable skills
source:
  - "session: codex 019ea54d-86fe-7a10-9954-166992a6659d via ce-sessions 2026-06-08"
  - "chat: 2026-06-08 portability session lookup"
decision_mode:
  question: Where should Bun and non-Bun portability rules live?
  option: create one runtime portability reference with provenance and local-development labels
  confidence: strong
```

Decision:

- Use `skills/create-skill/references/runtime-portability.md` as the portable owner for Bun and non-Bun runtime portability.
- Treat Bun-backed skills as portable only when runtime, owner scripts, package metadata, lockfile need, verification path, and missing-dependency state are named.
- Treat Node, Python, shell, and other runtime-backed skills by the same rule.
- Label `file:` dependencies outside the skill bundle as local development portability unless the dependency owner travels with the export payload.
- Treat private facade packages as non-universal unless the facade owner travels with the export payload.
- Keep local session evidence as provenance, not as an operational dependency.

Rationale:

- Bun portability was discovered during script-backed skill verification work.
- Non-Bun portability has the same shape: runtime, owner files, dependencies, verification, and missing state.
- One runtime portability owner avoids split rules and hidden local assumptions.

Consequences:

- `create-skill` now routes runtime portability work to `runtime-portability.md`.
- Future script-backed skill audits classify universal portability, local development portability, or non-portability.
- Current local `file:` dependencies are not universal portability proof unless their owners travel too.

Next:

- Audit Bun-backed script packages for universal portability versus local development portability.

V2 Ideas:

- Add a runtime portability audit script only after repeated hidden runtime assumptions survive manual review.

## Decision 113: Track Bun Facade Migrations As Local Development Portability

```yaml
id: decisions-skill-113
status: accepted
decided_at: "2026-06-08"
decision: Track Bun facade migrations as local development portability
owner: skills/create-skill/TASKS.md
scope: Bun facade-backed script packages
source:
  - "chat: 2026-06-08 Bun facade migration tracking"
decision_mode:
  question: How should Bun packages with local facade dependencies be tracked?
  option: mark them local development portable and track migration to universal portability
  confidence: strong
```

Decision:

- Track Bun facade-backed script packages in `skills/create-skill/TASKS.md`.
- Mark each package with `@side-quest/cli-command-facade` as local development portable while it uses a `file:` dependency outside the skill bundle.
- Treat universal portability as blocked until the facade dependency is public, bundled, or included in the export payload.
- Keep migration repair options visible: publish or version the facade package, bundle the facade owner, replace the dependency, or keep the local-only blocked state explicit.

Rationale:

- Current `file:` dependencies make local verification work.
- Local verification is not the same as export portability.
- A tracker prevents future agents from treating the local facade path as either broken or universally portable by accident.

Consequences:

- `browser-use`, `test-runner`, `fallow`, and `cli-author` script packages have a shared migration tracker.
- Future package dependency edits should update the tracker.
- Runtime portability rules now include facade migration tracking.

Next:

- Choose a facade migration path before claiming universal portability for these packages.

V2 Ideas:

- Add a package portability scanner only if local facade dependencies spread beyond the tracked packages.

## Decision 114: Prefer Shared Portable Runtime Owner For Facade Migration

```yaml
id: decisions-skill-114
status: accepted
decided_at: "2026-06-08"
decision: Prefer shared portable runtime owner for facade migration
owner: skills/create-skill/references/runtime-portability.md
scope: Bun facade migration target
source:
  - "chat: 2026-06-08 Bun facade migration grilling"
decision_mode:
  question: Should facade migration copy, publish, or bundle the facade?
  option: bundle one shared portable runtime owner before copying or publishing
  confidence: strong
```

Decision:

- Prefer one shared portable runtime owner for `@side-quest/cli-command-facade` migration.
- Do not copy the facade into each skill.
- Do not publish the facade as the first move while it is private and pre-1.0.
- Include the shared runtime owner in the export payload before claiming universal portability.

Rationale:

- Four skills already depend on the same facade package.
- Per-skill copies create multiple owners for one runtime contract.
- External publishing is premature while the facade is private and pre-1.0.
- A shared runtime owner keeps one implementation and makes export portability inspectable.

Consequences:

- The migration tracker now points at a shared portable runtime owner as the accepted target.
- A folder owner must be chosen before moving package files.
- Package dependency edits should wait until the shared owner path is named.

Next:

- Decide the shared runtime owner path.

V2 Ideas:

- Revisit publishing after the facade stabilizes past pre-1.0.

## Decision 115: Use Bun Workspaces For Shared Runtime Migration

```yaml
id: decisions-skill-115
status: accepted
decided_at: "2026-06-08"
decision: Use Bun workspaces for shared runtime migration
owner: skills/create-skill/references/runtime-portability.md
scope: Bun facade workspace migration
source:
  - "Firecrawl: https://bun.sh/docs/pm/workspaces checked 2026-06-08"
  - "Firecrawl: https://bun.sh/docs/pm/filter checked 2026-06-08"
  - "Firecrawl: https://bun.sh/docs/pm/cli/install checked 2026-06-08"
  - "chat: 2026-06-08 Bun workspace migration"
decision_mode:
  question: How should the shared facade runtime travel with portable skills?
  option: use Bun workspaces with a shared runtime package and workspace dependencies
  confidence: strong
```

Decision:

- Use Bun workspaces for the shared runtime migration.
- Add shared runtime packages to root `package.json` workspaces.
- Use `workspace:*` for local workspace dependencies instead of local `file:` paths.
- Keep root `bun.lock` as the workspace lockfile when workspace packages are part of the export payload.
- Use `bun install` from the workspace root for dependency linking.
- Use `bun --filter` or `bun run --filter` for focused package installs and scripts when useful.
- Use `bun ci` or `bun install --frozen-lockfile` for reproducible verification.

Rationale:

- Bun official docs define root `workspaces`, `workspace:*` local dependencies, filtered installs/scripts, and lockfile-based reproducible installs.
- Workspace dependencies make the facade a named portable owner instead of a hidden local checkout.
- Root lockfile ownership gives one install surface for the portable runtime payload.

Consequences:

- The Bun facade migration tracker now targets a workspace package shape.
- Package dependency changes should replace `file:` facade paths with `workspace:*` only after the shared runtime owner exists.
- The next hardening step is to create or migrate `runtime/cli-command-facade/` and wire root workspaces.

Next:

- Decide whether to create the workspace package now or keep the migration as a tracked task.

V2 Ideas:

- Add a workspace dependency scanner after the first workspace migration lands.

## Decision 116: Create Runtime Facade Workspace Owner

```yaml
id: decisions-skill-116
status: accepted
decided_at: "2026-06-08"
decision: Create runtime facade workspace owner
owner: runtime/cli-command-facade/
scope: shared facade runtime package
source:
  - "chat: 2026-06-08 first Bun workspace migration slice"
decision_mode:
  question: Should the shared facade runtime owner be created now?
  option: create and verify the shared workspace package before switching consumers
  confidence: strong
```

Decision:

- Create `runtime/cli-command-facade/` as the shared portable runtime owner.
- Add root `package.json` workspace coverage for `runtime/*`.
- Keep package name `@side-quest/cli-command-facade`.
- Copy source, tests, package docs, and package instructions from the existing facade owner.
- Exclude generated TypeScript build info from the portable runtime owner.
- Verify the shared runtime package before changing consumer package dependencies.

Rationale:

- A verified shared owner gives Bun workspace migration a concrete package target.
- Changing consumers before the shared package verifies would mix two failure sources.
- Keeping the package name lets consumers move from `file:` to `workspace:*` without import rewrites.

Consequences:

- The first Bun workspace migration slice is complete.
- Four script packages still use local `file:` dependencies until switched in a later slice.
- Future consumer migration can change one package at a time and verify its focused checks.

Next:

- Switch one facade-backed script package from `file:` to `workspace:*` and verify.

V2 Ideas:

- Add `skills/*/scripts` workspace coverage only when migrating the first consumer package.

## Decision 117: Migrate CLI Author Scripts To Workspace Facade

```yaml
id: decisions-skill-117
status: accepted
decided_at: "2026-06-08"
decision: Migrate cli-author scripts to workspace facade
owner: skills/cli-author/scripts/package.json
scope: first facade-backed consumer migration
source:
  - "chat: 2026-06-08 cli-author workspace facade migration"
decision_mode:
  question: Which facade-backed script package should migrate first?
  option: migrate cli-author first because it is closest to the facade concept
  confidence: strong
```

Decision:

- Add `skills/cli-author/scripts` to root Bun workspaces.
- Change `skills/cli-author/scripts` from local `file:` facade dependency to `workspace:*`.
- Add a focused facade resolution smoke script for the package.
- Add `typescript` as a package-local dev dependency so `typecheck` has an owned executable.
- Remove stale local install artifacts from `skills/cli-author/scripts`.
- Keep the other three facade-backed script packages on local development portability until migrated separately.

Rationale:

- `cli-author` is the closest consumer to the facade design surface.
- A single consumer migration proves the workspace pattern without widening blast radius.
- Package-owned smoke and typecheck commands make future verification obvious.

Consequences:

- `cli-author` scripts now resolve `@side-quest/cli-command-facade` through the workspace graph.
- Root `bun.lock` owns the migrated package dependency state.
- `browser-use`, `test-runner`, and `fallow` still need migration from `file:` to `workspace:*`.

Next:

- Migrate the next facade-backed script package after confirming the first consumer remains green.

V2 Ideas:

- Add a workspace dependency scanner after all four facade-backed packages migrate.

## Decision 118: Migrate Fallow Scripts To Workspace Facade

```yaml
id: decisions-skill-118
status: accepted
decided_at: "2026-06-08"
decision: Migrate fallow scripts to workspace facade
owner: skills/fallow/scripts/package.json
scope: second facade-backed consumer migration
source:
  - "chat: 2026-06-08 fallow workspace facade migration"
decision_mode:
  question: Which facade-backed script package should migrate after cli-author?
  option: migrate fallow because it has focused test and typecheck verification
  confidence: strong
```

Decision:

- Add `skills/fallow/scripts` to root Bun workspaces.
- Change `skills/fallow/scripts` from local `file:` facade dependency to `workspace:*`.
- Remove the stale package-local `bun.lock`.
- Keep `fallow` package-owned `test` and `typecheck` scripts as verification.
- Keep `browser-use` and `test-runner` on local development portability until migrated separately.

Rationale:

- `fallow` already had focused test and typecheck scripts.
- Migrating one more consumer proves the workspace pattern across a real runner package.
- Keeping the remaining two consumers unchanged limits blast radius.

Consequences:

- `fallow` scripts now resolve `@side-quest/cli-command-facade` through the workspace graph.
- Root `bun.lock` owns `fallow` dependency state.
- The migration tracker now has two migrated consumers and two local-development portable consumers.

Next:

- Migrate either `test-runner` or `browser-use` next.

V2 Ideas:

- Add a workspace dependency scanner after all four facade-backed packages migrate.

## Decision 119: Split Workspace Bundle Portability From Standalone Skill Zip Portability

```yaml
id: decisions-skill-119
status: accepted
decided_at: "2026-06-08"
decision: Split workspace bundle portability from standalone skill zip portability
owner: skills/create-skill/references/runtime-portability.md
scope: runtime dependency export shapes
source:
  - "chat: 2026-06-08 standalone skill zip portability"
decision_mode:
  question: Does workspace portability make a single skill zip portable?
  option: no; standalone skill zips need public/installable or bundled runtime dependencies
  confidence: strong
```

Decision:

- Distinguish workspace portable bundles from standalone skill zips.
- Treat workspace portable bundles as portable when root workspace metadata, root `bun.lock`, skill packages, and required `runtime/` owners travel together.
- Treat standalone skill zips as portable only when every runtime dependency is public/installable or bundled inside that zip.
- Keep `@side-quest/cli-command-facade` unpublished for now.
- Publish or privately install the facade package only when standalone skill zips become the target.

Rationale:

- A Bun workspace can link local runtime owners when the whole bundle travels.
- A single skill zip cannot resolve a workspace-only runtime unless the runtime is bundled inside that zip or installable from a registry.
- Publishing is extra ceremony while current migration target is bundled workspace portability.

Consequences:

- Current workspace migration supports repo/bundle portability, not standalone skill zip portability.
- Future standalone skill zip work needs a package publication, private registry, or per-zip bundled runtime plan.
- The migration tracker can continue using `workspace:*` without claiming standalone portability.

Next:

- Finish migrating remaining workspace consumers before deciding publication.

V2 Ideas:

- Add standalone zip packaging only after workspace bundle migration is complete.

## Decision 120: Migrate Test Runner Scripts To Workspace Facade

```yaml
id: decisions-skill-120
status: accepted
decided_at: "2026-06-08"
decision: Migrate test-runner scripts to workspace facade
owner: skills/test-runner/scripts/package.json
scope: third facade-backed consumer migration
source:
  - "chat: 2026-06-08 test-runner workspace facade migration"
decision_mode:
  question: Which facade-backed script package should migrate after fallow?
  option: migrate test-runner because it has focused test and typecheck verification
  confidence: strong
```

Decision:

- Add `skills/test-runner/scripts` to root Bun workspaces.
- Change `skills/test-runner/scripts` from local `file:` facade dependency to `workspace:*`.
- Remove the stale package-local `bun.lock`.
- Align the package-owned `test` script with the focused runner test suite.
- Keep `test-runner` package-owned `test` and `typecheck` scripts as verification.
- Keep `browser-use` on local development portability until migrated separately.

Rationale:

- `test-runner` already has focused runtime tests and TypeScript checks.
- Direct `bun test` runs intentionally failing fixture files; the package script needs the focused test file.
- Migrating it proves the workspace facade path for the repo test harness.
- Leaving `browser-use` last limits the browser-path blast radius.

Consequences:

- `test-runner` scripts now resolve `@side-quest/cli-command-facade` through the workspace graph.
- Root `bun.lock` owns `test-runner` dependency state.
- The migration tracker now has three migrated consumers and one local-development portable consumer.

Next:

- Migrate `browser-use` after `test-runner` verification passes.

V2 Ideas:

- Add a workspace dependency scanner after all four facade-backed packages migrate.

## Decision 121: Migrate Browser Use Scripts To Workspace Facade

```yaml
id: decisions-skill-121
status: accepted
decided_at: "2026-06-08"
decision: Migrate browser-use scripts to workspace facade
owner: skills/browser-use/scripts/package.json
scope: fourth facade-backed consumer migration
source:
  - "chat: 2026-06-08 browser-use workspace facade migration"
decision_mode:
  question: Which facade-backed script package remains after test-runner?
  option: migrate browser-use because it is the last local file-path facade consumer
  confidence: strong
```

Decision:

- Add `skills/browser-use/scripts` to root Bun workspaces.
- Change `skills/browser-use/scripts` from local `file:` facade dependency to `workspace:*`.
- Remove the stale package-local `bun.lock`.
- Keep `browser-use` package-owned `test` and `typecheck` scripts as verification.
- Treat the four tracked facade consumers as migrated to workspace facade.

Rationale:

- `browser-use` was the last tracked package still depending on the local facade checkout.
- Workspace facade dependency removes hidden local checkout coupling for bundled repo exports.
- Package-owned tests and typecheck keep the browser-path migration inspectable.

Consequences:

- `browser-use` scripts now resolve `@side-quest/cli-command-facade` through the workspace graph.
- Root `bun.lock` owns `browser-use` dependency state.
- The migration tracker now has all four facade consumers migrated.
- Workspace bundle portability is stronger; standalone skill zip portability still needs publishing, private install, or per-zip bundled runtime.

Next:

- Add a workspace dependency scanner or run the next portability audit over portable owner files.

V2 Ideas:

- Revisit standalone zip packaging after workspace bundle migration stays green.

## Decision 122: Use Skill Root Bun Package Shape

```yaml
id: decisions-skill-122
status: accepted
decided_at: "2026-06-09"
decision: Use skill root Bun package shape
owner: skills/create-skill/references/runtime-portability.md
scope: Bun-backed skill package layout
source:
  - "chat: 2026-06-09 Bun skill package governance"
  - skills/create-skill/TASKS.md
```

Decision:

- Put Bun-backed skill package `package.json` files at the skill root.
- Put package `tsconfig.json` files at the skill root beside `package.json`.
- Put Bun-owned source, tests, contracts, fixtures, and build helpers under `src/`.
- Reserve `scripts/` for non-Bun helper skills that have no `package.json`.
- Treat old `scripts/package.json` shapes as migration exceptions or archive history.

Rationale:

- Package-root manifests make the package boundary obvious.
- Root `tsconfig.json` avoids hiding package configuration inside source.
- `src/` keeps implementation files together without turning `scripts/` into a second package root.
- Non-Bun helper skills still need a lightweight `scripts/` home when no package exists.

Consequences:

- New Bun-backed skill packages should not start in `scripts/`.
- Existing active Bun packages should migrate to skill-root package shape.
- Package checks can assume `package.json` and `tsconfig.json` live at the package root.

Next:

- Keep `runtime-portability.md` and the workspace invariant checker aligned with this shape.

V2 Ideas:

- Add archive-only checks if stale active `scripts/package.json` paths reappear.

## Decision 123: Use Scripts For Source Mode And Bins For Published Tools

```yaml
id: decisions-skill-123
status: accepted
decided_at: "2026-06-09"
decision: Use scripts for source mode and bins for published tools
owner: skills/create-skill/references/runtime-portability.md
scope: Bun package command surfaces
source:
  - "chat: 2026-06-09 bin and script governance"
  - scripts/check-workspace-facade-invariants.ts
```

Decision:

- Use `package.json#scripts` for repo-local source-mode commands.
- Use `package.json#bin` only for published or externally consumed tools.
- Keep private repo-local skill packages free of `bin` entries.
- Keep public package bins pointed at built distribution files unless an explicit source-distribution exception is accepted.
- Keep CLI command contracts naming command identity, not `bun run`, source paths, or dist paths.

Rationale:

- Repo prose can call `bun run <script>` consistently.
- Published bins are install contracts and should not expose dev-only source paths.
- Private skill packages do not need global command installation surfaces.
- Command contracts stay package-agnostic when they name command identity only.

Consequences:

- Private packages with `bin` entries fail governance checks.
- Public package bins must be covered by the package `files` allowlist.
- Source-mode examples in skill prose should use `bun run`.

Next:

- Keep checking package manifests and lockfile metadata for stale private bins.

V2 Ideas:

- Add clean tarball install-and-execute proof for public package bins.

## Decision 124: Lock TypeScript Through Workspace Catalogs

```yaml
id: decisions-skill-124
status: accepted
decided_at: "2026-06-09"
decision: Lock TypeScript through workspace catalogs
owner: skills/create-skill/references/runtime-portability.md
scope: active Bun workspace TypeScript governance
source:
  - "chat: 2026-06-09 TypeScript governance audit"
  - package.json
  - scripts/check-workspace-facade-invariants.ts
```

Decision:

- Let root `package.json#workspaces.catalog` own shared TypeScript tool versions.
- Lock `typescript`, `@types/bun`, and `@types/node` together.
- Use `catalog:` for active workspace package TypeScript and runtime type dependencies.
- Use `@types/bun` with `compilerOptions.types: ["bun"]` for Bun CLI packages.
- Use `@types/node` with `compilerOptions.types: ["node"]` for Node-library packages.
- Do not declare direct `bun-types` in active workspace packages.
- Keep portable package `tsconfig.json` files self-contained.

Rationale:

- Workspace catalogs remove version drift without adding a published shared tsconfig package.
- Package-local configs keep package roots portable.
- Direct `bun-types` created two Bun ambient type versions in the lockfile.
- Self-contained configs are easier to export than root-relative `extends`.

Consequences:

- Active packages cannot use `*`, `^`, or `~` for TypeScript toolchain deps.
- Package typecheck scripts should use `tsc --noEmit -p tsconfig.json`.
- `noUncheckedIndexedAccess` remains a separate hardening pass because it exposed broad indexed-access work.

Next:

- Keep `bun run check:workspace-facade` enforcing catalog and tsconfig drift.

V2 Ideas:

- Re-enable `noUncheckedIndexedAccess` after parser and fixture indexing paths have explicit guards.

## Decision 125: Derive Checker Facts From Package Truth

```yaml
id: decisions-skill-125
status: accepted
decided_at: "2026-06-09"
decision: Derive checker facts from package truth
owner: scripts/check-workspace-facade-invariants.ts
scope: workspace runtime package governance
source:
  - "chat: 2026-06-09 checker registry review"
  - skills/create-skill/references/runtime-portability.md
```

Decision:

- Keep policy in `scripts/check-workspace-facade-invariants.ts`.
- Derive package facts from root workspaces, package manifests, package `tsconfig.json`, package `bin`, package `scripts`, and conventional `src/command-contract.ts`.
- Do not maintain a separate package registry while derivation is enough.
- Keep workflow guidance in `runtime-portability.md`.

Rationale:

- A separate registry removed package facts from checker code but created a second source of truth.
- Package manifests already own command surfaces, dependency facts, and publication shape.
- Conventional owner paths give enough structure without extra config ceremony.

Consequences:

- Adding a package means updating its manifest and root workspace entry, not a second registry file.
- Checker logic should stay generic and discover package facts.
- Add a registry only if a recurring package fact cannot be derived cleanly.

Next:

- Preserve this derivation-first shape while extending workspace checks.

V2 Ideas:

- Add machine-readable exceptions only for rare, named exceptions that cannot live in package manifests.

## Decision 126: Remove Browser Use Legacy Shell Wrapper

```yaml
id: decisions-skill-126
status: accepted
decided_at: "2026-06-09"
decision: Remove browser-use legacy shell wrapper
owner: skills/browser-use/package.json
scope: browser-use source command surface
source:
  - "chat: 2026-06-09 browser-use shell wrapper audit"
  - skills/browser-use/src/preflight-browser-adapter.test.ts
```

Decision:

- Remove `skills/browser-use/src/launch-agent-chrome.sh`.
- Do not keep shell wrappers in `browser-use` unless they are declared package command surfaces or own a missing-runtime boundary that TypeScript cannot handle.
- Route Warm Chrome launch through `preflight-warm-chrome` package scripts and built bins.

Rationale:

- The wrapper only translated legacy positional args into `preflight-warm-chrome.ts launch`.
- It was not declared in `package.json#scripts` or `package.json#bin`.
- It was not part of the published `dist/` payload.
- Tests were preserving an undocumented legacy surface.

Consequences:

- `browser-use` now has no shell files under `src/`.
- Legacy `launch-agent-chrome.sh` invocations are no longer supported.
- Future shell wrappers need an explicit package-surface or missing-runtime reason.

Next:

- Keep `browser-use` shell-free unless a new accepted boundary names why shell is required.

V2 Ideas:

- Add a checker rule if undeclared `.sh` files reappear in Bun package source.

## Decision 127: Rename Decisions Skill To Record Decision

```yaml
id: decisions-skill-127
status: accepted
decided_at: "2026-06-09"
decision: Rename decisions skill to record-decision
owner: skills/record-decision
scope: accepted decision capture skill routing
source:
  - "chat: 2026-06-09 skill rename"
  - skills/record-decision/SKILL.md
```

Decision:

- Rename `skills/decisions/` to `skills/record-decision/`.
- Set frontmatter `name` to `record-decision`.
- Keep the skill singular and action-shaped.
- Use `record-decision` for future helper command naming.
- Leave historical decision IDs and source brainstorm filenames unchanged as provenance.

Rationale:

- `record-decision` describes the workflow as a verb-object action.
- `decisions` read like a topic folder, not an invocation target.
- Singular naming fits ordinary use while still supporting multiple entries in one session.
- Historical log IDs remain stable because changing them would break decision references.

Consequences:

- Active owner paths and handoff routes point to `skills/record-decision/`.
- `context-advisor` routes accepted repo decisions to `record-decision`.
- Future runtime work should prefer `record-decision` over `decisions record`.
- Historical entries may still mention `decisions` when describing prior accepted state.

Next:

- Run skill description and role audits after the rename.

V2 Ideas:

- Add a temporary bridge only if old-name invocation failures appear after active-reference audit.

## Decision 128: Use Owner-Scoped Tracker Bindings

```yaml
id: decisions-skill-128
status: accepted
decided_at: "2026-06-09"
decision: Use owner-scoped tracker bindings
owner: skills/coding-task-tracker
scope: coding task tracker setup and CRUD safety
source:
  - "chat: 2026-06-09 coding-task-tracker owner binding grill"
  - skills/coding-task-tracker/SKILL.md
  - skills/coding-task-tracker/src/coding-task-tracker.ts
```

Decision:

- Scope Coding Task Tracker bindings to owner paths, not entire repositories.
- Let any directory with `.coding-task-tracker/` config become a Tracker owner path.
- Resolve the nearest Tracker owner path upward from the command working directory.
- Split tracker config between committed owner identity and ignored local Notion identifiers.
- Allow only setup commands to write tracker binding config.
- Require external trackers to expose a Tracker fingerprint before CRUD writes.
- Use two-stage create for v1: emit the required tracker shape, then bind and validate the created or duplicated tracker.

Rationale:

- Bun workspace repos can have separate durable work owners, including individual skills.
- Owner-path scoping follows the context-advisor rule that storage follows the owner.
- Split config preserves repo-visible ownership without committing account-specific Notion routing facts.
- Fingerprint verification prevents wrong-owner CRUD when local config points at the wrong Notion tracker.
- Two-stage create avoids turning v1 into a general Notion database creator.

Consequences:

- `coding-task-tracker` CRUD resolves owner binding before task lookup or mutation.
- Missing owner config returns a no-mutation setup path.
- Runtime code, help, and tests own exact config filenames, fields, diagnostics, and command contracts.
- `SKILL.md` stays thin and points to the runtime owner.

Next:

- Design the setup and CRUD CLI changes with `cli-author`.

V2 Ideas:

- Add direct Notion tracker creation after two-stage setup proves too costly.

## Decision 129: Ship Bind-Only Tracker MVP

```yaml
id: decisions-skill-129
status: accepted
decided_at: "2026-06-09"
decision: Ship bind-only tracker MVP
owner: skills/coding-task-tracker
scope: coding task tracker setup MVP
source:
  - "chat: 2026-06-09 coding-task-tracker feasibility review"
  - skills/coding-task-tracker/src/coding-task-tracker.ts
```

Decision:

- Ship the first owner-scoped tracker version as a bind-only MVP.
- Support nearest-owner resolution, split config, `bind`, `doctor`, and CRUD safety.
- Validate the configured Notion data source before writes.
- Defer direct Notion database creation.
- Defer external tracker fingerprint marker enforcement beyond data-source validation.
- Keep CRUD commands from writing tracker binding config.

Rationale:

- The safe core needs to work before adding Notion database creation or richer setup flows.
- Bind-only setup preserves owner-scoped routing without making the MVP a Notion schema manager.
- Data-source validation catches stale or malformed local binding while keeping existing trackers usable.

Consequences:

- `bind` is the only MVP setup command.
- `doctor` proves the resolved owner binding and Notion access.
- Full Tracker fingerprint marker enforcement remains a follow-up.
- `setup plan-create` remains a follow-up, not MVP scope.

Next:

- Use the MVP and add richer setup only when repeated friction appears.

## Decision 130: Block Inherited Tracker Writes

```yaml
id: decisions-skill-130
status: accepted
decided_at: "2026-06-09"
decision: Block inherited tracker writes
owner: skills/coding-task-tracker
scope: coding task tracker owner-resolution DX
source:
  - "chat: 2026-06-09 coding-task-tracker adversarial reviewer pass"
  - skills/coding-task-tracker/src/coding-task-tracker.ts
  - skills/coding-task-tracker/SKILL.md
```

Decision:

- Allow reads to use an inherited tracker owner.
- Label inherited reads in the runtime envelope.
- Block writes when owner resolution is inherited.
- Allow writes from the exact owner path.
- Allow writes with explicit `--owner <path>`.
- Treat a child `.coding-task-tracker/` directory as authoritative even when its config is broken.
- Validate target task parent data source before writes.

Rationale:

- Inherited reads support discovery without forcing setup.
- Inherited writes can mutate a parent tracker when the user intended a child tracker.
- Explicit owner targeting makes cross-directory writes inspectable.
- Broken child config should fail closed instead of falling through to a parent tracker.
- Target-page validation catches stale views before mutation.

Consequences:

- Agents can read `owner_resolution` before deciding whether to write.
- Browser-use repo-root tracker commands pass `--owner ../..` from `skills/coding-task-tracker`.
- Child skills can bind their own tracker when they need isolated task state.

Next:

- Add direct tracker creation only after bind-only setup creates repeated friction.

## Decision 131: Govern Agent-Native CLI Implementation Shape

```yaml
id: decisions-skill-131
status: accepted
decided_at: "2026-06-09"
decision: Govern agent-native CLI implementation shape
owner: skills/cli-author/references/agent-native-cli-design.md
scope: runtime-backed CLI implementation guidance
source:
  - "chat: 2026-06-09 coding-task-tracker Fallow refactor review"
  - skills/coding-task-tracker/src/coding-task-tracker.ts
  - skills/cli-author/references/agent-native-cli-design.md
```

Decision:

- Add implementation-shape guidance to agent-native CLI design.
- Keep multi-command CLI dispatchers thin.
- Move command bodies into named handlers once lookup, validation, network, file, or mutation behavior appears.
- Extract repeated target parsing, validation, envelope builders, and tool-call error builders before the third copy appears.
- Run Fallow after meaningful CLI implementation.
- Treat introduced duplication and oversized dispatchers as refactor work.
- Treat private-handler `add-tests` findings as coverage prompts, not automatic direct-test requirements.

Rationale:

- `coding-task-tracker` grew an oversized dispatcher and duplicated helper logic during fast CLI iteration.
- Existing guidance named contract owners but did not give an implementation-shape checkpoint.
- A prose design checkpoint plus Fallow evidence is enough; a workspace invariant would be brittle here.

Consequences:

- `cli-author` owns the implementation-shape guidance.
- `create-skill` points runtime-backed skill work to `cli-author` and keeps skill prose thin.
- Runtime code and tests still own exact handler names, helper signatures, and output contracts.

Next:

- Use the developer tooling governance audit to check root-owned lint, test, and TypeScript portability.

## Decision 132: Split Browser, 1Password, Prompt-System, and Issue-to-PR Vocabulary Into Scoped Contexts

```yaml
id: decisions-skill-132
status: accepted
decided_at: "2026-06-11"
decision: Split browser, 1Password, prompt-system, and issue-to-pr vocabulary out of root CONTEXT.md
owner: docs/agents/domain.md
scope: CONTEXT-MAP.md
supersedes: decisions-skill-061 (the "keep root CONTEXT.md for Issue-to-PR and Browser Adapter vocabulary" clause)
source:
  - "chat: 2026-06-11 root CONTEXT.md junk-drawer split"
```

Decision:

- Root `CONTEXT.md` no longer owns browser, 1Password, prompt-system-workflow, or Issue-to-PR vocabulary. It keeps only cross-cutting agent-config, startup, governance, and CLI-design terms (15 terms).
- Browser vocab moves to `skills/browser-use/CONTEXT.md`; 1Password to `skills/one-password/CONTEXT.md`; prompt-system to `skills/prompt-system-workflow/CONTEXT.md`; Issue-to-PR to `runbooks/issue-to-pr-v2/CONTEXT.md`.
- `CONTEXT-MAP.md` is the canonical index of all scoped contexts.
- Three retired Issue-to-PR terms archived to `docs/archive/2026-06-11-context-split-retired-terms.md`.

Rationale:

- Root `CONTEXT.md` had become a 78-term junk drawer spanning four unrelated bounded contexts.
- Decision 61 explicitly placed Issue-to-PR and Browser Adapter vocab in root; that clause is now superseded.
- Conservation verified: 78 terms = 60 moved + 15 kept + 3 archived, zero lost, zero duplicated.

Consequences:

- Decision 61's "keep root CONTEXT.md for Issue-to-PR, Browser Adapter" clause is superseded; the rest of Decision 61 (agent-native CLI split) stands.
- Agents resolve a term in the nearest scoped context first, falling back to root only for cross-cutting vocabulary.
- The runbook's "no central glossary" policy is now honored — Issue-to-PR vocab lives in the runbook it serves.

Next:

- Split further root vocabulary only when a stable scoped owner boundary is evident (carries Decision 61's V2 idea forward).

## Decision 133: Resolve Startup Owner From Main Worktree When Linked Worktrees Lack The Relative Target

```yaml
id: decisions-skill-133
status: accepted
decided_at: "2026-06-14"
decision: Resolve startup owner from main worktree when linked worktrees lack the relative target
owner: scripts/agent-instructions.sh
scope: agent-instructions.config
source:
  - "chat: 2026-06-14 VS Code commit blocked by instruction health check in Codex worktree"
```

Decision:

- Keep `startup_owner` as the configured checkout owner.
- Resolve relative `startup_owner` from the current checkout first.
- If that target has no startup files and Git exposes a different main worktree, retry the same relative value from the main worktree.
- Run the pre-commit health script through `bash` so Git does not depend on worktree-local shebang execution metadata.
- Keep the projection check strict after owner resolution.

Rationale:

- Linked Codex worktrees can share one global startup owner with the main checkout.
- `startup_owner=../claude-code-config` resolves correctly in the main checkout but not under `.codex/worktrees/<id>/claude-code-config`.
- Failing projection checks in those worktrees blocks unrelated skill/doc commits even when home symlinks point at the intended owner.

Consequences:

- Worktree commits validate the configured shared startup owner instead of the transient worktree path.
- Missing or wrong home symlinks still fail after resolution.
- Absolute owner config remains unnecessary.

Next:

- Prefer repo-owned relative config; add a specific config value only if another checkout topology cannot be inferred from Git worktree state.
