# Browser Stack Resources

All repository links are relative to this file.

## Knowledge

- [Decision log: Browser Connect Connection Architecture](../../docs/decisions/2026-07-14-001-browser-connect-architecture-decision-log.md)
  THE architectural frame: environment × route × adapter, the Chrome 150 incident, no-fallback v1, repair paths. Use for: why the stack is shaped this way. **Primary source for lesson 0001.**
- [Glossary: runtime/browser-connect/CONTEXT.md](../../runtime/browser-connect/CONTEXT.md)
  Canonical vocabulary: Agent Chrome, Human Chrome, Browser Adapter, Verified Handoff Envelope, Repair Path. Use for: exact term meanings; the envelope/handoff mirror.
- [Glossary: runtime/warm-chrome/CONTEXT.md](../../runtime/warm-chrome/CONTEXT.md)
  Proof-side vocabulary: Proof chain, Station, Endpoint authority, exit 20, race policy. Use for: how "is this really our Chrome?" is proven.
- [Glossary: skills/browser-use/CONTEXT.md](../../skills/browser-use/CONTEXT.md)
  Consumer-side vocabulary: handoff-bound, Browser Entry Handoff, Bounded Browser Outcome, retired Router terms. Use for: what browser-use does and deliberately does not own.
- [Decision log: Browser-Use Migration Cleanup](../../docs/decisions/2026-07-16-001-browser-use-migration-cleanup-decision-log.md)
  Why the Router chain died and the envelope seam replaced it; the fakes-vs-real-shape lesson (Decision 4). Use for: history that explains present oddities (dormant R9 files, retained vocabulary).
- [Plan: Envelope-Derived Browser Transport](../../docs/plans/2026-07-17-001-refactor-envelope-derived-transport-plan.md)
  The pending change: derive adapter invocations from the envelope, drop mcporter static config. Use for: the live decision surface the mission targets.
- [MCP specification](https://modelcontextprotocol.io/specification)
  What mcporter and chrome-devtools-mcp actually speak (initialize / tools/call over stdio). Use for: why a protocol client sits between browser-use and the adapter.
- [Chrome DevTools Protocol docs](https://chromedevtools.github.io/devtools-protocol/)
  What "CDP endpoint on 9222" means underneath everything. Use for: endpoint/websocket mechanics only when needed.

## Wisdom (Communities)

- This stack is a private, single-operator codebase — no external community practices it. Wisdom here comes from **live smoke sessions** (running the stack against real Agent Chrome and reading the envelopes/stations it emits) and from **adjudicating review findings** on it. Treat each live smoke as the practice arena.
- [MCP GitHub discussions](https://github.com/modelcontextprotocol/specification/discussions)
  For MCP-protocol questions only (not stack-specific).

## Gaps

- No single narrative doc in-repo walks one command end to end across all four packages — the teaching workspace's reference map fills this until one exists.
