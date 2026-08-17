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

**Vault Git Host Enrollment**:
Setup-owned domain behind explicit `setup sync --domain vault-git` that validates private SSH prerequisites, persists Activation Configuration, installs the Installed Runtime, and owns Runtime Selection and rollback.
_Avoid_: vault-git self-install, ad hoc PATH setup, generic bins projection

**Installed Runtime**:
One immutable compiled Vault Git executable stored side by side under the XDG data root at its own SHA-256 content address, built only from clean merged source.
_Avoid_: source-linked bin, dev checkout execution

**Runtime Selection**:
The atomic managed-symlink choice of exactly one Installed Runtime. Selection and rollback refuse during active or uncertain vault work and invalidate prior activation, so fresh Prepared Evidence and human Activation Review are required.
_Avoid_: first-PATH-hit lookup, silent upgrade

**Host Handle**:
One generated stable non-secret host identifier preserved across re-enrollment inside Activation Configuration. The OS hostname is not durable identity.
_Avoid_: hostname, machine serial

**Doctor Continuation**:
External state change, inspection, or terminal action selected by Doctor after read-only diagnosis. Doctor itself is never its own immediate continuation.
_Avoid_: retry Doctor, diagnostic loop

**Doctor Task**:
Owner-private durable lifecycle for one Background Doctor diagnosis, admitted, observed within a bounded window, and terminalized apart from any Completion Task, Vault Transaction, or Transaction Receipt. It grants no vault, Git, lease, repair, or activation authority; only its own owner-private task evidence may change.
_Avoid_: doctor job, background process, completion task, worker queue

**Doctor Finding**:
Closed evidence-backed classification of what one Doctor diagnosis proved, selecting exactly one Doctor Continuation. It is neither a Blocker nor a Validation Failure Class and grants no Deterministic Repair authority.
_Avoid_: error code, blocker, repair decision, diagnosis log

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

**Validation Candidate**:
One private disposable checkout composed from the exact Admitted Baseline plus frozen Owned Path bytes and Git file modes, held beneath the owner-private state root, where the vault's own check runs under the activation-bound runtime in an isolated scrubbed environment. The frozen bindings gate the later commit.
_Avoid_: temp clone, scratch worktree, checking the live worktree

**Validation Failure Class**:
Closed public classification of one Validation Candidate run: `candidate_setup`, `vault_content`, `stage_budget_exceeded` with its stage, or `candidate_cleanup`. Only `vault_content` may offer Deterministic Repair; cleanup owns the class whenever it cannot settle or remove its record.
_Avoid_: check failed, generic timeout, collapsed error code

**Validation Stage Budget**:
One product-owned monotonic duration budget per candidate stage (`candidate_setup`, `vault_check`, `candidate_cleanup`) that bounds even held-open work. No caller timeout flags; cleanup always draws a fresh budget after earlier stages exhaust theirs.
_Avoid_: caller timeout flag, shared deadline

**Candidate Residue**:
Bounded owner-private record durably published before its candidate is built, binding candidate path, owning transaction, stage, and age so an abandoned candidate is never ownerless. Later Janitor routing may remove residue only after age and active-ownership checks.
_Avoid_: orphaned clone, leftover temp directory, diagnostic log
