---
name: router-cli-smoke
description: "Run Browser Adapter Router CLI smoke suites and save keyed JSON response artifacts. Use when validating Router CLI behavior, rerunning core route/report/status checks, or auditing observability, repair, recovery, continuation, runtime action, and route-validity hints."
---

# Router CLI Smoke

## Run

- Use the bundled script.
- Run from the repo root.
- Default to both suites.
- Save artifacts outside the repo.

```bash
node skills/router-cli-smoke/scripts/router_cli_smoke.mjs --suite all --out-dir /tmp/claude-501 --timestamp
```

## Suites

- `core`: 100 command, report, route, status, fail-closed, input-source, and run-id cases.
- `hints`: 100 observability, repair, recovery, diagnostic-trail, runtime action, continuation, redaction, plain-output, and route-validity cases.
- `all`: run both suites and save two artifacts.

## Options

- `--suite core|hints|all`
- `--out-dir <dir>`
- `--script <path>`
- `--timestamp`
- `--no-timestamp`

## Rules

- Treat artifacts as evidence, not source of truth.
- Record branch, HEAD, git status, and top-level `temp_fixture_dir`.
- Preserve existing artifacts unless explicitly asked to overwrite them.
- Do not edit Router implementation while running this skill.
- If a validator fails, inspect source truth before changing expectations.

## Artifacts

- Core artifact base name: `router-cli-smoke-responses-100`.
- Hints artifact base name: `router-cli-hints-observability-recovery-100`.
- Each artifact stores top-level metadata: `generated_at`, `cwd`, `branch`, `head`, `git_status`, `script`, `temp_fixture_dir`, `suite`, `suite_focus`, and `summary`.
- Each artifact stores keyed `responses`.
- Each response stores command, expected exit, actual exit, stdout, stderr, parsed JSON stdout, assertions, and pass/fail state.
