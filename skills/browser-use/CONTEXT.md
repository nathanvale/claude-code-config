# Browser Use

Scoped vocabulary for browser-use: Warm Chrome, Browser Adapters, the browser-connect handoff, durable browser knowledge, and playback modes. Glossary only.

## Language

### Retired terms (Router era)
The Browser Adapter Router command surface (Router CLI with prepare/route/report, Browser Adapter Proof, Browser Adapter Map) is deleted; `runtime/browser-connect` owns the connection and its Verified Handoff Envelope replaced route evidence. The `browser-adapter-router-*.ts` engine/model/recovery/validation modules survive only as dormant dead code pending removal — no live import edge — not agent vocabulary. Retired — do not reintroduce as live terms: Validated Route Evidence Envelope, Adapter capability report, Router Recovery, Route Validity, Route Evidence Invalid, Research Recovery, Browser Adapter Router, Browser Adapter Proof, Browser Adapter Map, Browser Adapter Command Resolution, Bounded Browser Outcome (live per-attach scoping is Shared Browser Use Run + Task Intent), route-bound (renamed handoff-bound), Evidence-First Selection (its evidence-or-recovery discipline lives on in browser-connect's fail-closed gates).

### Retired terms (browser memory era)
`browser-domain-memory` is archived with no compatibility route. Browser Use owns future durable browser knowledge and capture work.

### Browser entry and adapters
**browser-use**:
The browser-work capability. It owns browser operational policy and Durable Browser Knowledge, including Item Bindings, Browser Runbooks, capture, and playback. It delegates proven connection to `browser-connect` and generic secret-access safety to `one-password`.
_Avoid_: browse, play, browser adapter, browser orchestrator, browser memory skill, owns all browser entry

**Daily Driver Acceptance Proof**:
The release-readiness claim that Browser Use can complete its intended everyday workflows through its public front door across supported repositories, Browser Adapters, authentication states, and Durable Browser Knowledge. A missing capability fails the claim; an unavailable environment records blocked evidence, never pass or skip.
_Avoid_: smoke test, current-surface test, Command Entrypoint Integration Test, partial readiness

**Warm Chrome**:
A reusable authenticated browser environment that `browser-use` drives for login-heavy workflows. It is distinct from the everyday Chrome profile and from Browser Adapters; separate identities may require separate Warm Chrome environments.
_Avoid_: default Chrome profile, adapter browser, Chrome for Testing, cold browser

**Authenticated Session Reuse**:
Use of the still-live authenticated state in the selected Warm Chrome environment by any attached Browser Adapter, after Browser Use proves the expected account and login state. Expiry, logout, account drift, or environment change ends reuse and requires a fresh authentication path.
_Avoid_: cross-adapter session store, session transfer, permanent login, credential cache

**Session Identity Proof**:
Per-portal evidence that a live authenticated session belongs to the expected subject, account, and tenant. Prefer stable machine-readable identity; when unavailable, require at least two independent page-level identity facts plus exact mutation-target ownership and scope proof. Session presence, cookies, or one display label alone do not prove identity. Missing, conflicting, or non-unique evidence means proof is absent; it never silently degrades.
_Avoid_: name-badge check, logged-in assumption, cookie-presence proof

**Human Identity Attestation**:
A one-run human assertion of the current subject, account, tenant, and mutation target when Session Identity Proof cannot be completed. It never becomes a standing exception, overrides a proven identity mismatch, or survives target change.
_Avoid_: identity override, standing identity exception, trust-me approval

**Browser Use Security**:
The local security capability that establishes human authority and confines credential retrieval and delivery for Browser Use. It returns admitted security outcomes without making Browser Adapters, Browser Connect, or One Password owners of browser authorization.
_Avoid_: auth adapter, credential manager, secret daemon, browser security process

**Environment-Injected OP Lane**:
The explicitly lower-assurance Browser Use credential path whose service-account authority is made available at process launch. Its vault authority is read-only; host-local persistence is a deployment tradeoff, never signed native admission.
_Avoid_: env-var OP custody lane, ambient OP access, unsigned Browser Use Security lane, native fallback

**Confidential Field Delivery Helper**:
The disposable, transaction-internal process that receives one raw username, password, or current OTP value through a private inherited pipe and writes it to one pre-proven browser field through a pre-opened verified browser-channel handle. It is one of only two raw-secret processes; the other is the disposable 1Password helper. Task adapters, adapter plugins/daemons, long-lived Browser Use processes, and the approval broker never receive the value. The helper is not a Browser Adapter and never changes the selected task lane.
_Avoid_: auth adapter, credential broker, secret daemon, Agent Browser login helper, adapter-native secret fill

**Warm Chrome Runtime Package**:
The independently hardened browser-entry layer shipped as `runtime/warm-chrome` (`@side-quest/warm-chrome`). It implements the Warm Chrome proof — verifying that a candidate browser endpoint satisfies the Warm Chrome contract. `runtime/browser-connect` is the front door that consumes this proof, injects the verified endpoint, attaches the adapter, and mints the Verified Handoff Envelope; `browser-use` is the downstream consumer of that envelope and owns no entry or proof logic itself.
_Avoid_: Warm Chrome product, separate browser product, browser-use replacement, browser-use-owned entry layer

**Suggested Explicit Port**:
An informational repair hint emitted when the Warm Chrome convention port is
occupied by a foreign listener. It is advisory only — never an allocation,
binding, or identity. It becomes usable only after an explicit rerun passes
the Warm Chrome proof.
_Avoid_: port allocation, automatic rebinding, durable port binding, port authority

**Warm Chrome Preflight**:
The readiness proof that `runtime/browser-connect` (the front door) runs before any Browser Adapter acts, delegating to `runtime/warm-chrome` for implementation. It verifies that a candidate browser endpoint satisfies the Warm Chrome contract; adapters consume the result via the Verified Handoff Envelope rather than owning separate readiness policies. `browser-use` is not the proof owner — it consumes the envelope.
_Avoid_: manual checklist, browser-domain-memory preflight, browser-use-owned preflight

**handoff-bound**:
The `targets` discovery mode whose binding evidence is the browser-connect Verified Handoff Envelope. Formerly route-bound, whose evidence was the Router's route artifact; the rename keeps "route" grounded in browser-connect's attachment-route sense. `recovery` mode keeps its name and yields evidence-gathering candidates, not operation-ready ones.
_Avoid_: route-bound, route artifact, proof-bound

**Shared Browser Use Run**:
The one durable run record the platform owns for browser work (owner: `skills/browser-use/src/browser-use-run-model.ts`). It carries exactly one run state, a compare-and-swap revision, environment/profile identity, the opaque versioned auth fragment slot, and exactly one next safe action when blocked. Platform code is its only writer; authentication reaches it only through the run integration Port and never writes run state directly. Caller metadata on a run is audit-only and never authority.
_Avoid_: auth-owned run, second run lifecycle, task log, caller-scoped run

**Task Intent**:
A code-owned name for the outcome class a browser request wants (owner: `skills/browser-use/src/browser-use-run-model.ts`; projected by `browser-use task list`). Prose interprets language into a Task Intent; code proves lane capability. Runbook execution, trace inspection, and HTTP replay are distinct intents, and a Lighthouse audit is not performance profiling. An intent whose preferred lane is unregistered stays typed-unavailable, never silently rerouted.
_Avoid_: task type guess, adapter name, freeform intent string, capability claim

**Browser Adapter**:
Within `browser-use`, the native tool surface selected after browser-connect returns a Verified Handoff Envelope. The Browser Adapter owns target discovery, tab and session continuity, navigation, actions, snapshots, screenshots, evaluation, debug output, and adapter-specific recovery. The LLM reads and invokes that native surface; Browser Use does not translate it. Browser Adapters do not own authenticated browser state, browser entry, policy, authority, or durable browser knowledge, and they never find Chrome themselves. The canonical environment-agnostic definition is owned by `runtime/browser-connect/CONTEXT.md`; this entry is the `browser-use` consumer view of it.
_Avoid_: Browser Use executor, command mapping, cold adapter, isolated adapter, playback mode, front door, browser entry point, browser owner, memory owner, self-discovering adapter

**Browser Entry Handoff**:
A request from a browser-consuming capability back to `browser-use` when the Warm Chrome environment is missing, wrong, unattached, or otherwise not ready. It stops Browser Adapter work, not the agent, when `browser-use` has a safe recovery path. It is not a CLI runtime or dependency failure. It is the failure-direction mirror of browser-connect's success-direction **Verified Handoff Envelope** (a proven connection handed forward to a consumer): the Browser Entry Handoff hands an *unready* state back; the Verified Handoff Envelope hands a *proven* connection forward. Both names live; do not conflate them.
_Avoid_: Verified Handoff Envelope, connection success, CLI runtime failure, self-repair, direct browser launch, adapter fallback, operator stop

### Architecture boundary

ADR 0031 owns this boundary. Earlier Browser Facade and per-lane GoF Adapter vocabulary is retired.

**Adapter-Native Delegation**:
The Browser Use execution boundary: prose interprets Task Intent and the LLM drives the selected Browser Adapter through its native help or tool schema after verified attachment. Browser Use owns intent, routing policy, authority, and the bounded outcome. Browser-connect owns verified attachment. The adapter owns every browser mechanic, including finding and switching tabs, navigation, clicks and fills, snapshots, screenshots, evaluation, findings, session continuity, and adapter-specific recovery. Browser Use never copies command names, argv, response parsing, refs, page IDs, tab indexes, session rules, action postconditions, or retries.
_Avoid_: Browser Facade, universal browser API, per-lane native executor, adapter command map, normalized action vocabulary

**Differential Oracle** (target vocabulary, unbuilt):
A mechanical Set-diff over N independent Browser Adapters observing one Warm Chrome, producing consensus / confidence / quorum. It is **N-version programming** (independent re-derivations voted in code), not a Facade — its value is to SURFACE per-engine divergence, never hide it. The LLM consumes its verdict; it does not produce it. Proven in `src/prototype-playwright-vocab-map/` only; live adapters run single-engine per lane, no N-adapter fan-out.
_Avoid_: facade, LLM oracle, model judgment, single-engine check, consensus engine

### Durable browser knowledge

The capture/playback terms below (Browser capture, Scratch Evidence, Recorder JSON, Browser Gotcha, Run Outcome per-mode metrics, and the three playback modes) are **planned target vocabulary — not yet shipped**. Shipped today: one declarative v2 Browser Runbook keyed by `service_id`/`flow_id`, executed through the agent-browser lane. The compounding capture loop is unbuilt (ledger DDA-E14/E16).

**Browser capture** (planned, unbuilt):
The Browser Use workflow that turns messy browser-run evidence into Durable Browser Knowledge. It may use raw Scratch Evidence as source material, but durable output is curated knowledge, not a trace.
_Avoid_: capture everything, raw trace archive, recording, replay capture, capture skill

**Scratch Evidence** (planned, unbuilt):
Redacted browser-run source material selectively retained when a run teaches something: capture, drift, failure, ambiguity, user-requested save, or promotion proof. It is not kept for every clean replay, not trusted memory, not a runbook, and not a durable replay artifact.
_Avoid_: recording, trace, tape, replay file, raw history, durable instruction

**Durable Browser Knowledge**:
Curated, trusted per-domain browser memory used to make future `browser-use` runs faster and safer. Shipped: Item Bindings (surviving legacy Auth Pointers are Import Candidates) and Browser Runbooks. Planned (unbuilt): Browser Gotchas, optional Recorder JSON for deterministic-ready flows, and other model-readable notes.
_Avoid_: scratch, trace archive, replay library, browser automation store

**Private Runbook Catalog**:
The private, Git-versioned authoring source for all Browser Runbooks. It follows the operator across machines through repository sync; runtime execution uses an activated immutable projection rather than mutable catalog files.
_Avoid_: shipped runbook catalog, user runbook catalog, public runbook defaults, XDG authoring store

**Runbook Draft**:
A complete candidate Browser Runbook document supplied to validation and apply. It has no runtime authority until apply writes it to the Private Runbook Catalog and a later activation includes it in a Runbook Generation.
_Avoid_: steps file, partial runbook, runbook patch, active runbook

**Runbook Generation**:
A validated immutable XDG projection of the complete Private Runbook Catalog and its referenced Reviewed Actions. A generation may be staged, active, or previous; runtime execution uses the selected active generation, and replacing it requires explicit catalog activation.
_Avoid_: Corpus Generation, Active Runbook Generation, mutable XDG override, XDG runbook source, live repo read, build-dist activation

**Storage key**:
Browser Runbooks are keyed by `service_id`/`flow_id`. The private Binding Catalog resolves a Binding Reference by service, auth context, environment, and profile; the selected receipt carries exact origin and method authority. There is no hostname-derived storage key.
_Avoid_: Browser Domain Key, canonical hostname key, display name key, tenant key, account key

**Flow Name**:
Human-readable label (`flow_name`) for a repeated browser intent, such as `submit-timesheet` or `download-invoice`. It helps humans and LLMs find the right Browser Runbook; the machine key is `flow_id`. Change the name when the user intent changes, not when the flow's steps change.
_Avoid_: Browser Flow Slug, opaque id, URL slug, page slug

**Auth Pointer**:
The legacy-era name for what is now the Item Binding: a safe per-domain reference to the 1Password account, vault, item, fields, OTP fields when available, approved origins, optional login paths, and login context needed for browser auth. Surviving legacy pointers are Import Candidates — they propose and never bind. Use Item Binding for new work.
_Avoid_: password note, secret mapping, auth tape, login recording, live binding authority

**Item Binding**:
The Browser Use relationship between one profile-scoped Binding Reference and exactly one Login item. Durable authority comes from a Binding Approval Receipt; runtime use requires a Verified Item Binding, never a request label or discovery match alone. Successor to the Auth Pointer.
_Avoid_: auth pointer (new work), credential mapping, vault allowlist, unsigned binding cache, shared binding, auto-rebind

**Binding Reference**:
A portable Runbook role for one credential relationship, resolved within the Runbook's service and auth context plus the selected environment and profile. It never contains a vault item id or encodes a credential field in its name.
_Avoid_: item binding slug, vault item id, binding id, credential-field suffix

**Binding Approval Receipt**:
An immutable ApprovalBroker-signed snapshot of one human-approved Binding Reference revision: service, auth context, environment, profile, exact vault item, exact origins, and exact credential methods. A replacement or expansion creates a complete new revision; revocation leaves no active revision.
_Avoid_: selection hint, one-match approval, mutable binding record, standing auto-selection

**Vault Item Evidence**:
Current redacted facts observed from the token-scoped vault for one item, including liveness and exact origin or method evidence. It can invalidate or constrain a receipt but never supplies service, auth-context, environment, profile, or human-selection authority.
_Avoid_: item authority, binding source, trusted discovery match, request context

**Verified Item Binding**:
The ephemeral runtime projection produced only when the active Binding Approval Receipt verifies and exact live Vault Item Evidence still satisfies it. Replacement, revocation, signature failure, item drift, or scope drift stops further confidential delivery immediately.
_Avoid_: cached item binding, discovered binding, selected candidate, durable binding record

**Binding Catalog**:
The private local owner of immutable Binding Approval Receipt revisions and the active revision for each profile-scoped Binding Reference. Runbooks remain portable; run state pins the resolved revision, while use-time verification still honors replacement and revocation.
_Avoid_: Runbook Catalog, source-controlled vault map, per-run receipt copy, binding event fold

**Import Candidate**:
A legacy-derived proposal handed to the candidate-import Interface during platform migration. Live vault evidence may rank eligible items, but only a signed Binding Approval Receipt binds one. Item and vault hints remain redacted ranking provenance; legacy-only origins require explicit approval; a secret-positive candidate is refused per candidate, never salvaged in place.
_Avoid_: trusted import, binding transplant, legacy authority, bulk bind, migrated credential

**Browser Runbook**:
The one active durable path for a known browser flow, keyed by `service_id`/`flow_id`. The current v2 form is declarative: typed inputs and runtime-resolved semantic targets (role + name, resolved to exactly one match against a fresh page snapshot), with no stored CSS selectors, inline JavaScript, or login choreography. It may declare a non-secret auth-context ref, reference separately promoted Reviewed Actions, and name a portable Binding Reference plus an explicit credential field for confidential fills, but never secret values or 1Password item details. It may retain prior versions for rollback; only one current runbook is active.
_Avoid_: automation script, login runbook, CI fixture, raw trace, stored selectors, inline JavaScript, Recorder JSON pairing

**Browser Authentication Transaction**:
The per-run authentication path entered when a Browser Runbook declares an auth-context ref. It resolves the active Binding Approval Receipt, combines it with live Vault Item Evidence, and lets the generic login engine use the resulting Verified Item Binding for the approved credential fields; Browser Runbooks and Reviewed Actions never own login steps or receive credential values.
_Avoid_: login runbook, auth action, stored login choreography, portal-specific login script

**Reviewed Action**:
A content-addressed JavaScript business capability promoted independently of a Browser Runbook. Its registry record binds exact bytes to one origin, effect class, input and result schemas, postcondition, and human approval; a runbook may reference only its action id and expected digest.
_Avoid_: inline runbook script, self-approved action, auth script, unreviewed fast path

**Recorder JSON** (planned, unbuilt):
A deterministic replay artifact intended to pair with a Browser Runbook once deterministic replay ships. It would contain replayable business-workflow steps, but never login selectors, login choreography, secret values, or 1Password item details. No type, parser, or pairing exists in code yet (v2 dropped v1 record/replay).
_Avoid_: recording, raw trace, transcript, secret replay file

### Playback modes (planned, unbuilt)

The three modes below are target vocabulary; no `replayMode` config surface exists in code. Shipped today is a single declarative execution path (the v2 Browser Runbook through the agent-browser lane).

**Prose mode** (planned, unbuilt):
The mode where a reasoning agent reads model-readable Durable Browser Knowledge and re-drives Warm Chrome through `browser-use`, using runbooks and gotchas to reduce discovery while still inspecting and judging the page. It does not consume Recorder JSON. The intended flexible default.
_Avoid_: coded replay, deterministic replay, manual mode

**Runbook mode** (planned, unbuilt):
The mode where code reads a Browser Runbook and drives Warm Chrome through a Browser Adapter step-by-step, resolving stored targets, waits, asserts, and coded heal ladders without an LLM call per step. It does not consume Recorder JSON. The intended fast tool-neutral path once the runbook is refined.
_Avoid_: prose mode, puppeteer replay, LLM replay

**Deterministic mode** (planned, unbuilt):
The mode where a Browser Runbook's Recorder JSON replays against Warm Chrome through a Browser Adapter — fast, zero reasoning rounds, secret-value-free, and repaired through the heal/recapture loop when drift breaks playback. Secret field values come from live 1Password resolution via the Item Binding. The intended fast opt-in.
_Avoid_: machine-play, tape execution, CI replay

**Run Outcome**:
The result recorded on the Shared Browser Use Run via `recordTaskRunOutcome` (owner: `browser-use-run-model.ts` / `browser-use-runs.ts`), keyed by run id. It tracks date, result, and what the run did. (Per-mode value metrics are planned, pending the playback modes above.)
_Avoid_: test result, execution proof, success metric in prose, `<flow>.runs.jsonl`

**Browser Gotcha** (planned, unbuilt):
A non-obvious domain fact, fork, trap, warning, label mismatch, slow state, or fragile condition that would help future browser work. Intended as one broad bucket rather than a generic browser note type. No gotcha record or storage exists yet.
_Avoid_: note, trivia, ordinary noise, raw observation

**Compound browser knowledge** (planned, unbuilt):
The intended loop where browser work produces learning evidence, Browser capture distills it into Durable Browser Knowledge, and later Browser Use runs start from that knowledge. The compounding is curated memory, not blind capture-everything.
_Avoid_: raw record/replay everything, browser automation engine

## Example Dialogue

Dev: "Should `browser-use` remember the login path it just discovered?"
Domain expert: "That is the intent, through Browser capture (planned). Browser Use owns the resulting Durable Browser Knowledge."

Dev: "Can Browser capture open or repair Warm Chrome?"
Domain expert: "No. Browser Use routes connection and repair through `browser-connect`; capture owns knowledge, not browser entry."

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
Domain expert: "No. `browser-connect` proves the environment before any adapter acts; adapters consume the Verified Handoff Envelope and never find Chrome themselves."

Dev: "Is browser capture a separate skill?"
Domain expert: "No. Browser capture is a Browser Use workflow that distills messy browser-run evidence into Durable Browser Knowledge."

Dev: "Is the Chrome Recorder-shaped JSON a recording?"
Domain expert: "Not by itself. In the planned capture path, Recorder-shaped Scratch Evidence would be retained as source evidence, but only verified Recorder JSON would be durable replay material."

Dev: "What does browser capture create?"
Domain expert: "Durable Browser Knowledge: curated runbooks, gotchas, and notes future `browser-use` runs can trust. Item Bindings arrive through the auth discovery and selection policy, not through capture."

Dev: "Do we need a generic browser note type?"
Domain expert: "No. Durable Browser Knowledge has Item Bindings, Browser Runbooks, and Browser Gotchas. Broaden Browser Gotcha for non-obvious useful facts."

Dev: "Where does the 1Password item path for a portal live?"
Domain expert: "As an Item Binding in Durable Browser Knowledge; a surviving legacy Auth Pointer only proposes as an Import Candidate. `one-password` owns safe access mechanics, not the domain-specific item choice."

Dev: "Should a Browser Runbook repeat the login steps?"
Domain expert: "No. It declares an auth-context ref; the Browser Authentication Transaction resolves the Item Binding and the generic login engine owns the current page shape."

Dev: "Can a runbook click through the site next time?"
Domain expert: "Today a v2 Browser Runbook drives the flow declaratively through the agent-browser lane, resolving semantic targets against a fresh snapshot. Faster playback modes (Runbook, Deterministic) are planned, not yet shipped."

Dev: "Can Browser capture choose `agent-browser` or Chrome DevTools MCP directly?"
Domain expert: "No. It requests a Task Intent. Browser Use owns adapter policy and selection."

Dev: "What's the default Browser Adapter?"
Domain expert: "There isn't a fixed default. `browser-use` selects by requested outcome and verified adapter capability."

Dev: "Can `browser-use` pick the likely best adapter when connection evidence is missing?"
Domain expert: "No. Missing evidence fails closed — mint a fresh Verified Handoff Envelope through `browser-connect`; adapters never switch automatically."

Dev: "Is Puppeteer banned?"
Domain expert: "Puppeteer launch paths are banned. `puppeteer-core` is deterministic replay detail that connects to verified Warm Chrome."

Dev: "Which mode is the default for a fresh capture?"
Domain expert: "Prose mode — the flexible default while memory is still maturing. Runbook and deterministic modes are faster opt-ins once the path proves stable. Run Outcomes track per-mode metrics so you can see which earns its keep per flow."
