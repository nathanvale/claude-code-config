# Findings — honest self-healing token doctor (post-build accept spike)

**Date:** 2026-08-01 · **Lane:** post-build accept (custody spine merged in #290) · **Direction:** "honest self-healing doctor, env lane" (Nathan). Secret-free; no portal; **no Chrome attach needed** (see finding F0). Throwaway — `main` keeps only the decision.

Run: `bun run skills/browser-use/src/prototypes/2026-08-01-token-doctor-self-heal/doctor-spike.ts`

## Verdicts

| Q | Claim | Verdict |
|---|---|---|
| Q1 | A doctor renders **every** gate state without crashing, incl. the `create-credential-clean-profile` continuation that crashes the shipped CLI | **PASS** ✅ |
| Q2 | Profile-gate self-heal drives the real supervisor status to **5/5 green** (and a dirty profile blocks — flip shown) | **PASS** ✅ |
| Q3 | `reload` mechanic (op → `install-token --stdin --replace`) | **PASS (sketch)** — mechanic already shipped; only the stored item-ref is missing |

## Falsification fired (the receipt is meaningful)

- **Q1a shipped `bun run browser-use auth status --json` on the current state → CRASH** (`CliRuntimeContractError: ... unsafe runtime-contract text: credential`). The bug is real and reproduced. Against that, **Q1b the doctor renders the same real state cleanly** (4 OK + 1 XX with a repair line). Flip: shipped ❌ crash → doctor ✅ render.
- **Q2 flip:** a scratch profile with password-manager/autofill/sync ON → `profile_policy: blocked (profile-policy-unproven)`; a scratch profile with them OFF → `profile_policy: ready` and **all 5 gates green**. The proof isn't vacuous — the dirty case actually blocks.

## Key findings for the real feature

- **F0 — the doctor + self-heal are 100% browser-free.** The `profile_policy` gate (`main.swift:624 profilePolicyCheck`) is a pure filesystem/JSON check: a `0700` profile dir whose `Default/Preferences` JSON has `credentials_enable_service:false`, `profile.password_manager_enabled:false`, `autofill.profile_enabled:false`, `autofill.credit_card_enabled:false`, `sync.requested:false`, and an absent-or-empty `Default/Login Data`. **No Chrome launch, no CDP.** So the whole doctor/self-heal ships without any browser dependency — only the eventual live login needs Chrome. (This also means `auth doctor --fix profile` can *write* a clean Preferences file deterministically.)
- **F1 — the crash cause is the repair word itself.** `create-credential-clean-profile` contains "credential", which the facade's `RUNTIME_CONTRACT_UNSAFE_TEXT_PATTERNS` (`runtime/cli-command-facade/src/runtime-text-safety.ts:20`) bans from `error.message`; `emitCliError` (`skills/browser-use/src/browser-use.ts:~5656`) throws. **The doctor renders the repair as normal stdout, never an `error.message`, so it's immune.** The production fix has two independent parts: (a) keep the banned term out of `error.message` (carry the continuation id in a `data` field, per the U5 precedent), and (b) route status through a doctor renderer, not the error-emit path.
- **F2 — status envelope shape is stable and rich enough to drive the doctor.** `{ state, ok, lane:{selected,status}, checks:{token_file,op,token,vault_scope,profile_policy → {status, cause?, visible_count?}}, next_action }`. A per-cause `REPAIR` map (proven in the spike) gives a one-command fix line for every red gate.
- **F3 — reload is one wrapper away.** `install-token --stdin --replace` already exists and atomically swaps (proven when Nathan reloaded this morning). `auth reload` = persist the `op://vault/item` reference at install time, then `op read <ref> | install-token --stdin --replace`. No new custody surface.
- **F4 — expiry surfacing is the one genuinely hard bit.** `op` exposes no token-expiry read (only `op service-account ratelimit`). Proactive "expires in N days" needs either the token's own expiry claim (if present) or a stored "last-validated-at" + periodic validity ping. Defer or scope explicitly.

## What the real feature needs to wire up (feeds the plan)

1. **Fix the crash** (F1): banned term out of `error.message` → `data`; add the doctor renderer as the status surface. (`/diagnosing-bugs` owns the crash; the doctor is the feature.)
2. **`auth doctor`** — per-gate green/red + one-command repair per red (F2), rendered as stdout.
3. **`auth doctor --fix profile`** — deterministically write a credential-clean `Default/Preferences` into the profile dir (F0), then re-check → green.
4. **`auth reload`** — stored item-ref + `install-token --stdin --replace` wrapper (F3).
5. **Expiry warning** — scoped per F4 (heartbeat or token claim), or explicitly deferred.

## Graduation

Post-build accept receipt: the self-healing-doctor mechanic is **proven** end-to-end (render + profile self-heal to 5/5 green) against the real supervisor, browser-free. Spike captured under `prototypes/2026-08-01-token-doctor-self-heal/`. Next: fold into a `ce-plan` DX plan (collaborative with Nathan); the crash (F1) is a `diagnosing-bugs` item that the plan depends on.
