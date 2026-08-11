# Vault Git Transaction Manager

This context defines durable language for Vault Git activation and transaction recovery.

## Language

**Activation Configuration**:
Non-secret host-local paths required to resolve the dedicated repository-scoped SSH identity and reviewed known-hosts evidence before live activation validation.
_Avoid_: activation admission, credentials, SSH secrets

**Activation Restriction**:
Public semantic result that denies a Vault write and names its cause, preserved safe state, and one next action.
_Avoid_: activation error, generic blocker, permission failure

**Doctor Continuation**:
External state change, inspection, or terminal action selected by Doctor after read-only diagnosis. Doctor itself is never its own immediate continuation.
_Avoid_: retry Doctor, diagnostic loop
