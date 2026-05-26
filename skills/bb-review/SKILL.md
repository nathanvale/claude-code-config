---
name: bb-review
description: "Review a Bitbucket PR and post findings as a human-style review. Switches to the PR branch, runs the ce-code-review multi-agent pipeline, posts P0/P1 findings as terse inline comments matching the existing reviewers' voice, and one terse summary comment carrying non-blockers. Triggers on 'bb-review <PR#>', 'review this bitbucket PR', 'inline review the PR'."
argument-hint: [PR-number-or-url]
disable-model-invocation: true
allowed-tools: Bash, Read, Agent, AskUserQuestion, Skill
---

# bb-review

Review a Bitbucket Cloud PR end to end and leave feedback that reads like a teammate, not a bot. Posts P0/P1s as terse inline comments and folds non-blockers into one terse summary comment, both in the existing reviewers' plain-sentence voice.

Argument `$1` = PR number or URL. If absent, ask which PR.

## Why this exists

Multi-agent reviews produce thorough findings but bot-flavoured prose (headers, severity tags, code-fence walls, essay length). On a shared PR that stands out and reads as machine-dropped. This workflow keeps the rigor of the review but rewrites the output to match how the humans on the PR already comment: short, conversational, often a question.

See [comment-style.md](comment-style.md) for the exact voice spec. Read it before drafting any comment.

## Workflow

### 1. Load tooling and view the PR

- Invoke the `bitbucket-pr:bb-pr` skill to load the `bb-api.ts` path and command set.
- `pr-view $1`, `pr-comments $1`, `pr-diffstat $1`. Read the description and the existing comment threads. The existing threads are the voice reference and may contain unresolved debates you should resolve rather than re-raise.
- **Interpreting an inbound comment: read the anchored line before deciding what it means.**
  - Each comment's `inline.path` + `inline.line` points at a specific diff line; resolve it via the Git-read MCP flow (JSON output) or the Bitbucket diff API when it exposes the hunk.
  - Let the *changed code* tell you the topic. A comment on `checkbox.stories.tsx:1` is about whatever changed on line 1 (e.g. an import source), not whatever the file is "about".
  - Do not infer the topic from the filename or from prior conversation.
  - A reply that answers the wrong question costs a correction on the thread.

### 2. Switch to the PR branch (safely)

- `git status --porcelain` first. If dirty, stop and tell the user to stash/commit, or offer to review without switching.
- Fetch and check out the PR source branch (`git fetch origin <branch>` then `git switch -c <branch> --track origin/<branch>`, or `git switch <branch>` if it exists locally).
- Note the user's original branch so you can offer to switch back at the end.

### 3. Run the review (report-only, no mutations)

- Invoke `compound-engineering:ce-code-review` against the branch with `base:origin/<dest>` (usually `develop`). Pass PR title/body as intent and call out anything the description or existing threads flag.
- ce-code-review writes per-reviewer artifacts under `/tmp/compound-engineering/ce-code-review/<run-id>/`. Let its merge/dedup/confidence-gate pipeline produce the final finding set. Do not re-rank by hand beyond mapping to P0/P1 vs non-blocker.

### 4. Decide the posting plan (ask once)

Use `AskUserQuestion` to confirm before any write:
- Which P0/P1s go inline (default: all P0s + P1s).
- Non-blockers: summary-only (default) or some inlined.
- Whether to reply on any existing unresolved thread (e.g. confirming/refuting a debate the review settled).
- Preview drafts first (default) vs post directly.

Writes to a live PR are outward-facing. Never post without this confirmation.

### 5. Draft in the human voice

Read [comment-style.md](comment-style.md). Optionally route drafting through the `draft-message` skill, but the comment-style spec is the bar either way. Rewrite every finding to:
- Plain sentences. No `**P1 —**` headers, no severity tags, no section scaffolding.
- One short paragraph per inline comment. End with a question or a light suggestion ("Could we ... instead?", "Worth settling before ...?").
- Inline code spans for symbols; a small code block only when it genuinely clarifies. No multi-block essays.
- Australian-friendly, no em/en-dashes (use commas or parens).

The summary comment: one short positive opener (specific, earned), then the non-blockers as a tight bullet list in the same terse voice, then the P0/P1s named with a pointer to their inline comments. Keep it scannable, not a report.

### 6. Post

- Inline: `pr-inline-comment $1 <path> <new-file-line> "<text>"`. Anchor to the `to`-side line number in the new file version (verify with `grep -n`).
- Thread reply: `pr-reply $1 <leaf-comment-id> "<text>"`.
- Summary: `pr-comment $1 "<text>"`.
- Quote all free-text args. Capture returned `comment_id`s and report them with the PR link.

### 7. Draft a message to the author

Draft a short message to the PR author letting them know the review is done, using the `draft-message` skill. It copies to clipboard for the user to paste; the user sends. Do not use the `slack-message` MCP skill (its Slack tools are read-only/unreliable here, so it can't resolve people or send).

Keep it to one or two lines:
- Always: say you've read through the PR.
- If there's anything major (a P0/P1), name it in one brief line and point to the PR.
- Otherwise: just say it looks good.

Tone: casual teammate. No em/en-dashes. Examples:
- Clean: "Had a read through E2G-1180, looks good to me. Left a couple of tiny optional notes on the PR but nothing blocking."
- With a major: "Read through E2G-1180. Mostly solid, two things worth a look before merge (status override re-arming the action buttons, and the response envelope mismatch). Both on the PR inline."

Draft it, show the user, copy to clipboard. The user pastes into their chat tool and sends.

### 8. Wrap up

- Give the user the PR overview link plus direct comment links.
- If you switched branches in step 2, offer to switch back to their original branch.

## Notes

- `bb-api.ts` has no delete command. If the user wants to redo comments, they delete in the Bitbucket UI; you repost. Do not build a raw DELETE path unless asked.
- No P0 is a normal, good outcome. Don't manufacture severity. A resolved debate (like a confirmed operator choice) is a thread reply, not a finding.
- Severity scale and routing come from ce-code-review (P0 must-fix ... P3 discretionary). This skill only governs branch handling, the ask-before-post gate, and the output voice.
