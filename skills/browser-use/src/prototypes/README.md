# Browser Use prototypes

Throwaway spikes that falsify a plan's risky browser mechanics **before**
implementation. Home of the `browser-use-prototyper` workflow
(`skills/browser-use-prototyper/SKILL.md`).

## Rules

- **Throwaway.** Each spike answers one design question, then is captured to a
  branch — not kept on `main`. Only the validated decision graduates into the
  plan.
- **Secret-free.** Dummy values only. Real credentials are operator-gated; auth
  goes through `browser-use auth` where possible; `op` reads flow through the
  custody child, never the agent context.
- **Real harness only.** Attach via `browser-connect connect <adapter> --json`;
  drive through the `browser-use` CLI or a flat-session CDP client against the
  verified endpoint. Never the real default Chrome (Agent Chrome only, DDA-F26).
- **Served, not `file://`.** Fixtures are served over `http://localhost` so the
  harness target-discovery (http(s)-only) can see them.
- **Lane-neutral.** A mechanic that must be adapter-independent is proven on
  agent-browser, playwright-cdp, and chrome-devtools-mcp — same result.

## Naming

`YYYY-MM-DD-<question-slug>/` per spike; a `findings.md` receipt per spike is
the single source `ce-plan` folds in.
