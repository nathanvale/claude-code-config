# Skillport Planning Handoff

## Current Objective

Plan the Skillport MVP implementation from the completed requirements document.

The next session should run planning, not restart brainstorming. Treat the
requirements doc as the source artifact, and attach the architecture support
doc, seam report, source research, and prototype evidence.

## Completed Work

- Claimed npm package: `@side-quest/skill-port@0.0.0`.
- Chose product name: Skillport.
- Confirmed MVP scope: skills-only first.
- Confirmed provider stance: wrap the existing `skills` npm package first, but keep a clean provider seam for later replacement.
- Used Context7 research for `vercel-labs/skills`.
- Created ICA-style seam report.
- Built and ran a throwaway logic prototype for the five MVP seams.
- Applied GoF and non-GoF architecture pressure labels.
- Moved durable artifacts into this repo.

## Source Artifacts

- Requirements doc:
  `docs/brainstorms/2026-06-17-skillport-mvp-requirements.md`
- Architecture support:
  `docs/research/2026-06-17-skillport-mvp-architecture.md`
- Source and prototype evidence:
  `docs/research/2026-06-17-skillport-source-and-prototype-evidence.md`
- ICA seam report:
  `docs/research/2026-06-17-skillport-seam-report.html`

## MVP Seams

All five are required for V1:

1. Skills Provider
2. Operation Planner / Executor
3. Ownership Ledger
4. Target Projection
5. CLI Facade front door

Planning should keep these as implementation units or closely aligned units.

## Planning Constraints

- Do not reimplement the `skills` ecosystem.
- Do not fork every provider-owned target path rule.
- Do not rely on `AGENTS.md` prose as the enforcement layer.
- Do not make Skillport skill installation a prerequisite for V1.
- Do not expose raw destructive provider commands as the agent path.
- Keep mutations preview-first.
- Preserve unrelated skills by default.
- Keep agent output parseable, repairable, and observable.
- Use `@side-quest/cli-command-facade` style and proof expectations.

## Remaining Work

- Create a concrete implementation plan for `@side-quest/skill-port`.
- Decide repo/package location for real Skillport source.
- Define initial command surface.
- Define result contracts and station/branch proof surface.
- Define provider adapter contract.
- Define ownership ledger state and migration story from existing `skills-lock.json`.
- Define plan/apply lifecycle.
- Define target projection behavior for `codex`, `claude-code`, and provider-supported ids.
- Define smoke tests from prototype acceptance examples.

## Suggested Skills

- `compound-engineering:ce-plan` — primary next skill; plan implementation from the requirements doc.
- `create-cli` — required for facade-backed CLI contract and command surface proof.
- `improve-codebase-architecture` — use if implementation-unit seams become unclear.
- `gof-pressure-lens` — use only if pattern names drift during planning.
- `tdd` — use once planning turns into implementation.
- `fallow` — use after meaningful implementation or review-prep edits.

## Blockers

- No known technical blocker.
- Package location is not decided.
- The requirements doc now lives in this repo; plan from the CCC paths above.

## Next Safe Action

Run `ce-plan` using:

- `docs/brainstorms/2026-06-17-skillport-mvp-requirements.md`

Attach:

- `docs/research/2026-06-17-skillport-mvp-architecture.md`
- `docs/research/2026-06-17-skillport-source-and-prototype-evidence.md`
- `docs/research/2026-06-17-skillport-seam-report.html`
