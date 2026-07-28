---
name: matest-session
description: "Run an Experience extension in MATest with a warm authenticated browser and live debugging."
disable-model-invocation: true
---

# MATest Session

Run the named extension in MATest, prove its live page, then leave the browser and dev
server warm. With no arguments, use the extension in the current request.

## Dependencies

- `skills/browser-use/SKILL.md`: hard dependency for browser routing, warm attach,
  browser actions, run state, and recovery. Missing state: blocked. Next repair:
  restore `browser-use` with `setup sync`, then verify `browser-use --help`.
- `skills/one-password/SKILL.md`: hard dependency only for cold authentication.
  Missing state: cold authentication is blocked; an authenticated warm session can
  continue. Next repair: restore the skill and verify its runtime before login.
- Startup guidance: `$HOME/code/claude-code-config/AGENTS.md` first, then the nearest
  repository agent instructions, context documentation, and extension config.

Read `references/matest-runbook.md` before a cold login, deploy, new-extension
registration, or page-route repair.

## Route

1. Inspect the extension package, card manifest, page route, dev port, and current
   browser state.
2. Stop the extension dev server before any build, deploy, or handback command. Run the
   requested command, then restart the dev server in the persistent secret-backed shell.
3. Hand browser work to `browser-use`. Use the shipped MATest
   `development-snapshot-verify` runbook for the authenticated Development-page proof.
   Preserve the returned run id for status or recovery, then hand browser state back to
   this workflow.
4. Reuse an authenticated MATest tab. On cold auth, select **Monash University Users**,
   then use **Google Authenticator** for MFA.
5. Wait for a successful compile and HTTP 200 from the local `manifest.json`. Enable
   live reload, verify its session-storage value, and open Development.
6. For a new extension, activate Test in Experience Setup and complete Card Management
   metadata before treating a page-route 404 as a code failure.
7. Open the full card page route, capture a screenshot, inspect errors and console, and
   leave the browser and dev server running.

## Safety Gate

- Never select **Google Account** as the MATest identity provider.
- Never treat a surviving package-manager PID as proof that webpack is live. Require
  local manifest HTTP 200 before reloading MATest.
- Never clear warm-browser cookies or storage as routine auth repair. Use a fresh tab
  for a stale transaction.
- Never print passwords, TOTP values, upload tokens, cookies, or auth-bearing URLs.
- Treat Experience Setup activation and Card Management edits as external mutations;
  keep them scoped to the named extension and report them.

## Next Safe Action

If auth, deployment, or registration fails, report the failed boundary and the exact
next repair from the runbook. Do not substitute another identity provider.
