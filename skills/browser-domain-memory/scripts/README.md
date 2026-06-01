# browser-domain-memory scripts

Script-local package for the browser-domain-memory prerequisite gate.

This is **not** the browser-domain-memory CLI. It is the readiness preflight a
later agent runs before starting active-plan runtime work (U1/U1a/U2+). It
proves prototype evidence, root replay dependencies, and the script-local
facade package are available, then exits.

## Run

```
./browser-domain-memory-prerequisites.sh          # plain output
./browser-domain-memory-prerequisites.sh --json    # machine-readable result
```

Exit codes: `0` ready, `1` a prerequisite is missing (the result names which
one and the repair action), `2` usage error.

## What it checks

- **Prototype evidence** — the lift sources named by the active plan. The
  inventory is `prerequisites.ts`; prose does not duplicate it.
- **Root replay dependencies** — `@puppeteer/replay` and `puppeteer-core`,
  resolved from the repo root where deterministic replay code will load them.
- **Facade package** — `@side-quest/cli-command-facade`, resolved from this
  script-local surface (a private machine-local link, not the public registry).

## Scope

Readiness only. No capture, replay, config, storage, auth, or promotion
commands. Those land in later active-plan units.
