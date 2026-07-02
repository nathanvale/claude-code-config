---
status: graduated
---

# Agent-Native CLI Toolkit Context

Agent-Native CLI Toolkit is the root workspace package for package-agnostic
agent-native CLI contracts, command grammar, discovery projection, JSON writer
mechanics, runtime-contract testing support, and CLI diagnostic plumbing. It
gives consuming packages shared toolkit slices without owning their command
catalogs, runtime policy, schemas, or domain vocabulary.

## Language

**Agent-Native CLI Toolkit** is the shared package identity for reusable
agent-native CLI contracts, documentation paths, fixtures, validators, writers,
and package-agnostic runtime mechanics.
_Avoid_: CLI Command Facade as product identity, generic CLI framework, package
policy owner

**CLI Command Facade** is the toolkit slice that owns reusable command facade
grammar and front-door runtime mechanics for root workspace packages.
_Avoid_: product identity, command router, package policy owner

**Command Facade Interface Slice** is one reusable command-facade part of the
toolkit surface: metadata grammar, discovery projection, result contract
discovery, JSON writer behavior, usage helpers, or diagnostics mechanics.
_Avoid_: all-or-nothing facade adoption

**Facade Testing Subpath** is the approved public test-support subpath
`@side-quest/cli-command-facade/testing` for package-agnostic fixtures and test
helpers that consuming package tests may extend.
_Avoid_: production facade API, deep implementation import, consumer-specific
test harness

**Command Surface Alignment Proof** is the package-owned evidence that a CLI's
command discovery metadata, rendered help, public argv outcomes, and runtime
meaning stay aligned for an agent.
_Avoid_: facade-owned parser, derived parser allowlist, prose-only CLI guarantee

**Agent-Native CLI Runtime Contract** is the umbrella facade contract for
agent-readable runtime CLI behavior across structured errors, runtime action
guidance, agent hints, exit-code meanings, retry and recovery slots, redaction
gates, and output-channel expectations.
_Avoid_: global JSON envelope, CLI framework, package recovery policy

**Agent-Native CLI Runtime Lifecycle Helper** is a helper category for
package-agnostic CLI invocation mechanics that **cli-author** needs to emit
repeatable contracts or that consuming packages already share, such as **Run
Correlation ID** setup, diagnostic context setup, **Command Duration**
measurement, stdout/stderr discipline, ADR-0010 writer handoff, generic usage
or error envelope handling, and exit-code return mechanics.
_Avoid_: command router, command dispatcher, package front door, package
framework, recovery policy owner

**Command Facade Adapter** is consuming-package code that maps package-owned
command meaning into one or more **Command Facade Interface Slices**.
_Avoid_: facade-owned command catalog

**Command Metadata Adapter** is a **Command Facade Adapter** that uses shared
command contract types, flags, aliases, usage helpers, JSON writing, usage
errors, or metadata drift checks while keeping command names and policy local.
_Avoid_: shared route registry

**Command Discovery Adapter** is a **Command Facade Adapter** that projects a
package-owned command catalog into the generic discovery grammar.
_Avoid_: shared `agent-context` policy

**Command Discovery Tree** is the package-agnostic projection shape for command
metadata, flags, exit codes, aliases, optional unified routes, optional result
contract metadata, and package-supplied augment fields.
_Avoid_: package map, command inventory authority

**Command Capability Role** is a package-agnostic discovery label for a
command's generic role, without controlling its route name or package meaning.
_Avoid_: command router, route taxonomy, package command catalog

**Diagnostic Capability** is the package-owned command role for discoverable
readiness diagnostics across environment, auth, config, service reachability,
or local dependencies.
_Avoid_: mandatory `doctor` command, health route, status-only command,
diagnostics prose

**Result Contract Discovery** is the optional discovery grammar for a command's
result contract metadata and safe action affordance shape.
_Avoid_: schema registry, global result envelope, package action policy

**Result Data Helper** is the package-root facade helper category that attaches
`resultContract` metadata to package-owned object-shaped command data while
reserving facade metadata keys.
_Avoid_: schema validator, generic data envelope, command router, package
result vocabulary owner

**Result Payload** is the package-owned structured object passed to the
**Result Data Helper** before facade metadata is attached. It is not a generic
dictionary and not an array or function.
_Avoid_: `Record<string, unknown>` default, bare `object` without runtime guard,
facade-owned result schema

**Action Affordance** is generic discovery metadata for a possible next action:
id, summary, and facade side-effect classes.
_Avoid_: executable command template, repair semantics, browser policy

**Runtime Action Guidance** is generic runtime result guidance for a next action:
id, summary, and facade side-effect classes derived from package-owned output.
_Avoid_: Agent Action Hints, retry policy, executable command template, recovery
semantics

**Runtime Continuation Guidance** is generic runtime result guidance that frames
whether and how an agent may continue from one invocation.
_Avoid_: Runtime Action Guidance, recovery engine, package fallback policy,
browser policy

**Runtime Recovery Choice** is generic error-envelope guidance for a human
selection among valid recovery paths after autonomous continuation stops.
_Avoid_: Runtime Continuation Choice, generic operator menu, success-path
selection

**Verdict-to-Envelope Projection** is the package-owned mapping from a
command-local verdict into ADR-0010 envelope status, Structured Runtime Error
fields, runtime actions, domain run identity, and CLI exit code.
_Avoid_: facade-owned verdict policy, global domain verdict enum

**Structured Runtime Error** is the mandatory runtime-contract failure shape for
agent-readable CLI errors.
_Avoid_: prose-only failure, package error taxonomy, public envelope mandate

**Failure Domain** is a package-owned broad failure label on a **Structured
Runtime Error** for agent routing without parsing exact error codes.
_Avoid_: facade enum, global error taxonomy, replacement for error code

**Baseline Exit Semantics** is the facade-owned minimum exit meaning set for
agent-native command contracts: `0` success, `1` generic or runtime failure,
and `2` invalid usage.
_Avoid_: full exit taxonomy, package exit policy, success-only exemption,
prose-only exit convention

**Runtime Error Severity** is the shared impact level for a **Structured Runtime
Error**: `info`, `warning`, `error`, or `fatal`.
_Avoid_: recovery instruction, retry signal, package health taxonomy

**Runtime Error Recoverability** is the shared recovery path category for a
**Structured Runtime Error**: `none`, `retry`, `change_input`, `authenticate`,
`repair_state`, or `contact_support`.
_Avoid_: retryability boolean, recovery owner, confidence score

**Agent Hint** is an optional structured hint on a **Structured Runtime Error**
with `summary`, optional controlled `action`, and optional `docs_url`.
_Avoid_: executable command template, provider policy, sensitive context

**CLI Diagnostics Adapter** is a **Command Facade Adapter** that configures
facade-owned diagnostic mechanics at a front door, Gateway Command seam, or
test-isolation seam.
_Avoid_: package modules configuring LogTape or output channels directly

**Universal Diagnostic Flags** are facade-owned CLI flags for diagnostic
volume and correlation: `--quiet`, `--verbose`, `--debug`, and `--run-id`.
_Avoid_: package-specific flags with reserved diagnostic names

**Run Correlation ID** is the facade-owned opaque top-level CLI invocation
identity, spelled `run_id` in facade diagnostics and facade JSON envelopes.
_Avoid_: package-owned domain run id, browser run id, Memory OS source id,
encoded command or category metadata

**Domain Run Identity** is a package-owned runtime identity recorded alongside
the **Run Correlation ID** when legacy command output must preserve its own
`run_id`.
_Avoid_: treating two run identities as interchangeable

**Correlation-Aware JSON Writer** is the facade JSON writer that adds the
current **Run Correlation ID** and **Command Duration** to object-shaped command
results inside an active CLI diagnostic context.
_Avoid_: per-command `run_id` injection, facade envelope around arrays

**Command Duration** is facade-measured wall-clock elapsed time for one CLI
command invocation, spelled `duration_ms` in facade JSON envelopes.
_Avoid_: package-owned domain timing evidence

**Post-Mortem Diagnostic Buffer** is the default-mode diagnostic sink that keeps
bounded lower-severity LogTape records silent until an error or fatal record
flushes the current diagnostic context.
_Avoid_: always-on debug output, buffer keyed only by public `run_id`

**Diagnostic Trail Reference** is the facade-owned runtime narrowing of the
`cli-author` design-layer Diagnostic trail pointer: one CLI invocation points
to a package-owned **Diagnostic Capability** for the same **Run Correlation ID**.
_Avoid_: raw log access, trace vendor contract, retention policy, package event
catalog, persisted diagnostics access

**Write Preview Capability** is the mode-backed declaration that a mutating
command has a `check` or `dry_run` execution path, or a package-owned exception
when safe preview is not possible.
_Avoid_: rich write-safety schema, idempotency policy, rollback policy, fake
preview

**Persisted Diagnostics Access** is the future product decision for how
longer-lived diagnostic logs are exposed, scoped, authorized, retained, and
deleted across local, shared, or protocol-visible surfaces.
_Avoid_: facade runtime shape, raw log pointer, package event meaning

**Gateway Command** is a package-owned machine handoff seam that may use facade
diagnostics without becoming a selected unified route.
_Avoid_: every package script as a public route

## Relationships

- `package.json` exports approve `@side-quest/cli-command-facade` as the
  production root and `@side-quest/cli-command-facade/testing` as the only
  public subpath.
- CLI Command Facade exports its production Interface from the package root.
  Production consumers import from `@side-quest/cli-command-facade`, not public
  subpaths.
- The **Facade Testing Subpath** is the approved exception for package-agnostic
  test support. Consuming package tests may import from
  `@side-quest/cli-command-facade/testing` and extend shared fixtures locally.
- A **Command Surface Alignment Proof** may use **Facade Testing Subpath**
  helpers, but consuming packages supply command examples, expected public
  outcomes, runtime semantic probes, and domain-specific assertions.
- CLI Command Facade depends on LogTape and Node built-ins for diagnostics, but
  must not import from `plugins/**` or learn consumer topology.
- CLI Command Facade owns generic command metadata grammar, command discovery
  grammar, projection helpers, shape-level drift checks, usage helpers, JSON
  writing, diagnostic flag parsing, stdout/stderr discipline, LogTape setup,
  generic redaction, **Run Correlation ID**, **Command Duration**, and
  **Post-Mortem Diagnostic Buffer** mechanics.
- The **Agent-Native CLI Runtime Contract** is a shared runtime-contract
  umbrella. Its slices may share validation and projection mechanics, but they
  must keep package-owned error families, recovery meaning, retry policy,
  command examples, identifiers, sensitive context, and public JSON field names
  local.
- A future **Agent-Native CLI Runtime Lifecycle Helper** may enter CLI Command
  Facade only when it owns generic lifecycle mechanics needed by **cli-author**
  as repeatable contract-emission surface or already shared by consuming
  packages. It must not own command catalogs, route tables, dispatch policy,
  package error families, recovery meaning, diagnostic event names, redaction
  extensions, result schemas, or runtime lanes.
- Browser Automation front-door runners and Memory OS command runners are
  consuming-package surfaces, not facade-owned ones. Keep adoption posture and
  migration rationale in consuming-package context until a shared ADR exists.
- Runtime-contract-compatible success output must carry the facade **Run
  Correlation ID** as its mandatory success metadata spine, while success
  envelope shape remains package-owned or ADR-owned.
- Agent-native command contracts must declare **Baseline Exit Semantics**.
  Additional exit codes remain package-owned and must earn their place through
  distinct agent routing value. The runtime owner is `findBaselineExitCodeDrift`
  (`runtime/cli-command-facade/src/baseline-exit-drift.ts`) over
  `COMMAND_FACADE_BASELINE_EXIT_CODES`
  (`runtime/cli-command-facade/src/command-contract.ts`), run by
  `findCommandFacadeMetadataDrift`
  (`runtime/cli-command-facade/src/command-metadata.ts`) and
  `findCommandDiscoveryTreeDrift`
  (`runtime/cli-command-facade/src/command-discovery.ts`). The per-code
  categories are emitted by the code; docs must not restate that catalog.
- **Run Correlation ID** values are opaque. Package name, command name, run kind,
  trace ID, span ID, category, and environment belong in separate package-owned
  payload, diagnostic, resource, or future observability metadata.
- ADR-0010 ideal envelopes do not require a top-level schema or version field;
  versioning belongs to the runtime-contract package and package-owned data
  schemas.
- Agent-facing payload schema/version meaning belongs in **Result Contract
  Discovery** when discovery is needed, not as mandatory runtime envelope
  metadata.
- Consuming packages that declare **Result Contract Discovery** use the
  **Result Data Helper** for command result metadata attachment. The helper owns
  `contract_id` and `schema_version` placement; package payloads own the
  remaining result vocabulary.
- Name **Result Payload** types as structured object types. Do not force
  interface-shaped payloads through `Record<string, unknown>`, because that
  turns ordinary object interfaces into dictionary contracts.
- A broad `object` payload constraint is acceptable only with a runtime
  plain-object guard. The guard rejects null, arrays, functions, and reserved
  metadata collisions before helper output is spread or written.
- Use lifecycle or error-owned result contracts for generic failure data
  when result metadata is needed. Do not stamp generic error payloads with a
  command-specific success `resultContract`; that misreports the payload shape
  to agents and alignment tests.
- Runtime-contract adopters must provide structured runtime errors; failures
  are the highest-value agent path and must not be left as prose-only output.
- Runtime-contract adopters must provide redaction fixtures proving sensitive
  values do not leak through structured errors, hints, or runtime actions.
- Baseline runtime-contract redaction fixtures cover credentials, tokens,
  cookies, tenant and account IDs, local paths, command examples, payment and
  account data, scopes, browser debugger URLs, and auth-state paths.
- Runtime-contract redaction baseline fixtures and helpers are exported from
  the **Facade Testing Subpath** so package migrations can extend one shared
  baseline instead of copying it.
- **Structured Runtime Error** carries **Run Correlation ID**, error code,
  message, exit code, **Runtime Error Severity**, recoverability,
  retryability, and optional agent hint while keeping domain error families and
  recovery meaning package-owned.
- Construct **Structured Runtime Error** values through facade helper
  constructors so recoverability, retryability, hint, failure-domain, and unsafe
  text gates stay centralized. Typed convenience helpers cover common usage,
  repair-state, and retry failures; the generic structured error builder covers
  package-owned recovery choices such as `none` or `authenticate`.
- **Structured Runtime Error** fields use canonical snake_case spelling in the
  facade runtime-contract projection.
- **Failure Domain** values are package-owned labels. CLI Command Facade
  validates spelling and unsafe text only; it must not define a global failure
  domain enum.
- Package **Command Facade Adapters** own compatibility mapping from
  package-specific public field spelling into the canonical runtime-contract
  projection.
- **Runtime Error Recoverability** names the recovery path category. The
  `retryable` field separately says whether retrying the same input is allowed.
- `retryable: true` is valid only when **Runtime Error Recoverability** is
  `retry`, and **Runtime Error Recoverability** `retry` requires
  `retryable: true`; all other recovery paths require action before the same
  input can be retried.
- Retry delay metadata is optional and must be characterized before it becomes
  a runtime-contract field.
- **Agent Hint** gives a stable hint shape without owning package-specific
  recovery policy or executable command examples. Its optional `action` is one
  of `retry`, `change_input`, `authenticate`, `repair_state`, `open_docs`, or
  `contact_support`.
- **Agent Hint** `action` must match or refine **Runtime Error
  Recoverability** and must not contradict the recovery path.
- **Agent Hint** `docs_url` must be public-safe and non-sensitive; it must not
  carry tenant, account, credential, local path, or provider-secret context.
- The **Command Discovery Tree** projection trusts gated input: it is a pure
  shape transform, and the construction drift checks are the preventive layer.
  Every projected free-text value (not just env-var names) is scanned for unsafe
  content; instruction-shaped / prompt-injection text is a deliberate non-goal,
  so untrusted instruction-shaped text in projected fields stays an author
  responsibility, not a gated invariant. The scan owner is
  `validateProjectedFreeText`
  (`runtime/cli-command-facade/src/runtime-text-safety.ts`) over
  `RUNTIME_CONTRACT_UNSAFE_TEXT_PATTERNS`
  (`runtime/cli-command-facade/src/runtime-text-safety.ts`), run by
  `findCommandFacadeMetadataDrift`
  (`runtime/cli-command-facade/src/command-metadata.ts`) and mirrored by
  `findCommandDiscoveryTreeDrift`
  (`runtime/cli-command-facade/src/command-discovery.ts`).
- **Diagnostic Capability** is a **Command Capability Role**, not a mandatory
  route spelling. `doctor` is the preferred CLI spelling when a package has no
  established diagnostic route, but the facade validates the role, not the
  command name. The role vocabulary owner is `COMMAND_FACADE_CAPABILITY_ROLES`
  (`runtime/cli-command-facade/src/command-contract.ts`), declared on a
  contract via `capabilityRoles`, projected to `capability_roles`, and
  spelling-checked in `findCommandFacadeMetadataDrift`
  (`runtime/cli-command-facade/src/command-metadata.ts`) and
  `findCommandDiscoveryTreeDrift`
  (`runtime/cli-command-facade/src/command-discovery.ts`).
- Consuming packages own command catalogs, route inclusion, command names,
  mutation meaning, audience meaning beyond generic defaults, runtime lanes,
  risk and trust policy, result schemas, action meanings, redaction policy,
  diagnostic event names, output safety, and local Adapter placement.
- Browser Automation and Memory OS are consuming packages, not facade-owned
  ones: the facade does not treat either as an active ADR-0010 or **Agent-Native
  CLI Runtime Contract** migration target. Keep adoption posture and migration
  rationale in consuming-package context until a shared ADR exists.
- Result Contract Discovery stays shallow on meaning: the facade owns metadata
  and affordance shape, while consuming packages own schema versions, runtime
  result shapes, decision vocabulary, safe actions, and enforcement.
- Result Contract Discovery is the pre-run place for agent-facing package
  payload schema/version metadata; runtime results are not required to repeat
  those schema facts.
- **Action Affordance** is pre-run discovery vocabulary only. Per-run
  `runtime_actions` plus **Runtime Continuation Guidance** are authoritative
  for the current invocation.
- **Runtime Action Guidance** stays shallow on meaning: the facade owns the
  runtime projection shape, while consuming packages own the output field name,
  action meaning, recovery path, retry semantics, and sensitive context.
- **Runtime Continuation Guidance** stays shallow on meaning: the facade owns
  the runtime decision-frame shape, while consuming packages own action
  meanings, fallback policy, operator policy, recovery examples, and sensitive
  context.
- **Verdict-to-Envelope Projection** stays package-owned. The facade may supply
  envelope mechanics, but consuming packages own command-local verdict meaning,
  classifier placement, error code families, runtime action meanings, and tests.
- **Runtime Action Guidance** action IDs remain package-owned and do not use the
  **Agent Hint** controlled `action` vocabulary.
- **Runtime Action Guidance** may appear in successful results or error results
  because it describes runtime next steps, not only failure recovery.
- **Runtime Action Guidance** is projected through the canonical
  `runtime_actions` array field when present.
- `runtime_actions` must contain at least one action when present; omit the
  field when no runtime action is recommended.
- Runtime-contract-compatible envelopes that include `runtime_actions` must
  also include **Runtime Continuation Guidance**. Legacy adapters that omit it
  are legacy-preserved outputs, not the ideal ADR-0010 runtime-contract shape.
- Every **Runtime Action Guidance** action must include `side_effects`.
- Executable command examples are forbidden in the facade **Runtime Action
  Guidance** projection, but consuming packages may expose package-owned command
  examples outside the runtime-contract projection.
- Facade JSON envelopes add `run_id` and `duration_ms` only to object-shaped
  results written through facade envelope writers. Legacy domain JSON and
  primitive or array JSON values keep their package-owned shape.
- **Post-Mortem Diagnostic Buffer** isolation follows the active diagnostic
  context. Reusing the same public **Run Correlation ID** does not merge
  buffered records across command contexts.
- **Diagnostic Trail Reference** may be facade-owned only as the safe runtime
  shape for the broader design-layer Diagnostic trail pointer: a package-owned
  **Diagnostic Capability** plus correlation mechanics.
  Consuming packages and platform surfaces own diagnostics storage, access,
  retention, deletion, redaction extensions, and event meaning. The runtime
  owner is the `DiagnosticTrailReference` type and
  `validateOptionalDiagnosticTrail`
  (`runtime/cli-command-facade/src/runtime-envelope.ts`), carried on both
  runtime envelopes as `diagnostic_trail` and built through
  `createCliRuntimeSuccessEnvelope` / `createCliRuntimeErrorEnvelope`
  (`runtime/cli-command-facade/src/runtime-envelope.ts`). The allowed-keys gate
  is what keeps raw logs, trace URLs, retention, and access policy out of this
  shape.
- **Write Preview Capability** uses the existing execution-mode vocabulary.
  The facade may require write or destructive commands to declare `check`,
  `dry_run`, or a package-owned exception, but it must not define rollback,
  confirmation, idempotency, or exact preview behavior. The runtime owner is the
  write-preview cross-check in `findCommandFacadeMetadataDrift`
  (`runtime/cli-command-facade/src/command-metadata.ts`) over
  `PREVIEW_EXECUTION_MODES` and `WRITE_ESCALATING_SIDE_EFFECTS`
  (`runtime/cli-command-facade/src/command-metadata.ts`); the exception is the
  `previewExemption` contract field (`CommandFacadePreviewExemption`),
  reason-text only and safe-text scanned.
  Enforcement keys on the *honestly declared* side effect: a command that
  under-declares its own `sideEffects` carries no preview obligation, because
  `mutation` meaning is package-owned. Boundary decision: enforce preview only
  from honestly declared side effects; keep mutation meaning package-owned.
- **Persisted Diagnostics Access** is a future product decision. This package
  may reserve safe runtime shape for trail references, but it must not decide
  raw log access, trace vendor policy, or protocol-visible exposure rules.
- The `claude-code-config` cli-author reference is a downstream documentation
  consumer of this runtime shape, not an owner. Once these runtime-backed
  candidates land, the cli-author docs need a sync pass: **Baseline Exit
  Semantics**, **Diagnostic Capability**, the design-layer diagnostic trail
  pointer (now the facade **Diagnostic Trail Reference**), and **Write Preview
  Capability** are now runtime-enforced, superseding the old "declare, don't
  enforce" wording that said the facade does not judge sensible exit codes. That
  sync is a follow-up in the cli-author repo; this plan does not edit downstream
  docs.
- ADR-0005 owns the repo decision for facade-owned CLI diagnostics. ADR-0006
  owns the repo decision for facade-owned Result Contract Discovery.
- Package tests protect package-agnostic implementation, public-root imports,
  fake Adapter compatibility, discovery projection, result contract discovery,
  JSON envelope conflicts, diagnostic flag parsing, stdout/stderr separation,
  context propagation, post-mortem buffering, and generic redaction.

## Example dialogue

> **Dev:** "Can the facade decide which Browser Automation commands appear in
> `agent-context`?"
> **Domain expert:** "No. The facade owns discovery grammar and projection
> helpers; Browser Automation owns route inclusion and browser-specific labels."

> **Dev:** "Should Browser Automation keep its legacy runtime output behind a
> permanent compatibility adapter?"
> **Domain expert:** "The facade should not decide that. Browser Automation is
> legacy consumer evidence, not an active facade migration target. If package
> maintenance resumes, choose package-owned migration or legacy preservation
> based on concrete callers and tests."

> **Dev:** "Memory OS imports the facade. Does that mean Memory OS has adopted
> CLI diagnostics?"
> **Domain expert:** "No. Facade adoption is slice-by-slice. Memory OS
> currently proves metadata and discovery usage, not public CLI diagnostics."

> **Dev:** "Should the facade expose a generic `runContractCli` helper?"
> **Domain expert:** "Only if it is a narrow **Agent-Native CLI Runtime
> Lifecycle Helper**. It may own generic invocation mechanics, but not command
> routing, package dispatch policy, diagnostic vocabulary, redaction
> extensions, schemas, or recovery meaning."

> **Dev:** "Should every agent-native CLI invent its own structured errors,
> hints, exit codes, and retry slots?"
> **Domain expert:** "No. Use the **Agent-Native CLI Runtime Contract** as the
> shared source of truth, then let each package map its domain meaning into the
> relevant runtime-contract slices."

> **Dev:** "Does the runtime contract own the whole success JSON envelope?"
> **Domain expert:** "No. It requires a **Run Correlation ID** success metadata
> spine for runtime-contract-compatible output. ADR-0010 owns the ideal public
> JSON envelope for new runtime-contract CLIs; consuming packages own legacy
> envelope compatibility until migration."

> **Dev:** "Where should an agent learn what the `data` payload means?"
> **Domain expert:** "From **Result Contract Discovery** when the command
> exposes that metadata. The ADR-0010 runtime envelope does not require a
> top-level `data_schema` or schema version field."

> **Dev:** "Should package tests import redaction helpers from the production
> root?"
> **Domain expert:** "No. Use the **Facade Testing Subpath**. The production
> root stays clean, while package tests can extend shared redaction fixtures."

> **Dev:** "Can a CLI adopt the runtime contract but keep prose-only errors?"
> **Domain expert:** "No. Structured runtime errors are mandatory for
> runtime-contract adoption because failures are where agents most need a
> stable machine-readable path."

> **Dev:** "Should structured errors wait to add severity and recoverability?"
> **Domain expert:** "No. They are part of the minimum failure spine, alongside
> retryability, so agents can decide whether to retry, stop, or escalate without
> guessing from prose."

> **Dev:** "Can a Result Contract Discovery action include the command template
> to run the repair?"
> **Domain expert:** "No. The facade advertises safe action metadata, not
> executable repair policy. The consuming package owns what the action means and
> how it is performed."

> **Dev:** "Can runtime command output reuse **Action Affordance** for
> `next_action`?"
> **Domain expert:** "Use **Runtime Action Guidance** instead. **Action
> Affordance** is static discovery metadata before execution; runtime output is
> derived from package-owned command results."

> **Dev:** "A package result already has `run_id`. Should `writeCliJson` keep
> it?"
> **Domain expert:** "Only if it matches the current CLI **Run Correlation ID**.
> If the package must preserve a legacy domain `run_id`, use the legacy-domain
> writer path and record the **Domain Run Identity** separately."

## Flagged ambiguities

- Resolved: "uses the facade" is not a single adoption state. Name the
  specific **Command Facade Interface Slice** a package has adopted.
- Resolved: runtime CLI behavior should converge through the **Agent-Native CLI
  Runtime Contract** rather than many package-local mini-contracts, while each
  slice still has its own adoption and compatibility rules.
- Resolved: future lifecycle helpers may own generic CLI invocation mechanics,
  but they must not become command routers, package front doors, diagnostic
  taxonomy owners, recovery policy owners, or schema owners.
- Resolved: success output is not one global envelope. The runtime contract owns
  the mandatory **Run Correlation ID** success metadata spine. ADR-0010 owns
  the ideal public JSON envelope for new runtime-contract CLIs; consuming
  packages own legacy envelope compatibility until migration.
- Resolved: WOTS and xero-cli are prior-art learning sources, not assumed
  migration targets. Browser Automation and Memory OS are legacy in-repo
  consumer evidence, not active migration targets for ADR-0010 or the
  **Agent-Native CLI Runtime Contract**.
- Resolved: direct ADR-0010 migration is the default for actively maintained
  in-repo CLIs; legacy or deprecated consumers need package-owned maintenance
  before they can constrain facade shape.
- Resolved: the ADR-0010 ideal success envelope uses `status: "ok"`, `run_id`,
  `data`, optional `runtime_actions`, and **Runtime Continuation Guidance**
  whenever `runtime_actions` is present.
- Resolved: the ADR-0010 ideal error envelope uses `status: "error"`, `run_id`,
  `error`, optional `runtime_actions`, and **Runtime Continuation Guidance**
  whenever `runtime_actions` is present, where `error` is a **Structured
  Runtime Error**.
- Resolved: the ADR-0010 ideal envelope does not require a top-level schema or
  version field; package-owned data schemas and runtime-contract package
  versioning own version meaning.
- Resolved: package payload schema/version meaning belongs in **Result Contract
  Discovery** when agent-facing discovery is needed, not as required runtime
  result metadata.
- Resolved: reusable redaction test fixtures/helpers live under the **Facade
  Testing Subpath**, not the production package root or private implementation
  paths.
- Resolved: a reusable **Command Surface Alignment Proof** helper may live under
  the **Facade Testing Subpath**, but the facade still must not derive parser
  allowlists or own command runtime semantics.
- Resolved: structured runtime errors are mandatory for runtime-contract
  adoption, not an optional later add-on.
- Resolved: redaction fixtures are mandatory for runtime-contract adoption;
  packages own domain redaction policy, but must prove sensitive values do not
  leak through agent-readable output.
- Resolved: baseline runtime-contract redaction fixtures cover credentials,
  tokens, cookies, tenant and account IDs, local paths, command examples,
  payment and account data, scopes, browser debugger URLs, and auth-state paths.
- Resolved: **Structured Runtime Error** minimum shape includes **Run
  Correlation ID**, error code, message, exit code, severity, recoverability,
  retryability, and optional agent hint, spelled as snake_case fields in the
  facade runtime-contract projection.
- Resolved: package-specific field spelling belongs in consuming package
  Adapters; the facade validates canonical runtime-contract projections only.
- Resolved: **Runtime Error Severity** means impact level only: `info`,
  `warning`, `error`, or `fatal`. Recoverability and retryability own what an
  agent can do next.
- Resolved: **Runtime Error Recoverability** means recovery path category:
  `none`, `retry`, `change_input`, `authenticate`, `repair_state`, or
  `contact_support`. It is not the same as the `retryable` boolean.
- Resolved: **Runtime Error Recoverability** `retry` and `retryable: true`
  imply each other.
- Resolved: retry delay metadata is optional and characterization-driven, not
  mandatory for every retryable error.
- Resolved: **Agent Hint** is a structured object with `summary`, optional
  controlled `action`, and optional `docs_url`. It must not contain executable
  command templates or sensitive context.
- Resolved: **Agent Hint** `action` must match or refine **Runtime Error
  Recoverability**; contradictory hints are invalid.
- Resolved: **Agent Hint** `docs_url` is allowed only when public-safe and
  non-sensitive.
- Resolved: **Result Contract Discovery** owns generic discovery shape, not
  runtime result schemas, schema enforcement, action meanings, or command
  templates.
- Resolved: **Action Affordance** and **Runtime Action Guidance** are separate.
  **Action Affordance** is static discovery metadata; **Runtime Action
  Guidance** is a runtime projection shape over package-owned output.
- Resolved: **Runtime Action Guidance** validates `id`, `summary`, and
  `side_effects`; its `id` is package-owned and is not the **Agent Hint**
  `action` vocabulary.
- Resolved: **Runtime Action Guidance** may appear in success or error results.
- Resolved: **Runtime Action Guidance** is plural by default: canonical
  projection field `runtime_actions` is an array.
- Resolved: `runtime_actions` is omitted when empty; if present it must contain
  at least one action.
- Resolved: every **Runtime Action Guidance** action requires `side_effects`.
- Resolved: executable command examples do not belong in the facade **Runtime
  Action Guidance** projection. Packages may expose them in package-owned output
  outside the runtime-contract projection.
- Resolved: `run_id` is collision-prone vocabulary. In facade diagnostics and
  facade JSON envelopes it means **Run Correlation ID**; package-owned runtime
  identities should be named as domain run identity or by the consuming
  package's own term.
- Resolved: **Run Correlation ID** is opaque correlation identity, not a compact
  carrier for command names, package names, run kinds, trace/span IDs,
  categories, or environments.
- Resolved: **Gateway Command** is useful facade boundary language, but concrete
  Gateway Command inventories and package-only classifications belong to the
  consuming package map.
- Resolved: **Post-Mortem Diagnostic Buffer** is keyed by diagnostic context
  when possible, not by public **Run Correlation ID** alone.
- Remaining: new runtime-contract helpers need production CLI characterization
  or a clearly package-agnostic invariant before their interfaces are locked.
