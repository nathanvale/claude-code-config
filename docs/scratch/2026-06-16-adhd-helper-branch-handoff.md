# ADHD Helper Branch Handoff

Date: 2026-06-16
Branch: `feat/adhd-helper-skill`
HEAD: `95c70cba feat(skills): add adhd-helper skill`

## Done

- Created and committed `skills/adhd-helper/`.
- Added the Moment Map: `Start`, `Unstick`, `Triage`, `Resume`, `Reduce`, `Reset`.
- Added support cards in `skills/adhd-helper/references/support-cards.md`.
- Healed bare invocation so it offers all six Moment Map options.
- Filed `heal-skill` closeout: `closeout_950b640fc59ff2a3`.

## Left

- Decide whether to commit `CONTEXT-MAP.md`.
  - Current diff adds the ADHD Helper context entry.
- Decide whether to commit `docs/ideation/2026-06-15-adhd-helper-prompt-pack-ideation.html`.
  - This is the ideation artifact from the prompt-pack conversion work.
- Decide whether to keep and commit `scripts/install-git-hooks.sh`.
  - Current diff changes hook install target to `git rev-parse --git-path hooks`.
  - Verified: `./scripts/install-git-hooks.sh` works in this worktree.
- Fix unrelated repo-wide audit blocker if needed.
  - `bun run skills/create-skill/scripts/skill-description-audit.ts --json`
  - Current failure: `skills/find-skills/SKILL.md` missing `description`.
- Re-run `./install.sh` only if global symlink ownership should change.
  - Current blocker: top-level links point at `/Users/nathanvale/code/claude-code-config`.
  - Current blocker: `memory/` target is missing in this worktree.

## First Move Tomorrow

- Run `git status --short`.
- Review the three unstaged items.
- Commit docs/context work separately from the hook installer fix.
