---
name: skill-self-audit-loop
description: "Create, prepare, update, or resume a skill self-audit loop file for one target SKILL.md."
role: tool-workflow
---

# Skill Self-Audit Loop

Use when the user asks to create, prepare, update, or resume a self-audit loop file for one specific skill.

Do not use for ordinary one-shot skill review. Do not audit every skill. Do not repair skill source.

## Owner Paths

- Skill repair owner: `skills/skill-author/SKILL.md`.
- Skill design runbook: `skills/skill-author/references/skill-design-decision-runbook.md`.
- Storage owner: `skills/context-advisor/references/storage-routing.md`.
- CLI owner for future helpers: `skills/cli-author/SKILL.md`.
- Source requirements: `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`.
- Loop-proof methods: `skills/skill-self-audit-loop/references/loop-proof-methods.md` — how to prove a loop feature works before trusting it.

## Workflow

1. Work from the repo root that owns the target `SKILL.md`.
2. Read `skills/skill-author/references/skill-design-decision-runbook.md`.
3. If the target `SKILL.md` is missing, ask one question.
4. Read the target `SKILL.md`.
5. Read claim-relevant owner paths named by the target skill.
6. Record skipped owner paths and why.
7. Create or update `docs/skill-audits/<skill-directory-name>/self-audit-loop.md`.
8. Preserve Open Findings, Finding History, Unresolved Questions, Dedupe Warnings, Candidate Shapes, and Repair Candidates when updating an existing loop file.
9. Do not run `/goal` or `/loop`.
10. Report the loop file path and next safe action.

## Path Rule

- Derive `<skill-directory-name>` from the parent folder of the target `SKILL.md`.
- Store one stable file: `docs/skill-audits/<skill-directory-name>/self-audit-loop.md`.
- Create the audit directory when missing.
- If an existing loop file frontmatter names a different `target_skill`, stop and ask before overwriting.

## Loading Rule

- Start with claim-relevant owner paths only.
- Load direct owners for safety, storage, runtime, verification, and repair claims.
- Skip examples marked illustrative, inactive archives, generated outputs with source owners, and unrelated references.
- Before accepting any future finding that depends on a skipped path, the driver loads that path or keeps the item unresolved.

## Contradiction Rule

A skill contradiction is a supported hard conflict between two instruction sources where both cannot be followed.

This list is the single source of truth for the accepted shape set. Elsewhere say "the accepted shapes," not a count; promotion edits this list only.

Accept only these conflict shapes:

- `authority`: a lower-authority file acts like it owns another owner path's contract.
- `scope`: trigger, boundary, or target scope conflicts.
- `lifecycle`: loop state or finding state conflicts.
- `safety`: workflow allows an action blocked by a safety owner.

Reject style, taste, missing examples, and vague wording unless they create one of those conflicts.

### Out-Of-Shape Capture

- A real hard conflict (both sources cannot be followed) that fits no accepted shape is `out-of-shape`, not rejected.
- Record it under `Candidate Shapes`, not as a rejected style nit.
- Name a candidate shape label, the two sources, the impossible behavior, and a blast-radius note.
- Out-of-shape findings do not block convergence; they feed shape discovery.
- Known candidate shapes seeded from a mutation test: `cross-source` (skill vs a global rule or another skill, outside the one-target + owner-path scope) and `temporal-ordering` (a later step undoes what a still-later step needs).
- `cross-source` may stay out of scope by design; promotion can resolve to "keep out of scope."

### Shape Promotion

- Promote a candidate shape into the accepted set only when it recurs and earns it.
- Rank candidates by recurrence x blast-radius, not frequency alone.
- A promotion is a loop change: gate it with a fresh mutation test per `references/loop-proof-methods.md` (step-function fixture pair or mutation kill-rate) before adding the shape.

## Finding State

- `Open Findings` contains only active findings with `status: open`.
- `Finding History` contains non-active findings with `status: resolved`, `rejected`, `duplicate`, or `superseded`.
- `Candidate Shapes` contains `status: out-of-shape` findings: real conflicts that fit no accepted shape yet.
- Do not delete findings unless unsafe, private, or written in error.
- Duplicates link to an existing `signature`.
- Resolved findings include repair evidence or a resolution reason.

## Repair Handoff

- Repair Candidates are evidence handoffs, not tasks.
- Name the smallest likely owner path and repair shape.
- Point every candidate to `skills/skill-author/SKILL.md`.
- Do not authorize source edits.
- A later repair workflow rereads the target skill and owner paths before patching.

## Loop File Template

Use this shape for new files. Keep setup sections current when updating existing files.

````md
---
target_skill: <repo-relative path to target SKILL.md>
status: active
passes: 0
last_pass: null
convergence: not_started
---

# Skill Self-Audit Loop: <skill-name>

## Truth Stance

- This file is audit state.
- This file is not canonical skill instruction.
- Research explains loop shape only.
- Findings require local source evidence.
- Repair source through `skills/skill-author/SKILL.md`.
- Add a helper only after real loop files show ledger-shape drift, duplicate-signature confusion, false convergence claims, or privacy-redaction drift; use `skills/cli-author/SKILL.md` first.

## Driver Commands

Short path:

```text
/goal Read docs/skill-audits/<skill-directory-name>/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/<skill-directory-name>/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/<skill-directory-name>/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `<skill-name>`
- Target path: `<repo-relative path to target SKILL.md>`
- Audit file: `docs/skill-audits/<skill-directory-name>/self-audit-loop.md`

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.

## Loaded Owner Paths

- `skills/skill-author/references/skill-design-decision-runbook.md`
- `<target SKILL.md>`

## Skipped Owner Paths

- None yet.

## Pass Ledger

- No passes yet.

## Open Findings

- None yet.

## Finding History

- None yet.

## Unresolved Questions

- None yet.

## Dedupe Warnings

- None yet.

## Candidate Shapes

- None yet.

## Repair Candidates

- None yet.

## Stop Rule

- Converged: a fresh pass adds zero new accepted contradictions.
- Active: at least one open finding remains or the next pass is needed.
- Blocked: evidence is missing, authority is unclear, loop state is corrupt, privacy prevents recording evidence, or a human decision is required.
- Dedupe warnings do not block convergence by themselves.
- Maximum-pass limits are cost guards, not proof of convergence.

## Research Anchors

- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`

## Next Safe Action

- Run the copyable `/goal` command above.
````

## Updating Existing Files

- Refresh target, scope, owner paths, driver commands, stop rule, research anchors, and next safe action when stale.
- Preserve finding state unless the user asks to change it or a pass result updates it.
- Keep file status in frontmatter: `active`, `converged`, `blocked`, or `archived`.
- Keep finding status in body entries: `open`, `resolved`, `rejected`, `duplicate`, or `superseded`.

## Safety

- Never store secrets, raw transcripts, raw private payloads, cookies, tokens, or auth-bearing URLs.
- Redact unsafe evidence and record the redaction.
- Surface skipped checks and degraded evidence.
