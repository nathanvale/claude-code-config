---
title: "fix: Harden Fallow scope and mutation authority"
type: fix
status: active
date: 2026-06-09
sources:
  - docs/plans/2026-06-04-003-feat-fallow-agent-native-mvp-v1-plan.md
  - docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md
  - docs/plans/2026-06-05-003-feat-fallow-finding-resolver-actions-plan.md
---

# fix: Harden Fallow scope and mutation authority

## Summary

Tighten the Fallow skill and runner around two failure classes: wrong-scope audit
evidence and under-specified mutation authority. The repair keeps Fallow
agent-native, but makes scope, repair hints, config trust, plain output, and
documentation tests line up with the workflow agents are told to follow.

---

## Problem Frame

The recent Fallow heal added dirty-branch guidance, but the reviewer swarm found
that the guidance overclaims isolation and depends on signals hidden from the
recommended plain output. The same pass exposed a sharper safety issue:
`fix-apply` requires authorization, but the skill does not define what
authorization means.

The target state is not a larger Fallow handbook. The target is a smaller set of
runtime-backed, test-covered gates that make agents tell the truth about scope
and stop before source mutation unless the user explicitly approved the named
scope.

---

## Requirements

**Audit scope**

- R1. Treat `--base-ref HEAD` as an uncommitted-work scan, not proof that all findings belong to the current task.
- R2. Require agents to inspect changed paths before claiming current-task ownership on a dirty worktree.
- R3. Surface mixed-scope audit evidence as mixed or unowned unless task-owned paths are isolated.
- R4. Expose audit scope signals in the first recommended output path, or change the workflow to require JSON before scope triage.
- R5. Enforce Fallow audit new-only attribution through runner args or fail closed when attribution is absent.

**Mutation authority**

- R6. Define `fix-apply` authorization as explicit user approval to apply Fallow fixes to a named scope.
- R7. Require same-scope `fix-preview` evidence before `fix-apply`.
- R8. Surface config-scope evidence before mutation when config is present.
- R9. Block or ask before setup, install, dependency, config, package, or mutation repair hints.
- R10. Auto-follow only read-only repair hints with safe retry semantics.

**Analyzer-noise handling**

- R11. Treat non-audit `dead-code`, `health`, and `dupes` findings as unvalidated until repo-owned coverage or equivalent evidence intersects them.
- R12. Stop instead of promoting raw non-audit findings when coverage cannot map the finding.
- R13. Say zero introduced means zero introduced Fallow audit findings, not general safety.

**Skill and CLI DX**

- R14. Update Fallow frontmatter to route cleanup, refactor, fix-preview, and apply-safety request shapes.
- R15. Split first-screen route bullets so each bullet carries one decision.
- R16. Remove copied output literals from workflow prose when runtime owner paths can own exact fields.
- R17. Add root-help examples for common agent flows.
- R18. Preserve structured envelopes for unexpected runtime failures.
- R19. Lock the new docs and scope behavior with tests.

---

## Key Technical Decisions

- KTD1. **Runtime owns scope signals:** If a workflow tells agents to use `changed_files_count`, the runner must surface that signal in the recommended first output path or the docs must route to JSON first.
- KTD2. **Dirty-worktree truth over convenience:** `--base-ref HEAD` is useful, but it only scopes to all uncommitted changes. Current-task claims require changed-path ownership.
- KTD3. **Authorization is user wording, not analyzer state:** Preview output, auto-fixable counts, and repair hints never authorize mutation. Only an explicit user request for a named scope does.
- KTD4. **Config trust is pre-apply state:** Config presence and paths are scope evidence. Agents need that evidence before a write command runs.
- KTD5. **Docs teach policy, tests own drift:** `SKILL.md` and references route behavior. Exact flags, help, output shape, and parser behavior stay in contract/runtime/tests.

---

## Implementation Units

### U1. Patch skill policy and prose

- **Goal:** Make the Fallow skill docs state scope and mutation authority precisely.
- **Requirements:** R1-R3, R6-R13, R14-R16
- **Files:** `skills/fallow/SKILL.md`, `skills/fallow/references/commands.md`, `skills/fallow/references/workflows.md`, `skills/fallow/references/safety.md`
- **Approach:** Add a dirty-worktree preflight, define current-task authorization, add a repair-hint safety boundary, replace zero-introduced overclaims, and convert dense or narrative bullets into one-decision imperative guidance.
- **Test scenarios:**
  - `SKILL.md` frontmatter includes implementation, PR prep, cleanup/refactor, dead-code/dupes/health, fix-preview, and apply-safety triggers.
  - `SKILL.md` route index includes dirty-worktree path ownership before current-task claims.
  - Safety docs define explicit named-scope user authorization and same-scope preview before apply.
  - Workflow docs no longer copy exact output literals where runtime owners suffice.
  - Coverage-intersect docs say to use repo-owned coverage or stop with unvalidated findings.
- **Verification:** `bun --filter fallow-scripts test`; YAML parse for `skills/fallow/SKILL.md`; owner-path check for changed docs.

### U2. Make audit scope machine-visible and enforced

- **Goal:** Align audit runtime behavior with changed-code workflow claims.
- **Requirements:** R1-R5, R19
- **Files:** `skills/fallow/src/fallow-runner.ts`, `skills/fallow/src/command-contract.ts`, `skills/fallow/src/fallow-runner.test.ts`
- **Approach:** Pass or validate new-only audit attribution, expose changed-file count in plain output, and add a runner proof for `audit --root <repo> --base-ref HEAD --plain`.
- **Test scenarios:**
  - Audit invocation passes the new-only gate or blocks when attribution cannot prove introduced vs inherited.
  - Plain audit output includes changed-file count and base-ref scope when Fallow provides them.
  - JSON audit summary still includes changed-file count under runner-owned mode evidence.
  - `audit --root <repo> --base-ref HEAD --plain` runs from the target root and maps to the expected Fallow base argument.
  - Broad changed-file counts are visible without retrying in JSON.
- **Verification:** `bun --filter fallow-scripts test`; focused tests around audit args, plain rendering, and JSON summary evidence.

### U3. Harden apply and repair-hint execution

- **Goal:** Prevent agents from mutating source or changing setup based on ambiguous Fallow evidence.
- **Requirements:** R6-R10, R18, R19
- **Files:** `skills/fallow/src/fallow-runner.ts`, `skills/fallow/src/command-contract.ts`, `skills/fallow/src/fallow-runner.test.ts`, `skills/fallow/references/safety.md`
- **Approach:** Surface config scope during preview, add runtime state needed to prove same-scope preview before apply or document the blocked state, add a safe-action allowlist for repair hints, and wrap unexpected runtime failures into the structured envelope path.
- **Test scenarios:**
  - `fix-preview` with config present reports config presence and paths before any apply path can run.
  - `fix-apply` without explicit named-scope authorization remains blocked.
  - `fix-apply` without same-scope preview evidence remains blocked or documented as unsupported until state exists.
  - Setup/install/config-changing repair hints are not auto-followed by skill guidance.
  - Unexpected runtime exceptions emit a structured failure envelope with run correlation instead of a raw stack trace.
  - Plain blocked output includes enough repair hint text to act without retrying JSON for common input failures.
- **Verification:** `bun --filter fallow-scripts test`; focused plain blocked-output tests; runtime exception test.

### U4. Improve CLI discoverability and documentation proof

- **Goal:** Make the Fallow runner easier to discover from terminal help and keep doc guidance under test.
- **Requirements:** R14-R19
- **Files:** `skills/fallow/src/command-contract.ts`, `skills/fallow/src/fallow-runner.test.ts`, `skills/fallow/SKILL.md`, `skills/fallow/references/commands.md`, `skills/fallow/references/workflows.md`
- **Approach:** Add compact root-help examples for common flows, extend doc tests to lock dirty-branch guidance, and update tests when the frontmatter description changes.
- **Test scenarios:**
  - Root help shows examples for `audit --plain`, `audit --base-ref HEAD --plain`, and `doctor --plain`.
  - Doc tests assert dirty-worktree path ownership, `--base-ref HEAD`, whole-branch review distinction, and changed-file scope guidance.
  - Frontmatter parse test expects the broadened trigger phrase set.
  - Help/parser/discovery alignment still rejects unsupported flags and accepts public audit flags.
- **Verification:** `bun --filter fallow-scripts test`; `bun --filter fallow-scripts typecheck` if TypeScript changes.

---

## Acceptance Examples

- AE1. Given a dirty worktree with unrelated changed paths, when an agent runs current-task Fallow audit, then the report names mixed scope instead of claiming all introduced findings belong to the task.
- AE2. Given audit output with `changed_files_count`, when the agent follows the recommended plain path, then the count is visible without a JSON retry.
- AE3. Given Fallow audit output without new-only attribution, when the runner evaluates the result, then it blocks or marks attribution unavailable instead of telling the agent to triage introduced findings.
- AE4. Given a user asks “can Fallow fix this?”, when `fix-preview` shows auto-fixable findings, then the agent does not run `fix-apply` without explicit named-scope approval.
- AE5. Given config files are present, when an agent previews fixes, then config-scope evidence is visible before any apply command.
- AE6. Given a non-audit `dead-code` finding on a contract export, when coverage cannot map the finding, then the agent reports an unvalidated Fallow signal rather than recommending deletion.

---

## Scope Boundaries

In scope:

- Fallow skill docs.
- Fallow runner audit, plain output, repair hints, config-scope, and exception handling.
- Fallow runner tests and doc tests.
- Help examples for common agent flows.

Out of scope:

- Fallow installation or dependency management.
- Broader CI adoption.
- Baseline/regression mode for non-audit commands.
- New persisted preview state if same-scope preview proof would require a larger design.
- Rewriting Fallow thresholds or analyzer semantics.
- Changes outside `skills/fallow/` except this plan.

---

## Risks & Dependencies

- **Fallow CLI support:** If the installed Fallow version does not accept an explicit new-only gate, the runner should validate attribution presence instead of passing an unsupported flag.
- **Preview lineage:** Same-scope preview proof may need persisted state. If that exceeds the repair scope, document `fix-apply` as blocked without explicit recent preview evidence.
- **Plain output size:** Adding scope and repair hints to plain output must stay compact enough for agent context.
- **Existing frontmatter validator mismatch:** `quick_validate.py` rejects the existing `role` key. Use repo-owned Fallow tests and YAML parse unless the validator policy changes.

---

## Documentation / Operational Notes

- Keep exact output fields, parser behavior, and command flags in `skills/fallow/src/command-contract.ts`, `skills/fallow/src/fallow-runner.ts`, rendered help, and tests.
- Keep `SKILL.md` as route clarity only.
- Treat `skills/create-skill/references/skill-design-decision-runbook.md` as the owner for gotcha and self-healing rules.
