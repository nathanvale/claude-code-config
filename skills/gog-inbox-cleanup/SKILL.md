---
name: gog-inbox-cleanup
description: "Gmail cleanup audits: bounded read-only sender and category proposals through gog; no mailbox mutations."
---

# gog Inbox Cleanup

Audit Gmail metadata and return exact private label-only proposals plus
non-executable review decisions. This skill does not change Gmail or external
subscriptions.

## Run

1. Read the applicable `.productivity.yml`. Stop unless
   `connectors.email-account` and `connectors.email-client` each resolve to one
   scalar value.
2. Read the installed `gog` and `gog-gmail` skills for current command and auth
   semantics. Use no Google connector or app.
3. Inspect the runtime contract:

   ```bash
   bun run src/cli.ts --help
   ```

4. Run one bounded audit from this skill directory. Use the applicable config,
   a date- or age-bounded Gmail query, an explicit cap, and `--json` for agents.
5. Keep exact proposals and Gmail evidence private. Persist only the value-free
   `receipt` outside the vault with mode `0600` when a durable record is needed.
6. Return caps, sender-domain concentration, overlap, exclusions, uncertainty,
   review decisions, and one next safe action.

## Boundary

- The runtime permits only `gog gmail search` with read-only and no-send guards.
- Treat every proposal as review evidence. Obtain separate future authority
  before any label, filter, archive, unsubscribe, block, or other mailbox change.
- Stop on missing identity, an unbounded query, hidden truncation, protected or
  mixed mail, unexpected gog output, or any request for a mutation command.
- Keep `gog-inbox-triage` as the owner of daily actionable-mail triage.

## Verify

```bash
bun test src/*.test.ts
bun run typecheck
```

Next safe action: review the exact private proposals; make no Gmail change from
the audit or its receipt.
