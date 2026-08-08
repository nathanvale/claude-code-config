# MATest Live-Debug Runbook

Use only after the `matest-session` route selects a cold-login, deploy,
new-extension, or page-repair branch.

## Inspect

- Read the nearest extension agent instructions and context documentation when present.
- Read `package.json`, `extension.js`, card `config.js`, and `webpack.config.js`.
- Derive the package filter and live-reload port from source. Common local defaults:
  SL01 `8082`, SL02 `8083`, SL04 `8084`.
- A page extension still needs one launcher card. Its card config needs a stable
  `type`, matching `displayCardType`, and `pageRoute.route`.

## Deploy And Start

From the repo root:

```bash
UPLOAD_TOKEN_REF='op://API Credentials/wdkqx7turfueovtyhvjuxacqta/EXPERIENCE_EXTENSION_UPLOAD_TOKEN'
TOKEN_WRAPPER="$HOME/code/dotfiles/bin/with-one-password-token"

"$TOKEN_WRAPPER" inject EXPERIENCE_EXTENSION_UPLOAD_TOKEN "$UPLOAD_TOKEN_REF" -- \
  pnpm --filter <package> run deploy
"$TOKEN_WRAPPER" inject EXPERIENCE_EXTENSION_UPLOAD_TOKEN "$UPLOAD_TOKEN_REF" -- \
  pnpm --filter <package> dev
```

Use `run deploy`. `pnpm deploy` is pnpm's unrelated built-in deploy command.
The MATest capability owns this exact upload-token reference. The wrapper owns token-file
validation, gives `OP_SERVICE_ACCOUNT_TOKEN` only to `op`, and removes it before `pnpm`.
Never substitute `with-env`, bare `op`, an exported token, or `op run`.

Stop the extension dev server before any production build, deploy, or handback command.
These commands overwrite physical `dist` assets used by webpack-dev-server. Restart the
dev server afterwards and require all three checks before touching MATest:

1. Webpack reports a successful compile.
2. `http://localhost:<port>/manifest.json` returns HTTP 200.
3. The local manifest contains `cards[].previewId`.

An ESLint or webpack hook failure can terminate the webpack child while leaving its
package-manager parent alive. Do not trust the PID or terminal alone. If the HTTP check
fails, stop the exact extension process and restart it through the wrapper's `inject`
route.

The upload output gives the base page path. Append the card's `pageRoute.route` for a
direct page URL.

## Browser Connection

Hand browser routing and execution to `skills/browser-use/SKILL.md`. Read its live
guide, discover the current runbook catalog, then execute the
`matest/development-snapshot-verify` flow through the `browser-use` CLI.

Preserve the returned run id. Use the run status or resume path from the live guide,
and follow `continuation.next_action_id` under its emitted constraints. Return the
selected lane, observed browser state, blocked condition, and next safe action to
`matest-session`.

Never drive `browser-connect` directly, launch another Chrome process, hardcode a CDP
port, or substitute a cold browser.

## MATest Authentication

Skip auth when the warm tab already shows MATest.

For a cold session:

1. Open `https://experience-test.elluciancloud.com.au/matest/`.
2. On the provider chooser, select the option whose visible label reads
   **Monash University Users**. Never select by position — provider ordering can
   change.
3. Assert the selected provider reads exactly "Monash University Users" before
   entering any credentials. If it does not, stop and reselect.
4. Fill the QA account username and password via the domain's Auth Pointer (see
   below).
5. On MFA, choose **Google Authenticator**, resolve a fresh TOTP through the Auth
   Pointer, and verify.
6. Wait for the redirect back to MATest.

**Google Account** is a different identity provider. Never select it for this flow.

For a stale saved auth transaction, open MATest in a fresh tab and select **Monash
University Users** again. Preserve cookies and storage so the working SSO session
survives. Do not repair the flow by opening a direct Okta or Google Account URL.

Resolve credentials through the domain's Auth Pointer at fill time. The browser-use
skill owns the Auth Pointer, credential custody, resolution, and confidential delivery.
The dotfiles upload-token wrapper is not a browser-login lane. Never extract browser
secret values into shell variables or pass them as browser-command
arguments — command args are shell-visible, which the browser owner forbids. Never log
secret values; report secret checks by shape only (present/absent, length, account
name).

## Live Reload

On the authenticated MATest tab, call `enableLiveReload(<port>)`. Wait five seconds,
then verify:

```js
sessionStorage.getItem('ExperienceToolkit::liveReload')
```

Expected shape: `{"enabled":true,"port":<port>}`.

Open `https://experience-test.elluciancloud.com.au/matest/development`. Confirm the
named launcher card renders before following its page action.

If MATest is blank and the console reports a failed local-manifest fetch, the browser
reloaded before webpack was ready. Prove local manifest HTTP 200, then reload the same
warm tab. Do not clear its cookies or session storage.

## New Extension Registration

A successful upload does not finish tenant registration.

1. Open `https://experiencesetup-test.elluciancloud.com.au/extensions` in the warm
   browser.
2. If prompted, authenticate with the 1Password item titled `Ellucian`; choose
   **Google Authenticator** for MFA.
3. Find the exact extension name and uploaded version. New versions can be disabled
   even when an older version is enabled. Enable the exact uploaded version, edit it,
   select **Test**, and save.
4. Return to MATest Configuration, Card Management.
5. Find the exact card. Edit only that row.
6. Set a searchable test tag, the intended category, and the minimum roles held by the
   QA account. Keep the card enabled and finish.

For a Fees launcher, use category **Fees & Scholarships**. Common QA roles include
`advisor`, `instructor`, and `OR0041`; verify the current account holds each role before
selecting it.

A WIP page action returning 404 before category and roles exist is a registration gate,
not proof of a broken bundle.

## Proof And Handoff

- Open the full uploaded path including `pageRoute.route`.
- Verify the page heading and primary interactive regions in an accessibility snapshot.
- Capture a full-page screenshot.
- Clear diagnostic buffers, reload once, then inspect page errors and console output.
- Report upload, activation, Card Management changes, URL, screenshot, and checks.
- Leave the authenticated browser tab and dev server running.
