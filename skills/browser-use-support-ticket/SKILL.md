---
name: browser-use-support-ticket
description: "Browser Use toolchain runtime, routing, or unmet-request defects: file redacted, deduplicated GitHub support tickets."
disable-model-invocation: true
---

# Browser Use Support Ticket

File one public support ticket when the Browser Use toolchain has a terminal
runtime defect, its prose selects no usable route, or its prose-led workflow
does not satisfy the user's explicit request.

## Gate

- Classify `runtime-terminal`, `prose-routing`, or `prose-outcome` through the
  CLI input contract.
- Name the owning component through the CLI input contract. Coverage includes
  `browser-use`, `browser-connect`, `warm-chrome`, supported adapter CLIs,
  Browser Use Security, cross-component failures, and future related tools via
  `other-toolchain`.
- For runtime defects, follow the typed Browser Use continuation once. File
  only when the same defect repeats or the continuation cannot be invoked.
- For prose defects, compare the skill's selected route or delivered outcome
  against a sanitized summary of the user's explicit request. Never copy the
  raw prompt into the public issue.
- Do not file expected login walls, user cancellations, target-site failures,
  or an operator-owned continuation that remains available.
- Record one stable error code, failure locus, public-safe correlation ID,
  minimal reproduction, and implicated tool versions.
- Classify the external effect and same-input retry. When a write was
  dispatched or its state is unknown, require same-lane reconciliation before
  retry. Never retry a confirmed effect as safe.
- Capture every shell command used, in order, with outcome, error or exit code,
  and side-effect state. Use an empty list when routing failed before execution.
- Classify the evidence for publication. Public filing accepts only
  `public-safe`; personal, commercial-sensitive, or unknown data stops for
  de-identification. Security-sensitive evidence routes to GitHub private
  vulnerability reporting. Never paste raw logs.

## File

1. Run `bun run skills/browser-use-support-ticket/src/support-ticket.ts --help`.
2. Build the JSON input from the current run evidence.
3. Run `preview --input <path> --json`; inspect the human triage, ordered
   commands, privacy statement, and versioned agent record.
4. Obtain explicit user approval for the reviewed public GitHub write.
5. Run `file --input <path> --preview-digest <content_digest> --execute --json`
   without changing the reviewed input.
6. Return the created or deduplicated issue URL to the Browser Use driver.

## Owners

- Runtime: Bun.
- Contract, discovery, and help: `src/command-contract.ts`.
- Model, validation, rendering, dedupe, GitHub boundary, and CLI:
  `src/support-ticket.ts`.
- Contract tests: `src/support-ticket.test.ts`.
- Focused proof: `bun --filter browser-use-support-ticket-scripts test`.

The runtime owns validation, public-data gates, redaction, preview binding,
GitHub identity, repository, label, duplicate detection, issue format, and
failure continuations.

## Next Safe Action

Missing input or a refused gate: follow the CLI envelope's single continuation;
never improvise a public issue body.
