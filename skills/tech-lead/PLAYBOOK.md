# Playbook — What To Do Next

Decision trees by pipeline stage. Used by tech-lead to give stage-aware advice.

---

## Pipeline Map

Visual pipeline for status output. Show with current position marked.

```
kickoff → plan → implement → test → qa → PR → review → approve → merge
```

### Progress Bar

Generate a progress bar based on stage index (0-9):

```
Stage 0: [█░░░░░░░░] kickoff
Stage 1: [██░░░░░░░] planned
Stage 2: [███░░░░░░] implementing
Stage 3: [████░░░░░] testing
Stage 4: [█████░░░░] qa_verified
Stage 5: [██████░░░] pr_created
Stage 6: [███████░░] in_review
Stage 7: [███████░░] changes_requested
Stage 8: [████████░] approved
Stage 9: [█████████] merged
```

### Quick Command Reference

Include this in status output — shows exactly what command to run at each stage:

```
Pipeline:  kickoff → plan → implement → test → qa → PR → review → approve → merge
Command:   /plan     /git   /qa-test    (fix)  /git    /review   (wait)   /git
                     commit              ↻     pr-create workflow          pr-merge
```

### Next Action Table (used by /next mode)

| Stage | Command | What it does |
|-------|---------|-------------|
| kickoff | `/plan` | Create technical plan |
| planned | `/git commit` | Start coding, first commit advances |
| implementing | `/qa-test <KEY>` | Verify acceptance criteria |
| testing | `/qa-test <KEY> --retest` | Re-verify after fixes |
| qa_verified | `/git pr-create` | Open pull request |
| pr_created | `/review-workflow` | Self-review, then team review |
| in_review | (wait for review) | Address comments if any |
| changes_requested | `/git commit` + re-request | Fix review feedback |
| approved | `/git pr-merge` | Merge and ship |
| merged | `/kickoff <NEXT-KEY>` | Pick up next ticket |

---

## By Stage

### kickoff (0)
**You're here:** Ticket was just picked up, context is being gathered.
**Next:** Run `/plan` to create a technical plan.
**If stuck:** Check gathered context with `/tech-lead what was gathered?`

### planned (1)
**You're here:** Plan is written and approved.
**Next:** Create a worktree for isolated development: `/git:worktree feat/<KEY>-short-description`. Then start coding — your first `/git commit` will advance the stage.
**If stuck:** Re-read the plan at `~/.claude/plans/<KEY>-plan.md`.

### implementing (2)
**You're here:** Actively coding.
**Next:** Keep coding. When feature-complete, run `/qa-test <KEY>` to verify acceptance criteria.
**If stuck:** Run `/tech-lead what should I do next?` or `/learn <topic>` to explore the codebase.

### testing (3)
**You're here:** QA verification in progress.
**Next:** Fix any failing ACs, then re-run `/qa-test <KEY> --retest`.
**If stuck:** Check QA results at `~/.claude/state/qa-test/<KEY>/results.json`.

### qa_verified (4)
**You're here:** All acceptance criteria pass.
**Next:** Create a PR with `/git pr-create`.
**If stuck:** Make sure all tests pass (`yarn test`) and linting is clean (`yarn lint`).

### pr_created (5)
**You're here:** PR is on GitHub, waiting for review.
**Next:** Self-review first with `/review-workflow`. Then request team review.
**If stuck:** Check PR status with `/git pr-checks`.

### in_review (6)
**You're here:** PR is being reviewed by the team.
**Next:** Address review comments, push fixes, and re-request review.
**If stuck:** Check review comments with `/git pr-view`.

### changes_requested (7)
**You're here:** Reviewer requested changes.
**Next:** Address each comment, push fixes, then re-request review.
**If stuck:** Run `/review-impl` to compare your changes against the plan.

### approved (8)
**You're here:** PR is approved.
**Next:** Merge with `/git pr-merge`.
**If stuck:** Ensure CI checks pass with `/git pr-checks`.

### merged (9)
**You're here:** Done! PR is merged.
**Next:** Pick up next ticket with `/kickoff <NEXT-KEY>`.
**If stuck:** Nothing to do here — celebrate the win!

## Common Questions

### "I forgot where I was"
Run `/tech-lead` (no args) for full status.

### "Is my pipeline healthy?"
Run `/tech-lead --health` for ecosystem check.

### "Something seems broken"
Run `/babysitter` for self-healing diagnosis.

### "What's blocking me?"
Run `/tech-lead what's blocking me?` — checks Jira + ticket state for blockers.

### "I need to work on something in parallel"
Run `/git:worktree feat/<KEY>-short-description` to create an isolated worktree. It fetches latest from origin, creates the branch off `origin/main`, copies gitignored files (.env, .claude, etc.), and runs `bun install`. See `.worktrees.json` for config.

### "How do I skip a stage?"
Use `Skill("ticket-state", args: "update <KEY> --stage <target>")` for non-linear moves. This is intentionally manual to prevent accidents.

---

## Advisory Stage Validations

Run during Status and Audit modes. These are **soft warnings only** — never blocking.

| Stage | Check | Warning |
|-------|-------|---------|
| `planned` | Plan file exists? `ls ~/.claude/plans/*<KEY>*` | "No plan file found. Run `/plan`." |
| `implementing` | Any commits on branch? `git log --oneline -1 origin/master..HEAD` | "No commits yet on this branch." |
| `testing` | QA evidence? `ls ~/.claude/state/qa-test/<KEY>/` | "No QA evidence. Run `/qa-test <KEY>`." |
| `pr_created` | PR exists? `gh pr view --json state 2>/dev/null` | "No PR found for this branch." |
| `in_review` | Review activity? `gh pr view --json reviews 2>/dev/null` | "PR has no reviews yet." |
| `approved` | PR approved? Check review decision | "PR status is not approved." |

These are 2-3 quick bash/gh commands. No Skill() calls needed.

---

## Complexity Tiers

| Tier | ~Tokens | When | How |
|------|---------|------|-----|
| **T1** | 500-2k | Factual lookups, stage advice, health | Inline from loaded knowledge + cached state |
| **T2** | 3-5k | Needs one external source | Single `Skill()` delegation, synthesize result |
| **T3** | 8-15k | Novel/cross-cutting, full audit | 2-3 Task agents in parallel |

80% of invocations should be T1. Optimize for fast, cheap answers.
