# Vault Git Transaction Manager

This context defines durable language for Vault Git activation and transaction recovery.

## Language

**Activation Configuration**:
One stable non-secret host handle plus host-local paths required to resolve the dedicated repository-scoped SSH identity and reviewed known-hosts evidence before live activation validation. The OS hostname is not durable identity.
_Avoid_: activation admission, credentials, SSH secrets

**Activation Restriction**:
Public semantic result that denies a Vault write and names its cause, preserved safe state, and one next action.
_Avoid_: activation error, generic blocker, permission failure

**Doctor Continuation**:
External state change, inspection, or terminal action selected by Doctor after read-only diagnosis. Doctor itself is never its own immediate continuation.
_Avoid_: retry Doctor, diagnostic loop

**Completion Task**:
Stable receipt-scoped completion intent exposed by one Task ID. Explicit repair preserves the Task while creating a new Attempt.
_Avoid_: worker process, retry job

**Attempt**:
One explicitly authorized completion execution within a Completion Task. Repair increments the Attempt number; bounded pre-ack process replacement only increments `launchAttempt`.
_Avoid_: automatic retry, launch attempt

**Repair Authorization**:
Single-use private evidence created by an approved `repair resume`. It permits the next identical `complete` to create one fresh Attempt and never grants transaction authority itself.
_Avoid_: retry token, capability, lease
