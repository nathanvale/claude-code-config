# Retirement Criteria — the-cinema-bandit plugin

This document defines the checkable conditions under which the legacy `side-quest-plugins/plugins/the-cinema-bandit/` plugin can be archived or deleted.

**Retirement is not executed by this skill.** This file exists so a future plan (or a future Nathan, or a future Claude session) has a clear, grounded list of what "done" means. When all criteria below are met, write a follow-up retirement plan that archives the old plugin.

---

## Why the old plugin exists

`the-cinema-bandit` is a TypeScript plugin at `~/code/side-quest-plugins/plugins/the-cinema-bandit/`. It bundles:

- A CLI (`src/cli.ts`) with subcommands `movies`, `movie`, `pricing`, `seats`, `send`
- A web scraper (`src/scraper-client.ts`, `src/scraper.ts`, `src/selectors.ts`, `src/price-scraper.ts`)
- A bespoke Gmail OAuth server (`src/gmail/auth.ts`, `send.ts`, `credentials.ts`) with its own token cache at `~/.config/the-cinema-bandit/gmail-token.json`
- HTML ticket templates (`classic-cinemas-email-template.html`, `examples/sample-ticket.html`)
- Tests (`*.test.ts`)
- A harness `commands/ticket.md` and `skills/cinema-booking/` skill that drives the CLI conversationally

All of this has a single purpose: generate a ticket-style email confirmation for Classic Cinemas Elsternwick. The new `classic-cinema` user-scope skill replaces it using `ba-browse` + `gog` instead of bundled code.

---

## Criteria for retirement

All of the following MUST be true before the old plugin is archived:

### 1. Three independent successful smoke tests through the new skill

The new skill has been used end-to-end to generate a confirmation email on **three separate occasions**, on **three different days**, for **three different movies or sessions**.

- [ ] Smoke test 1: _____ (date, movie, session)
- [ ] Smoke test 2: _____ (date, movie, session)
- [ ] Smoke test 3: _____ (date, movie, session)

Each smoke test must:
- Complete all 6 workflow stages (browse → details → pricing → seats → confirm → send)
- Result in an email landing in Nathan's inbox with the HTML template rendered
- Result in a new entry in `~/.local/state/classic-cinema/bookings.jsonl`
- Not have required manual intervention beyond the expected `AskUserQuestion` prompts

### 2. Determinism convergence proven

By the 4th run of any single stage (browse, pricing, or seats) under the `browse-and-price-elsternwick` canonical flow, **no new gotchas are being staged** in the domain file.

- [ ] Stage 1 (browse) converged: no new gotchas since iteration ___
- [ ] Stage 3 (pricing) converged: no new gotchas since iteration ___
- [ ] Stage 4 (seat map) converged: no new gotchas since iteration ___

Check by grepping the iteration log:

```bash
grep "bootstrap-observe\|browse-and-price-elsternwick" \
  ~/.config/side-quest/browser-automation/domains/classiccinemas-com-au/classiccinemas-com-au.md
```

If the most recent 2+ iteration rows show no new gotchas in their notes, the flow is converged.

### 3. Booking log has 3+ successful entries

- [ ] `wc -l ~/.local/state/classic-cinema/bookings.jsonl` returns ≥ 3
- [ ] All entries have non-empty `gmail_message_id` fields (send succeeded for each)

### 4. Old plugin's CLI has not been invoked since new skill went live

The old plugin is archived only if Nathan has not manually fallen back to it.

- [ ] Nathan has not run `bun run src/cli.ts movies|pricing|seats|send` in the old plugin since the new skill's first successful run
- [ ] Nathan has not run `/ticket` from the old plugin's commands since the new skill's first successful run
- [ ] No Claude session has dispatched to `the-cinema-bandit:*` skills since the new skill's first successful run

Self-check — no reliable automation for this; Nathan's recall is the check.

### 5. Old plugin's Gmail OAuth credentials can be safely revoked

Verify that revoking the plugin's bespoke Gmail credentials doesn't break anything else.

- [ ] `~/.config/the-cinema-bandit/credentials.json` is not referenced by any other tool
- [ ] `~/.config/the-cinema-bandit/gmail-token.json` is not referenced by any other tool
- [ ] Google Cloud Console: the OAuth client linked to the old plugin can be revoked without affecting other apps
- [ ] Backup of the credentials files taken (in case revocation is premature)

### 6. The new skill and canonical domain are backed up somewhere

User-scope skills at `~/.claude/skills/` and canonical domain files at `~/.config/side-quest/browser-automation/domains/` are NOT in any git repo by default. Before retiring the source-of-truth (the old plugin), the new skill should be snapshotted somewhere durable.

- [ ] `~/.claude/skills/classic-cinema/` has been copied into a git-tracked location (e.g. `claude-code-config/skills/classic-cinema/` with a symlink back), OR
- [ ] The user explicitly acknowledges that user-scope skills are intentionally unversioned

### 7. No regression in the email output

The new skill's generated email must be visually indistinguishable from the old plugin's.

- [ ] A side-by-side visual comparison (screenshots) of an email generated by the old plugin and an email generated by the new skill has been done
- [ ] No layout regressions, no missing fields, no broken CSS
- [ ] The template MD5 hash still matches: `63b58d49afbc14aba9809d10c33ec066`

---

## Retirement procedure (for the follow-up plan)

When all criteria above are checked, a retirement plan should:

1. Create a git archive of `side-quest-plugins/plugins/the-cinema-bandit/` (e.g. `git tag archived/the-cinema-bandit`)
2. Remove the plugin's entry from `side-quest-plugins`'s plugin registry (if any)
3. Delete or move `~/.config/the-cinema-bandit/` credential files (optionally to a backup location)
4. Revoke the Gmail OAuth client in Google Cloud Console
5. Delete the plugin directory or move it to `side-quest-plugins/archived/`
6. Update the `classic-cinema` skill's "Related" section to note retirement date
7. Update the canonical domain file's notes to reflect retirement
8. Write a retirement summary (e.g. `docs/retirements/2026-XX-XX-the-cinema-bandit.md` in `my-second-brain`)

---

## What NOT to retire

The canonical `classiccinemas-com-au` managed domain at `~/.config/side-quest/browser-automation/domains/classiccinemas-com-au/` is the NEW source of truth. It's NOT part of the old plugin and NEVER gets retired. It continues to accumulate earned determinism across skill runs.

The HTML ticket template at `~/.claude/skills/classic-cinema/references/assets/ticket-template.html` is a byte-identical copy of the old plugin's template but lives fully inside the new skill. Once retirement happens, the new skill's copy becomes the canonical copy — the old copy in `the-cinema-bandit/classic-cinemas-email-template.html` goes away with its host plugin.

---

## Current status (as of 2026-04-08)

- New skill created: 2026-04-08
- Canonical domain bootstrapped: 2026-04-08 (2 iterations: bootstrap-observe + checkout-observe)
- First real target_flow minted: `browse-and-price-elsternwick` (no iterations yet under the real flow name — all observations have been under `bootstrap-observe`)
- Smoke tests completed: **0 of 3**
- Booking log entries: **0**
- Convergence status: **not yet measured** (need real runs under `browse-and-price-elsternwick`)
- Old plugin usage since new skill: **old plugin used once for Project Hail Mary booking on 2026-04-08** (before the new skill existed)
- Retirement status: **NOT READY**
