# Browser Use

Scoped vocabulary for browser-use and browser-domain-memory: Warm Chrome, Browser Adapters, the Router, durable browser knowledge, and the playback modes. Glossary only.

## Language

### Router and route evidence
**Validated Route Evidence Envelope**:
Browser Adapter Router route input that has passed runtime-owned validation before route evaluation. Use this term for the engine input boundary; keep raw JSON, CLI flags, file paths, and stdin outside it.
_Avoid_: raw route envelope, trusted CLI envelope, typed envelope

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

### Browser entry and adapters
**browser-use**:
The browser-driving capability. It owns all browser entry — open, reuse, attach, repair, adapter policy, and capability-routed adapter selection — plus Warm Chrome, inspection, navigation, clicking, filling, and live browser control. It defaults to Warm Chrome; cold or isolated browser entry requires an explicit user request. It does not own browser memory, runbooks, capture policy, or domain-specific auth knowledge.
_Avoid_: browse, play, browser adapter, browser orchestrator, browser memory skill

**Warm Chrome**:
A reusable authenticated browser environment that `browser-use` drives for login-heavy workflows. It is distinct from the everyday Chrome profile and from Browser Adapters; separate identities may require separate Warm Chrome environments.
_Avoid_: default Chrome profile, adapter browser, Chrome for Testing, cold browser

**Warm Chrome Runtime Package**:
The independently hardened browser-entry layer inside `browser-use`. It owns Warm Chrome readiness semantics while `browser-use` remains the agent-facing browser product.
_Avoid_: Warm Chrome product, separate browser product, browser-use replacement

**Suggested Explicit Port**:
An informational repair hint emitted when the Warm Chrome convention port is
occupied by a foreign listener. It is advisory only — never an allocation,
binding, or identity. It becomes usable only after an explicit rerun passes
the Warm Chrome proof.
_Avoid_: port allocation, automatic rebinding, durable port binding, port authority

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

### Architecture patterns (pressure-earned)

Pattern names refereed against live prototype + decision evidence; see `docs/decisions/2026-06-13-001-gof-pattern-naming-decision-log.md` for the verdicts.

**Browser Facade**:
The `operate` / `observe` / `verify` action surface that hides which Browser Adapter ran. It is a GoF Facade for the action path only — callers never name an engine. It does NOT name the divergence-surfacing layer; the Differential Oracle is its deliberate opposite.
_Avoid_: facade-as-whole-product, universal browser API, the facade hides divergence

**Differential Oracle**:
A mechanical Set-diff over N independent Browser Adapters observing one Warm Chrome, producing consensus / confidence / quorum. It is **N-version programming** (independent re-derivations voted in code), not a Facade — its value is to SURFACE per-engine divergence, never hide it. The LLM consumes its verdict; it does not produce it.
_Avoid_: facade, LLM oracle, model judgment, single-engine check, consensus engine

**Adapter (pattern sense)**:
Each Browser Adapter is a GoF Adapter — the two-axis mapping layer (parser-per-ref-format + dispatch-per-transport, engine-origin-tagged ref) converts each engine's native vocabulary and dispatch to the Browser Facade contract. Fully pressure-earned: delete the mapping and N collapses to 1.
_Avoid_: thin wrapper, passthrough, shim

**Evidence-First Selection**:
The Browser Adapter Router's selection discipline — candidates are presumed invalid until proven (attachment proof + capability match); missing evidence yields recovery, not a route. It is NOT a GoF Strategy (no free swap of interchangeable algorithms); calling it Strategy is decorative.
_Avoid_: Strategy, algorithm swap, interchangeable engines, automatic fallback

### Durable browser knowledge
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

### Playback modes
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

## Example Dialogue

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
