---
title: Browser Connect Connection Architecture
slug: browser-connect-architecture
type: decision-log
status: in-progress
date: "2026-07-14"
timezone: Australia/Melbourne
owner: browser-connect
source:
  - docs/plans/2026-07-14-001-feat-browser-connect-plan.md
  - lessons/0001-chrome-150-and-warm-chrome.html
  - lessons/0002-auto-connect-is-not-a-protocol.html
  - lessons/0003-chrome-150-adapter-connection-map.html
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Connect Connection Architecture

## Frame

Browser automation in this repo kept failing at the same seam: connecting a
tool to the right Chrome. The Chrome 150 incident sent an everyday-Chrome
debugging listener through the Warm Chrome proof, which correctly rejected it
as foreign; earlier, adapters guessing port 9222 stranded orphaned headless
browsers. The old system conflated four concerns — browser environment,
attachment route, Browser Adapter, and proof. `browser-connect`
(`@side-quest/browser-connect`, home `runtime/browser-connect`) separates
them into a modeled product whose only job is a proven connection handoff.

## Decision 1: environment × route × adapter connection model (slice one)

```yaml
id: browser-connect-architecture-001
status: accepted
decided_at: "2026-07-14"
decision: ship a facade-backed CLI that provably attaches Browser Adapters to Agent Chrome, modeling environment, route, and adapter as separate things
owner: browser-connect
source:
  - docs/plans/2026-07-14-001-feat-browser-connect-plan.md
```

Decision:

- Ship `runtime/browser-connect` as a private, facade-backed CLI. Humans get
  one command — `browser-connect run <adapter> -- <cmd>` — that proves the
  environment, injects the verified endpoint, and execs the tool. Agents get
  the same guarantee as a Verified Handoff Envelope (JSON machine surface).
  The product ends at proven connection; it never performs browser operations.
- Model **environment × route × adapter** as three separate things. Doors into
  Chrome move (the 9222 flag died for default profiles; Chrome 144 added a
  consent toggle), so a route implementation is swapped without redesigning
  the product.
- **Three-door route model, sequenced.** Explicit-CDP (Agent Chrome) is built
  in slice one; UI-consent discovery (Human Chrome) is slice two; extension
  attachment is slice three. All three are first-class route capabilities in
  the model from day one so door assumptions never leak into the envelope
  schema.
- **No-fallback v1.** The caller names the adapter; there is no ranked
  fallback selection. Evidence ranking fails the deletion test, so the
  browser-use router engine is deliberately not consumed in v1.
- **warm-chrome consumed in-process.** `@side-quest/warm-chrome` is the Agent
  Chrome implementation; browser-connect imports its `main` and parses its
  JSON envelope, preserving the exit-20 fail-closed contract and proof
  semantics intact.
- **Verified Handoff Envelope as the adapter-agnostic connection contract.**
  One neutral shape — environment, endpoint, route, proof, single next safe
  action as an enumerated affordance id — identical across all adapters.

Rationale:

- The durable core is the model, not any one Chrome door. Google keeps moving
  the way in; a modeled product absorbs that with a route swap.
- Agent Chrome is fully controlled, already provable via warm-chrome, and
  offers explicit CDP — the route with the widest adapter support — so it is
  the primary environment for slice one.
- No-fallback keeps v1 honest: an adapter appears only when installed and
  proven, and a failed connection ends in exactly one named next safe action,
  never a guessed port or a cold browser.

Consequences:

- browser-use becomes a consumer: it keeps operational policy and delegates
  the proven connection to browser-connect. The canonical **Browser Adapter**
  definition moves to browser-connect's CONTEXT.md; browser-use keeps a
  consumer view. **Verified Handoff Envelope** (success-direction) and
  **Browser Entry Handoff** (failure-direction) are deliberate mirrors.
- `rules/browser-access.md` R11–R14 are now absorbed into this Product
  Contract and carried verbatim in browser-connect's ARCHITECTURE.md. The rule
  retires **pointer-first** via the prompt-system workflow — a committed
  follow-up, not this diff. Until it lands, both texts coexist and a
  rule-following agent double-gates rather than trusting browser-connect's
  envelope.
- warm-chrome gains its first in-process contract-pinned consumer; its
  `schema_version` is the drift tripwire.

Next:

- File the prompt-system-workflow follow-up to retire `rules/browser-access.md`
  now that the browser-connect pointer exists (the coexistence window's closing
  trigger). Filed as issue #230.
- Slice two: Human Chrome via the UI-consent door, which freshly verifies the
  territory ADR 0006 recorded as a dead end.

V2 Ideas:

- Adapter fallback: ranked selection when the named adapter cannot connect —
  the browser-use router engine's evidence-first ranking is the recorded
  candidate mechanism.
- Per-agent target/context allocation for concurrent agents on one Agent
  Chrome (lesson 0003 boundary).
- A shared operation floor (verbs defined by verified postconditions) layered
  on browser-connect, earned only after multiple adapters connect reliably.

## Notes

- v1 has exactly one Agent Chrome instance (the warm-chrome convention
  profile). Future multi-identity means multiple Agent Chrome instances
  distinguished by envelope environment identity, never new environment names.

## Decision 2: relationship to prior decisions (ADR 0006 / 0009 / 0012)

```yaml
id: browser-connect-architecture-002
status: accepted
decided_at: "2026-07-14"
decision: "Consume ADR 0009 intact, do not reverse ADR 0012, defer ADR 0006's superseding note to slice two"
owner: "browser-connect"
source:
  - "docs/plans/2026-07-14-001-feat-browser-connect-plan.md"
  - "docs/adr/0006"
  - "docs/adr/0009"
  - "docs/adr/0012"
```

Decision:

- **ADR 0009 (endpoint authority) is consumed intact.** Endpoints come only from warm-chrome's verified ok envelope; browser-connect never derives an endpoint from convention. R12 restates this invariant.
- **ADR 0012 (browser-use router) is NOT reversed.** The router is deliberately unused in browser-connect v1 (no-fallback makes its ranking dead weight), and it still governs browser-use until migration. This is a scoped non-consumption, not a reversal.
- **ADR 0006's superseding note stays deferred to slice two.** ADR 0006 recorded the UI-consent territory as a dead end on the old `chrome://inspect` evidence. Whether it needs a superseding note is answered when slice two's live consent-flow verification runs — not now.

Rationale:

- Naming the relationship prevents a future agent from reading browser-connect as an implicit reversal of the router decision or the endpoint authority.
- Deferring the ADR 0006 note avoids recording a supersession on unverified territory; the answer is empirical and belongs to slice two.

Consequences:

- No ADR files are edited in the browser-connect slice-one diff.
- The router engine remains the recorded candidate for the future adapter fallback feature.

Next:

- Revisit ADR 0006 during slice two's live consent-flow verification.

V2 Ideas:

- When adapter fallback lands, record whether it consumes ADR 0012's router engine or a fresh ranking mechanism.

## Decision 3: staged repair paths from typed context (repair-paths slice)

```yaml
id: browser-connect-architecture-003
status: accepted
decided_at: "2026-07-15"
decision: every error station ships one staged, typed, versioned repair path back to a verified connection
owner: browser-connect
source:
  - docs/plans/2026-07-14-002-feat-browser-connect-repair-paths-plan.md
  - runtime/browser-connect/REPAIR.md
```

Decision:

- **Staged recovery, two postures.** An automatic stage emits ordered
  `runtime_actions` and exactly one `continuation.next_action_id`. An operator
  stage emits `requires_operator: true`, operator-only `choices`, no
  `next_action_id`, and at least one constraint — the facade rejects an
  operator stage without a constraint floor, so every gate names what the
  caller must not do (`no_adapter_fallback`, `no_process_destruction`,
  `no_mutation_from_diagnostics`, ...).
- **Typed repair context is the only action input.** Policy
  (`src/repair-path.ts`) branches on typed failure context — cause, port
  evidence, adapter provenance, hop — never on prose `detail`. The branch
  diagnostic re-emits the typed evidence (requested port, hop, cause,
  preserved suggestion) so the caller consumes fields, not sentences.
- **Versioned public docs URLs.** Every projected action and choice carries a
  `REPAIR.md#v1-<action_id>` anchor. Headings are append-only versioned
  fragments and must exist on main before the emitting binary releases.
- **Bounded repair-chain hop (0|1).** `use_suggested_port` is the sole
  cross-invocation automatic continuation, emitted only from a failed
  `connect` or `run` at hop 0 with a verified-free suggested port. The failed
  invocation never consumes the suggestion (`no_internal_port_switch`); the
  caller starts exactly one fresh copy with `--port <suggested>
  --repair-chain-hop 1`; a hop-1 failure emits an operator stage
  (`no_cross_invocation_retry`) and never another hop. `check` preserves
  suggestions as typed diagnostics only and never emits the action.
- **Explicit-port ownership end to end.** `--port` reaches warm-chrome check,
  launch, and recheck unchanged and is never derived from the 9222
  convention. browser-connect never adopts a port other than the one
  requested inside an invocation — when warm-chrome's competing-instance
  guard hands back the convention browser instead of launching the requested
  port, the invocation fails closed to operator diagnostics rather than
  silently switching.
- **`repair-adapter --check|--execute` is the package executor.** Preview is
  read-only, reports the exact currently-eligible action, and grants no
  authority; execute is the sole package-mutation path, re-reads the same
  trusted state, validates registry-relative or exact canonical-origin lock
  entries before any network, and runs the registry-owned isolated installer
  with lifecycle scripts disabled. Only explicit allowlisted
  observed-version-to-pin transitions automate.
- **Closed non-mutating legacy compatibility selector.** Schema-1
  `data.next_action_id` mirrors automatic outer actions; operator stages
  degrade only to a cause-appropriate non-mutating compatibility stop. A
  mutating class default never survives across an operator gate.
- **Terminal listener boundary.** `inspect_listener` is terminal:
  browser-connect ingests no process-ownership evidence as authority and
  projects no port-freeing action. Recovery from an occupied port returns
  only through fresh warm-chrome proof on another explicit port; listener
  remediation stays external and operator-owned.

Implementation truths:

- Station IDs use the hyphenated command segment — `repair-adapter.preview`,
  `repair-adapter.installed`, `repair-adapter.upgraded`,
  `repair-adapter.operator_stop` — because the facade derives station
  prefixes from command names verbatim.
- `agent-browser` package repair is operator-owned: its recipe requires
  lifecycle scripts, so preview reports posture `none` with
  `lifecycle_scripts_required` and execute stops before any network.
- `chrome-devtools-mcp` is the automatically eligible adapter: complete
  recipe, canonical lock origins, full dependency integrity, lifecycle
  scripts disabled.

Rationale:

- A failure without a complete repair path is a dead end, and the 2026-07-14
  live smoke showed dead ends are what agents actually hit. Making the repair
  path a shipping gate (stable ID + typed context + one continuation posture
  + public versioned anchor) turns recovery into contract, not prose.
- The hop bound keeps autonomy honest: one suggestion, one marked fresh
  invocation, then a human. Nothing self-heals its way onto a port or into a
  package the caller never named.

Consequences:

- `REPAIR.md` becomes a public release artifact with append-only `v1-*`
  headings; editing a shipped heading in place is a contract break.
- Package mutation has exactly one door (`repair-adapter --execute`); no
  connect or run failure installs anything as a side effect.
- Legacy schema-1 consumers keep a safe `next_action_id` under every posture.

### Smoke evidence (2026-07-15, U6)

Live arms against real machine state, explicit high ports only. Machine
state: a verified Agent Chrome already held the 9222 convention
(pre-existing, PID 98143, monash_qa profile), so warm-chrome's
competing-instance guard (R10a) refused every explicit-port launch — the
launch, reuse, and verified-recovery legs are fixture-cited below; the
posture and boundary arms all ran live.

- `check --port 9377` (free) → `environment-absent`, exit 20,
  `launch_agent_chrome` continuation + docs anchor, constraints present; no
  suggested-port action from check.
- `connect chrome-devtools-mcp --port 9384` → warm-chrome returned the
  convention browser; browser-connect refused the port swap →
  `launch-failed`, operator stage, sole choice `inspect_diagnostics`
  (explicit-port ownership held against real drift).
- `dashboard` → read-only evidence: `chrome-devtools-mcp` absent,
  `agent-browser` installed and connectable, routes as modeled.
- `repair-adapter chrome-devtools-mcp --check` → `install_state: absent`,
  posture automatic, eligible `install_adapter` at pin 1.5.0, all four trust
  gates true, `no_pin_policy_change`; zero mutation.
- `repair-adapter agent-browser --check` → `installed_at_pin` 0.31.2, posture
  `none`, stop `lifecycle_scripts_required`; zero mutation.
- Owned dummy listener on 9391, `connect agent-browser --port 9391` →
  `foreign-listener`, automatic `use_suggested_port`, typed evidence
  `cause: occupied_listener`, `suggested_port: 9223`; listener untouched.
- Hop: `connect agent-browser --port 9223 --repair-chain-hop 1` → hop-1
  failure emitted an operator stage with `no_cross_invocation_retry`
  forbidding `use_suggested_port`; no second hop (bounded chain held live).
- `check --port 9391` (same occupied state) → operator `inspect_listener`,
  no suggested-port action, `no_process_destruction` present (diagnostic
  check boundary and terminal listener boundary held live).
- `run agent-browser --port 9405 true` (missing `--`) →
  `run-missing-separator`, exit 2, automatic `add_run_separator`, no wrapped
  argv projected; corrected rerun surfaced `preexec-connect-failed`
  projecting the underlying operator recovery path (F4).
- Every observed failure envelope carried a facade-valid posture and
  `REPAIR.md#v1-*` docs URL; no automatic package work ran during smoke.
- Fixture-cited recovery legs (hermetic, process-boundary,
  `tests/entrypoint.test.ts` unless noted): verified reuse `launched: false`
  (`tests/environment.test.ts` R5/F1); auto-launch provenance true (AE7);
  occupied-with-suggestion → one hop-1 invocation verifies and attaches;
  absent adapter → `repair-adapter --execute` installs → original connect
  proves attachment through the published bin; allowlisted mismatch →
  execute upgrades → connect proves attachment; `agent-browser` execute →
  operator stop before any network (R29); run passthrough byte-exact
  (`tests/run-exec.test.ts`).

Next:

- Rerun the launch, reuse, and hop-recovery arms live on a machine state
  without a standing convention Agent Chrome, and attach the envelopes here.

V2 Ideas:

- A typed multi-instance environment identity would let explicit-port launch
  coexist with a standing convention browser instead of failing closed —
  only if the one-Agent-Chrome note in Decision 1 is ever revisited.
