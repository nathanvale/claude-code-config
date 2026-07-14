# Browser Connect Agent Guide

`@side-quest/browser-connect` owns Browser Adapter attachment to Agent
Chrome: prove, inject, exec over the cli-command-facade runtime contract.
Environment proof comes from `@side-quest/warm-chrome` in-process.

This file routes maintainers. `README.md` explains the tool to humans.
`CONTEXT.md` owns package language.

## Always Read

Read `CONTEXT.md` first. It defines Agent Chrome, Human Chrome, Browser
Adapter, and Verified Handoff Envelope — the terms used across CLI output,
tests, and plans.

Front door:

```bash
bun run runtime/browser-connect/src/cli.ts
```

Use `bun --filter @side-quest/browser-connect ...` for package maintenance.

## Intent Gate

- **Operate or inspect browser-connect** -> `README.md`, then CLI help.
- **Explain package language** -> `CONTEXT.md`.
- **Change CLI contract, flags, help, outputs, or exit codes** ->
  `cli-author`, then verification below.
- **Change environment proof behavior** -> `runtime/warm-chrome` owns the
  proof; this package consumes it in-process. Do not fork proof logic here.
- **Choose next work** -> `TASKS.md`.
- **Close or reclassify task detail** -> update `TASKS.md` and
  `TASKS.archive.md` in the same pass.

## Status

Slice one complete: `check`, `connect`, `dashboard`, and `run` are
implemented and proven through the 19-station Branch Station catalog. Module
ownership is in `ARCHITECTURE.md`; closed unit detail is in
`TASKS.archive.md`. Slice two (Human Chrome / UI-consent) is the next work.

## Verification

```bash
bun install
bun run check:workspace-facade
bun run prove:workspace-portability
bun --filter @side-quest/browser-connect typecheck
```
