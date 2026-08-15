---
title: "feat: Prove read-only gog inbox cleanup prototype"
type: feat
date: 2026-08-15
status: accepted
---

# Read-only gog inbox cleanup prototype

## Outcome

Add one first-party `gog-inbox-cleanup` skill that audits bounded Gmail search
metadata and returns exact label-only cleanup proposals. The prototype has no
Gmail mutation path.

## Boundary

### In scope

- Read the nearest explicit `.productivity.yml` before Gmail access.
- Require one `connectors.email-account` and one `connectors.email-client`.
- Run one capped Gmail search through `gog` with read-only and no-send guards.
- Classify sender-level cohorts from search metadata without fetching bodies.
- Exclude protected or ambiguous mail before lower-risk proposals.
- Keep the primary proposal lane label-only; return archive, unsubscribe, block,
  keep, and needs-review decisions in a separate non-executable review lane.
- Report caps, overlaps, exclusions, uncertainty, and exact private scopes.
- Report sender-domain concentration without message text.
- Emit a value-free receipt suitable for private persistence by the caller.
- Prove the public CLI with synthetic fixtures and one bounded live read.

### Out of scope

- Gmail label, archive, filter, unsubscribe, block, spam, trash, delete, send,
  reply, forwarding, or settings commands.
- GitHub, alias, subscription, scheduled-task, or external-message changes.
- Message-body or attachment reads.
- Changes to `gog-inbox-triage`.
- Commit, push, pull request, or projection apply.

## Design decisions

### Invocation and skill shape

- Use the model invocation lane with a narrow cleanup-audit trigger.
- Keep `SKILL.md` as the workflow driver and runtime pointer.
- Keep exact flags, output vocabulary, allowlists, and classifications in code,
  help, and tests.
- Depend on installed `gog` and the `gog-gmail` command contract. Do not copy
  their generated command inventory into the skill.

### CLI surface

- Command: `gog-inbox-cleanup audit`.
- No args: concise help and one safe example.
- Required flags: `--config`, `--query`, and `--max`.
- Output: human summary by default; stable JSON with `--json`.
- Stdout: primary result only. Stderr: diagnostics only.
- Exit `0`: completed audit, including zero candidates.
- Exit `2`: missing, ambiguous, unbounded, or unsafe input.
- Exit `1`: dependency, auth, subprocess, or unexpected runtime failure.
- No mutation, preview-write, confirmation, force, or execute flag exists.

### Google execution allowlist

The runtime constructs exactly one subprocess family:

```text
gog --account <config account> --client <config client>
    --enable-commands-exact gmail.search --readonly --gmail-no-send
    --no-input --wrap-untrusted --json
    gmail search <bounded query> --max <cap>
```

- Reject `--all`, empty queries, mutation-like Gmail terms, caps outside the
  package limit, and additional caller-supplied gog arguments.
- Pass argv directly to Bun spawn. Never invoke a shell.
- Accept only JSON search results. Never call thread, message, attachment,
  settings, label, filter, send, draft, or batch endpoints.

### Classification

- Normalize synthetic or live search rows into thread id, sender, subject,
  date, and Gmail label names. Discard snippets immediately.
- Apply protected-category detection before candidate classification.
- Protect security, recovery, finance, health, government, legal, family,
  receipt, warranty, return, and active-subscription indicators.
- Group remaining rows by exact sender, then domain when every included sender
  shares the same proposed result.
- Return `label-candidate` in the primary lane. Return `keep`,
  `archive-candidate`, `unsubscribe-candidate`, `block-candidate`, and
  `needs-review` in a separate review lane.
- The first live prototype may concretely recommend only a label. Every other
  decision is a review signal with no executable continuation.
- Explain mixed cohorts, overlapping category matches, and cap truncation.

### Privacy and receipts

- Exact sender or domain scopes appear only in the private command result.
- The receipt records run id, timestamp, query hash, cap, counts, exclusions,
  outcome, changed state, and next safe action.
- The receipt excludes account value, query text, senders, subjects, snippets,
  thread ids, bodies, attachments, auth data, and URLs.
- The CLI writes no receipt or audit file. The caller may redirect JSON into a
  private mode-0600 location outside the vault.

## Owner map

- Skill route: `skills/gog-inbox-cleanup/SKILL.md`
- Package metadata: `skills/gog-inbox-cleanup/package.json`
- Public CLI and argv parsing: `skills/gog-inbox-cleanup/src/cli.ts`
- Config and identity validation: `skills/gog-inbox-cleanup/src/config.ts`
- Gmail subprocess allowlist: `skills/gog-inbox-cleanup/src/gog-runner.ts`
- Data model and receipt vocabulary: `skills/gog-inbox-cleanup/src/model.ts`
- Pure classification: `skills/gog-inbox-cleanup/src/audit-engine.ts`
- Public process proof: colocated `*.test.ts` files under the same `src/`
- Google routing contract: existing `skills/productivity-connectors/` plus the
  installed `gog` and `gog-gmail` skills

## Code-structure pressure gate

- Pressure source: production subprocess execution and deterministic synthetic
  execution must share one audit workflow.
- Seam: an injected argv runner at the Gmail process boundary.
- Deletion test: removing the seam duplicates process behavior inside the
  classifier or makes public CLI tests depend on live Gmail.
- Locality gain: all allowed commands and read-only flags stay in one module.
- Second adapter: Bun spawn in production and an argv-recording fake in tests.
- Choice: plain function interface. No named design pattern or registry.

## Implementation units

### U1. Scaffold the portable skill package

- Add the skill workspace entry, package metadata, TypeScript config, and thin
  skill route.
- Add no dependency beyond repo catalog TypeScript and Bun types.
- Add a repo-local script, not a published bin.

### U2. Implement pure contracts and classification

- Define package-owned input, result, proposal, exclusion, overlap, and receipt
  types.
- Normalize only synthetic Gmail search result shapes observed from `gog`.
- Implement protected-first classification and exact cohort aggregation.
- Bound every emitted collection and record truncation.

### U3. Implement identity and gog boundary

- Parse `.productivity.yml` with Bun YAML support.
- Require exact scalar `email-account` and `email-client` values.
- Build and execute only the allowlisted Gmail search argv.
- Reject unexpected JSON shape and redact runtime failures.

### U4. Implement public CLI

- Add help, parser validation, human output, JSON output, exit meanings, run
  correlation, and safe recovery hints.
- Keep the dispatcher thin and the process entrypoint non-interactive.

### U5. Prove and qualify

- Run focused process and engine tests with synthetic GitHub, newsletter,
  receipt, security, ambiguous, capped, and overlapping fixtures.
- Demonstrate a command-spy RED/GREEN sensitivity check for mutation-command
  refusal.
- Run typecheck, Biome on changed files, package tests, existing
  `gog-inbox-triage` contract checks, skill-description audit, and setup sync
  check.
- Read the applicable `.productivity.yml`, then run one capped live audit using
  its account and client.
- Compare bounded pre/post read-only mailbox evidence and record only sanitized
  counts outside the vault.

## Test boundary

- Primary proof layer: public Bun process with synthetic config and fake `gog`
  executable on `PATH`.
- Supporting proof: pure classifier tests for category and overlap edges.
- Live proof: bounded Gmail read and repeatable read-only state comparison.
- Not proved: Gmail mutation execution, unsubscribe safety, filters, labels,
  production scheduling, full-mailbox completeness, or fresh projected skill
  discovery before merge and sync.

## Completion gate

- Every goal requirement maps to a passing check or an explicit unproved item.
- No Gmail mutation-capable command appears in source or observed subprocesses.
- No private message value enters repository, vault, fixture, snapshot, receipt,
  or public handoff.
- Nathan reviews the sanitized prototype output before any mutation-phase goal.
