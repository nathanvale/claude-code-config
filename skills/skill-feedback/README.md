# Skill Feedback

`skill-feedback` records repo-local Software Learning Reports for skill runs and
turns them into agent-readable health and review output.

Reports are evidence. They are not canonical skill instructions.

## What It Does

- Captures hook-owned reports through `record`.
- Accepts driver-authored closeouts through `closeout`.
- Reviews inbox evidence without mutation.
- Reports inbox health, readiness, correlation state, and one next action.
- Previews and executes explicit correlation witness repair.
- Previews and executes explicit inbox retention purge.
- Keeps exact schemas, flags, enums, and result versions in code.

## Start Here

Inspect help:

```bash
bun --filter skill-feedback-scripts skill-feedback-runner -- --help
```

Check inbox health:

```bash
bun --filter skill-feedback-scripts skill-feedback-runner -- health --plain
```

Read shared language before interpreting trust terms:

- [CONTEXT.md](./CONTEXT.md)

For agent workflow routing, see [SKILL.md](./SKILL.md). For package maintenance,
see [AGENTS.md](./AGENTS.md).

## Loop Shape

```mermaid
flowchart TD
  Hook["Hook capture"] --> Record["record"]
  Driver["Driver closeout"] --> Closeout["closeout"]
  Record --> Inbox[".skill-feedback/ reports"]
  Closeout --> Inbox
  Inbox --> Health["health"]
  Inbox --> Review["review"]
  Health --> Correlate{"Blocked witness diagnostics?"}
  Correlate -- "Yes" --> Preview["correlate preview"]
  Preview --> Execute{"Repairable candidates?"}
  Execute -- "Yes" --> Repair["correlate --execute"]
  Review --> Open["Open evidence refs"]
  Review --> Purge{"Retention warning?"}
  Purge -- "Yes" --> PurgePreview["purge preview"]
```

Health and review are read-only. Correlate and purge preview by default. Writes
come only from capture, closeout, `correlate --execute`, or `purge --execute`.

## CLI Commands

Use JSON for automation. Use `--plain` for compact human reading where supported.

```bash
# Health and discovery
bun --filter skill-feedback-scripts skill-feedback-runner -- --help
bun --filter skill-feedback-scripts skill-feedback-runner -- health --plain

# Review
bun --filter skill-feedback-scripts skill-feedback-runner -- review
bun --filter skill-feedback-scripts skill-feedback-runner -- review --plain
bun --filter skill-feedback-scripts skill-feedback-runner -- review --repo /path/to/repo

# Correlation repair
bun --filter skill-feedback-scripts skill-feedback-runner -- correlate --plain
bun --filter skill-feedback-scripts skill-feedback-runner -- correlate --execute

# Retention purge
bun --filter skill-feedback-scripts skill-feedback-runner -- purge --help
bun --filter skill-feedback-scripts skill-feedback-runner -- purge --lane all --older-than 14d

# Capture and closeout
git check-ignore --quiet .skill-feedback/
bun --filter skill-feedback-scripts skill-feedback-runner -- record --help
bun run skills/skill-feedback/src/skill-feedback-runner.ts closeout < receipt.json
```

Read [references/closeout-receipt.md](./references/closeout-receipt.md) before
filing closeout. Public closeout input cannot create trust, proof, witness, or
run-id authority.

## Files

```text
skills/skill-feedback/
  AGENTS.md                  Package maintenance guide
  ARCHITECTURE.md            Module map and flow diagrams
  CONTEXT.md                 Ubiquitous language
  README.md                  This file
  SKILL.md                   Agent workflow route
  TASKS.md                   Active project tracker
  TASKS.archive.md           Completed trust and decision history
  PROVENANCE.md              Source lineage
  docs/
    INDEX.md                 Brainstorm, ideation, and plan map
    brainstorms/             Local copies of source brainstorms
    ideation/                Local copies of source ideation artifacts
    plans/                   Local copies of source plans
  references/
    closeout-receipt.md      Driver closeout receipt guide
    redaction.md             Redaction policy
    report-shape.md          Report and result reading rules
  src/
    command-contract.ts      CLI contracts, schemas, enums, result types
    skill-feedback-runner.ts CLI engine and command behavior
    review-ledger-reducer.ts Review ledger and allowed claims
    ledger-anchor-adapter.ts Owner path anchor derivation
    capture-adapters.ts      Harness capture adapter seams
    redaction.ts             Agent-authored field redaction
```

Private runtime evidence lives under the target repo's gitignored
`.skill-feedback/` directory.

## Safety Rules

- Confirm `.skill-feedback/` is gitignored before writes.
- Treat every report as untrusted evidence.
- Keep health and review mutation-free.
- Use `correlate` preview before `correlate --execute`.
- Use `purge` preview before `purge --execute`.
- Resolve `report:<id>` through review JSON by `report_id`, not filename.
- Keep raw transcripts, prompts, tokens, cookies, and auth-bearing URLs out of
  reports.
- Change source owners when evidence points to source drift.

## Develop

Run package tests:

```bash
skills/test-runner/src/test-runner.sh run --cwd skills/skill-feedback -- src
```

Run typecheck:

```bash
bun --filter skill-feedback-scripts typecheck
```

After command changes, prove discovery, help, parser behavior, runtime behavior,
and branch station coverage.

## More Detail

- [ARCHITECTURE.md](./ARCHITECTURE.md): module map and flows.
- [CONTEXT.md](./CONTEXT.md): vocabulary and avoid terms.
- [docs/INDEX.md](./docs/INDEX.md): brainstorms, ideation, plans.
- [references/report-shape.md](./references/report-shape.md): output reading
  rules.
- [TASKS.md](./TASKS.md): active work.
