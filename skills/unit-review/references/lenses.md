# Deriving a per-unit review lens

A lens is "what to scrutinise in THIS unit and why" — not a generic checklist. Generate it; don't wait for a human to hand-write one (that's what made the original workflow non-scaling).

## Inputs per unit
- Plan unit: Goal, Files, Approach, Execution note, Patterns, Test scenarios, Verification.
- Plan-wide: Key Technical Decisions (KTDs), Convergence Log (CL-xx), Risks.
- The commit diff for the unit.

## How to derive
1. **Risk surface** → from Files + Approach. Picks the persona (SKILL.md table).
2. **Named hazards** → any KTD/CL/Risk row that cites this unit becomes a lens bullet ("verify X holds"). These are the bugs the planner already feared.
3. **Edge cases** → from the diff: boundaries, null/empty, concurrency, failure paths the happy-path code skips.
4. **Test adequacy** → do the unit's tests cover the categories that apply (happy/edge/error/integration), or just the easy ones?
5. **Do-not-flag** → confirmed decisions + accepted risks for this unit, so the reviewer doesn't report them as bugs.

## Worked example (a commit/mutation unit)
Risk surface: external mutation → adversarial persona.
Named hazards (from CL rows): non-transactional commit accepted → do-not-flag the design, DO flag any way its hazard goes silent; guard-before-write ordering required → verify no write before the guard.
Edge cases (from diff): multiple matches for a key; partial batch failure; empty-batch skip; off-by-one in chunking.
Test adequacy: is there a test for the failure path, or only the happy commit?

## Anti-patterns
- A lens that just says "review for bugs" — useless; that's a generic pass.
- Re-listing the do-not-flag items as things to check — wastes the reviewer.
- Inventing hazards the plan never raised — stay grounded in plan + diff.
