# Agent-native credential CLI prototype

Throwaway Bun and TypeScript prototype.

Question: can one small agent-native CLI make the three production hardening
candidates legible and recoverable before the command-facade runtime is adopted?

The candidates are:

1. Credential Front Door deep module.
2. Reversible Browser Use authentication pause and adapter handoff.
3. Manifest-pinned official `op` runtime custody.

Run from the repository root:

```sh
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts --help
```

This prototype has no persistence and performs no `op`, browser, credential,
configuration, or network action. Every result declares `changed: false`.
It deliberately does not import `@side-quest/cli-command-facade`; production
hardening is the point at which that runtime becomes useful.
