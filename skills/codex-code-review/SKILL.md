---
name: codex-code-review
description: "Set up, verify, trigger, or troubleshoot Codex reviews for one GitHub repository or pull request."
argument-hint: "<owner/repo> [PR URL or number] [setup|status|review|troubleshoot]"
disable-model-invocation: true
---

# Codex Code Review

Configure or request Codex GitHub reviews for one proven target. Invoke as
`/codex-code-review ...`; never start this external workflow from model recall.

## Start

- Resolve the exact `owner/repo` and requested route.
- For `review`, also resolve one open pull-request URL or number.
- With no args, inspect the current Git remote and run the read-only `status`
  route. Ask for `owner/repo` only when the target remains ambiguous.
- Read [GitHub review workflow](references/github-review.md), then execute only
  the selected route.

| Signal | Route |
|---|---|
| `status`, `check`, or no action | Read-only status |
| `setup`, `enable`, `automatic`, or settings change | Setup |
| `review`, `trigger`, or request review | Manual trigger |
| Review absent, no reaction, or wrong repository | Troubleshoot |

## Safety

- Treat a ChatGPT connection email as display metadata, not GitHub identity.
- Prove the authenticated GitHub login and GitHub App repository scope before
  changing settings or commenting.
- Stop on any account, repository, or pull-request mismatch.
- Never broaden GitHub App access unless the user explicitly names the new
  repository scope.
- Keep status and troubleshooting read-only unless the user explicitly requests
  the repair.

## Owners

- Route detail: [GitHub review workflow](references/github-review.md).
- Browser attachment and UI mechanics: `skills/browser-use/SKILL.md`.
- Product behavior: [OpenAI Codex GitHub review documentation](https://learn.chatgpt.com/docs/third-party/github).

## Next Safe Action

Run the selected route. Report the proven GitHub login, exact repository or PR,
observed state, any change made, and verification result.
