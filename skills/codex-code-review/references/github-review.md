# GitHub Review Workflow

Load this file only after selecting a route in
`skills/codex-code-review/SKILL.md`.

## Common Gate

1. Resolve one exact `owner/repo`. Resolve one open PR for the manual-trigger
   route.
2. Prove the GitHub login through the active GitHub connector identity endpoint
   or authenticated GitHub profile. Do not infer it from a ChatGPT email label,
   local Git config, or another `gh` session.
3. Inspect the Codex GitHub App installation and require the exact repository in
   its repository list. Repository access does not prove Code review is enabled.
4. Require Codex cloud setup for the exact repository.
5. Stop and report the mismatch when any proof fails. Do not repair scope or
   identity without a separately explicit request.

## Status

- Inspect the repository row in Codex Code review settings.
- Record Code review, Automatic reviews, trigger policy, and any exhaustive-mode
  state shown by the live product.
- Make no changes.

## Setup

1. Require an explicit requested state. If automatic policy or trigger is
   missing, show the live choices and ask one question.
2. Invoke `skills/browser-use/SKILL.md` for the live Codex settings UI. Let that
   owner handle attachment, tabs, snapshots, actions, and retries.
3. Turn on Code review for the exact repository.
4. If requested, set Automatic reviews and the selected live trigger policy.
5. Save, then re-read the repository row and the GitHub App repository list.
6. Report the previous state, new state, and proof. A saved UI control without a
   matching repository row is not success.

Automatic review applies to matching future PR events. For a PR that already
exists, use the manual-trigger route unless the live product shows a qualifying
event occurred after setup.

## Manual Trigger

1. Require the exact open PR and explicit authority to create a GitHub comment.
2. Confirm the PR belongs to the proven repository.
3. Post this exact PR comment. Retain the created comment ID and author from the
   result:

   ```text
   @codex review
   ```

4. For a one-off focus explicitly supplied by the user, append it after
   `@codex review`, for example `@codex review for security regressions`.
5. Verify that exact comment ID and expected author on the exact PR. If it cannot
   be verified, report the request as failed.
6. Check for an eyes reaction or posted review authored by the Codex app account.
   Ignore reactions and reviews from other actors. Report `requested, pending`
   only after the exact new comment is verified and Codex processing remains
   asynchronous; never claim the review completed from comment creation alone.

## Troubleshoot

Check in this order:

1. Proven GitHub login.
2. Exact repository in the Codex GitHub App installation.
3. Codex cloud setup for the repository.
4. Code review enabled for the repository.
5. Exact `@codex review` comment on the intended open PR.
6. Automatic-review event matches the live trigger policy.

Keep diagnosis read-only. Name the first failed gate and the smallest repair.
