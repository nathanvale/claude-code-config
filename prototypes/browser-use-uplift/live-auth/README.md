# live-auth boundary prototype

## Question

Can a saved browser flow (e.g. submit a weekly timesheet) log in on every run
WITHOUT ever persisting the real password? The stored memory must hold only an
**Auth Pointer** — a shape-only reference like `1password:Molty/Oncore Login/password`
plus which field is the secret. At run time the flow resolves the pointer, fetches
the secret, fills it into the live field, and the secret must NEVER reach disk, logs,
the run-book, or the Recorder JSON.

This prototype proves the **Auth-Pointer -> resolve -> fill -> no-leak** boundary is
safe: the secret exists only in memory during the fill; everything persisted is
shape-only.

## How to run

```bash
bun prototypes/browser-use-uplift/live-auth/live-auth.ts
```

Pure TypeScript, zero deps, no network, no shell. Exits `0` when the boundary holds.

## MOCKS 1Password — this is a safety-logic prototype

`resolveSecret(ref)` returns an obviously-fake constant (`hunter2-FAKE-SECRET`). It
does NOT touch real 1Password, does NOT run `op`, does NOT read any credential file
or env var. Real `op` access is a plan concern owned by the **`one-password`** skill;
this prototype only proves the persistence boundary, not the auth integration.

## Verdict

**PASS** — Auth-Pointer boundary holds: safe path leaks nothing, naive path is caught.

Actual run output (verdict lines):

```
  ✓ no leak — persisted artifacts + console contain only redacted:* / 1password:* shapes
  ✓ leak-check CAUGHT the naive capture: artifact:runBook, artifact:recorderJson
PASS — Auth-Pointer boundary holds: safe path leaks nothing, naive path is caught.
```

The safe path persists only shapes:

```
Recorder JSON persisted:
  [{"action":"type","field":"username","value":"molty@oncore.example"},
   {"action":"fill","field":"password","value":"redacted:password-field"}]
```

The stored run-book password step is shape-only — `secretRef` + `valueShape`, no value:

```
{"kind":"auth","field":"password","auth":{
  "field":"password",
  "secretRef":"1password:Molty/Oncore Login/password",
  "valueShape":"redacted:password-field"}}
```

The naive recorder stored the typed secret inline (`value === FAKE_SECRET`), and the
leak-check caught it in two artifacts (`runBook`, `recorderJson`).

## Findings for browser-domain-memory

- **The Auth Pointer is sufficient.** A stored step needs only `{ field, secretRef,
  valueShape }`. No secret value is required to replay a login — the value is
  resolved at run time and never persisted.
- **The fill must be a distinct step kind, not a `type`.** The leak is born when a
  recorder captures the password field as literal keystrokes (`action: "type"`,
  `value: <secret>`). Modeling auth as a separate `kind: "auth"` step that emits a
  `fill` event with `value: "redacted:password-field"` is what keeps the secret out
  of the Recorder JSON.
- **Secret scope is one function.** `resolveSecret` -> fill -> drop happens inside a
  single function (`liveLoginField`); the secret never escapes into the persisted
  `RecorderEvent`, run-book, or run-outcome log. Keeping that scope tight is the
  whole safety property.
- **The leak-check is a cheap, deterministic gate.** Stringify every persisted
  artifact + the captured console buffer, substring-search for the secret. It caught
  the naive capture and passed the safe one with no false positives. This belongs in
  the capture/commit path as a fail-closed assertion before any run-book is saved.
- **Console is an artifact too.** The prototype wraps `console.log` into a buffer and
  scans it. Real flows must treat logs/transcripts as persisted surfaces — a secret
  that only leaks to stdout is still a leak.
- **Real `op` integration is out of scope here.** The resolver is mocked. The plan
  should route actual secret reads through the `one-password` skill (service-account,
  targeted read) and keep this leak-check as the boundary guard around it.
