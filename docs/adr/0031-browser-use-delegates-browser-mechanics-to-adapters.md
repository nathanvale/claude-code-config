---
status: accepted
date: 2026-08-01
---

# Browser Use delegates browser mechanics to adapters

Browser Use owns intent, routing policy, authority, connection admission, and
the bounded run outcome. It does not implement or translate browser mechanics.

After `browser-connect connect <adapter> --json` returns a Verified Handoff
Envelope, the LLM discovers and invokes the selected adapter's native tool
surface. The selected adapter owns target discovery, tab and session
continuity, navigation, click and fill actions, snapshots, screenshots,
evaluation, debug output, and adapter-specific recovery.

`browser-connect` owns verified attachment and endpoint injection only. It does
not grow a universal browser action interface.

Browser Use must not encode adapter command names, argv, output schemas,
response parsers, selector or ref formats, page IDs, tab indexes, session
mechanics, action postconditions, or adapter retry behavior. A new adapter may
require browser-connect registration and evidence, but it must not require a
Browser Use action implementation.

The shared outcome boundary stays small: requested intent, authority and origin
bounds, selected adapter identity, run state, and artifact references. It does
not normalize the adapter's action vocabulary.

## Considered Options

- Keep the Browser Facade and one native executor per adapter: gives callers a
  fixed action vocabulary, but duplicates mechanics and makes each new adapter
  fan out through Browser Use.
- Move the facade into browser-connect: changes the owner but preserves the
  duplicated universal interface.
- Let the LLM drive native adapter tools after verified attachment: keeps
  policy stable while adapter capabilities evolve independently.

## Consequences

- Retire the Browser Facade and per-lane GoF Adapter mapping as target
  architecture.
- Keep existing executors only as migration debt until their callers use
  adapter-native delegation.
- Treat adapter-native help and schemas as the action contract.
- Permit adapter-specific acceptance probes only as disposable falsification
  evidence. Never promote their command mappings into Browser Use runtime or
  workflow policy.
- Preserve Browser Use security boundaries. Adapter-native driving receives
  bounded authority and a verified endpoint, never secret-source details.
- Record screenshots and findings as artifacts without teaching Browser Use
  how the adapter produced them.

## Evidence

- The 2026-08-01 dashboard screenshot spike exercised `agent-browser`,
  `playwright-cdp`, and `chrome-devtools-mcp` against one verified Warm Chrome.
- All three produced a dashboard screenshot and refused a missing dashboard
  marker and an off-origin redirect.
- Chrome DevTools MCP required one native MCP session for page continuity. That
  continuity is adapter behavior, not a Browser Use transport rule.
- Deleting Browser Use's per-adapter mappings leaves intent, authority,
  verified attachment, and outcome coherent. It removes only duplicated
  mechanics already owned by the adapters.

## Supersedes

- `skills/browser-use/docs/decisions/2026-06-13-001-gof-pattern-naming-decision-log.md`,
  Decision 1 and Decision 3.
- `docs/decisions/2026-07-17-002-envelope-derived-transport-decision-log.md`,
  Decisions 1 through 3.

