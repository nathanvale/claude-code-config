# Agent Skills Source Docs

Local home for brainstorms, ideation artifacts, and plans that shaped
`agent-skills`.

These files moved from root `docs/` into the runtime package so agent-skills
owns its source history beside the implementation.

## Scope

Included:

- primary agent-skills brainstorms,
- primary agent-skills ideation,
- primary agent-skills plans, including the npx-skills division-of-labor plan
  because `runtime/agent-skills/src/skills-lock.ts` implements it.

Not copied:

- decisions, ADRs, research, and reviews,
- Skillporter ADRs that agent-skills only consumes as lock-boundary rules,
- broader repo-workability docs that mention agent-skills as one signal.

Those adjacent docs are linked below.

## Brainstorms

| File | Current path | Role |
| --- | --- | --- |
| [2026-05-30-agent-skills-repo-no-plugins-pivot.md](./brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md) | `runtime/agent-skills/docs/brainstorms/2026-05-30-agent-skills-repo-no-plugins-pivot.md` | Pivot away from plugin marketplaces toward repo-owned skills and `.agents/skills/` projection. |
| [2026-06-16-agent-skills-local-projection-requirements.md](./brainstorms/2026-06-16-agent-skills-local-projection-requirements.md) | `runtime/agent-skills/docs/brainstorms/2026-06-16-agent-skills-local-projection-requirements.md` | v1 requirements: catalog, projection roots, fail-closed sync, blockers, ignore rules. |

## Ideation

| File | Current path | Role |
| --- | --- | --- |
| [2026-06-16-agent-skills-adhd-inventory-ideation.html](./ideation/2026-06-16-agent-skills-adhd-inventory-ideation.html) | `runtime/agent-skills/docs/ideation/2026-06-16-agent-skills-adhd-inventory-ideation.html` | Calm-inventory idea ranking behind the v1 requirements. |

## Plans

| File | Current path | Role |
| --- | --- | --- |
| [2026-06-16-001-feat-agent-skills-local-projection-plan.md](./plans/2026-06-16-001-feat-agent-skills-local-projection-plan.md) | `runtime/agent-skills/docs/plans/2026-06-16-001-feat-agent-skills-local-projection-plan.md` | v1 implementation plan: package, CLI facade, projection writer, snapshot. |
| [2026-07-02-002-feat-npx-skills-division-of-labor-plan.md](./plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md) | `runtime/agent-skills/docs/plans/2026-07-02-002-feat-npx-skills-division-of-labor-plan.md` | External-class recognition from `skills-lock.json`, imports retirement, publisher check. |

## Adjacent Root Docs

These stay in root docs because they are not brainstorm, ideation, or plan
artifacts:

- `docs/decisions/2026-07-02-npx-skills-division-of-labor.md`
- `docs/adr/0015-skillporter-naming-and-location.md`
- `docs/adr/0016-ownership-ledger-grain-and-lock-boundary.md`
- `docs/adr/0017-plan-apply-lifecycle-and-plan-storage.md`
- `docs/adr/0018-result-vocabulary-two-layers.md`
- `docs/git/worktree.md`

## Placement Rule

New agent-skills brainstorms, ideation artifacts, and plans belong under this
folder, not root `docs/brainstorms`, `docs/ideation`, or `docs/plans`.
