---
title: "Skill Feedback No-Arg Front Door - CLI Spec"
type: spec
date: 2026-07-02
topic: skill-feedback-no-arg-front-door
artifact_contract: cli-author-spec/v1
artifact_readiness: design-only
source_guidance: cli-author
---

# Skill Feedback No-Arg Front Door - CLI Spec

## Decision

Keep `skill-feedback` no-arg as a read-only dashboard, not help-only output.

Why:

- The CLI owns repo-local inbox state.
- The inbox is currently populated enough to summarize.
- Humans need a launcher for reports, usage, queue, and drill-down.
- Current no-arg output over-indexes on health and correlation repair.

Do not frame this as an ADHD helper or personal-productivity mode. The product
shape is stateful skill observability with low cognitive load.

## Minimum CLI Design Brief

- Command name: `skill-feedback`.
- Purpose: expose Software Learning Reports as a human-readable observability
  front door.
- Target users: human maintainers first; agents and scripts through command
  discovery and JSON-capable subcommands.
- Invocation shape: no-arg dashboard; `dashboard` alias; human commands
  `reports`, `report <id>`, `usage`, and `queue`; diagnostic commands
  `review`, `health`, `correlate`, and `purge`.
- No-arg behavior: state dashboard when inbox is populated, get-started help
  when empty, repair path when unsafe.
- Help behavior: `--help` lists the human questions each command answers before
  internal diagnostics.
- Output streams: dashboard and plain views to stdout; diagnostics and errors
  follow existing command envelope rules.
- Output modes: dashboard/plain for humans; JSON remains on data commands where
  scripts need complete evidence.
- Exit codes: no-arg exits `0` for missing, empty, or populated readable state;
  exits `1` for unsafe or unreadable inbox state; exits `2` for invalid
  dashboard usage.
- Error style: repair-state output names what is unreadable and the next repair
  command; no stack traces or file dumps.
- Side-effect stance: no-arg and all MVP observability commands are read-only.
- Safety gates: destructive candidates appear only as preview commands; no-arg
  never executes `purge --execute` or `correlate --execute`.
- Config/env behavior: keep current `--repo <path>` dashboard targeting.
- Non-interactive behavior: no prompts.
- Smoke command: `bun run skills/skill-feedback/src/skill-feedback-runner.ts`.

## State Gates

| State | Dashboard behavior |
| --- | --- |
| Missing inbox | Show get-started help for capture/closeout plus `health`. |
| Empty inbox | Show get-started help and explain no reports exist yet. |
| Populated inbox | Show counts, newest report timestamp, signal summary, and command launcher. |
| Unsafe or unreadable inbox | Show blocked repair path before normal commands. |
| Destructive work available | Show preview command only, under diagnostics. |

## First Screen Shape

```text
Skill Feedback
Reports: 258 primary, 556 low-signal
Newest: primary 2026-07-01T19:49:19.379Z
Signals: repeated friction, high verification burden, owner-path observations

Next:
  reports              Browse recent reports
  report <id>          Open a report ref from reports, usage, or queue
  usage                See which skills are being used
  queue                See what to inspect next
  review               Inspect full evidence summary

Diagnostics:
  health               Check inbox and readiness state
  correlate            Preview correlation witness repair
  purge                Preview retention cleanup
```

Keep this bounded. The dashboard launches commands; it does not render the full
review ledger, full report list, or all health diagnostics.

## Command Launcher Rules

- Lead with `reports`, `usage`, `queue`, and one concrete `report <id>` when a
  recent primary report id is available.
- Keep `review` visible as full evidence, not the primary human path.
- Keep `health`, `correlate`, and `purge` under diagnostics unless the inbox is
  unsafe, unreadable, unauthenticated, or otherwise blocked.
- Use `report:<id>` refs as navigation; do not show filenames by default.
- Separate primary report counts from low-signal counts.
- Label low-signal evidence where it appears.

## Current-State Application

Live read-only evidence on 2026-07-02:

- `primary=258`
- `low-signal=556`
- `unlinked=258`
- `next_action=preview-correlation-repair`

Spec impact:

- Populated-state dashboard is justified.
- Correlation status remains visible but secondary.
- The first command group must not be `health | correlate | review`.
- The first command group should be `reports | usage | queue | review`, plus
  one `report <id>` drill-down when available.

## Contract Changes For Later Implementation

Do not implement until this spec is accepted or planned.

- Add command contracts for `reports`, `report`, `usage`, and `queue`.
- Update `dashboard` summary and help copy to name human observability.
- Keep `dashboard` output mode plain-only unless JSON demand appears.
- Add or update Branch Stations for missing, empty, populated, unsafe, and
  destructive-preview dashboard states.
- Update dashboard tests so populated state prioritizes human commands before
  diagnostics.
- Keep `health` as the JSON/plain health contract.
- Keep `review` as the full evidence surface.
- Keep `correlate` and `purge` preview-first.

## Acceptance Checks

- No-arg with a populated inbox shows report-oriented commands before
  correlation repair.
- No-arg with missing or empty inbox shows get-started help, not a broken
  dashboard.
- No-arg with unsafe inbox exits nonzero and shows repair guidance.
- No-arg never mutates `.skill-feedback/`.
- No-arg does not print report filenames or private paths in the normal
  populated path.
- Help and discovery metadata cannot advertise commands that parser acceptance
  rejects.
- Public argv, rendered help, discovery metadata, and runtime semantics stay
  aligned through the existing facade proof path.
