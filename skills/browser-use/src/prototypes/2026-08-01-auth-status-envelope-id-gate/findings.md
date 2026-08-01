# Spike receipt — auth status envelope id-gate fix (2026-08-01)

Lane: pre-build falsify (browser-free — CLI envelope validation, no CDP).
Branch: `fix/auth-status-envelope-id-gate`. Spike edits live in the working
tree of this branch; graduation is test-first re-application, not this diff.

## Bug under test

`browser-use auth status --json` (forbidden env keys stripped) crashes with
`CliRuntimeContractError` instead of emitting its typed blocked envelope.

Proven causal chain (corrects the handoff's premise — the trigger is NOT
prose interpolation into `error.message`):

1. Supervisor status → blocked `profile-policy-unproven`, continuation
   `create-credential-clean-profile`.
2. `emitAuthTokenLifecycleResult` builds the blocked envelope carrying that id
   in `runtime_actions[0].id` and `continuation.next_action_id`.
3. `runtime-envelope.ts` validates BOTH id fields with `validateNonEmptyString`,
   which runs `validateSafeRuntimeText` — the free-text VALUE vocabulary scan
   (`runtime-text-safety.ts` pattern label `credential`). The legal enum id
   fails → `CliRuntimeContractError` ("runtime_actions.0.id includes unsafe
   runtime-contract text: credential" + same for continuation).
4. That error propagates to `runBrowserUseCli`'s catch → `emitCliError`; its
   message quotes the label "credential"; `redactUnsafeText` (values-only:
   op:// URLs, sensitive --flags, paths) leaves it; `createCliRuntimeError`
   validates `error.message` → second `CliRuntimeContractError` thrown INSIDE
   the last-resort emitter → uncaught crash, exit 1.

## Q1 — id fields gated by SHAPE instead of vocabulary → typed envelope?

Candidate: `validateRuntimeActionIdText` (non-empty, ≤128 chars,
`/^[a-z][a-z0-9_-]*$/`) replacing `validateNonEmptyString` for
`runtime_actions[].id` and `continuation.next_action_id`. Ids are controlled
enum identifiers, not agent-facing prose; all 69 existing ids match the token
shape. Rationale mirrors the repo's own NAME-gate-vs-VALUE-scan split
(`runtime-text-safety.ts` env-var name gate comment).

**PASS (live):**
`env -u OP_SERVICE_ACCOUNT_TOKEN -u OP_CONNECT_TOKEN -u OP_CONNECT_HOST -u BROWSER_USE_TOKEN -u BROWSER_USE_OP_TOKEN bun run browser-use auth status --json`
→ exit **20**, parseable typed envelope: `evaluation.status=blocked`,
`blocked_cause=profile-policy-unproven`, 4/5 checks ready,
`continuation.next_action_id=create-credential-clean-profile`, no stack trace.

**PASS (harness):** success envelope accepts the legal id; malformed ids
(`"Bearer abc"`, uppercase, spaces, punctuation, leading dash, >128 chars) all
still rejected.

## Q2 — can emitCliError still be crashed after Q1?

**CRASH CONFIRMED pre-hardening:** `runForTest(["auth","status","--json"])`
with `runAuthTokenSupervisor` throwing `Error("supervisor rejected the
credential material")` → `CliRuntimeContractError` escapes the emitter.
(Usage-error paths are already covered by `sanitizeUsageValue`; the live
vector is any upstream error message carrying banned vocabulary — including
any future `CliRuntimeContractError` whose issue text quotes a banned label.)

**PASS post-hardening:** `emitCliError` wraps `createCliRuntimeError` in
try/catch; on a leak-guard rejection it falls back to the generic message
"runtime error message withheld: it did not pass the runtime-contract text
safety gate." → exit 1, valid envelope, no crash. The last-resort emitter is
now total.

## Graduation decision

- Fix 1 (required for the objective): id-shape gate in
  `runtime/cli-command-facade/src/runtime-envelope.ts` for the two id fields.
  This IS a shared-facade change (handoff flagged it approval-gated) — but the
  evidence shows no app-level alternative meets the objective short of
  renaming the action id, which ripples into the Swift supervisor contract and
  the parallel session's prototype. The gate only widens acceptance (every
  previously valid envelope stays valid); other id-ish fields
  (choices[].id/action_id, constraints[].id, forbidden_action_ids) still use
  the vocabulary scan — flagged as a consistency follow-up, not taken here.
- Fix 2 (defense-in-depth, app-level): emitCliError never-throw fallback.
- Test homes: facade envelope validation suite (id acceptance/rejection) +
  browser-use auth command test (blocked profile-policy → typed envelope) +
  emitCliError fallback test via runForTest with a throwing supervisor.
