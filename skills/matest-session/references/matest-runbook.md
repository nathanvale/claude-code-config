# MATest Live-Debug Runbook

Use only after the `matest-session` route selects a cold-login, deploy,
new-extension, or page-repair branch.

## Inspect

- Read the nearest extension `AGENTS.md` and `CONTEXT.md` when present.
- Read `package.json`, `extension.js`, card `config.js`, and `webpack.config.js`.
- Derive the package filter and live-reload port from source. Common local defaults:
  SL01 `8082`, SL02 `8083`, SL04 `8084`.
- A page extension still needs one launcher card. Its card config needs a stable
  `type`, matching `displayCardType`, and `pageRoute.route`.

## Deploy And Start

From the repo root:

```bash
pnpm --filter <package> run deploy
pnpm --filter <package> dev
```

Use `run deploy`. `pnpm deploy` is pnpm's unrelated built-in deploy command.

Stop the extension dev server before any production build, deploy, or handback command.
These commands overwrite physical `dist` assets used by webpack-dev-server. Restart the
dev server afterwards and require all three checks before touching MATest:

1. Webpack reports a successful compile.
2. `http://localhost:<port>/manifest.json` returns HTTP 200.
3. The local manifest contains `cards[].previewId`.

An ESLint or webpack hook failure can terminate the webpack child while leaving its
package-manager parent alive. Do not trust the PID or terminal alone. If the HTTP check
fails, stop the exact extension process and restart it in the persistent secret-backed
shell.

The upload output gives the base page path. Append the card's `pageRoute.route` for a
direct page URL.

## Browser Connection

Follow `skills/browser-use/SKILL.md`:

```bash
browser-connect connect agent-browser --json
browser-connect run agent-browser -- agent-browser --session <session> <command>
```

Reuse the verified warm Chrome handoff. Never launch another Chrome process or hardcode
a CDP port as a repair.

## MATest Authentication

Skip auth when the warm tab already shows MATest.

For a cold session:

1. Open `https://experience-test.elluciancloud.com.au/matest/`.
2. On the provider chooser, select the first option: **Monash University Users**.
3. Fill the selected QA account username and password from 1Password.
4. On MFA, choose **Google Authenticator**, fetch a fresh TOTP, and verify.
5. Wait for the redirect back to MATest.

**Google Account** is a different identity provider. Never select it for this flow.

For a stale saved auth transaction, open MATest in a fresh tab and select **Monash
University Users** again. Preserve cookies and storage so the working SSO session
survives. Do not repair the flow by opening a direct Okta or Google Account URL.

Use one persistent 1Password shell for the task. Extract exact JSON fields by ID:

```bash
op item get <item> --vault "API Credentials" --format json \
  | jq -r '.fields[] | select(.id == "password") | .value'
```

Do not use wrapped `--fields label=password` output as the credential value. Fetch TOTP
at fill time with `op item get <item> --vault "API Credentials" --otp`. Pass secret
values directly into the browser command without logging them.

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
