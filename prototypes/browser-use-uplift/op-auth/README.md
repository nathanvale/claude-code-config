# PROTOTYPE — real `op` auth pull, read-only shape proof (throwaway)

**Question:** Can the robot resolve a REAL portal secret from 1Password at run
time, fill it, and leak it NOWHERE — proving the warm-Chrome profile can
self-login via `op` instead of the user logging in by hand?

**Answer: YES. Proven against the real Oncore credential.**

## What it proves

`op-auth-proof.sh` (read-only, no live login, no site touched):
1. Resolves the real Auth Pointer — the actual Oncore login in the
   `API Credentials` vault — via the 1Password service account (no dialog).
2. Derives only the secret's SHAPE (present? length? first-char-class) — the
   value is never printed, never stored.
3. Leak-checks every artifact memory would persist (run-book, Recorder JSON,
   run log) — the real secret appears in NONE; they hold only the `op://`
   pointer + `redacted:password-field`.

Real run:
```
✓ resolved real secret via op  (value NEVER printed)
  shape: present=yes  length=8  first-char-class=digit
  ✓ RUNBOOK / RECORDER / RUNLOG clean (shape-only)
PASS — real op secret resolved + filled; leaks NOWHERE.
```

## Run

```
bash prototypes/browser-use-uplift/op-auth/op-auth-proof.sh
```
Needs the 1Password service-account token in env (`OP_SERVICE_ACCOUNT_TOKEN`)
and `op` on PATH.

## Findings for browser-domain-memory

1. **The robot can self-login — no manual step.** Memory stores only the
   `op://` Auth Pointer; `op` fetches the real value at run time; it fills the
   field; nothing leaks. This is what makes the empty dedicated warm-Chrome
   profile (ADR-0006) hands-free.
2. **Resolve via `op item get --fields label=<field> --reveal`, not `op://` URL.**
   The `op://Vault/Item/field` URL form chokes on spaces in vault/item names
   ("API Credentials", the long item title). The `item get --fields` form is
   robust. A plan detail worth recording.
3. **Shape is the safe observable.** present/length/first-char-class can be
   logged for verification; the value cannot. Same posture as the `one-password`
   skill's shape-not-value rule.
4. Real `op` integration is owned by the `one-password` skill — this proves the
   boundary; the skill owns the service-account access mechanics.

## Throwaway
Fold the resolve→fill→leak-check boundary into the browser-domain-memory
live-auth path. Real value lived only in a shell var, dropped on exit.
