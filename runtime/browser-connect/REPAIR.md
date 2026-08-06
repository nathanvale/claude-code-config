# Browser Connect Repair Manual

Action manual for `@side-quest/browser-connect` recovery. One versioned
heading per catalogue repair action. `src/repair-path.ts` owns action
selection and emits public URLs ending in `#v1-<action_id>`; this file owns
the matching procedures.

## Versioning And Release

- Headings are append-only and versioned: `## v1-<action_id>`.
- A binary may emit only URLs whose matching heading exists on main. Publish
  the heading before releasing the binary that emits it.
- An incompatible procedure change mints a new version heading (for example
  `v2-install_adapter`); never rewrite the meaning of a shipped heading.

## Reading This Manual

- Commands live only in this manual. Envelope summaries stay prose-safe and
  never carry commands.
- Package names, pins, install scopes, install argv, and safe transitions are
  owned by the Adapter Definitions in `src/adapters/`. This manual references
  those definition fields; it never restates their values as policy.
- Placeholders name their source. `<adapter_id>` is a registered id from the
  Adapter Definition registry (`src/adapters/registry.ts`).
  `<suggested_port>` is the typed `suggested_explicit_port.port` evidence
  field. `<run_id>` is the envelope run correlation. `<free_port>` is an
  operator-chosen free port. Concrete values in examples (ports such as
  `9321`, versions such as `1.2.3`) are illustrative placeholders only.
  Never substitute a value recovered from error prose.
- Command examples use the `browser-connect` bin. In repo-local environments
  run `bun run runtime/browser-connect/src/cli.ts` with the same arguments.
- Operator-owned procedures are decisions and external work; agents never
  execute them. Each names the evidence an operator needs first.
- Compatibility-only actions are marked; new policy never emits them as an
  outer continuation.

## v1-change_input

- Posture: automatic caller rerun or operator choice; also the closed legacy
  compatibility stop for usage, separator, and wrapped-command operator
  stages.
- Emitted from: `usage-invalid` (`usage_invalid`) and `adapter-unknown`
  (`unregistered_adapter`) failure stages; docs anchor for the
  `provide_corrected_input` operator choice family.
- Selected when: the typed cause proves a deterministic correction; for an
  unknown adapter, exactly one trusted registered replacement id exists.
- Required context: `deterministic_correction` or
  `deterministic_replacement_adapter_id` (a trusted registry id) from the
  typed repair context.
- Owner: caller rerun.
- Side effects: `check`.
- Same-input retry: safe; one automatic attempt, then operator.
- Success evidence: the fresh invocation parses and reaches its next gate.
- Stop and handoff: usage-invalid with no deterministic correction hands off
  to an operator stage with `provide_corrected_input`
  (`no_synthesized_caller_input`). Adapter-unknown with no single trusted
  replacement hands off to an operator stage offering
  `choose_registered_adapter:<adapter_id>` choices per trusted candidate
  (`no_synthesized_caller_input`); documented under `v1-select_compatible_route`.
- Follow-up proof: the rerun's own parse and command gates.

### Procedure

Automatic: rerun the same command with the corrected typed input. Replace
only the field the typed cause names; for `unregistered_adapter` use the
deterministic replacement id from the typed context.

Operator boundary (`provide_corrected_input`): when no deterministic
correction exists, the operator supplies corrected input against the rendered
help and the accepted usage reference. Evidence needed first: the typed usage
cause and `browser-connect <command> --help`. Policy never synthesizes
corrected input from error prose.

### Examples

Adapter example: a misspelled adapter operand with one trusted registered
replacement; rerun with the replacement id from the typed context.

```bash
browser-connect connect <adapter_id> --json
```

## v1-add_run_separator

- Posture: automatic caller rerun or operator choice.
- Emitted from: `run-missing-separator` failure stages (`separator_missing`,
  `wrapped_command_missing`) on the `run` surface; docs anchor for the
  `provide_wrapped_command` operator choice family.
- Selected when: the separator is missing and the parser's in-memory
  non-empty-command marker (`wrapped_command_present`) is true.
- Required context: the boolean `wrapped_command_present` marker only. The
  envelope never carries wrapped argv, arguments, environment values, or
  executable paths.
- Owner: caller rerun.
- Side effects: `check`.
- Same-input retry: safe; one automatic attempt, then operator.
- Success evidence: the rerun reaches the pre-exec connection gate.
- Stop and handoff: an empty or unknown wrapped command hands off to an
  operator stage with `provide_wrapped_command`
  (`no_synthesized_caller_input`).
- Follow-up proof: pre-exec proof, then the wrapped command's own exit
  passthrough.

### Procedure

Automatic: insert `--` between run options and the caller's own original
wrapped command, then rerun. The wrapped command stays caller-owned memory;
the envelope proves only that it was non-empty. Never reconstruct a wrapped
command from error prose.

Operator boundary (`provide_wrapped_command`): when the marker is false, the
operator supplies the intended wrapped command. Evidence needed first: the
parsed adapter id and the missing-command cause from the envelope.

### Examples

Run example: rerun with the separator; the wrapped command is the caller's
own original input, not a projected value.

```bash
browser-connect run <adapter_id> -- <your original wrapped command>
```

## v1-launch_agent_chrome

- Posture: automatic gateway action.
- Emitted from: `environment-absent` (`no_listener`) failure stages at
  repair-chain hop `0`.
- Selected when: warm-chrome reports `no_listener` and proves the explicit
  port free.
- Required context: `explicit_port_free: true` from the environment gateway
  evidence.
- Owner: gateway (the warm-chrome launch owner inside the same invocation).
- Side effects: `browser`, `write`.
- Same-input retry: not same-input safe; one launch attempt, then operator.
- Success evidence: the recheck verifies Agent Chrome on the same explicit
  port.
- Stop and handoff: any listener, a changed port, an unverified child, or an
  exhausted launch attempt stops the action and hands off to
  `inspect_diagnostics` (`no_process_destruction`,
  `no_unverified_listener_connection`).
- Follow-up proof: the owning invocation's environment recheck, then route
  and attachment gates.

### Procedure

Automatic: no caller step. The gateway launches on the requested explicit
port and rechecks the same port inside the owning invocation.

Environment repair by hand: safe environment recovery either re-proves the
environment or launches on a free explicit port through a fresh `--port`
invocation. Never free a port, terminate a listener, or touch an existing
browser from this manual; that work is external and operator-owned.

```bash
browser-connect connect <adapter_id> --port <free_port> --json
```

### Examples

Environment example: no listener on the requested port and the port proven
free; the invocation launches and rechecks itself. Re-prove by hand on a
chosen free port (illustrative port):

```bash
browser-connect check --port 9321 --json
```

## v1-inspect_listener

- Posture: terminal operator fallback (operator choice); also the closed
  legacy compatibility stop for foreign-listener operator stages.
- Emitted from: `foreign-listener` failure stages (occupied, foreign, or
  unverified listener) with no usable suggested port, and every hop-1
  foreign-listener failure; docs anchor for the `inspect_listener` operator
  choice family.
- Selected when: the listener is foreign, uninspectable, or ambiguous and no
  safe suggested port exists.
- Required context: none ingested by policy. Operator evidence: the explicit
  port, the warm-chrome reason, and the redacted listener evidence from the
  envelope.
- Owner: operator.
- Side effects: `check` (read-only diagnostics).
- Same-input retry: read-only inspection is safe to repeat; no automatic
  attempts.
- Success evidence: a fresh invocation proves the original or
  operator-selected explicit port after external remediation.
- Stop and handoff: never terminate a process from pid, port, basename, or
  prose; never emit a follow-on process action (`no_process_destruction`,
  `no_unverified_listener_connection`).
- Follow-up proof: fresh warm-chrome proof at the start of the next
  invocation.

### Procedure

Operator boundary: every remediation step is external to browser-connect.
No process-destructive step is listed here, ever.

1. Inspect read-only: warm-chrome diagnostics for the explicit port, then
   the listener's own process owner through tools the operator owns.
2. Remediate externally through that owner. browser-connect ingests no
   ownership claim, pid, process token, evidence file, or continuation
   receipt afterward; external completion is never reported back.
3. Return only through a fresh invocation on the original or an
   operator-selected explicit port. Any return starts with fresh warm-chrome
   proof.

### Examples

Environment example: an unverified listener holds the requested port; after
external remediation the operator re-proves the port fresh.

```bash
browser-connect check --port <port> --json
```

## v1-inspect_diagnostics

- Posture: operator fallback (operator choice); also the closed legacy
  compatibility stop for environment, launch, attachment, and unexpected
  failure classes, and the fail-closed default for unknown repair context.
- Emitted from: `environment-absent` after a stopped or exhausted launch,
  `launch-failed`, transient proof exhaustion, hop-1 environment failures,
  unsafe wrapped-executable identity, and `runtime-error-unexpected` stages;
  docs anchor for the `inspect_diagnostics` operator choice family.
- Selected when: runtime or environment evidence remains untyped after
  bounded checks.
- Required context: none ingested by policy. Operator evidence: the run
  correlation and the owning diagnostic surface named by the envelope.
- Owner: operator.
- Side effects: `check`.
- Same-input retry: read-only rerun is safe to repeat; no automatic attempts.
- Success evidence: a typed cause or a human diagnosis exists.
- Stop and handoff: diagnostics alone never authorize mutation
  (`no_mutation_from_diagnostics`); only a fresh typed cause selects the next
  repair.
- Follow-up proof: the next typed cause's own repair path.

### Procedure

Operator boundary: this is inspection, not repair. Rerun the owning read
surface with the same run correlation in diagnostic mode, then read the
fresh typed cause and follow its own heading.

```bash
browser-connect check --json --verbose --run-id <run_id>
```

`<run_id>` is the run correlation from the failing envelope.

### Examples

Environment example: launch stopped after its single attempt; re-read the
environment with correlation and diagnostics.

```bash
browser-connect check --json --verbose --run-id <run_id>
```

## v1-list_registered_adapters

Compatibility-only: new policy never emits this action as an outer
continuation; tests forbid it as `continuation.next_action_id`.

- Posture: compatibility-only.
- Emitted from: the legacy schema-1 `data.next_action_id` field only, as the
  closed non-mutating stop for adapter-class operator stages
  (`adapter-unknown`, `adapter-not-installed`, `route-incompatible`); never
  from new outer policy.
- Selected when: never by new policy; retained for released schema-1
  consumers.
- Required context: none.
- Owner: legacy discovery.
- Side effects: `read`.
- Same-input retry: safe; read-only.
- Success evidence: not applicable; retained for released consumers.
- Stop and handoff: tests forbid use as an outer continuation next action.
- Follow-up proof: none; follow the outer operator stage's choices instead.

### Procedure

Read the registered adapter ids from the read-only registry projection, then
follow the outer stage's operator choices.

```bash
browser-connect --json
```

### Examples

Adapter example: a schema-1 consumer resolves the legacy stop and lists
registered adapter ids read-only.

```bash
browser-connect --json
```

## v1-install_adapter

- Posture: automatic package action or operator-choice procedure.
- Emitted from: `adapter-not-installed` (`executable_absent`) failure stages;
  docs anchor for the `install_registered_adapter_manually:<adapter_id>`
  operator choice family.
- Selected when: the adapter executable is absent. Automatic posture requires
  complete isolated-install evidence: a supported recipe, canonical lock
  origins, full dependency integrity, and lifecycle scripts disabled. The
  manual choice requires complete trusted manual-install inputs: package
  identity, exact pin, user-owned scope, package owner, and this heading.
- Required context: `adapter_id` (trusted registry id) plus the
  `automatic_install.*` evidence booleans from the typed repair context.
- Owner: `repair-adapter` command; the sole package-mutation path.
- Side effects: `write` (facade affordance). The isolated installer reaches
  only the canonical registry origin; the manual operator choice declares
  direct `network`, `write`.
- Same-input retry: not same-input safe; one execute attempt, then operator.
- Success evidence: the repair command proves fresh exact-pin provenance,
  then the caller's original connect or run proves attachment.
- Stop and handoff: a missing isolated recipe, non-canonical lock origins,
  incomplete dependency integrity, or a lifecycle-script requirement stops
  automatic install; hand off to the manual choice when trusted inputs are
  complete, otherwise to `review_adapter_definition:<adapter_id>`. Automatic
  safety-gate failures never downgrade into agent-run package commands.
- Follow-up proof: a fresh provenance read, then the original connect or run.

### Procedure

Automatic, both registered adapters (`chrome-devtools-mcp`, `agent-browser`):

```bash
browser-connect repair-adapter <adapter_id> --check --json    # read-only preview
browser-connect repair-adapter <adapter_id> --execute --json  # sole package mutation
```

`--execute` runs the isolated installer non-interactively. Package identity,
pin, user-owned scope, install argv, and canonical registry come from the
Adapter Definition in `src/adapters/`, never from caller input or this
manual. It installs the adapter executable only; it never runs an
adapter-owned browser installer and never downloads Chrome for Testing.

Operator boundary (`install_registered_adapter_manually:<adapter_id>`): an
agent never executes this choice, and the choice never projects a command.
Evidence needed first: the registered adapter id, plus the exact package
identity, pin, user-owned scope, and package owner read from the Adapter
Definition.

1. Read the Adapter Definition for the package identity, pin, and scope.
2. Install at that exact pin, in the user-owned scope, in the operator's own
   package-manager session. Privilege escalation is out of scope for this
   procedure.
3. Verify: `browser-connect repair-adapter <adapter_id> --check --json`
   proves fresh exact-pin provenance.
4. Rerun the original connect or run.

### Examples

Adapter example: `agent-browser` absent with complete isolated-install
evidence.

```bash
browser-connect repair-adapter agent-browser --check --json
browser-connect repair-adapter agent-browser --execute --json
browser-connect connect agent-browser --json
```

## v1-select_compatible_route

Compatibility-only action: new outer policy and the legacy compatibility
selector never emit it; tests forbid both. This versioned heading also
carries the cross-adapter handoff procedure for the
`choose_registered_adapter:<adapter_id>` operator choice family.

- Posture: compatibility-only action; operator-choice procedure anchor for
  the cross-adapter handoff.
- Emitted from: released legacy discovery only; docs anchor for
  `choose_registered_adapter:<adapter_id>` choices on `adapter-unknown` and
  `route-incompatible` operator stages.
- Selected when: never by new or legacy compatibility policy. The handoff
  choice is offered after exhaustive same-adapter route selection, one
  choice per trusted registered candidate with an implemented compatible
  route.
- Required context: candidate ids come only from the Adapter Definition
  registry; caller-supplied or unregistered candidates produce no choice.
- Owner: legacy discovery (action); operator (handoff choice).
- Side effects: `read` (action). The handoff choice declares direct `check`,
  `network`, `browser`, `write`.
- Same-input retry: safe; read-only until the operator starts a fresh
  invocation.
- Success evidence: a fresh invocation with the chosen adapter passes route
  compatibility and attachment proof.
- Stop and handoff: never offered for caller-supplied, unregistered, or
  route-incompatible candidates; adapters never switch automatically
  (`no_adapter_fallback`). Stop when no trusted candidate exists.
- Follow-up proof: the fresh invocation's route compatibility and attachment
  gates.

### Procedure

Operator boundary (`choose_registered_adapter:<adapter_id>`): switching
adapters is an operator decision; policy never selects across adapters
automatically. Evidence needed first: the projected choices, each backed by
a trusted Adapter Definition declaring an implemented compatible route for
the verified environment.

1. Pick one projected choice; its `<adapter_id>` is a trusted registry id.
2. Start a fresh invocation with the chosen adapter.

```bash
browser-connect connect <adapter_id> --json
# or, for run surfaces
browser-connect run <adapter_id> -- <your original wrapped command>
```

### Examples

Adapter example: route incompatibility hands off to the other registered
adapter through a projected choice.

```bash
browser-connect connect chrome-devtools-mcp --json
```

## v1-inspect_attachment_probe

- Posture: operator fallback (operator choice).
- Emitted from: `attachment-failed` failure stages (`transient_probe_failure`
  after the bounded in-invocation re-probe, `probe_failed`); docs anchor for
  the `inspect_attachment_probe` operator choice family.
- Selected when: one bounded safe re-probe failed or probe evidence is
  ambiguous.
- Required context: none ingested by policy. Operator evidence: adapter id,
  route, probe cause, and verified endpoint provenance without endpoint
  secrets.
- Owner: operator.
- Side effects: `check` (action). The choice declares direct `read`,
  `check`, `browser`.
- Same-input retry: read-only inspection is safe to repeat; the
  in-invocation re-probe budget is already spent
  (`no_cross_invocation_retry` once attempted).
- Success evidence: the operator identifies the adapter, endpoint, or route
  fault.
- Stop and handoff: never weaken the environment proof and never switch to
  adapter discovery (`no_adapter_fallback`); the environment proof stays
  authoritative.
- Follow-up proof: a fresh connect or run after the fault is fixed.

### Procedure

Operator boundary: inspection only. For both registered adapters the probe
runs through the Adapter Definition's own executable; probe evidence names
which executable performed the handshake.

1. Reproduce with diagnostics:
   `browser-connect connect <adapter_id> --json --verbose --run-id <run_id>`.
2. Read the probe evidence: probing executable, route, and probe cause.
3. Fix the identified adapter, endpoint, or route fault through its owner,
   then rerun the original command.

### Examples

Adapter example: a non-transient probe failure against a verified endpoint.

```bash
browser-connect connect <adapter_id> --json --verbose
```

## v1-resolve_connect_failure

Compatibility-only: new policy never emits this action; tests forbid it as a
primary continuation next action. A pre-exec connection failure inherits the
exact underlying environment or adapter repair instead.

- Posture: compatibility-only.
- Emitted from: released legacy discovery for `preexec-connect-failed`
  envelopes only; never from new policy.
- Selected when: never by new policy; the underlying typed cause selects the
  real repair.
- Required context: none.
- Owner: legacy discovery.
- Side effects: `check`.
- Same-input retry: safe; read-only.
- Success evidence: not applicable; pre-exec failures inherit the exact
  underlying repair.
- Stop and handoff: tests forbid use as a primary continuation next action.
- Follow-up proof: the underlying failure's own heading.

### Procedure

Follow the underlying typed cause: the envelope's continuation already names
the exact inherited action; open that action's heading in this manual.
Reproduce the underlying state read-only:

```bash
browser-connect check --json
```

### Examples

Run example: a run fails pre-exec because the environment proof failed; the
continuation names the underlying environment action, not this one.

```bash
browser-connect check --port <port> --json
```

## v1-fix_wrapped_command

- Posture: automatic caller rerun or operator choice.
- Emitted from: `wrapped-command-not-found` (`wrapped_executable_absent`)
  failure stages after a verified handoff; docs anchor for the
  `fix_wrapped_command` operator choice family.
- Selected when: the verified handoff succeeded but the wrapped executable
  is absent; automatic posture requires a deterministic correction.
- Required context: `deterministic_correction`; at most a normalized safe
  executable basename after text-safety validation. Never a path, argv,
  arguments, or environment values.
- Owner: caller rerun; any install runs through the wrapped command's own
  owner, never through browser-connect.
- Side effects: `check` (action). The operator choice declares direct
  `check`, `network`, `write`.
- Same-input retry: safe; one automatic attempt, then operator.
- Success evidence: the wrapped command starts and its exit passes through
  unchanged.
- Stop and handoff: an unknown replacement, a prompt, or privilege
  escalation requires an operator (`no_synthesized_caller_input`).
- Follow-up proof: a fresh run reaches exec; the wrapped exit passes
  through.

### Procedure

Automatic: correct the wrapped executable in the caller's own command, then
start a fresh run. The connection envelope was already emitted; only the
wrapped command changes.

Operator boundary (`fix_wrapped_command` choice): when the intended command
is not deterministic, the operator names or installs it through its own
owner. Evidence needed first: the verified handoff and the safe
missing-command identity from the envelope. `repair-adapter` never installs
wrapped commands.

```bash
browser-connect run <adapter_id> -- <corrected wrapped command>
```

### Examples

Run example: the wrapped tool is absent; the operator installs it through
that tool's own owner, then starts a fresh run.

```bash
browser-connect run <adapter_id> -- <corrected wrapped command>
```

## v1-use_suggested_port

- Posture: automatic caller rerun; the sole cross-invocation automatic
  continuation.
- Emitted from: `foreign-listener` failure stages on `connect` and `run` at
  repair-chain hop `0` with a verified-free suggested port. `check` failures
  never emit it; they preserve the suggestion as typed diagnostic data.
- Selected when: the command is `connect` or `run`, the hop is `0`, and the
  typed evidence proves `suggested_explicit_port.verified_free: true`.
- Required context: `command`, `repair_chain_hop`,
  `suggested_explicit_port.port`, and
  `suggested_explicit_port.verified_free`.
- Owner: caller rerun.
- Side effects: `browser`, `write`.
- Same-input retry: not same-input safe; exactly one hop
  (`no_cross_invocation_retry` at hop `1`).
- Success evidence: the fresh invocation launches or verifies Agent Chrome,
  then proves adapter attachment.
- Stop and handoff: a `check` surface, hop `1`, a stale suggestion, or any
  further failure emits an operator stage and never another suggested-port
  action.
- Follow-up proof: the fresh invocation's environment proof and attachment
  probe.

### Procedure

Start exactly one fresh copy of the original connect or run with the
suggested port and hop `1`. The failed invocation itself never consumes the
suggestion (`no_internal_port_switch`), and the occupied listener stays
untouched (`no_process_destruction`); any listener remediation is external
and operator-owned.

```bash
browser-connect connect <adapter_id> --port <suggested_port> --repair-chain-hop 1 --json
# or, for run surfaces
browser-connect run <adapter_id> --port <suggested_port> --repair-chain-hop 1 -- <your original wrapped command>
```

`<suggested_port>` is read from `data.suggested_explicit_port.port` in the
JSON envelope (`suggested_explicit_port.verified_free` must be `true`); never
a port parsed from stderr or prose detail.

### Examples

Environment example: a foreign listener holds the requested port and the
envelope carries a verified-free suggestion (illustrative port).

```bash
browser-connect connect agent-browser --port 9321 --repair-chain-hop 1 --json
```

## v1-upgrade_adapter_to_pin

- Posture: automatic package action.
- Emitted from: `adapter-not-installed` (`version_mismatch`) failure stages
  with an allowlisted transition.
- Selected when: the observed version and current pin match an exact
  registry-owned safe transition, both versions are plain `x.y.z`, and
  isolated-install evidence is complete.
- Required context: `adapter_id`, `observed_version`, `pinned_version`,
  `transition_allowlisted`, and the `automatic_install.*` evidence booleans.
- Owner: `repair-adapter` command; the sole package-mutation path.
- Side effects: `network`, `write`.
- Same-input retry: not same-input safe; one execute attempt, then operator.
- Success evidence: the repair command proves fresh exact-pin provenance,
  then the caller's original connect or run proves attachment.
- Stop and handoff: inferred semantic-version safety, an off-registry lock
  source, lock drift, missing integrity, lifecycle scripts, a downgrade, an
  unknown version, a prompt, auth, registry ambiguity, or privilege
  escalation requires an operator: `adjust_adapter_pin` or
  `review_adapter_definition:<adapter_id>` (`no_pin_policy_change`).
- Follow-up proof: a fresh provenance read, then the original connect or
  run.

### Procedure

Both registered adapters (`chrome-devtools-mcp`, `agent-browser`):

```bash
browser-connect repair-adapter <adapter_id> --check --json    # read-only eligibility preview
browser-connect repair-adapter <adapter_id> --execute --json  # sole package mutation
```

`--execute` recomputes eligibility, then runs the allowlisted upgrade in the
isolated installer: no inherited credentials, no shell, no prompt, no caller
overrides. Safe transitions come only from the Adapter Definition's
safe-upgrade allowlist; upgrade safety is never inferred from version shape.

### Examples

Adapter example: observed version behind the pin with an allowlisted
transition. Versions here are illustrative placeholders; real pins live in
the Adapter Definitions.

```bash
browser-connect repair-adapter chrome-devtools-mcp --check --json    # preview reports 1.2.3 -> pin
browser-connect repair-adapter chrome-devtools-mcp --execute --json
browser-connect connect chrome-devtools-mcp --json
```

## v1-adjust_adapter_pin

- Posture: operator policy action (operator choice).
- Emitted from: `adapter-not-installed` (`version_mismatch`) failure stages
  without an allowlisted transition; docs anchor for the
  `adjust_adapter_pin` operator choice family.
- Selected when: the observed version cannot safely transition to the
  current registry pin.
- Required context: none ingested by policy. Operator evidence: the safe
  observed version, the pin, package provenance, and the registry source
  owner.
- Owner: operator.
- Side effects: `write` (source review change).
- Same-input retry: source review is safe to revisit; no automatic attempts.
- Success evidence: registry, provenance, type, and attachment tests pass
  after review.
- Stop and handoff: never mutate pin policy from a runtime envelope
  (`no_pin_policy_change`); when the exact transition is allowlisted,
  automatic upgrade applies instead.
- Follow-up proof: package verification, then a fresh connect or run.

### Procedure

Operator boundary: a pin change is normal source review on the Adapter
Definition, never runtime work; agents never execute this choice.

1. Open the owning Adapter Definition module under `src/adapters/`.
2. Review package support for the observed and pinned versions.
3. Change the definition's pinned version (and safe-upgrade allowlist) in a
   reviewed commit; the definition owner reviews integrity metadata whenever
   a pin or transition changes.
4. Run the package verification commands in `AGENTS.md`, then rerun the
   original command.

### Examples

Adapter example: an installed version with no allowlisted transition to the
pin; the operator lands a reviewed pin change, then proves attachment fresh.

```bash
browser-connect connect <adapter_id> --json
```

## v1-review_adapter_definition

- Posture: operator source-policy action (operator choice).
- Emitted from: `adapter-not-installed` failure stages where install
  automation lacks trusted recipe, integrity, lifecycle, scope, or
  package-owner metadata; docs anchor for the
  `review_adapter_definition:<adapter_id>` operator choice family.
- Selected when: automatic and manual install are both unavailable because
  trusted Adapter Definition metadata is incomplete.
- Required context: none ingested by policy. Operator evidence: the
  registered adapter id, the typed missing-policy fields, and the source
  owner path.
- Owner: operator.
- Side effects: `write` (source review change).
- Same-input retry: source review is safe to revisit; no automatic attempts.
- Success evidence: registry, provenance, integrity, type, and attachment
  tests pass with the reviewed metadata.
- Stop and handoff: never infer registry fields from installed state,
  package-manager output, caller prose, or third-party text; runtime
  proposes no source value.
- Follow-up proof: package verification, then a rerun; automatic install may
  become available once metadata is complete.

### Procedure

Operator boundary: agents never execute this choice, and the runtime emits
no proposed source value.

1. Open the named Adapter Definition under `src/adapters/`.
2. Review the definition-owned install policy fields: package manager
   executable, canonical registry, package name, user-owned install scope,
   pinned version, install argv, dependency integrity, lifecycle-script
   eligibility, provenance read, and safe-upgrade allowlist.
3. Complete the typed missing fields from the package owner's own trusted
   sources; land through normal source review.
4. Run the package verification commands in `AGENTS.md`, then rerun the
   original command.

### Examples

Adapter example: automatic install stopped on incomplete dependency
integrity metadata; the operator completes the definition in source, then
re-reads provenance.

```bash
browser-connect repair-adapter <adapter_id> --check --json
```
