---
title: Decisions Skill Decision Log
slug: decisions-skill
type: decision-log
status: in-progress
date: "2026-06-06"
timezone: Australia/Melbourne
owner: skills/decisions
source:
  - docs/brainstorms/2026-06-06-decisions-skill-operating-manual.md
codex_session_id: "019e9b07-c5f8-7c42-a373-ec68d5e827bc"
decision_metadata_format: fenced-yaml-per-decision
---

# Decisions Skill Decision Log

Use this log for decisions made while designing the future `decisions` skill.

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
- Use `create-cli` before designing or implementing the helper.
- Treat exact parser rules, command contracts, output envelopes, and storage adapters as runtime-owned if the helper is built.

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

- Use `create-cli` before designing any helper command surface.
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
- Use `create-cli` before implementation.
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
- Keep helper implementation as a later `create-cli`-gated slice.

Rationale:

- The storage workflow is clear enough to use as a skill.
- The read-only checker contract still needs a separate CLI design pass.

Consequences:

- Agents can invoke `decisions` for accepted decision storage.
- Helper implementation does not start from this scaffold alone.

Next:

- Validate skill frontmatter and decision-log YAML.

V2 Ideas:

- Implement `decisions check` after a `create-cli` pass.
