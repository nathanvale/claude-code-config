---
status: accepted
date: 2026-08-16
issue: nathanvale/claude-code-config#390
---

# Executable Next Safe Actions, Installed Host Enrollment, and the installed-state journey

Vault Git protects Canonical Vault State, but first-host setup and failure
recovery are still too hard to follow without private implementation knowledge.
A fresh user or agent can receive a stable action ID and a summary yet still have
to guess the owning command, its arguments, the human gate, or the safe recovery
route. The daily-driver path also depends on a source-linked executable and
ambient activation environment variables, so a source edit, pull, missing
variable, or `PATH` mismatch can invalidate Activation Admission or select the
wrong runtime. Background Doctor is durable and authority-free, but its public
continuation is not mechanically reliable: a Doctor Task can emit a generic
inspection action whose real command differs from [Completion Task] inspection,
and completion validation still lives inside the broad Git adapter. Setup
projects source-linked bins and owns no Vault Git Host Enrollment for an
immutable Installed Runtime or private [Activation Configuration].

This decision records the accepted contract of issue
[#390](https://github.com/nathanvale/claude-code-config/issues/390) — the settled
implementation authority for the units that follow. It is a decision artifact,
not an execution script: it fixes the vocabulary, the closed recovery tables, the
`U1`–`U6` order, and the one installed-state acceptance journey so those cannot
drift while the units land. It does not change the vault operating mode; [Owner
Pause Mode] stays active until the owner activates.

## Decision

Deliver one understandable path from a fresh laptop state to an activated
Installed Runtime, one recoverable failure, and one real Vault Transaction.
Every nonterminal public result must identify exactly what can happen next
without granting authority, exposing private data, or requiring the caller to
infer command syntax.

### One deep Next Safe Action module (U1)

Create one package-owned deep Next Safe Action module that turns current
evidence into exactly one typed continuation:

- `invoke`: one logical command plus a sanitized argv vector that can run now.
- `needs_input`: one resume action ID plus ordered owner-defined input
  descriptors, with no values or placeholder argv.
- `needs_human`: an agent-terminal handoff, either an exact human command
  (`handoff_kind: command`) or a named external prerequisite owner and required
  condition (`handoff_kind: external_prerequisite`).
- `none`: a terminal stop.

Keep the existing action ID and summary fields for compatibility. Make
`data.next_action` the authoritative discriminated union in the versioned
lifecycle, activation, and discovery contracts; increment those schema versions
while retaining a compatibility projection for existing action-ID and summary
consumers. Derive facade runtime actions, the compatibility envelope
`continuation: {next_action_id}`, and human text from that one projection;
constructors reject divergence and omit facade runtime actions for terminal
`none`. Treat `operator_required` as a blocker and result posture, never an
action ID. Readers accept legacy persisted task actions shaped as
`{id, summary}` and project their semantic action ID; new writes persist the
semantic action ID only. Public results reconstruct complete continuations from
current durable state.

Next Safe Action owns two input lanes:

- A **pure public-input binder** that validates descriptor IDs and returns a
  sanitized public `invoke` continuation. It rejects missing, extra, duplicate,
  or unknown field IDs.
- A **private Setup binder** that accepts private values out of band, validates
  them against the referenced input contract, and owns the Setup process spawn.
  It derives the exact public Setup action argv from Setup discovery, appends
  `--input-stdin <contract-id>`, streams private values through child stdin, and
  returns the sanitized Setup result. Its internal bound invocation is never part
  of the public union. Private values never enter argv, process listings,
  discovery, JSON, plain rendering, diagnostics, receipts, or public results.

Represent invocable continuations as one logical executable plus an argv array;
never emit a shell string as the machine contract. Permit logical executable
owners `vault-git` and `setup`. Resolve `vault-git` only through Setup's managed
Runtime Selection and verify its real path and digest before spawn; resolve
`setup` through its installed owner; never use first-`PATH`-hit lookup for
execution. Permitted selectors are public Task ID, Transaction ID, evidence
reference, and a validated Repair ID sourced only from the admitted Doctor
Finding. Never place Transaction Capability bytes, owner capability paths,
[Activation Configuration] paths, auth URLs, raw child output, or raw Git output
into continuation arguments. Split task inspection into `inspect_completion_task`
and `inspect_doctor_task`; project legacy `inspect_status` contextually by Task
kind while loading task state without rewriting history. Missing selectors or
incomplete mappings fail closed as `continuation_unavailable`,
`operator_required`, and terminal `none`. Keep Branch Station the branch
expectation owner and validate every fully projected action against the Next
Safe Action catalog (kind, owner, effects, selector completeness). Do not create
a shared routing framework or move package recovery semantics into CLI Command
Facade.

### Setup-owned Host Enrollment and immutable Installed Runtime (U2)

Add one Setup-owned Vault Git Host Enrollment module behind the existing
Setup CLI. Extend Setup with the `vault-git` domain for status, preview, and
apply. Plain `setup sync` projects Vault Git domain status only; install,
Runtime Selection, rollback, and [Activation Configuration] writes require
explicit `--domain vault-git`. Store [Activation Configuration] at the XDG
configuration root with owner-only directory and file permissions; generate and
preserve one Host Handle; store only canonical absolute paths, never secret
contents.

Accept explicit first-enrollment SSH identity, public-key, and known-hosts path
inputs through the private stdin lane. Require an already-provisioned dedicated
repository SSH identity, matching public key, and reviewed known-hosts file.
Missing prerequisites return `needs_human`, name the external SSH owner, explain
each file, and perform no mutation. Resolve accepted paths to existing canonical
absolute paths before persistence.

Build the Installed Runtime only from clean merged source. Compute the runtime
content address from SHA-256 of the final compiled executable bytes; store
runtimes side by side under the XDG data root. Atomically select one runtime
through the managed Vault Git symlink; in the same change, remove the
source-linked `vault-git` projection from the generic Setup `bins` domain and
update its pinned test, making the Vault Git domain the sole managed-selector
owner with real-path proof that the selector stays inside the Installed Runtime
root and matches the directory digest. Retain the prior runtime for rollback.
Expose rollback as `setup sync --domain vault-git --rollback --check` (preview)
and the same command without `--check` (apply); report selected and prior public
runtime references; a missing prior runtime fails closed. Allow installation
during active work but refuse Runtime Selection and rollback during active or
uncertain work. Require fresh Prepared Evidence and Activation Review after
every selection or rollback. Replace ambient activation environment variables
with persisted [Activation Configuration] for daily-driver execution; retain
`VAULT_GIT_HOST`, `VAULT_GIT_SSH_IDENTITY_FILE_PATH`,
`VAULT_GIT_SSH_PUBLIC_KEY_PATH`, and `VAULT_GIT_SSH_KNOWN_HOSTS_PATH` for fixture
compatibility only; production enrollment and daily-driver execution leave them
unset.

### Deep Validation Candidate (U3)

Deepen the existing Vault Check seam with one Validation Candidate module;
keep its process and filesystem adapters internal. Compose candidates from the
exact Admitted Baseline and frozen Owned Paths; bind owned bytes and Git file
mode to the subsequent commit. Refuse symlink or ancestor escape before candidate
overlay mutation. Use the activation-bound runtime and an isolated, scrubbed
environment for Vault Check. Use independent product-owned monotonic duration
budgets for candidate setup, Vault Check, and cleanup, derived from
production-shaped measurements, exposing no caller timeout flags, and preserving
cleanup time when earlier stages consume their budgets. Emit stable Validation
Failure Classes for candidate setup, vault content, stage budget exceeded, and
candidate cleanup; carry `failure_class` plus `stage: candidate_setup |
vault_check | candidate_cleanup` when stage-specific; route every class through
Doctor. Normal completion removes its Validation Candidate; a crashed one
becomes Candidate Residue with bounded diagnostic metadata rather than a full
clone.

### Deep Doctor (U4)

Deepen Doctor around the existing Doctor Task Lifecycle, keeping the lifecycle
and Doctor diagnosis as internal seams. Move foreground admission, acknowledgement
handling, Doctor Task inspection, worker execution, stale reconciliation,
terminal projection, and [Doctor Continuation] mapping out of the CLI adapter,
preserving owner-private progress writes and the authority-free posture. Doctor
may make bounded owner-private diagnostic and reconciliation writes; it never
mutates Canonical Vault State, remote refs, leases, transaction authority,
repair authority, or activation. Map `inspect_completion_task` to
`vault-git status --task-id <id> --json` and `inspect_doctor_task` to
`vault-git doctor --task-id <id> --json`. Admitted, launching, and running Doctor
Tasks emit `inspect_doctor_task`; a terminal Doctor Task never emits `run_doctor`
and, after owner-private reconciliation, continues classification inside the same
task to one non-Doctor continuation, `needs_input`, `needs_human`, or terminal
`none`. Stalled or exhausted lifecycle evidence maps to `continuation_unavailable`,
`operator_required`, and terminal `none`.

### Fenced Repair Promotion (U5)

Permit Deterministic Repair only after a proven vault-content Doctor Finding.
Extend the explicit Repair surface with `apply-vault-content`: it consumes the
exact Doctor Finding Repair ID, requires matching Checker Admission and
Checker Closure, invokes only the admitted checker repair-registry entry inside
a Validation Candidate, and re-runs Vault Check. After the repaired candidate
passes, freeze an output manifest of exact Owned Path bytes and modes.
Revalidate Activation Admission, transaction capability, Transaction Receipt
revision, Remote Lease generation, baseline head, Unrelated State, and every
Owned Path input hash and mode before canonical mutation. Persist a
repair-promotion intent binding the Repair ID, receipt revision, input hashes
and modes, and verified output hashes and modes; promote only exact Owned Paths
through compare-and-swap writes with durable per-path checkpoints; refuse if any
intent input hash or mode changed. After all paths settle, persist
repair-promotion completion and return the transaction to writing; the next
completion consumes and revalidates that binding before creating a fresh
Validation Candidate. On interrupted or partial promotion, never rerun the
checker repair automatically — use the closed recovery mapping below. Only exact
Owned Path worktree bytes and modes are mutable under transaction authority or
fenced Repair Promotion before close; Unrelated State, index, local refs,
object database, and remote refs remain unchanged until their owned close phase.

### Always-present Activation Home and the journey (U6)

Extend the existing Activation Front Door into an always-present Activation
Home rather than a peer seam; preserve the explicit `activation inspect` surface
and the bare `activation` alias. Report ordered Enrollment Gates, protected
state, and exactly one Next Safe Action. Reuse `activation prepare` as
First-Change Rehearsal (no second rehearsal command); it reports
`Nothing changed.`. Keep human Activate and Defer decisions inside Activation
Review, which renders a bounded sanitized summary of evidence age, selected
runtime digest and version, source revision, repository and remote identity,
aligned-main state, Checker Closure, what Activate changes, and what Defer
preserves; it offers only Activate or Defer; default, EOF, interrupt, and
`--no-input` never admit; it revalidates after rendering and before recording the
choice, rejecting stale Prepared Evidence.

## Closed recovery tables

These tables are the contract. Every result maps to exactly one executable
continuation, one named input contract, one human-owned prerequisite, or a
fail-closed stop. They are reproduced from the issue so the units cannot silently
re-route.

### Stale-Lease Takeover (U4)

| Takeover evidence | Action ID | Continuation |
| --- | --- | --- |
| Reconcilable Host Quarantine evidence | `reconcile_quarantine` | `invoke`: `vault-git repair reconcile-quarantine --transaction-id <id> --json` |
| Burned or missing Takeover Token after Host Quarantine is reconciled | `reattest_stale_lease_takeover` | `needs_human`: external owner `vault_git_operator`, condition `stale_lease_takeover_reattested` |

### Validation route matrix (U3/U4)

Setup, budget, and cleanup failures never emit Deterministic Repair.

| Failure evidence | Action ID | Continuation |
| --- | --- | --- |
| `candidate_setup` with a proven Installed Runtime or Activation Configuration defect and complete stored inputs | `preview_host_enrollment_repair` | `invoke`: `setup sync --domain vault-git --check --json` |
| `candidate_setup` with missing private enrollment inputs | `provide_host_enrollment_inputs` | `needs_input`: Setup's Host Enrollment input contract |
| `candidate_setup` with absent external SSH prerequisites | `provision_repository_ssh` | `needs_human`: external owner `repository_ssh_owner`, condition `dedicated_identity_ready` |
| `candidate_setup` with a proven transaction or candidate-integrity defect | `escalate_validation_evidence` | `needs_human`: external owner `vault_git_operator`, condition `candidate_integrity_reconciled` |
| `vault_content` with deterministic evidence and an admitted checker repair | `apply_vault_content_repair` | `invoke`: `vault-git repair apply-vault-content --transaction-id <id> --repair-id <id> --json`; the existing private-launch owner loads capability bytes and revalidates every fence |
| `vault_content` without deterministic evidence or an admitted repair | `escalate_validation_evidence` | `needs_human`: external owner `vault_git_operator`, condition `deterministic_content_repair_available` |
| `stage_budget_exceeded` at `candidate_setup` or `vault_check` | `diagnose_validation_budget` | `needs_human`: external owner `vault_git_performance_owner`, condition `validation_stage_budget_diagnosed` with stage metadata |
| `candidate_cleanup` or cleanup-budget failure with active owner | `inspect_completion_task` | `invoke`: `vault-git status --task-id <id> --json` |
| `candidate_cleanup` or cleanup-budget failure with old proven-unowned residue | `run_janitor` | `invoke`: `vault-git janitor --json` |
| `candidate_cleanup` or cleanup-budget failure with young proven-unowned residue | `none` | terminal `none` with `eligible_after` and package-owned Janitor eligibility for the next observation; no scheduler is implied |
| `candidate_cleanup` or cleanup-budget failure with absent or already removed residue | `none` | terminal `none` |
| Any validation failure with insufficient, conflicting, or unknown evidence, including residue ownership | `escalate_validation_evidence` | `needs_human`: external owner `vault_git_operator`, condition `validation_evidence_required` |
| Unknown failure class, stage, action, or selector | `none` | `continuation_unavailable`, `operator_required`, terminal `none` |

### Interrupted Repair Promotion (U5)

Never rerun the checker repair automatically.

| Promotion evidence | Action ID | Continuation |
| --- | --- | --- |
| Missing or unreadable transaction capability | `restore_transaction_capability` | `needs_human`: external owner `vault_git_operator`, condition `transaction_owner_capability_available` |
| Consistent partial checkpoints and unchanged fences | `resume_vault_content_promotion` | `invoke`: `vault-git repair resume-promotion --transaction-id <id> --repair-id <id> --json`; resume only the frozen output manifest |
| Promotion complete but transaction not yet returned to writing | `resume_repaired_transaction` | `invoke`: `vault-git repair resume --transaction-id <id> --json`; perform only interrupted-attempt re-entry |
| With readable capability, inconsistent checkpoint, manifest, intent input hash or mode, Activation Admission, lease, or other fence evidence | `reconcile_repair_promotion` | `needs_human`: external owner `vault_git_operator`, condition `repair_promotion_reconciliation_required` |

An absent Repair Promotion intent is not an interrupted promotion. Doctor
reclassifies the evidence through the closed validation matrix, an abandoned
candidate becomes Candidate Residue, and only fresh deterministic evidence may
offer `apply_vault_content_repair` again; this is a new evidence-driven offer,
never an automatic rerun. Keep `repair resume` exclusively for interrupted-attempt
re-entry; it never claims to modify invalid content.

### Unknown Publication Outcome (U4/U5)

One route per evidence class; never emit same-input publication retry from unknown
evidence.

| Publication evidence | Action ID | Continuation |
| --- | --- | --- |
| Remotely closed | `close_verified_publication` | `invoke`: `vault-git repair close-verified --transaction-id <id> --json` |
| Proven not published, origin-host and all fences intact | `retry_proven_unpublished` | `invoke`: `vault-git repair retry-push --transaction-id <id> --json` |
| Unavailable evidence | `obtain_remote_evidence` | `needs_human`: `vault_git_operator`, condition `remote_evidence_available` |
| Conflicting evidence | `resolve_publication_conflict` | `needs_human`: `vault_git_operator`, condition `publication_conflict_resolved` |
| Contract breach | `restore_remote_contract` | `needs_human`: `vault_git_operator`, condition `remote_contract_restored` |
| Missing or invalid projection data | `none` | `continuation_unavailable`, `operator_required`, terminal `none` |

### Acyclic recovery invariant

The terminal diagnosis and recovery graph is acyclic. Only nonterminal Completion
Task and Doctor Task observation cycles are permitted. Every inspection result
carries exact task revision or launch generation, `poll_after`, and a
package-owned observation expiry; unchanged work may repeat inspection only within
that bound. At expiry, lifecycle reconciliation produces a terminal lost/unknown
or human-owned result. Terminal tasks never return to inspection. Validation
evidence that is insufficient, conflicting, over budget, or missing an admitted
repair ends in a named human prerequisite; it never emits Doctor, Preview, or
Repair as a no-progress recovery loop. Janitor refusal never points back to
Janitor.

## Installed-state acceptance journey

Prove the complete journey through one public-process acceptance seam, driving the
continuation state machine rather than hard-coding or inferring commands:

> fresh HOME/XDG + installed Setup only → Vault Git Host Enrollment → selected
> Installed Runtime → Activation Home → First-Change Rehearsal → human
> Activation Review → Vault Transaction → injected vault-content failure →
> Doctor Task → emitted [Doctor Continuation] → Deterministic Repair → Atomic
> Close

The journey supplies Vault Event, Owned Paths, and commit summary through public
field IDs; supplies private fixture inputs through the Setup binder's stdin lane;
resumes from sanitized results; executes every public `invoke` continuation; and
sends command handoffs to a separate interactive PTY lane. External prerequisites
stop at their named owner and condition. `Installed Setup` means the projected
Setup bin from the checkout; the source-execution prohibition begins with the
first Vault Git invocation and applies only to Vault Git. It is a required
path-filtered macOS pull-request gate for relevant Setup and Vault Git changes,
and is repeated against the exact selected Installed Runtime head before live
activation.

## Implementation order

Land the units serially in this order; each is a complex main-direct commit that
passes the exact-final-diff code review before landing.

1. `U1` — Next Safe Action as the single semantic continuation owner.
2. `U2` — Setup-owned Vault Git Host Enrollment, immutable Installed
   Runtime, selection, rollback, and the generic `bins`-domain handoff.
3. `U3` — deep Validation Candidate: activation-bound runtime, isolated
   environment, bytes and modes, stage budgets, failure classes, cleanup, and
   Candidate Residue.
4. `U4` — deep Doctor: Doctor Task Lifecycle and the closed recovery routes,
   including interrupted Stale-Lease Takeover.
5. `U5` — `apply-vault-content` and fenced Repair Promotion with every crash
   recovery route.
6. `U6` — Activation Home and the fresh installed-state journey.

## Scope boundaries

Out of scope: the separate Background Preflight product; automatic activation,
defer, revocation, or human review by an agent; automatic execution of Next Safe
Actions by Vault Git itself; a generic job/queue/workflow/routing/continuation
framework; moving Vault Git domain semantics into CLI Command Facade; creating or
trusting SSH keys or known-hosts content automatically; Mac Mini enrollment or
cross-host activation transfer; three-unfamiliar-human comprehension
qualification; general support export design; automatic retry after unknown
publication or unknown worker outcome; removing existing full crash, stress, live,
or release qualification before replacement ownership is proven; and the five-write
two-day soak itself — this work makes the product ready to begin it.

## Consequences

- The units land against a fixed vocabulary and fixed recovery tables, so a unit
  cannot quietly re-route a failure class or invent an action ID. New vocabulary
  above (`Next Safe Action`, `Installed Runtime`, `Runtime Selection`, `Host
  Handle`, `Vault Git Host Enrollment`, `Validation Candidate`, `Candidate
  Residue`, `Validation Failure Class`, `Doctor Task`, `Doctor Finding`, `Repair
  Promotion`, `Repair ID`, `Enrollment Gate`, `Activation Home`, `First-Change
  Rehearsal`) is promoted to `CONTEXT.md` by the unit that first owns it.
- The four terminal boundaries `testing-patterns.md` already names as unproved —
  known-hosts content trust, hosted macOS behavior, installed activation, and the
  daily-driver soak — are the exact frontier this decision advances. Installed
  activation and the five-write two-day soak remain owner-owned terminal gates
  after the units land; this decision does not close them and does not change the
  [Owner Pause Mode] state.
- Existing activation trust, Prepared Evidence, Activation Admission, Remote
  Lease, Transaction Receipt, Atomic Close, and Deterministic Repair
  contracts remain authoritative. Full crash, stress, live, and release
  qualification lanes are retained until replacement ownership is hosted and
  proven.

[Owner Pause Mode]: ../../CONTEXT.md
[Doctor Continuation]: ../../CONTEXT.md
[Completion Task]: ../../CONTEXT.md
[Task Lifecycle]: ../../CONTEXT.md
[Activation Configuration]: ../../CONTEXT.md
