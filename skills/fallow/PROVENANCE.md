# Provenance: fallow

## Source

- Official docs index: `https://docs.fallow.tools/llms.txt`.
- Official Agent Skills docs: `https://docs.fallow.tools/integrations/agent-skills`.
- Official CI docs: `https://docs.fallow.tools/integrations/ci`.
- Official repository: `https://github.com/fallow-rs/fallow`.
- Official skill repository: `https://github.com/fallow-rs/fallow-skills`.
- GitHub Action: `https://github.com/marketplace/actions/fallow-codebase-intelligence`.
- Tool site: `https://fallow.tools`.

## Local Sources

- Decision log: `docs/decisions/2026-06-04-fallow-agent-native-decision-log.md`.
- Tool research: `docs/research/2026-06-04-fallow-ai-code-quality-tool.md`.
- Agent-lens research: `docs/research/2026-06-04-fallow-agent-lens.md`.
- Implementation plan: `docs/plans/2026-06-04-003-feat-fallow-agent-native-mvp-v1-plan.md`.
- Skill design rule: `context/skill-design-philosophy.md`.
- CLI design rule: `skills/create-cli/SKILL.md`.
- Facade-backed path: `skills/create-cli/references/cli-command-facade.md`.

## Local Status

- Status: adapted.
- Owner: `skills/fallow`.
- Boundary: Runner Facade.
- Primary user: agent.
- Runtime source of truth: Fallow CLI output.
- Local contract source: `skills/fallow/scripts/command-contract.ts`.
- Local runner source: `skills/fallow/scripts/fallow-runner.ts`.

## Local Adaptation

- Keep the official Fallow skill as source material.
- Keep this repo skill as a thin self-review router.
- Keep exact Fallow syntax in official docs, live CLI help, runner code, and tests.
- Keep exact runner flags, result vocab, repair action ids, and output semantics in contract code, help, generated output, and tests.
- Keep CI adoption reference-only in v1.
- Keep apply as an explicit mutation boundary.

## Local Owners

- Skill router: `skills/fallow/SKILL.md`.
- Provenance: `skills/fallow/PROVENANCE.md`.
- CLI design brief: `skills/fallow/references/cli-design-brief.md`.
- Command recipes: `skills/fallow/references/commands.md`.
- Workflow recipes: `skills/fallow/references/workflows.md`.
- Safety reference: `skills/fallow/references/safety.md`.
- CI reference: `skills/fallow/references/ci.md`.
- Script package: `skills/fallow/scripts/package.json`.
- TypeScript config: `skills/fallow/scripts/tsconfig.json`.
- Contract owner: `skills/fallow/scripts/command-contract.ts`.
- Model, engine, discovery, and CLI owner: `skills/fallow/scripts/fallow-runner.ts`.
- Test owner: `skills/fallow/scripts/fallow-runner.test.ts`.
- Live smoke test owner: `skills/fallow/scripts/fallow-runner.live.test.ts`.

## Open Work

- Prove current Fallow CLI compatibility with live smoke when Fallow is available.
- Revisit workflow-facade behavior after the Runner Facade is boring.
