# Agent-native credential CLI prototype findings

## Question

Can one small Bun and TypeScript CLI make the three production hardening
candidates discoverable, parseable, recoverable, and safe before the
command-facade runtime is adopted?

## Verdict

**PASS for contract shape.** The prototype demonstrates:

- one Credential Front Door discovery and status interface;
- preview-first Browser Login with a deterministic approval handle;
- fail-closed recovery when the handle does not match the exact origin and
  capability;
- a simulated paused Browser Use authentication mode and explicit adapter
  handoff;
- complete pinned-runtime verification across version, digest, signature, and
  architecture;
- equivalent human and JSON result vocabulary;
- stdout result and stderr diagnostic separation;
- stable exit codes and run correlation; and
- rejection of secret-shaped CLI flags.

The TypeScript imports no command-facade runtime.

## Proof

Run from the repository root:

```text
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts --help
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts candidates --json
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts status --json
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts login plan --origin https://example.test --capability example.login --json
bun run skills/one-password/src/prototypes/2026-08-17-agent-native-credential-cli/cli.ts runtime verify --pinned 2.39.0 --observed 2.39.0 --digest-match --signature-match --architecture-match --json
```

The bounded proof also executed the plan's exact run ID, rejected a mismatched
approval with exit 20 and a repair continuation, blocked a runtime version
mismatch with exit 20, rejected a secret-shaped flag with exit 2, parsed every
JSON result, and confirmed zero command-facade imports.

Biome passed for the prototype TypeScript. A strict TypeScript 6 check passed
with explicit Bun types. `git diff --check` passed for the prototype path.

## Limits

- No real credential was retrieved.
- No `op` process ran and no runtime artifact was downloaded or admitted.
- Browser Use source and state were untouched.
- No Warm Chrome target was opened or authenticated.
- The paused auth mode and Browser Login adapter are simulated result facts,
  not integrated product behavior.
- No persistence, process-boundary contract tests, Branch Station catalog, or
  facade validation exists.

## Productionization gate

Keep the command vocabulary provisional until the foreground grill accepts it.
Production must adopt the command-facade runtime, package-owned contracts,
process-level tests, Branch Stations, real runtime custody, and the reversible
Browser Use pause adapter. The first live proof requires explicit approval for
one low-risk target and credential transaction.
