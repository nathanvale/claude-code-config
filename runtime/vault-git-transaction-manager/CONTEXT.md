# Vault Git Transaction Manager

This context defines durable language for Vault Git activation and transaction recovery.

## Language

**Activation Configuration**:
One stable non-secret host handle plus host-local paths required to resolve the dedicated repository-scoped SSH identity and reviewed known-hosts evidence before live activation validation. The OS hostname is not durable identity.
_Avoid_: activation admission, credentials, SSH secrets

**Activation Restriction**:
Public semantic result that denies a Vault write and names its cause, preserved safe state, and one next action.
_Avoid_: activation error, generic blocker, permission failure

**Owner Pause Mode**:
Explicit host-local operator selection that stops new Transaction Manager use and routes the configured vault through the skill-owned Direct Git Mode. It freezes receipts and ledger evidence for later reconciliation; it is not transaction repair, activation revocation, or an automatic fallback.
_Avoid_: disabled safety, missing CLI, raw-Git bypass, activation blocked

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

**Task Lifecycle**:
The single owner that drives a Completion Task through its launch, acknowledgement, and terminal states, and that holds the at-most-one-owner and Attempt-fencing invariants. Distinct from the Completion Task (the intent) and the Attempt (one execution): the Lifecycle is who advances them. All process, spawn, and clock effects reach it through one injected runtime seam, so its state decisions are effect-free.
_Avoid_: worker loop, background runner, CLI orchestration

**Launch Acknowledgement Window**:
The bounded interval within which a launched Attempt must be acknowledged before the Lifecycle treats the launch as expired. One named budget governs every site that opens, persists, or waits on that interval. Distinct from the heartbeat-staleness budget, which governs an already-acknowledged Attempt.
_Avoid_: timeout, retry delay, grace period

**Durable Exclusive Publish**:
The crash-safe sequence that publishes bytes to a path so a torn write is never observed: staged temp, file sync, exclusive link or overwrite, directory sync. The primitive owns the ordering only; the caller supplies the race policy for a pre-existing destination (refuse, or yield as the losing writer).
_Avoid_: atomic write, save, commit
