# Agent-Native CLI Best Practices Research, 2026-06

Purpose: root-repo research provenance for 2026-06 `cli-author` rubric updates.

Not skill reference material.

## Scope

- Window: 2026-03-04 to 2026-06-02.
- Method: WOTS-first scan, then web verification for stronger claims.
- CLI first.
- MCP saved for separate pass.
- WOTS CLI artifact: `/tmp/wots-agent-native-cli-only-1780361111/report.md`.
- WOTS MCP artifact: `/tmp/wots-agent-native-mcp-1780361175/report.md`.

## Bottom Line

- Community moved toward the same shape: structured output is table stakes.
- The frontier is recovery, diagnostics, token budget, and safe next action.
- CLI and MCP are complementary.
- MCP transport does not own CLI recovery policy.

## Verified Signals

- [LangSmith CLI and Skills](https://www.langchain.com/blog/langsmith-cli-skills)
  shipped 2026-03-04 for coding-agent trace, dataset, and experiment work.
- [LangSmith CLI repo](https://github.com/langchain-ai/langsmith-cli) provides
  terminal-first agent-engineering workflows.
- [Nx AX redesign](https://nx.dev/blog/making-nx-agent-ready) describes
  agent-oriented CLI output: structured JSON events, required input, errors,
  completion, suggested next steps, idempotency, and context-aware help.
- [Nx AI skills](https://nx.dev/blog/nx-ai-agent-skills) reinforces skills plus
  CLI affordances as agent guidance surface.
- [MCP draft tools spec](https://modelcontextprotocol.io/specification/draft/server/tools)
  includes `structuredContent`, `outputSchema`, and structured error results,
  but still leaves tool-specific recovery design to builders.
- [CLIs.dev](https://clis.dev/) is a directory signal: agent-oriented CLI design
  has become an explicit category.

## Community-Only Signals

- `exec-json`: wrapper idea for turning noisy command output into structured
  JSON for agents.
- CLI plus MCP code-summary tools: reduce raw-source token load.
- Self-healing demos: split diagnosis from execution.
- "CLI tools are back" posts: agents need deterministic tool surfaces more
  than clickable GUIs.
- Shell-output compression tools: context budget is now a CLI UX problem.

Treat these as pressure signals, not authority.

## Design Layer Impact

- Strengthen structured output beyond "has JSON".
- Add repair options with evidence, constraints, side effects, and next action.
- Prefer diagnostic pointers over full log dumps.
- Add `status` and `doctor` as recovery primitives.
- Add token-budget controls: summaries, fields, limits, pagination.
- Keep redaction boundary explicit.
- Keep CLI/MCP boundary explicit.

## Source Docs Distilled

- `side-quest-marketplace`: `docs/research/2026-03-07-agent-native-cli-best-practices.md`.
- `bun-typescript-starter`: `docs/brainstorms/2026-02-27-cli-starter-brainstorm.md`.
- `bun-typescript-starter`: `docs/plans/2026-02-27-feat-cli-starter-branch-plan.md`.
- `side-quest-marketplace`: `docs/plans/2026-02-27-feat-cortex-stage-0-dogfood-mvp-plan.md`.
- `mac-mini-home-server`: `docs/plans/2026-05-07-003-feat-gog-mcp-v2b-observability-diagnostics-plan.md`.
- `side-quest-xero-cli`: `docs/plans/2026-02-26-feat-xero-cli-agent-native-plan.md`.
- `compound-engineering/ce-agent-native-architecture`: `references/mcp-tool-design.md`.
- `compound-engineering/ce-agent-native-architecture`: `references/agent-native-testing.md`.
- `compound-engineering/ce-agent-native-architecture`: `references/checklists.md`.
- `compound-engineering/ce-agent-native-architecture`: `references/product-implications.md`.
- `everything-claude-code`: `skills/agent-harness-construction/skill.md`.
- `mac-mini-home-server`: `docs/runbooks/vision-quality-corpus-runbook.md`.
- `my-agent-dojo`: `.claude/references/proposed-patterns/pattern-agent-hint-observability.md`.
