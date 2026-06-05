# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

## Language

**Helper command contract**:
The workflow promise for how an operator starts the Issue-to-PR helper. It covers runner shape and documented invocation, not helper semantics, command modes, or ledger validation behaviour. When contrasting runner families, say package-runner shape, not package-runner path.
_Avoid_: helper invocation contract, command contract, runner path, package-runner path

**CLI evidence recipe**:
A workflow-guide pattern that pairs a confusing operator state with the observable CLI facts that identify it and the recovery meaning of those facts. Use this for Issue-to-PR gotchas where the operator needs evidence from the CLI, not memory or inference.
_Avoid_: evidence proof, proof recipe, CLI proof

**Git Evidence**:
Runtime-owned Issue-to-PR commit fact source. It emits normalized git facts; ledger validation and Stage 5 decide workflow policy.
_Avoid_: git proof, commit proof, git utility, ledger evidence row, CLI evidence recipe

**Runtime contract drift check**:
A focused Issue-to-PR validation that keeps prose claims about CLI-owned facts aligned with the runtime contract the helper emits. It covers mechanically checkable facts and the control-plane links needed for operator recovery, not broad documentation quality.
_Avoid_: public docs drift check, general docs audit, markdown link crawler, gotchas-only safeguard

**Contract runtime**:
A runtime component that validates and enforces a declared contract, including required shape, drift detection, and machine-readable diagnostic feedback. Use prose guidance for judgment and optional design choices; don't restate deterministic contract members in prose.
_Avoid_: power tool, implementation guide, docs-owned schema, prose contract

**Runtime-backed capability**:
An agent-native CLI behavior already exposed or enforced by the contract runtime. Use this term when current runtime support exists; point readers to runtime docs for exact fields and validation.
_Avoid_: future contract, aspirational contract, rubric-owned contract, prose contract

**Contract candidate**:
An agreed agent-native CLI behavior that may belong in the contract runtime later but is not yet runtime-backed. Keep it in rubric guidance until implementation makes it enforceable.
_Avoid_: contract-owned, runtime-backed, required field, schema promise

**Minimum CLI design brief**:
The prose-level starting brief every `create-cli` path captures before choosing basic, agent-native, or facade-backed depth. It names command purpose, users, invocation shape, IO, errors, side effects, config, non-interactive behavior, and a smoke command without claiming runtime enforcement.
_Avoid_: universal minimum CLI contract, minimum CLI contract, prose contract

**Minimum agent-native CLI bar**:
The smallest behavior set a skill driver can safely rely on: discoverable command, non-interactive run path, parseable output, structured failure, run correlation, and side-effect stance. Escalate beyond it only when risk, scale, or output shape earns the extra surface.
_Avoid_: full adoption checklist, maturity model, every rubric item, implementation plan

**Agent-native CLI design layer**:
The judgment layer that applies the CLI baseline to skill-driver workflows: discovery, non-interactive execution, parseability, recovery, observability, safety, and token budget. It sits between the CLI baseline and contract runtime path; it is not an Overlay in the harness-installation sense.
_Avoid_: overlay, rubric, contract runtime, agent-only skill

**Skill Route Index**:
A first-screen skill section that maps request shapes to next safe routes and owners. It guides model judgment; it is not a command menu, deterministic route table, Workflow Facade, or state machine.
_Avoid_: progressive disclosure index, command menu, route table, workflow router, state machine

**Runner Facade**:
A thin runtime wrapper that normalizes one tool invocation into discoverable, parseable, repairable agent evidence. It owns command execution, output projection, and recovery hints, not multi-step workflow policy.
_Avoid_: workflow engine, workflow facade, raw tool passthrough, skill prose contract

**Workflow Facade**:
A runtime owner for multi-step workflow orchestration, route policy, state transitions, and repair loops after a Runner Facade is too small. Use only when the workflow behavior is stable enough to move from skill judgment into runtime checks.
_Avoid_: runner facade, bigger runner, prose workflow, premature orchestrator

**Run correlation ID**:
An identifier that connects one command invocation's result, human diagnostics, and diagnostic trail. Use concept wording in design prose; exact payload field names belong to the contract runtime.
_Avoid_: runId, trace id, log id, diagnostics id

**Persisted diagnostics exposure boundary**:
The safety line for diagnostic trails that survive a CLI invocation. It names what can be shown through shared, protocol-visible, or remote surfaces; access, retention, deletion, and richer local detail remain package or platform policy.
_Avoid_: full logging policy, trace vendor contract, raw log access, privacy schema

**Diagnostic capability**:
A runtime-backed package-owned command role for discoverable readiness diagnostics across environment, auth, config, service reachability, and local dependencies. Prefer `doctor` as CLI spelling when a package has no established diagnostic route; facade validation owns the role, not route spelling or diagnostic event meaning.
_Avoid_: mandatory doctor command, health route, status-only command, diagnostics prose

**Baseline exit semantics**:
A facade-owned minimum exit meaning set for agent-native command contracts: success, generic or runtime failure, and invalid usage. Extra exit codes remain package-owned and justified by distinct agent routing value.
_Avoid_: full exit taxonomy, package exit policy, prose-only exit convention

**Machine-readable output capability**:
The runtime-backed promise that an agent-native CLI exposes a parseable output path and keeps primary data separate from diagnostics. Exact payload content, mode names beyond the baseline, summaries, pagination, and field selection remain package-owned design choices.
_Avoid_: JSON everywhere, prose-only output, mixed stdout diagnostics, package result schema

**Runner Benchmark Harness**:
A reusable local comparison surface for runner strategies and token-optimization variants. It proves adoption decisions and supports later A/B tests over stable fixtures without turning one benchmark result into permanent policy.
_Avoid_: one-time benchmark, test-runner benchmark only, adoption gate only, token experiment script

**Agent Runner**:
A proof-oriented test runner surface that changes output by agent context state. Hot-context repair mode emits minimal failure facts plus lookup handles. Cold-context triage mode emits bounded navigation context. Detail lookup returns richer source-run diagnostics from generated local artifacts without rerunning tests.
_Avoid_: compact human report, default test runner, raw Bun replacement, MCP deprecation by prose

**Package-owned result vocabulary**:
Stable literal values a package emits or relies on inside its own command result surface, such as `data.*` status strings, source labels, diagnostic codes, failure domains, package runtime action ids, and exit codes beyond the facade baseline. Keep vocabulary in the package's contract-owned module cluster; facade docs own envelope shape, baseline exit keys, and result-contract field shape.
_Avoid_: facade enum registry, generic result vocabulary, prose-owned literal list

**Structured failure recovery**:
The runtime-backed failure guidance minimum for agent-native CLIs: machine-readable failure category and same-input retry safety. Package code owns exact error families, repair meaning, runtime action labels, and operator policy.
_Avoid_: prose-only recovery, full repair schema, package recovery engine, generic confidence score

**Repair affordance spine**:
The runtime-backed shape that exposes possible runtime actions, side-effect classes, and continuation/stop guidance without owning package repair semantics. Rubric guidance owns evidence quality, ranking, preconditions, reversibility, and documentation-link judgment.
_Avoid_: full repair option schema, executable auto-repair, package recovery policy, confidence gate

**Finding resolver action**:
A package-owned per-finding continuation that names a runnable evidence-gathering target for one analyzer finding. It belongs to usable finding evidence; blocked-run recovery still uses repair actions.
_Avoid_: repair action, resolver metadata, hidden command, workflow action

**Traceable finding**:
An analyzer finding with enough package-owned coordinates to run a Finding resolver action. It is narrower than a finding that merely asks for human review or mentions tracing in raw analyzer output.
_Avoid_: needs_trace, trace hint, every removable finding, manual review finding

**Diagnostic trail pointer**:
The design-layer failure affordance whose runtime-backed narrowing connects one CLI invocation to a package-owned Diagnostic capability for the same run. Storage, access, retention, deletion, and diagnostic event meaning stay package or platform policy.
_Avoid_: mandatory log file, logging framework contract, trace vendor field, raw log access, persisted diagnostics access

**Side-effect safety spine**:
The runtime-backed safety minimum for agent-native CLIs: side-effect classes, execution modes, interactivity stance, and operator-stop capability. Package policy owns confirmations, rollback, retention, approval thresholds, and domain-specific gates.
_Avoid_: full safety policy, prose-only mutation warning, package rollback contract, mandatory confirmation wording

**Redaction boundary**:
The runtime-backed baseline that machine-visible CLI output must not leak sensitive values. Package code owns domain-specific sensitive fields and extra redaction fixtures.
_Avoid_: prose-only secrecy warning, full privacy policy, package data taxonomy, logging vendor contract

**Command discovery capability**:
The runtime-backed promise that an agent-native CLI exposes discoverable command purpose, usage, flags, risk posture, and machine-readable path. Package code owns command catalog meaning, naming, and route policy.
_Avoid_: prose-only help, global command router, package command catalog, scraped usage text

**Projected discovery text boundary**:
The trust boundary for free text exposed through machine-readable command discovery. Project maintainer-authored, sanitized text only; never project user, third-party, or instruction-shaped text into an agent catalog.
_Avoid_: prompt-injection scanner, content moderation, scraped help text, user-authored catalog text

**Write preview capability**:
A runtime-backed safety promise that mutating command surfaces declare a check or dry-run path, or a package-owned exception when safe preview is not possible. Package policy owns exact preview behavior, rollback, idempotency, confirmation, and approval thresholds.
_Avoid_: mandatory dry-run for every command, fake preview, package mutation policy, prose-only write warning

**Secret input boundary**:
The runtime-backed baseline that agent-native CLIs do not invite or project secret values through flags, discovery metadata, or machine-visible output. Package code owns domain secret references and service-specific secret handling.
_Avoid_: secret flags, plaintext secret examples, package auth policy, secret-value discovery

**Non-interactive execution spine**:
The runtime-backed declaration of whether a command can run without prompts or operator input. Package code owns exact prompt behavior, confirmation wording, and interactive UX.
_Avoid_: prose-only prompt warning, mandatory no-input flag, package prompt policy

**Workflow Learning Scan**:
A read-only Issue-to-PR reflection pass that captures workflow-level learnings from ship-time or fail-stop evidence. It records learning metadata through ledger and registry surfaces; it does not repair skills, runbooks, CLI code, docs, or deliverables.
_Avoid_: self-repair pass, learning audit, workflow repair scan, meta-work pass

**Final metadata checkpoint**:
The Stage 6 Issue-to-PR checkpoint that records shipped run metadata after a PR URL exists. It may contain the per-issue ledger and Workflow Learnings registry metadata only; it is not a deliverable commit or control-plane repair.
_Avoid_: final ledger commit, ship-tail cleanup commit, metadata dump

**Final metadata checkpoint contamination**:
A Stage 6 hygiene failure where changed, staged, untracked, or committed paths exceed the final metadata checkpoint allowlist. It is fixed by cleaning the ship-tail state and rerunning Stage 6, not by routing through product review.
_Avoid_: final-review finding, residual finding, product diff issue

**Registry candidate**:
A proposed Workflow Learnings registry input prepared for validation or upsert by the registry helper. It is not a stored registry entry, ledger evidence row, or Issue-to-PR finding.
_Avoid_: learning record, learning finding, registry row, finding

**Workflow Learning upsert outcome**:
The runtime-emitted result of applying a Registry candidate to the Workflow Learnings registry. Final learning-summary counts come from helper facts, not prose inference.
_Avoid_: learning count, scan count, inferred summary, registry status

**Workflow Learning attention item**:
A scan-selected Workflow Learning that deserves explicit final-summary visibility because it affects this delivery's closure or follow-up understanding. Attention-item selection is judgment over runtime facts, disposition, confidence, and delivery context; it is not a raw registry helper output.
_Avoid_: interesting learning, registry result, all follow-ups, warning

**Resume-blocking Workflow Learning**:
A Workflow Learning whose unresolved workflow defect prevents safe Issue-to-PR continuation or honest closure of the current delivery. It is narrower than `file-follow-up`; general cleanup, future DX work, and non-blocking workflow debt are not resume-blocking. Every Resume-blocking Workflow Learning is a Workflow Learning attention item.
_Avoid_: blocking follow-up, required follow-up, must-fix learning, resume-needed follow-up

**Workflow Learning metadata safety failure**:
A Workflow Learning Scan failure where the metadata lane cannot safely validate or write ledger/registry evidence because the helper command is missing, the helper contract is ambiguous, or the registry write target is unsafe. It is not the same as weak evidence, no learning found, or a non-blocking upsert inconvenience.
_Avoid_: scan capture failure, registry safety failure, metadata failure, final metadata checkpoint contamination

**Section-coordinate scaffold pointer**:
A visible scaffold command that satisfies drift only when it appears at its inventoried section or anchor, not merely somewhere in the same document.
_Avoid_: doc-level scaffold pointer, hidden scaffold-pointer comment, loose scaffold mention

**Runtime scaffold lookup**:
Agent-use boundary where an agent resolves a visible scaffold command through the CLI at the moment it needs the deterministic shape.
_Avoid_: embedded packet YAML, hand-maintained scaffold example, stale rendered scaffold body

**Startup Surface**:
Agent instructions automatically loaded at session start. Includes rendered startup artifacts and wrappers; excludes on-demand context, skills, repo-local docs, generated references, and runtime config unless injected into startup.
_Avoid_: startup prompt, global prompt, always-loaded handbook

**Harness Engineering**:
Agent-first engineering posture where humans design legible environments, repository knowledge, tools, and feedback loops so agents can execute reliable work. Use it as philosophy, not as a new workflow owner.
_Avoid_: prompt stuffing, agent handbook, manual coding replacement, vibe automation

**Context Engineering**:
Agent-first posture for choosing what context enters the model, when it loads, and which owner supplies it. Use it for Startup Surface routing, owner docs, retrieval paths, projections, compaction, and checks that keep context useful.
_Avoid_: prompt engineering, context dumping, bigger prompt, retrieval alone

**Agent runtime**:
Agent tool that loads Startup Surface instructions, such as Claude Code or Codex. Use this term for concrete Claude/Codex delivery mechanics; keep Harness Engineering for the philosophy.
_Avoid_: harness, model, agent, client

**Lean authoring**:
Prompt-system shape where one compact canonical instruction source is edited directly, while install or projection tooling handles agent-runtime delivery and drift checks. After migration, retired prompt fragments are not a supported authoring path.
_Avoid_: fragment-first authoring, prompt render system, manual prompt sync

**Context path**:
The route an agent follows from Startup Surface to the smallest sufficient owner: skill, context doc, repo doc, generated doc, runtime check, or code. It is successful when a fresh agent can find the owner without startup prose restating it.
_Avoid_: lookup flow, doc link list, table of contents only, prompt memory

**System of record**:
The durable owner for a class of instruction or knowledge. Startup may route to it, but must not duplicate its content.
_Avoid_: backup copy, duplicated policy, rendered summary, startup restatement

**Light janitor pass**:
Bounded cleanup pass that removes obvious agent-runtime and context drift: broken owner routes, stale generated outputs, appendix bloat, duplicate policy, or leftover fragments. It is not a broad documentation rewrite.
_Avoid_: governance program, documentation overhaul, content audit, policy review

**Instruction topology helper**:
A CLI-shaped control surface that projects, checks, and diagnoses Startup Surface delivery across agent runtimes. It owns delivery health and drift visibility, not instruction authoring.
_Avoid_: prompt generator, render script, install helper, startup authoring tool

**Agent setup CLI**:
Broader install/control surface for wiring agent runtimes across user-scope or repo-scope locations. Use as a separate track from Startup Surface health unless instruction delivery cannot proceed without it.
_Avoid_: instruction topology helper, prompt renderer, repo `AGENTS.md` editor, broad Codex runtime setup by default

**User-scope instruction source**:
Canonical instruction file this repo owns for Nathan's user-scope agent-runtime setup. In this repo, root `AGENTS.md` fills that role while also acting as the repo-local startup file.
_Avoid_: repo-local AGENTS only, prompt fragment source, generated startup file

**Agent runtime appendix**:
Optional tiny agent-runtime-specific Startup Surface addition composed with the shared instruction source during projection. It exists only when a Claude or Codex startup mechanic cannot live cleanly in the shared source, config, or runtime docs.
_Avoid_: prompt fragment, second startup source, generated handbook

**Managed instruction copy**:
Projected Startup Surface file written to an agent-runtime-owned path and checked for drift against the selected runtime check owner. It is an install artifact, not an authoring source or committed generated file.
_Avoid_: manual copy, generated source file, symlink target

**Scoped ask-first gate**:
A confirmation rule for high-consequence action classes, not a blanket pause before implementation. It preserves agent autonomy for concrete requested work; low-risk ambiguity gets reasonable assumptions, high-risk ambiguity gets a question.
_Avoid_: ask before everything, implement only after confirmation, blanket confirmation

**Implementation slice**:
A thin, independently verifiable unit of issue work produced during planning before Stage 3 confirmation; represented at runtime as a candidate batch.
_Avoid_: task, phase, horizontal slice, generic plan step

**Ledger schema contract**:
Runtime-owned Issue-to-PR ledger field sets and allowed values emitted through CLI contract slices and enforced by helper validators. It defines allowed and required members, not authoring intent, operator judgment, or section purpose.
_Avoid_: ledger schema prose, docs-owned schema, ledger-and-helper schema

**Ledger authoring guidance**:
Prose-owned Issue-to-PR guidance for why ledger sections exist, who writes them, when confirmation is required, and how operators use helper facts. It may point at ledger schema contracts, but must not restate their members.
_Avoid_: ledger schema contract, runtime field list, schema owner

**Ledger template scaffold**:
Legacy committed template that showed the per-issue ledger starting shape before runtime rendering owned initial ledger creation.
_Avoid_: initial ledger render, generated schema doc, prose schema, contract owner

**Validated Route Evidence Envelope**:
Browser Adapter Router route input that has passed runtime-owned validation before route evaluation. Use this term for the engine input boundary; keep raw JSON, CLI flags, file paths, and stdin outside it.
_Avoid_: raw route envelope, trusted CLI envelope, typed envelope

**Initial ledger render**:
Runtime-emitted complete starting ledger document created after acceptance criteria confirmation; read-only output, not a committed template or filesystem mutation.
_Avoid_: ledger template scaffold, generated schema doc, mutable ledger init

**Capability**:
A registry-managed skill or agent, together with the files owned by that skill or agent. In v1, runbooks, prompt fragments, rules, commands, MCP tools, and whole plugins are not capabilities.
_Avoid_: imported thing, tool, plugin, runbook capability

**Adapter capability report**:
A runtime-owned browser adapter support fact set with provenance and freshness. It is Adapter capability evidence for Browser Adapter Router decisions, not an Agent Capability Registry capability.
_Avoid_: capability, docs matrix, adapter truth prose, projection slice

**Router Recovery**:
Browser Adapter Router failure guidance for how an agent can continue or stop after route evidence fails. It names package-owned recovery meaning; the facade owns only the shared envelope shape.
_Avoid_: facade recovery payload, error metadata, hint contract

**Route Validity**:
Browser Adapter Router constraint on a selected route or failed route evaluation. It does not describe report discovery, Adapter capability report freshness, or generic CLI errors.
_Avoid_: report validity, capability validity, Router validity

**Route Evidence Invalid**:
Browser Adapter Router input failure where supplied route evidence never becomes a Validated Route Evidence Envelope. It occurs inside the `route` command before route evaluation, so it does not create Route Validity.
_Avoid_: failed route decision, route validity failure, malformed route

**Research Recovery**:
Browser Adapter Router recovery for stale or unknown Adapter capability report evidence. Continuation names the next action; a Diagnostic trail pointer names the Router-owned diagnostic detail an agent follows after the Router stops. Research signal is advisory diagnostic metadata, not route confidence.
_Avoid_: facade research schema, hint metadata, docs-only recovery

**Source**:
The provenance record for where a capability came from. A source is metadata for review and update decisions, not the unit installed into a harness.
_Avoid_: install unit, upstream capability, source capability

**Snapshot**:
The preserved upstream copy of a selected capability at a pinned source version. A snapshot is dependency input for review, not Nathan's adapted working copy.
_Avoid_: fork, canonical copy, installed copy

**Canonical capability**:
Nathan's adapted copy of a capability and the source used for installation. Canonical capabilities preserve upstream operating behaviour by default, with harness differences kept outside the canonical copy.
_Avoid_: snapshot, fork, installed output, local patch

**Overlay**:
The smallest harness-specific difference needed when installing a canonical capability. Use overlays for real harness edges such as metadata, paths, invocation wording, or blocking-question mechanics.
_Avoid_: fork, duplicate capability, harness copy

**Discovery projection**:
A harness-visible exposure of a canonical capability, usually by symlink, copy, or generated artifact. A Discovery projection makes the capability reachable without becoming its owner.
_Avoid_: duplicate capability, second source of truth, copied workflow

**Capability dependency**:
A manually declared skill or agent that a capability needs to work. Dependency inference may warn about likely omissions, but manual declarations remain the source of truth.
_Avoid_: auto dependency, inferred dependency, implicit dependency

**Skill driver**:
The human, plan, or agent that invokes a skill and supplies its working context. A skill may serve multiple drivers while preserving one owned workflow and vocabulary.
_Avoid_: driver, caller, agent-only mode, separate skill

**Progressive disclosure index**:
A short entry reference that routes readers to heavier supporting examples only when their current decision needs them. It is a judgment aid, not a deterministic router or required-read table.
_Avoid_: front door router, route table, required reference map, example dump

**MCP adoption trigger**:
A condition that moves CLI design into a separate MCP pass because clients need typed remote discovery, server-mediated auth, session transport, or MCP-native tool orchestration. It is not a reason to weaken the CLI contract.
_Avoid_: MCP by default, CLI replacement, transport-first design, generic integration idea

**Capability risk flag**:
A composable review signal attached to a capability, such as whether it handles secrets, writes files, uses the network, or causes side effects. Risk flags shape review posture; they are not a lifecycle status.
_Avoid_: risk tier, risk level, lifecycle status

**Install target**:
A harness surface that may receive an installed capability. Install targets inherit registry defaults unless a capability explicitly opts in or out.
_Avoid_: source, snapshot destination, install unit

**Alias wrapper**:
A thin redirect from an alternate capability name to the canonical capability name. Alias wrappers route discovery and invocation; they do not duplicate full capability content.
_Avoid_: duplicate copy, second canonical capability, forked alias

**one-password**:
The canonical adapted skill for safe 1Password CLI (`op`) workflows. It owns the generic `op` safety contract, while exact vault, item, field, and service-account details belong in service-specific owning skills.
_Avoid_: 1password, onepassword, secrets

**browser-use**:
The browser-driving capability. It owns all browser entry — open, reuse, attach, repair, adapter policy, and capability-routed adapter selection — plus Warm Chrome, inspection, navigation, clicking, filling, and live browser control. It defaults to Warm Chrome; cold or isolated browser entry requires an explicit user request. It does not own browser memory, runbooks, capture policy, or domain-specific auth knowledge.
_Avoid_: browse, play, browser adapter, browser orchestrator, browser memory skill

**Warm Chrome**:
A reusable authenticated browser environment that `browser-use` drives for login-heavy workflows. It is distinct from the everyday Chrome profile and from Browser Adapters; separate identities may require separate Warm Chrome environments.
_Avoid_: default Chrome profile, adapter browser, Chrome for Testing, cold browser

**Warm Chrome Preflight**:
A `browser-use` readiness proof run before any Browser Adapter acts. It verifies that a candidate browser endpoint satisfies the Warm Chrome contract; adapters consume the result rather than owning separate readiness policies.
_Avoid_: manual checklist, browser-domain-memory preflight

**Browser Adapter Proof**:
A read-only `browser-use` proof that a Router-selected or requested Browser Adapter is attached to verified Warm Chrome. It runs after Warm Chrome Preflight, usually when Router emits `prove_adapter_attachment`, and before adapter action.
_Avoid_: manual checklist, durable binding, adapter fallback

**Browser Adapter Router**:
The `browser-use` decision point that chooses a Browser Adapter for a Bounded Browser Outcome from current adapter capability evidence. It ranks proven candidates; missing proof is recovery, not inference. It is not a universal browser API, browser entry point, or browser memory owner.
_Avoid_: browser adapter facade, browser orchestrator, adapter fallback, driver

**Bounded Browser Outcome**:
A scoped browser objective that `browser-use` can route while its assumptions remain valid. It is narrower than a whole user request and broader than a single element action.
_Avoid_: browser task, action window, runbook step, whole request

**Browser Adapter**:
A Warm-Chrome-only mechanism `browser-use` uses to attach to and operate Warm Chrome: `chrome-devtools`, `agent-browser`, or `playwright-cdp`. Browser Adapters may inspect, click, replay, or debug, but they do not own authenticated browser state, browser entry, or durable browser knowledge. `puppeteer-core` is deterministic replay detail, not public adapter name.
_Avoid_: cold adapter, isolated adapter, driver, playback mode, front door, browser entry point, browser owner, memory owner

**Browser Adapter Map**:
A local `browser-use` reference for one Browser Adapter that maps Browser Adapter Proof or Router recovery vocabulary to next safe actions, adapter-specific inspection, and operator repair commands. Required sections are `Owners`, `Rules`, `Recovery Map`, and `Verify`; adapter-specific sections stay optional. It is model-readable operational guidance, not a runtime contract or local `docs_url` target.
_Avoid_: config doc, repair doc, adapter orchestrator, browser adapter facade

**Browser Adapter Command Resolution**:
Runtime-owned Browser Adapter Proof step that resolves how to invoke a Browser Adapter support tool, such as `mcporter`, from local PATH or explicit command-vector override. It emits structured dependency recovery when tooling is missing; Router-selected page action uses the selected adapter surface after proof.
_Avoid_: bunx requirement, npx requirement, prose runner fallback, public package-runner contract, action facade

**Browser Entry Handoff**:
A request from a browser-consuming capability back to `browser-use` when the Warm Chrome environment is missing, wrong, unattached, or otherwise not ready. It stops Browser Adapter work, not the agent, when `browser-use` has a safe recovery path. It is not a CLI runtime or dependency failure.
_Avoid_: self-repair, direct browser launch, adapter fallback, operator stop

**browser-domain-memory**:
The compound browser knowledge capability. It owns durable per-domain browser knowledge — auth pointers, runbooks, gotchas — and browser capture/distillation plus the three playback modes (prose, runbook, deterministic).
_Avoid_: domain-memory, browser-capture skill

**Browser capture**:
The `browser-domain-memory` workflow that turns messy browser-run evidence into durable browser knowledge. It may use raw scratch evidence as source material, but durable output is curated memory, not a trace.
_Avoid_: capture everything, raw trace archive, recording, replay capture, capture skill

**Scratch Evidence**:
Redacted browser-run source material selectively retained when a run teaches something: capture, drift, failure, ambiguity, user-requested save, or promotion proof. It is not kept for every clean replay, not trusted memory, not a runbook, and not a durable replay artifact. Use timestamped evidence names such as `YYYY-MM-DD-HHMMSS-flow-slug`.
_Avoid_: recording, trace, tape, replay file, raw history, durable instruction

**Durable Browser Knowledge**:
Curated, trusted per-domain browser memory used to make future `browser-use` runs faster and safer. It includes Auth Pointers, Browser Runbooks, optional Recorder JSON for deterministic-ready flows, Browser Gotchas, and other model-readable notes.
_Avoid_: scratch, trace archive, replay library, browser automation store

**Browser Domain Key**:
Canonical hostname used as the storage key for a portal's Durable Browser Knowledge. It has a required human alias because hostnames are often meaningless. Tenant/account identity is not part of the v1 key unless it changes the hostname.
_Avoid_: display name key, tenant key, account key

**Browser Flow Slug**:
Human-readable stable slug for a repeated browser intent, such as `submit-timesheet` or `download-invoice`. It helps humans and LLMs find the right Browser Runbook. Change it when the user intent changes, not when selectors change.
_Avoid_: opaque id, URL slug, page slug

**Auth Pointer**:
A safe per-domain reference to the 1Password account, vault, item, fields, OTP fields when available, and login context needed for browser auth. It belongs with Durable Browser Knowledge, points to secrets, and never contains secret values. Playback artifacts may reference it and resolve it through `one-password` at runtime.
_Avoid_: password note, secret mapping, auth tape, login recording

**Browser Runbook**:
The one active durable path for a known browser flow. It may retain prior versions for rollback, but only one current runbook is active. It may include login selectors and login choreography, and may reference an Auth Pointer for the secret fields. It must not contain secret values or 1Password item details. Prose mode may read it; Runbook mode consumes it mechanically; Deterministic mode uses its paired Recorder JSON when available.
_Avoid_: automation script, CI fixture, raw trace

**Recorder JSON**:
An optional deterministic replay artifact paired with a Browser Runbook when the flow has been captured or made deterministic-ready. It contains replayable browser steps and may include login selectors or login choreography, but never secret values or 1Password item details.
_Avoid_: recording, raw trace, transcript, secret replay file

**Prose mode**:
The playback mode where a reasoning agent reads model-readable Durable Browser Knowledge and re-drives Warm Chrome through `browser-use`, using runbooks and gotchas to reduce discovery while still inspecting and judging the page. It does not consume Recorder JSON. The flexible default. Config value `replayMode=prose`.
_Avoid_: coded replay, deterministic replay, manual mode

**Runbook mode**:
The playback mode where code reads a Browser Runbook and drives Warm Chrome through a Browser Adapter step-by-step, resolving stored selectors, waits, asserts, and coded heal ladders without an LLM call per step. It does not consume Recorder JSON. The fast tool-neutral path once the runbook is refined. Config value `replayMode=runbook`.
_Avoid_: prose mode, puppeteer replay, LLM replay

**Deterministic mode**:
The playback mode where a Browser Runbook's Recorder JSON replays against Warm Chrome through a Browser Adapter — fast, zero reasoning rounds, secret-value-free, and repaired through the heal/recapture loop when drift breaks playback. Recorder JSON may include login selectors/choreography, but secret field values come from live `one-password` resolution via the Auth Pointer. The fast opt-in. Config value `replayMode=deterministic`.
_Avoid_: machine-play, tape execution, CI replay

**Run Outcome**:
A per-run result record for a Browser Runbook, stored beside it as `<flow>.runs.jsonl`. It tracks date, result, steps healed, drifted selectors, and per-mode value metrics (reasoning rounds / snapshots eliminated, heal rate, wall-clock), and links to timestamped Scratch Evidence only when evidence was selectively retained. It feeds the staleness policy and lets the user assess which mode earns its keep per flow.
_Avoid_: test result, execution proof, success metric in prose

**Browser Gotcha**:
A non-obvious domain fact, fork, trap, warning, label mismatch, slow state, or fragile condition that helps future browser work. Use this broad bucket instead of adding a generic browser note type in v1.
_Avoid_: note, trivia, ordinary noise, raw observation

**Compound browser knowledge**:
The loop where browser work produces learning evidence, browser capture distills it into durable browser knowledge, and later runs start from `browser-domain-memory` — agentic prose, coded runbook replay, or deterministic Recorder replay. The compounding is curated memory, not blind capture-everything.
_Avoid_: raw record/replay everything, browser automation engine

**Reference-only env file**:
An env-shaped file whose values are 1Password secret references such as `op://...`, not plaintext secret values. It is a safe mapping artifact that may be reviewed or regenerated when every secret-bearing value remains a reference.
_Avoid_: pointer env file, map file, `.env` with secrets

**Secret reference mapping**:
A capability-owned declaration that maps a tool-facing environment variable or config key to a 1Password secret reference. The capability that consumes the secret owns the mapping; `one-password` owns only the safety contract.
_Avoid_: central secret manifest, global env bucket, one-password mapping

**Scoped service-account access**:
The preferred non-interactive 1Password access path for agents. A service account token may act as the bootstrap secret only when its vault and item permissions are scoped to the capability's declared secret reference mappings.
_Avoid_: broad service account, ambient 1Password access, desktop-first auth

**Persistent shell session**:
A stable shell context reused for an interactive 1Password task so sign-in, verification, and follow-up commands share session state. Tmux is the usual CLI implementation; Codex desktop may use a persistent Codex PTY or start a dedicated tmux session.
_Avoid_: tmux-only rule, fresh shell per `op` command, scattered sign-in

**Direct service-account read**:
A narrow, non-interactive 1Password read that uses scoped service-account access without relying on desktop sign-in state. It may run outside a persistent shell session when the capability supplies the exact vault, item, field, and expected shape.
_Avoid_: ambient read, probing read, service-account enumeration

**Targeted metadata check**:
A 1Password metadata command against an exact account, vault, item, or field already declared by an owning capability. It may prove existence or shape, but must not discover candidates by listing broad accounts, vaults, or items.
_Avoid_: broad enumeration, vault discovery, item discovery

**Materialized secret adapter**:
A generated compatibility surface that contains plaintext secret values only because a target tool cannot consume `op run` or 1Password references directly. It is never the source of truth and should be scoped to the tool that needs it.
_Avoid_: secret source, canonical env file, synced secrets file

## Example Dialogue

Dev: "Does changing the helper command contract mean the helper validates different ledger fields?"
Domain expert: "No. The helper command contract is only about how the helper is started. Ledger validation behaviour belongs to the helper semantics."

Dev: "Should a runtime contract drift check scan every Issue-to-PR markdown link?"
Domain expert: "No. A runtime contract drift check compares prose claims with CLI-owned facts and only checks recovery links that affect the control plane."

Dev: "Is Git Evidence the same thing as a ledger evidence row?"
Domain expert: "No. Git Evidence is the runtime commit fact source. Ledger rows and Stage 5 decide what those facts mean for workflow policy."

Dev: "Can any visible scaffold command in a document satisfy the pointer?"
Domain expert: "No. A section-coordinate scaffold pointer must appear inside the inventoried heading section; moving it to another section is drift."

Dev: "Should rendered packets embed scaffold YAML so agents have a fillable form?"
Domain expert: "No. Rendered packets stay pointer-only; agents use runtime scaffold lookup to fetch deterministic shapes before returning output."

Dev: "Where does the agent learn to resolve scaffold pointers?"
Domain expert: "Each rendered packet carries one shared lookup preamble so the rule appears at the moment of use without role-specific prose drift."

Dev: "Can the final metadata checkpoint include a tiny docs fix discovered during shipping?"
Domain expert: "No. The final metadata checkpoint may contain only shipped run metadata. Docs fixes are control-plane repairs and need their own workflow path."

Dev: "Should final metadata checkpoint contamination go back through final review?"
Domain expert: "No. It is a Stage 6 hygiene failure, not a product diff finding. Clean the ship-tail state and rerun Stage 6."

Dev: "Can the final learning summary count registry entries by reading the markdown?"
Domain expert: "No. It uses Workflow Learning upsert outcomes emitted by the registry helper: created, updated, or unchanged."

Dev: "Is every file-follow-up a Workflow Learning attention item?"
Domain expert: "No. The scan selects attention items by judging the runtime facts, confidence, disposition, and whether the item affects this delivery's closure or follow-up understanding."

Dev: "Should scaffold pointers use top-of-file aliases like `$RETURN_ENVELOPE`?"
Domain expert: "No. Put the direct scaffold command in the owning section; avoid alias mini-languages unless repetition proves unavoidable."

Dev: "Is `/ce-plan` producing implementation tasks or candidate batches?"
Domain expert: "It produces implementation slices for human planning, represented as candidate batches once the runtime parses and validates them."

Dev: "Should the `/ce-plan` addendum become TypeScript strings once runtime owns scaffold YAML?"
Domain expert: "No. Keep it as the editable implementation-slice reference workflow seed; agents resolve its section-coordinate scaffold pointer through runtime scaffold lookup."

Dev: "Does `ledger-and-helper.md` own the ledger schema?"
Domain expert: "No. Runtime code owns the ledger schema contract. `ledger-and-helper.md` owns ledger authoring guidance and points to emitted contract slices."

Dev: "Can the ledger template still show concrete batch fields?"
Domain expert: "Only during migration. The initial ledger render owns the concrete starting document; runtime contract slices remain the source of truth for schema members."

Dev: "Should `issue-N-ledger.template.md` remain as a pointer-only compatibility file?"
Domain expert: "No. Once `ledger-init` renders and tests the initial ledger, retire the template and point Stage 1/docs at the CLI surface."

Dev: "After retiring the ledger template, where do policy checks prove initial ledger content?"
Domain expert: "They render `ledger-init` output and inspect the artifact agents actually use, not a compatibility template."

Dev: "Is initial ledger render a packet role?"
Domain expert: "No. It is a top-level read-only `ledger-init` CLI surface because it renders a starting ledger document, not an agent dispatch packet."

Dev: "Should `ledger-init` return only Markdown?"
Domain expert: "No. Return `ledger_markdown` plus small metadata for deterministic anchors, not a full parallel ledger schema."

Dev: "Should `ledger-init` return a destination path hint?"
Domain expert: "No. Stage 1 owns the ledger path convention; `ledger-init` renders content only."

Dev: "Can initial ledger render emit placeholder acceptance criteria?"
Domain expert: "No. It receives confirmed acceptance criteria as repeatable `--ac` flags and renders the matching checkbox list plus digest anchor."

Dev: "Does initial ledger render choose `started_at` from command time?"
Domain expert: "No. The caller supplies `--started-at`; same input flags must produce the same ledger body."

Dev: "Can initial ledger render set future-stage frontmatter fields?"
Domain expert: "No. It accepts only Stage 1 facts and defaults the ledger to the post-AC-confirmation state ready for planning."

Dev: "Does Stage 1 prose own the `ac_source` value list?"
Domain expert: "No. Once initial ledger render writes `ac_source`, runtime owns the finite source enum and Stage 1 prose explains only how values are chosen."

Dev: "Should `one-password` include the exact npm token item name?"
Domain expert: "No. `one-password` defines the safe `op` workflow. The npm-owning skill supplies the exact item and field names."

Dev: "Can an agent regenerate the env file?"
Domain expert: "It can regenerate a reference-only env file. If a tool needs plaintext values, that output is a materialized secret adapter and must stay generated, scoped, and non-canonical."

Dev: "Where should the `OPENAI_API_KEY=op://...` mapping live?"
Domain expert: "With the capability that needs OpenAI. `one-password` defines safe access, not the global list of every secret."

Dev: "Should an agent unlock the desktop app first?"
Domain expert: "No. Prefer scoped service-account access for declared mappings. Desktop app integration is the fallback when scoped access is unavailable or insufficient."

Dev: "Does `one-password` literally require tmux in Codex desktop?"
Domain expert: "No. It requires a persistent shell session for interactive 1Password work. Tmux is the common CLI implementation, but a persistent Codex PTY can satisfy the same session-state boundary."

Dev: "Can a service-account read run outside tmux?"
Domain expert: "Yes, when it is a direct service-account read for a declared vault, item, field, and shape. Interactive fallback still needs a persistent shell session."

Dev: "Can an agent list vaults to find the right one?"
Domain expert: "No. It can run targeted metadata checks for declared names, but broad vault or item discovery is outside the `one-password` safety contract."

Dev: "Should `browser-use` remember the login path it just discovered?"
Domain expert: "No. `browser-use` drives Chrome. `browser-domain-memory` owns browser capture and durable compound browser knowledge."

Dev: "Can `browser-domain-memory` open or repair Warm Chrome?"
Domain expert: "No. `browser-use` owns all browser entry, including Warm Chrome repair. `browser-domain-memory` consumes the browser environment and owns durable browser knowledge."

Dev: "What does `browser-domain-memory` do when Warm Chrome is missing or wrong?"
Domain expert: "It makes a Browser Entry Handoff. `browser-use` repairs or prepares Warm Chrome; browser-domain-memory does not launch or switch adapters itself."

Dev: "Is a missing Warm Chrome endpoint from preflight a Browser Entry Handoff?"
Domain expert: "Yes, when the failure means the Warm Chrome environment is not ready. Stop adapter work and continue through `browser-use` recovery."

Dev: "Is a locked 1Password session a Browser Entry Handoff?"
Domain expert: "No. Auth failures use the auth path. Browser Entry Handoff is for browser environment readiness."

Dev: "Is a preflight CLI/runtime failure a Browser Entry Handoff?"
Domain expert: "No. Browser Entry Handoff is only browser environment readiness. CLI runtime and dependency failures stop for diagnostics."

Dev: "Is Warm Chrome the same as my everyday Chrome profile?"
Domain expert: "No. Warm Chrome is an authenticated browser environment `browser-use` drives. Browser Adapters attach to it; they do not define it."

Dev: "Is there only one Warm Chrome?"
Domain expert: "No. Warm Chrome is a type of browser environment. A product plan may choose one shared active environment, but the term is not a singleton."

Dev: "Is an isolated browser tool a Browser Adapter?"
Domain expert: "No. Browser Adapters attach to Warm Chrome. Isolated or cold browser tools are explicit escape hatches, not adapters in this domain."

Dev: "Can each adapter decide whether Chrome is ready?"
Domain expert: "No. `browser-use` runs the shared Warm Chrome Preflight proof before adapter action; adapters consume that proof."

Dev: "Is browser capture a separate skill?"
Domain expert: "No. Browser capture is a `browser-domain-memory` workflow that distills messy browser-run evidence into curated domain memory."

Dev: "Is the Chrome Recorder-shaped JSON a recording?"
Domain expert: "Not by itself. Recorder-shaped Scratch Evidence may be retained as source evidence, but only verified Recorder JSON is durable replay material."

Dev: "What does browser capture create?"
Domain expert: "Durable Browser Knowledge: curated auth pointers, runbooks, gotchas, and notes future `browser-use` runs can trust."

Dev: "Do we need a generic browser note type?"
Domain expert: "No. In v1 Durable Browser Knowledge has Auth Pointers, Browser Runbooks, and Browser Gotchas. Broaden Browser Gotcha for non-obvious useful facts."

Dev: "Where does the 1Password item path for a portal live?"
Domain expert: "As an Auth Pointer in Durable Browser Knowledge. `one-password` owns safe access mechanics, not the domain-specific item choice."

Dev: "Should a Browser Runbook repeat the login steps?"
Domain expert: "It may include login choreography and selectors. Secret source details and secret values stay in the Auth Pointer and live `one-password` resolution."

Dev: "Can a runbook click through the site next time?"
Domain expert: "Yes, in Runbook mode. Code reads the Browser Runbook and drives a Browser Adapter step-by-step. Deterministic mode replays Recorder JSON through a Browser Adapter. Prose mode keeps the agent in the loop and uses memory to avoid rediscovery."

Dev: "Can browser-domain-memory choose `agent-browser` or Chrome DevTools MCP directly?"
Domain expert: "No. It requests a playback mode or browser outcome. `browser-use` owns adapter policy and selection."

Dev: "What's the default Browser Adapter?"
Domain expert: "There isn't a fixed default. `browser-use` selects by requested outcome and verified adapter capability."

Dev: "Can Browser Adapter Router pick the likely best adapter when proof is missing?"
Domain expert: "No. It ranks proven candidates. Missing proof becomes recovery, not selection."

Dev: "Is Puppeteer banned?"
Domain expert: "Puppeteer launch paths are banned. `puppeteer-core` is deterministic replay detail that connects to verified Warm Chrome."

Dev: "Which mode is the default for a fresh capture?"
Domain expert: "Prose mode — the flexible default while memory is still maturing. Runbook and deterministic modes are faster opt-ins once the path proves stable. Run Outcomes track per-mode metrics so you can see which earns its keep per flow."

Dev: "Should we import an entire plugin as one capability?"
Domain expert: "No. Track the selected skill or agent as the capability. The plugin or repository is a source."

Dev: "Can we edit the upstream snapshot to make it more Nathan-shaped?"
Domain expert: "No. Adapt the canonical capability. The snapshot preserves the upstream copy for review."

Dev: "Should Claude Code and Codex each get separate canonical copies?"
Domain expert: "No. Keep one canonical capability and use overlays only for real harness differences."

Dev: "Does `retired` mean we can still install it by asking explicitly?"
Domain expert: "No. Retired capabilities are preserved for provenance, not installed."
