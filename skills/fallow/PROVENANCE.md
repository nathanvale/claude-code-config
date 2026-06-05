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
- Skill Route Index plan: `docs/plans/2026-06-04-004-feat-fallow-progressive-disclosure-index-plan.md`.
- Finding resolver actions plan: `docs/plans/2026-06-05-003-feat-fallow-finding-resolver-actions-plan.md`.
- Finding resolver requirements: `docs/brainstorms/2026-06-05-fallow-finding-resolver-actions-requirements.md`.
- Trace adapter lineage: lifted from the retired `prototype-why-symbol` spike.
- Trace adapter keeper: behavior now lives in `skills/fallow/scripts/why-trace.ts` and runner tests.
- Trace adapter proof scope: spike proved the `trace_export` mcporter shape and reachability evidence.
- Trace adapter decision trail: decisions 27-40 in the log record why.
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
- Keep deterministic runner contract in code, help, generated output, and tests.
- Keep workflow prose in `SKILL.md` and one-level references.
- Keep CI adoption reference-only in v1.
- Keep apply as an explicit mutation boundary.
- Treat the Skill Route Index as a judgment aid, not a deterministic route classifier.
- Treat the Skill Route Index pattern as experimental until Fallow usage proves it should generalize.
- Challenge or retarget suspect Fallow targets before running readiness checks.
- Start routine PR self-review with `audit --plain`; reserve `doctor` for unknown readiness or blocked evidence.
- Report current-task findings first; keep pre-existing findings as separate count or status context unless Fallow owns baseline semantics.
- Start cleanup with one request-shaped evidence lane; use health first for bare cleanup asks.
- Keep reference examples request-shaped; point to routes and owners instead of full command syntax.
- Require bare `fix-apply` to fail closed through a runner-owned authorization marker.
- Accept `--plain` as a subcommand-local output flag in this pass, not a global flag.
- Prove `--plain` with one tiny golden shape fixture and semantic parity checks elsewhere.

## Local Owners

- Skill router: `skills/fallow/SKILL.md`.
- Provenance: `skills/fallow/PROVENANCE.md`.
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
