---
name: router-cli-smoke
description: "Run Browser Adapter Router CLI smoke suites and save keyed JSON response artifacts. Use when validating Router CLI behavior, rerunning core route/report/status checks, or auditing observability, repair, recovery, continuation, runtime action, and route-validity hints."
---

# Router CLI Smoke

## Owner

- CLI, parser, suite catalogue, artifact shape, redaction, and assertions: `skills/router-cli-smoke/scripts/router_cli_smoke.mjs`.
- Router runtime under test: `skills/browser-use/scripts/browser-adapter-router.ts`.
- Router contract owners: `skills/browser-use/scripts/command-contract.ts` and `skills/browser-use/scripts/browser-adapter-router*.ts`.

## Run

- Use the bundled script.
- Run from the repo root.
- Default to both suites.
- Save artifacts outside the repo.
- Inspect exact options with `node skills/router-cli-smoke/scripts/router_cli_smoke.mjs --help`.

```bash
node skills/router-cli-smoke/scripts/router_cli_smoke.mjs --suite all --out-dir /tmp/claude-501 --timestamp
```

## Suites

- Run `all` unless narrowing a failed case family.
- Use `core` for command, report, route, status, fail-closed, input-source, and run-id coverage.
- Use `hints` for observability, repair, recovery, continuation, redaction, and route-validity coverage.

## Rules

- Treat artifacts as evidence, not source of truth.
- Preserve existing artifacts unless explicitly asked to overwrite them.
- Do not edit Router implementation while running this skill.
- If a validator fails, inspect source truth before changing expectations.

## Artifacts

- Read artifact names, metadata, keyed response shape, redaction behavior, and assertion fields from `skills/router-cli-smoke/scripts/router_cli_smoke.mjs`.
- Do not copy artifact schemas, router output envelopes, or exact assertion catalogues into this file.
