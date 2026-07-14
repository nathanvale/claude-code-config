---
title: browser-connect repair hint ledger
type: review
date: 2026-07-15
source_plan: 2026-07-14-002-feat-browser-connect-repair-paths-plan.md
status: proposed
---

# browser-connect Repair Hint Ledger

Commentable review surface for every proposed browser-connect repair action, operator choice, and continuation constraint.

Canonical runtime term: **Repair Path**. “Repair hint” remains the plain-language label for this review.

Source plan: [browser-connect agent-native repair paths](./2026-07-14-002-feat-browser-connect-repair-paths-plan.md).

This ledger does not own the contract. Record accepted decisions in the source plan. Implementation moves stable IDs and summaries into package-owned code and `REPAIR.md`.

## How to Review

For each entry, comment on four questions:

1. Is the proposed summary immediately understandable?
2. Should an agent act automatically, ask the operator, or never emit it?
3. Is the success signal enough to know the repair worked?
4. Is any stop condition missing?

Add comments under **Reviewer comment**. Replace `[ ]` with `[x]` when accepted.

## At a Glance

| Group | Count | IDs |
|---|---:|---|
| Automatic or conditional | 7 | `change_input`, `add_run_separator`, `launch_agent_chrome`, `install_adapter`, `fix_wrapped_command`, `use_suggested_port`, `upgrade_adapter_to_pin` |
| Operator-only | 5 | `inspect_listener`, `inspect_diagnostics`, `inspect_attachment_probe`, `adjust_adapter_pin`, `review_adapter_definition` |
| Compatibility-only | 3 | `list_registered_adapters`, `select_compatible_route`, `resolve_connect_failure` |
| Deferred Human Chrome candidates | 2 | `enable_human_chrome_remote_debugging`, `approve_human_chrome_connection` |
| Deferred Agent Chrome version candidates | 2 | `review_agent_chrome_upgrade`, `upgrade_agent_chrome` |
| Current operator choice families | 10 | listed after the current actions |
| Current continuation constraints | 8 | listed after the current choices |

## What One Hint Looks Like

Illustrative projection. Exact envelope construction remains facade-owned.

```yaml
runtime_action:
  id: use_suggested_port
  summary: Start a fresh invocation with the suggested explicit port.
  side_effects: [check, network]
  docs_url: https://github.com/nathanvale/claude-code-config/blob/main/runtime/browser-connect/REPAIR.md#v1-use_suggested_port

continuation:
  next_action_id: use_suggested_port
  constraints:
    - no_internal_port_switch

repair_context:
  command: connect
  requested_port: 9222
  suggested_explicit_port: 9333
```

The hint does not contain a shell command. `REPAIR.md` owns executable procedure text.

## Legacy Compatibility Projection

`data.next_action_id` remains required for schema-1 consumers.

- Mirror the outer `next_action_id` for an automatic stage.
- Use only a typed, cause-appropriate non-mutating stop for an operator stage: `change_input`, `inspect_listener`, `inspect_diagnostics`, or `list_registered_adapters`.
- Reject any legacy action with `network`, `write`, `browser`, `auth`, or `destructive` effects.
- Reject any legacy action forbidden by the outer continuation.
- Fail envelope construction when neither the cause-specific stop nor `inspect_diagnostics` is valid.

Example: absent adapter plus incomplete automatic recipe emits operator choices for manual install or Adapter Definition review, while legacy data exposes only `list_registered_adapters`.

## Proposed Repair Actions

### H01. `change_input`

> Correct the invalid input, then start a fresh invocation.

- **Posture:** automatic when one deterministic correction exists; operator choice otherwise.
- **Emitted from:** `usage-invalid`; deterministic correction of `adapter-unknown`.
- **Required context:** command ID, typed usage cause, accepted usage reference, trusted replacement when automatic.
- **Never project:** rejected free text when it fails text safety; arbitrary caller-derived replacement labels.
- **Owner:** caller rerun through the same browser-connect command.
- **Side effects:** `check`.
- **Success signal:** fresh invocation passes parsing.
- **Stop:** no replacement or multiple valid replacements.
- **Constraints:** `no_synthesized_caller_input` in the operator posture.
- **Docs:** `REPAIR.md#v1-change_input`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H02. `add_run_separator`

> Separate browser-connect options from a non-empty wrapped command.

- **Posture:** automatic when parser memory proves a non-empty command; operator choice when the command is absent.
- **Emitted from:** `run-missing-separator: separator_missing`; operator choice for `wrapped_command_missing`.
- **Required context:** adapter ID, typed run cause, `wrapped_command_present` boolean.
- **Never project:** wrapped argv, arguments, environment values, executable path, or auth-bearing data.
- **Owner:** caller inserts the separator into its original invocation and reruns.
- **Side effects:** `check`.
- **Success signal:** fresh run reaches the pre-exec connection gate.
- **Stop:** no wrapped command exists in caller context.
- **Constraints:** `no_synthesized_caller_input`; command input must remain caller-owned.
- **Docs:** `REPAIR.md#v1-add_run_separator`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H03. `launch_agent_chrome`

> Launch Agent Chrome on the proven-free explicit port, then verify it.

- **Posture:** automatic.
- **Emitted from:** `environment-absent: no_listener` with free-port proof.
- **Required context:** requested explicit port, expected environment identity, safe profile identity, launch eligibility.
- **Never project:** profile contents, browser endpoint secrets, full process command line.
- **Owner:** warm-chrome launch gateway.
- **Side effects:** `check`, `network`, `browser`, `write`.
- **Success signal:** warm-chrome verifies Agent Chrome on the same port.
- **Stop:** any listener appears, port changes, launch child is unverified, or launch fails.
- **Constraints:** `no_adapter_fallback`, `no_internal_port_switch`, `no_unverified_listener_connection`, `no_process_destruction`.
- **Docs:** `REPAIR.md#v1-launch_agent_chrome`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H04. `inspect_listener`

> Inspect listener ownership before choosing any process or port action.

- **Posture:** operator-only.
- **Emitted from:** foreign, occupied, uninspectable, or ambiguous listener without a safe suggested port.
- **Required context:** explicit port, warm-chrome reason, redacted pid and executable basename when safely available.
- **Never project:** foreign command line, foreign filesystem paths, inferred ownership.
- **Owner:** warm-chrome diagnostics plus operator inspection.
- **Side effects:** `read`, `check`.
- **Success signal:** operator identifies the lifecycle owner or chooses another explicit port.
- **External completion:** browser-connect accepts no ownership evidence or continuation receipt. The operator may remediate through the owning lifecycle outside browser-connect, then starts a fresh invocation that repeats warm-chrome proof.
- **Stop:** ownership relies only on port, pid, basename, or error prose; never emit a follow-on process action.
- **Constraints:** `no_unverified_listener_connection`, `no_process_destruction`.
- **Docs:** `REPAIR.md#v1-inspect_listener`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H05. `inspect_diagnostics`

> Inspect correlated diagnostics before choosing another repair.

- **Posture:** operator-only.
- **Emitted from:** unexpected runtime failure, untyped launch failure, or failed bounded transient check.
- **Required context:** run correlation, failure domain, owning diagnostic surface.
- **Never project:** raw exception payloads, local paths, process arguments, sensitive environment values.
- **Owner:** owning read-only diagnostic surface.
- **Side effects:** `read`, `check`.
- **Success signal:** typed cause or operator diagnosis exists.
- **Stop:** diagnostics alone never authorize mutation.
- **Constraints:** `no_mutation_from_diagnostics`; preserve every safety constraint from the underlying failure.
- **Docs:** `REPAIR.md#v1-inspect_diagnostics`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H06. `list_registered_adapters`

> List registered adapters for compatibility with existing consumers.

- **Posture:** compatibility-only; never outer `next_action_id`.
- **Emitted from:** legacy `data.next_action_id` as the safe adapter-domain stop for operator stages, plus discovery.
- **Required context:** none.
- **Owner:** browser-connect dashboard.
- **Side effects:** `read`.
- **Success signal:** not applicable; listing does not complete a repair.
- **Stop:** new policy must not use this as the next action.
- **Constraints:** none.
- **Docs:** `REPAIR.md#v1-list_registered_adapters`.
- [ ] Keep as compatibility-only.
- **Reviewer comment:**

### H07. `install_adapter`

> Install the registered adapter at its pinned version, then recheck provenance.

- **Posture:** automatic only with a complete registry-owned install recipe; operator-choice procedure when trusted package identity, exact pin, install scope, owner, and versioned docs remain complete.
- **Emitted from:** adapter executable absent.
- **Required context:** trusted adapter ID, package recipe ID, package name, pinned version, user-owned install scope, package-manager argv, canonical registry, allowed lock-entry origins, full dependency integrity, lifecycle-script eligibility.
- **Never project:** a shell command string, latest-version fallback, package identity from error prose.
- **Owner:** facade-backed `repair-adapter <adapter_id>`; `--check` previews without mutation and `--execute` is the sole package-mutation mode.
- **Side effects:** `network`, `write`.
- **Success signal:** fresh provenance resolves the executable at the exact pin.
- **Stop:** automatic posture stops before network or mutation on missing recipe, prompt, auth, privilege escalation, package conflict, non-registry or alternate-origin dependency source, or post-install version mismatch. A canonical-origin redirect is never followed and publishes no mutation. Manual-install choice is absent when package identity, pin, scope, owner, or docs is missing; agents never execute it.
- **Constraints:** `no_pin_policy_change`.
- **Special boundary:** install the adapter executable only; never run an adapter browser installer or download Chrome for Testing.
- **Docs:** `REPAIR.md#v1-install_adapter`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H08. `select_compatible_route`

> Review released route-selection guidance before choosing another registered adapter.

- **Posture:** compatibility-only; never outer or legacy `next_action_id` in revised policy.
- **Emitted from:** previously released envelopes and discovery only. New `route-incompatible` failures offer operator choices for trusted registered adapters.
- **Required context:** none for compatibility discovery; operator choices carry trusted candidate adapter IDs and implemented route IDs separately.
- **Never project:** unregistered caller suggestions or undocumented routes.
- **Owner:** released compatibility procedure. Current compatibility selection exhausts every declared same-adapter route before failure; an operator owns any different registered adapter selection.
- **Side effects:** inherited only by released consumers; revised policy does not execute this action.
- **Success signal:** not applicable to revised policy.
- **Stop:** new policy attempts to select this action automatically or as a legacy fallback.
- **Constraints:** `no_adapter_fallback` remains active after an attachment proof failure.
- **Docs:** `REPAIR.md#v1-select_compatible_route`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H09. `inspect_attachment_probe`

> Inspect the failed adapter probe without weakening browser proof.

- **Posture:** operator-only.
- **Emitted from:** non-transient probe failure, ambiguous probe evidence, or failure after one invocation-local transient re-probe.
- **Required context:** adapter ID, implemented route, typed probe cause, safe endpoint provenance, probe executable identity.
- **Never project:** full endpoint URL, browser target data, adapter output containing page content.
- **Owner:** adapter-specific diagnostic procedure.
- **Side effects:** `read`, `check`, `browser`.
- **Success signal:** operator identifies an adapter, route, or endpoint-handshake fault.
- **Stop:** environment proof failed; adapter discovery or weaker proof is proposed.
- **Constraints:** `no_adapter_fallback`, `no_unverified_listener_connection`, `no_cross_invocation_retry` after retry exhaustion.
- **Docs:** `REPAIR.md#v1-inspect_attachment_probe`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H10. `resolve_connect_failure`

> Follow the underlying environment or adapter repair path.

- **Posture:** compatibility-only; never outer `next_action_id`.
- **Emitted from:** previously released legacy envelopes and discovery only; revised policy never selects it in outer or compatibility continuation data.
- **Required context:** underlying typed pre-exec failure for new consumers.
- **Owner:** underlying environment or adapter Repair Path.
- **Side effects:** inherited from the underlying action.
- **Success signal:** inherited from the underlying action.
- **Stop:** new policy must never hide the underlying action behind this ID.
- **Constraints:** inherit all underlying constraints.
- **Docs:** `REPAIR.md#v1-resolve_connect_failure`.
- [ ] Keep as compatibility-only.
- **Reviewer comment:**

### H11. `fix_wrapped_command`

> Correct or install the wrapped executable, then start a fresh run.

- **Posture:** automatic with one deterministic correction; operator choice otherwise.
- **Emitted from:** `wrapped-command-not-found` after verified browser handoff.
- **Required context:** missing-command state and optional safe executable basename when it passes text safety.
- **Never project:** wrapped arguments, environment values, full executable path, or auth-bearing data.
- **Owner:** caller or the wrapped executable's own installation owner.
- **Side effects:** `check`, `network`, `write`.
- **Success signal:** fresh run starts the wrapped command; its exit passes through.
- **Stop:** replacement unknown, install prompts, auth, or privilege escalation.
- **Constraints:** `no_synthesized_caller_input`; browser repair is complete; do not reinterpret this as a connection failure.
- **Docs:** `REPAIR.md#v1-fix_wrapped_command`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H12. `use_suggested_port`

> Start a fresh invocation with the suggested explicit port.

- **Posture:** automatic caller rerun.
- **Emitted from:** `connect` or `run` typed environment failure carrying a safe `suggested_explicit_port` at repair-chain hop `0`. Check preserves the suggestion as diagnostic data only.
- **Required context:** original command ID, requested port, suggested explicit port, original adapter ID when applicable, wrapped-command-presence marker for run.
- **Never project:** wrapped argv or a synthesized endpoint.
- **Owner:** caller starts one fresh copy of the original connect or run with hop `1`.
- **Side effects:** mirror the original connect or run; may include browser and write effects.
- **Success signal:** fresh invocation verifies and uses the suggested port.
- **Stop:** command is check, hop is already `1`, or suggestion is absent, stale, occupied, or consumed inside the failed invocation.
- **Constraints:** `no_internal_port_switch`, `no_unverified_listener_connection`, `no_process_destruction`.
- **Docs:** `REPAIR.md#v1-use_suggested_port`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H13. `upgrade_adapter_to_pin`

> Upgrade the adapter through its approved transition, then recheck provenance.

- **Posture:** automatic only for an exact registry allowlist transition.
- **Emitted from:** adapter version mismatch with approved observed-version-to-pin transition.
- **Required context:** trusted adapter ID, safe observed version, pinned version, install recipe ID, exact allowlist match, canonical registry, allowed lock-entry origins, full dependency integrity, lifecycle-script eligibility.
- **Never project:** inferred semantic-version compatibility or package identity from prose.
- **Owner:** facade-backed `repair-adapter <adapter_id>`; `--check` previews without mutation and `--execute` is the sole package-mutation mode.
- **Side effects:** `network`, `write`.
- **Success signal:** fresh provenance resolves the exact pinned version.
- **Stop:** downgrade, unknown version, absent allowlist entry, prompt, auth, privilege escalation, package conflict, or non-registry or alternate-origin dependency source stops before network or mutation. A canonical-origin redirect is never followed and publishes no mutation.
- **Constraints:** `no_pin_policy_change`.
- **Docs:** `REPAIR.md#v1-upgrade_adapter_to_pin`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H14. `adjust_adapter_pin`

> Review adapter support before changing the pinned-version policy.

- **Posture:** operator-only.
- **Emitted from:** installed version has no registry-approved transition to the current pin.
- **Required context:** trusted adapter ID, safe observed version, current pin, package provenance, registry source owner.
- **Never project:** a proposed pin derived from installed state or third-party prose.
- **Owner:** operator through normal source review.
- **Side effects:** `write`.
- **Success signal:** registry, provenance, type, and attachment tests pass with the accepted pin policy.
- **Stop:** no support evidence, no reviewed source change, or runtime attempts to mutate policy.
- **Constraints:** `no_pin_policy_change` until operator acceptance.
- **Docs:** `REPAIR.md#v1-adjust_adapter_pin`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

### H15. `review_adapter_definition`

> Review the registered adapter policy before enabling another install path.

- **Posture:** operator-only source-policy review.
- **Emitted from:** automatic and manual install are unavailable because trusted Adapter Definition recipe, integrity, lifecycle, scope, package-owner, or docs metadata is incomplete.
- **Required context:** trusted adapter ID, typed missing-policy fields, and registry source owner.
- **Never project:** replacement values inferred from installed state, package-manager output, caller prose, or third-party text.
- **Owner:** operator through normal source review.
- **Side effects:** `write`.
- **Success signal:** registry, integrity, provenance, type, and attachment tests pass with reviewed metadata.
- **Stop:** adapter is unregistered, no source owner exists, or runtime attempts to propose or write policy values.
- **Constraints:** `no_pin_policy_change` until operator acceptance.
- **Docs:** `REPAIR.md#v1-review_adapter_definition`.
- [ ] Accept posture, wording, and boundary.
- **Reviewer comment:**

## Proposed Operator Choices

These appear only with `requires_operator: true`. They never coexist with an automatic next action. Each projected choice carries facade-valid `recoverability`, direct `side_effects`, and a versioned public `docs_url`; omit `action_id` because the choice is not an executable runtime action.

| Choice ID or family | Proposed summary | Offered when | Direct effects | Success and stop contract |
|---|---|---|---|---|
| `provide_corrected_input` | Provide corrected input for a fresh invocation. | usage is invalid and no deterministic correction exists | `check` | fresh invocation parses; omit when a deterministic correction exists or text would be caller-authored |
| `provide_wrapped_command` | Provide a non-empty wrapped command for a fresh run. | no wrapped command exists | `check` | fresh run reaches pre-exec proof; omit when parser memory proves a command |
| `install_registered_adapter_manually:<adapter_id>` | Install this registered adapter through its documented operator procedure. | automatic install is unavailable and trusted package identity, exact pin, scope, owner, and docs exist | `network`, `write` | fresh provenance resolves the exact pin; omit when any trusted manual-install input is missing; never agent-execute |
| `review_adapter_definition:<adapter_id>` | Review this registered adapter's missing install-policy metadata. | automatic and manual install contracts are incomplete | `write` | registry, integrity, provenance, type, and attachment tests pass; omit for unregistered or prose-derived candidates |
| `choose_registered_adapter:<adapter_id>` | Choose this registered adapter and its compatible route. | trusted candidate declares an implemented compatible route | `check`, `network`, `browser`, `write` | fresh route and attachment proof pass; omit caller-authored, unregistered, or incompatible candidates |
| `inspect_listener` | Inspect listener ownership before choosing any external process action. | listener ownership is ambiguous | `read`, `check` | operator completes remediation externally and a fresh invocation re-proves; never ingest ownership evidence |
| `inspect_diagnostics` | Inspect correlated diagnostics before choosing another repair. | evidence remains untyped | `read`, `check` | typed cause or human diagnosis exists; omit while an automatic action remains |
| `inspect_attachment_probe` | Inspect the failed adapter probe without weakening browser proof. | probe failure needs operator diagnosis | `read`, `check`, `browser` | operator identifies the fault; omit when environment proof failed or retry remains |
| `adjust_adapter_pin` | Review adapter support before changing the pinned-version policy. | no safe upgrade transition exists | `write` | reviewed registry and attachment tests pass; omit when exact transition is allowlisted |
| `fix_wrapped_command` | Choose how to provide the missing wrapped executable. | wrapped executable correction is ambiguous | `check`, `network`, `write` | fresh run starts the intended command; omit when browser connection failed or identity is unsafe |

| Choice family | Recoverability | Versioned docs anchor |
|---|---|---|
| `provide_corrected_input` | `change_input` | `REPAIR.md#v1-change_input` |
| `provide_wrapped_command` | `change_input` | `REPAIR.md#v1-add_run_separator` |
| `install_registered_adapter_manually:<adapter_id>` | `repair_state` | `REPAIR.md#v1-install_adapter` |
| `review_adapter_definition:<adapter_id>` | `repair_state` | `REPAIR.md#v1-review_adapter_definition` |
| `choose_registered_adapter:<adapter_id>` | `change_input` | `REPAIR.md#v1-select_compatible_route` |
| `inspect_listener` | `repair_state` | `REPAIR.md#v1-inspect_listener` |
| `inspect_diagnostics` | `repair_state` | `REPAIR.md#v1-inspect_diagnostics` |
| `inspect_attachment_probe` | `repair_state` | `REPAIR.md#v1-inspect_attachment_probe` |
| `adjust_adapter_pin` | `repair_state` | `REPAIR.md#v1-adjust_adapter_pin` |
| `fix_wrapped_command` | `change_input` | `REPAIR.md#v1-fix_wrapped_command` |

- [ ] Accept all choice families and summaries.
- **Reviewer comment:**

## Proposed Continuation Constraints

| Constraint ID | Proposed summary | Applied when |
|---|---|---|
| `no_adapter_fallback` | Do not fall back to adapter discovery or another browser environment. | environment or attachment proof fails, or a route-incompatibility handoff is offered |
| `no_internal_port_switch` | Use a suggested port only in a fresh explicit invocation. | a suggested port is present |
| `no_unverified_listener_connection` | Do not connect to or replace an unverified listener. | listener identity is not verified |
| `no_process_destruction` | Do not stop processes or free ports automatically. | automatic environment recovery is considered |
| `no_pin_policy_change` | Do not change adapter pin policy automatically. | adapter provenance or version fails |
| `no_cross_invocation_retry` | Do not reset a transient retry through a fresh invocation. | invocation-local retry is exhausted |
| `no_synthesized_caller_input` | Do not synthesize corrected input, wrapped commands, or replacement identities; they stay caller-owned. | an input-correction operator stage is emitted |
| `no_mutation_from_diagnostics` | Do not treat diagnostic inspection as authority to mutate; a fresh typed cause selects the next repair. | an `inspect_*` operator stage is emitted |

Every operator stage emits at least one applicable constraint; the facade rejects `requires_operator` without a constraint summary.

- [ ] Accept all constraint IDs and summaries.
- **Reviewer comment:**

## Deliberately Absent Hints

| Rejected ID | Why absent |
|---|---|
| `terminate_listener` | No current failure safely distinguishes direct termination from broader operator-owned port remediation. |
| `reprove_environment` | A stateless fresh invocation cannot enforce a retry budget and may loop. Follow-up proof belongs inside the repair procedure. |
| `reprobe_attachment` | One typed transient re-probe may run inside the current invocation. A failed retry becomes operator inspection. |
| `free_occupied_port` | browser-connect has no trusted ownership-evidence input and never authorizes process mutation. `inspect_listener` ends the runtime chain; any operator remediation stays external and returns through fresh proof. |

- [ ] Agree these hints stay absent.
- **Reviewer comment:**

## Deferred Human Chrome UI-Consent Candidates

These candidates belong to browser-connect slice two. They must not appear when the caller requested Agent Chrome or the `explicit-cdp` route.

Official flow: enable remote debugging in Human Chrome, configure the adapter for UI auto-connect, then manually approve each incoming debugging connection.

### H16. `enable_human_chrome_remote_debugging`

> Enable Human Chrome remote debugging, then retry the consent route.

- **Posture:** operator-only with manual and Peekaboo-assisted choices.
- **Emitted from:** explicit Human Chrome request plus `ui-consent` route plus typed `remote_debugging_disabled` cause.
- **Required context:** explicit `human-chrome` environment selection, supported Chrome version, `ui-consent` route, Chrome running state, disabled-setting proof.
- **Never emit from:** Agent Chrome absence, explicit-CDP failure, guessed environment, or adapter fallback.
- **Owner:** operator; Peekaboo may assist only after the operator selects the assisted choice.
- **Side effects:** `browser`, `write`, `auth`.
- **Success signal:** Chrome shows “Allow remote debugging for this browser instance” as enabled.
- **Stop:** Chrome window or checkbox cannot be identified, Peekaboo permissions are missing, Chrome shows an unexpected dialog, or the selected profile is ambiguous.
- **Constraints:** `no_environment_substitution`, `no_permission_prompt_automation`.
- **Docs:** future `REPAIR.md#enable_human_chrome_remote_debugging`.

**Manual click procedure**

1. Use the intended Human Chrome profile.
2. Open `chrome://inspect/#remote-debugging`.
3. Select **Allow remote debugging for this browser instance**.
4. Keep Chrome running.
5. Start a fresh Human Chrome UI-consent connection.
6. Manually approve the incoming connection dialog when Chrome shows it.

**Peekaboo-assisted procedure**

1. Require the operator to choose **Turn it on with Peekaboo**.
2. Check Screen Recording and Accessibility permissions.
3. Inspect the existing Human Chrome window.
4. Navigate that window to `chrome://inspect/#remote-debugging`.
5. Locate the checkbox from the current UI snapshot.
6. Click the checkbox.
7. Verify the checkbox is enabled.
8. Stop before any incoming connection permission dialog.

**Operator choices**

| Choice ID | Proposed summary | Automation boundary |
|---|---|---|
| `show_remote_debugging_click_instructions` | Show the Chrome steps and wait for me to enable remote debugging. | no UI mutation |
| `enable_remote_debugging_with_peekaboo` | Use Peekaboo to enable the Chrome setting, then stop for connection approval. | explicit operator choice; checkbox only |

- [ ] Include this candidate in slice two.
- [ ] Keep manual instructions as the recommended choice.
- [ ] Offer Peekaboo-assisted checkbox activation.
- **Reviewer comment:**

### H17. `approve_human_chrome_connection`

> Approve the incoming Human Chrome debugging connection.

- **Posture:** operator-only; manual click only.
- **Emitted from:** explicit Human Chrome request plus `ui-consent` route plus typed `connection_approval_required` cause.
- **Required context:** remote debugging enabled, adapter identity, consent route, pending Chrome permission dialog.
- **Never emit from:** Agent Chrome, explicit CDP, or a connection without a visible Chrome permission dialog.
- **Owner:** operator.
- **Side effects:** `browser`, `auth`.
- **Success signal:** operator approves the visible prompt and the adapter completes consent-aware attachment proof.
- **Stop:** adapter identity is unclear, dialog is absent, profile is ambiguous, or the prompt changed unexpectedly.
- **Constraints:** `no_permission_prompt_automation`, `no_environment_substitution`.
- **Docs:** future `REPAIR.md#approve_human_chrome_connection`.
- [ ] Require manual approval for every incoming connection.
- [ ] Forbid Peekaboo from clicking the connection approval dialog.
- **Reviewer comment:**

### Deferred Human Chrome Constraints

| Constraint ID | Proposed summary | Applied when |
|---|---|---|
| `no_environment_substitution` | Do not substitute Human Chrome for Agent Chrome or another requested environment. | Human Chrome setup or consent repair |
| `no_permission_prompt_automation` | A human must approve each incoming Human Chrome debugging connection. | connection approval is required |

## Deferred Agent Chrome Version Intelligence Candidates

These candidates do not add release-network work to the current `check`, `connect`, or `run` fast path. A future explicit freshness surface must own the trigger before either candidate ships.

Trusted sources: Google's [VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference) supplies platform-and-channel release evidence. Official [Chrome release notes](https://developer.chrome.com/release-notes) supply feature and compatibility context.

### H18. `review_agent_chrome_upgrade`

> Agent Chrome is behind the fully released Stable version. Review what changed before choosing an upgrade.

- **Posture:** automatic read-only research; non-blocking advisory.
- **Emitted from:** an explicit freshness evaluation proves the verified Agent Chrome version is lower than a fully rolled-out Stable version for the same platform, architecture, and channel.
- **Required context:** verified browser version, platform, architecture, channel, fully rolled-out Stable version, and missed major versions.
- **Never emit from:** browser age alone, Beta, Dev, Canary, partial rollout, ambiguous platform or channel, failed version parsing, or an untrusted release source.
- **Never project:** fetched release prose, third-party summaries, or instruction-shaped web content into a runtime envelope.
- **Owner:** future version-intelligence discovery owner; the agent summarizes official sources outside the runtime contract.
- **Side effects:** `read`, `check`, `network`.
- **Success signal:** a compact release delta groups automation, CDP, and DevTools changes; browser and platform features; breaking changes, removals, and security reasons. It shows installed and available versions plus official links without changing connection success.
- **Stop:** release evidence is unavailable, rollout is incomplete, source identity is unclear, or the version gap cannot be bounded. Report `release_freshness_unknown`; never guess.
- **Constraints:** `no_browser_update_without_operator`, `no_untrusted_release_projection`.
- **Docs:** future `REPAIR.md#review_agent_chrome_upgrade`.
- [ ] Keep this advisory non-blocking.
- [ ] Require official platform-and-channel release evidence.
- [ ] Summarize missed features only after the advisory is selected.
- **Reviewer comment:**

### H19. `upgrade_agent_chrome`

> Upgrade Agent Chrome through its owning update flow, then re-prove the connection.

- **Posture:** operator-only blocking repair.
- **Emitted from:** trusted typed `browser_version_unsupported` evidence from an Adapter Definition or capability contract.
- **Required context:** verified installed version, exact minimum version or missing capability, evidence owner, supported Stable target, active Agent Chrome state, and follow-up proof owner.
- **Never emit from:** stale-but-compatible Chrome, adapter stderr, free-form diagnostics, release age, missing freshness evidence, or an inferred version requirement.
- **Owner:** operator through Google Chrome's owning update lifecycle; never the adapter installer.
- **Side effects:** `network`, `write`, `browser`, `destructive`.
- **Success signal:** relaunched Agent Chrome reports a supported version, warm-chrome proves the environment, and the adapter attachment proof passes.
- **Stop:** managed policy blocks the update, privilege or auth is required, no supported Stable target exists, active browser work cannot be safely closed, or the version requirement is ambiguous.
- **Constraints:** `no_browser_update_without_operator`, `no_untrusted_release_projection`.
- **Docs:** future `REPAIR.md#upgrade_agent_chrome`.

**Operator choice**

| Choice ID | Proposed summary | Automation boundary |
|---|---|---|
| `show_agent_chrome_upgrade_instructions` | Show the Chrome update and safe restart steps, then wait for me. | no browser mutation |

- [ ] Require trusted incompatibility evidence before blocking.
- [ ] Keep update, close, and restart operator-controlled.
- [ ] Keep adapter installation separate from browser update.
- **Reviewer comment:**

### Deferred Agent Chrome Version Constraints

| Constraint ID | Proposed summary | Applied when |
|---|---|---|
| `no_browser_update_without_operator` | Do not update, close, or restart Agent Chrome automatically. | any Agent Chrome upgrade path |
| `no_untrusted_release_projection` | Do not place fetched release prose or third-party summaries in runtime contract text. | release research or version guidance |

## Whole-Ledger Comment

- **Keep:**
- **Change:**
- **Missing hint:**
- **Too automatic:**
- **Too operator-heavy:**
- **Unclear wording:**
