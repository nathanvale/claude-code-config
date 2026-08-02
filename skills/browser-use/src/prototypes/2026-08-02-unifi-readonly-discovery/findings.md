# UniFi read-only discovery findings

Lane: pre-build falsification. Real Agent Chrome via the verified
`agent-browser` handoff. No credentials read, entered, or resolved. No form
mutation performed.

## Q1. Can the router open through the normal verified lane?

**PASS.** `https://192.168.1.1` opened without an HTTPS bypass flag or
certificate interstitial, then stabilized at `https://192.168.1.1/login` with
title `UniFi OS`.

Exact call sequence:

```text
browser-connect connect agent-browser --json
agent-browser --cdp <verified-port> --session codex-unifi-discovery tab new https://192.168.1.1 --json
agent-browser --cdp <verified-port> --session codex-unifi-discovery batch --bail "wait 3000" "get url" "get title" "snapshot -i" --json
```

Assertion that fired: final URL equals `https://192.168.1.1/login`; title equals
`UniFi OS`.

Plan effect: retain the single allowed origin `https://192.168.1.1`; make the
open step target `/login` and assert that exact stabilized URL.

## Q2. Is the real login form username plus password?

**FAIL.** The accessibility snapshot exposed one textbox named `Password` and
one button named `Sign In`. DOM metadata exposed one input:
`type=password`, `name=password`, `id=login-password`,
`autocomplete=current-password`. No username input exists.

Exact read-only probe after Q1:

```text
agent-browser --cdp <verified-port> --session codex-unifi-discovery eval <safe-form-metadata-probe> --json
```

Assertion that fired: input count equals 1; input type equals `password`;
username textbox count equals 0.

Plan effect: replace KTD5's username-plus-password assumption with a
password-only runbook. Use only `unifi_password`; do not gate the runbook shape
on a username field in the 1Password item.

## Q3. Are the pre-login targets structurally simple and stable?

**PASS.** Role/name resolution sees `textbox "Password"` and
`button "Sign In"`. The page has zero iframes and zero shadow hosts. The input
has stable id `login-password`; the button is a disabled submit until the empty
password field changes.

Assertion that fired: semantic targets occur exactly once; iframe count equals
0; shadow-host count equals 0.

Plan effect: the confidential fill target can use role `textbox`, name
`Password`; the click target can use role `button`, name `Sign In`.

## Q4. Can read-only discovery identify the post-login dashboard marker?

**FAIL.** The unauthenticated page exposes login content only. No dashboard DOM
or post-login URL is observable before crossing the operator-gated credential
boundary.

Assertion that fired: the fresh snapshot contains the login form and no
dashboard structure.

Plan effect: U6 cannot claim a verified submit postcondition while live login
stays deferred. Split the work: U6 authors and validates the proven pre-login
steps; the operator-gated follow-up performs live login, captures the dashboard
marker, adds the submit step, and acceptance-spikes the completed runbook.

## Verdict

The browser spike falsified two load-bearing assumptions before implementation:
the router is password-only, and read-only discovery cannot finalize the submit
postcondition. The CRUD implementation can proceed, but the plan must stop
claiming that U6 produces a fully verified login runbook without the deferred
operator-gated login.
