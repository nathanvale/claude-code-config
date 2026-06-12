---
date: 2026-06-12
topic: browser-use-multi-engine-facade
status: requirements
mode: deep-feature
seeded_from:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-facade-playwright-spike-requirements.md
  - skills/browser-use/docs/ideation/2026-06-12-browser-use-chrome-devtools-agents-ideation.html
  - skills/browser-use/docs/ideation/2026-06-12-floor-verb-semantics-adr0012-ideation.html
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/vocab-map.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/ref-normalizer.ts
  - skills/browser-use/src/prototype-playwright-vocab-map/N5-MATRIX-NOTES.md
  - skills/browser-use/src/prototype-playwright-vocab-map/DIVIDENDS-NOTES.md
  - skills/browser-use/src/prototype-playwright-vocab-map/DIVIDENDS-ROUND2-NOTES.md
  - skills/browser-use/docs/research/2026-06-12-round2-dividends-and-naming-divergence-findings.md
related:
  - skills/browser-use/SKILL.md
  - docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md
  - docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md
---

# browser-use multi-engine facade — requirements

## Summary

Promote the session's proven prototypes into the production `browser-use` facade: one
stable interface (`operate` / `observe` / `verify`) driving N interchangeable browser
engines, with measured cost-routing, a differential cross-engine oracle, and graceful
degradation. The facade dream is no longer speculative — it was demonstrated live at
N=5 across two transport kinds this session. This doc commits to building it.

## Why now — the bet is de-risked by live proof

Every load-bearing claim was proven this session, not assumed:

- **N=5 swappability works.** One facade-level `clickByName("Learn more")` landed a real
  click on all five adapters — chrome-devtools (MCP), playwright (MCP), agent-browser
  (CLI), playwright-cli (CLI), chrome-devtools CLI — against one shared warm Chrome.
- **The mapping design holds and scales sub-linearly.** Ref-FORMAT is engine-bound
  (2 parsers cover 5 adapters); DISPATCH is transport-bound (5 shapes). Adding an engine
  in an existing lineage = 0 new parsers + 1 dispatch fn. Proven, not projected.
- **Three dividends measured live; the fourth proven live.** Cost-routing (warm
  @playwright/cli fastest at 40ms), differential oracle (caught real divergence on
  Wikipedia), payload tiering (14× spread), graceful degradation (4-stage kill test).
- **The hard infra holds.** All 5 attach to one warm Chrome (ADR 0006 invariant);
  shared-precondition confirmed across MCP + CLI transports.

Proof lives in `skills/browser-use/src/prototype-playwright-vocab-map/` (see
`N5-MATRIX-NOTES.md`, `DIVIDENDS-NOTES.md`). This doc turns those throwaway spikes into
production requirements.

## The moat — what only N engines can do (answers "why not just chrome?")

chrome-devtools ships 44 tools; any dividend one capable engine could replicate alone is a
convenience, not a moat. The audit (`docs/research/2026-06-12-moat-audit-what-only-n-engines-can-do.md`)
draws the line:

- **Structural moats (impossible for ANY single engine):** differential oracle,
  confidence-annotated perception, quorum-gated action + receipt, reproduce-everywhere,
  graceful failover, cloaking detection. All require independent implementations
  disagreeing — **chrome-devtools cannot be a second opinion on itself.**
- **Conveniences (a single capable engine could do them):** drive-observe (R14), payload
  tiering. Kept, but not part of the moat case.

The one-sentence thesis: consensus, quorum, failover, and bug-vs-artifact triage are
impossible from inside one engine no matter how many tools it has. That is the product.

## Goal

Ship a production multi-engine facade in `browser-use` where:

- callers express intent capability-addressed (never naming an engine),
- the facade routes to a measured-cheapest capable engine,
- divergence between engines is surfaced (oracle), not hidden,
- a failed engine degrades gracefully to the next in a fallback chain,
- adding an engine costs a parser-per-lineage + a dispatch-per-transport, no more.

## Proven design to promote (the keepers)

The production facade lifts two prototype modules and the patterns around them:

- **Two-axis mapping layer** (`vocab-map.ts` → real adapter layer):
  - **Parser per ref FORMAT** (engine-lineage-bound): `uid=` for Chrome lineage,
    `[ref=]` for Playwright/Chromium lineage. Two parsers cover the current five.
  - **Dispatch per TRANSPORT** (per-adapter): five shapes today — mcp-uid-json,
    mcp-target-json, cli-@ref, cli-positional-ref, cli-positional-uid.
- **Engine-origin-tagged refs** (`ref-normalizer.ts` → real `FacadeRef`): a ref is not a
  bare string; it carries `{engine, raw, role, name}` so `click` dispatches correctly and
  divergence stays loud (the floor-verb ideation's "don't fake uniformity," concrete).
- **Capability-addressed verbs**: extend the existing `--capability` mechanism so callers
  request `observe.snapshot` / `operate.click` etc., resolved to a capable engine — never
  an engine name in caller code.

## Requirements

### R1 — Facade contract: floor verbs, capability-addressed
- Floor verbs `operate` / `observe` / `verify` defined by verified post-condition, not
  mechanism (per the floor-verb ideation's converged answer).
- Callers request a capability; the facade resolves to an engine. No caller names an engine.
- Ceiling capabilities an engine lacks return a typed `capability-unavailable`, never a
  silent fake (reuse existing `adapter_capability_partial` family).

### R2 — Two-axis mapping layer
- One parser per ref format; one dispatch per transport. Promote from `vocab-map.ts` +
  `ref-normalizer.ts`.
- Adding an engine in an existing lineage must require 0 new parsers.
- Refs are engine-origin-tagged end-to-end.

### R3 — Five-adapter initial roster
- chrome-devtools (MCP), playwright (MCP), agent-browser (CLI), playwright-cli (CLI),
  chrome-devtools CLI — all wired production-grade through the existing Router /
  adapter-proof machinery (do not bypass it; do not collapse it).
- Each enters via the `known → provable → mapped → selectable` lifecycle.

### R4 — Measured cost-routing
- A per-adapter cost table (latency, payload bytes, ref count, success rate) built
  EMPIRICALLY — costs are measured, not inferred from engine category (proven: transport
  kind does not predict latency).
- Routing picks the cheapest engine that satisfies the requested capability.
- `run-metrics.ts` is the seed of the measurement harness.

### R5 — Differential oracle (mechanical, agent-consumed) — PROVEN
- A mechanical diff (not the LLM) comparing the interactive set across ≥2 engines.
- Emits consensus + per-element disagreement with which engines saw what.
- The agent/LLM CONSUMES the oracle verdict; it does not produce it.
- Opt-in per task (high-stakes / unknown-page); not the default path (cost).
- **Accessible-name divergence is a first-class oracle signal.** Engines disagree not
  only on element *presence* but on element *names*: live on Hacker News, the chrome
  lineage named a link `"119 comments"` while the chromium lineage named the SAME DOM link
  `"3 hours ago"`. An agent acting by name silently succeeds on one lineage and fails on
  another; the contested score (e.g. 2/5) is the warning. The oracle must surface name
  divergence, not just presence divergence. (Proof:
  `docs/research/2026-06-12-round2-dividends-and-naming-divergence-findings.md`.)
- Match on EXACT accessible name when triaging lineage splits — substring matching hides
  the divergence (substring "comments" matched everywhere; exact "119 comments" did not).

### R6 — Graceful degradation / fallback chain
- Caller supplies (or policy supplies) an ordered engine preference.
- On engine failure, fall through transparently to the next capable engine; report
  `servedBy` + fallback depth.
- Total pool exhaustion fails honestly (loud), never a false success or hang.
- Proven shape in `run-degrade.ts`.

### R7 — Verify layer — CHARACTERIZED (spec settled by live spike)
- **The verify layer must check POST-STATE, not return values.** Live staleness spike found
  engines split across THREE incompatible stale-ref contracts: chrome-MCP hard-errors
  ("uid no longer exists"); playwright-MCP/CLI + chrome-CLI auto-recover (re-resolve the
  ref); **agent-browser SILENTLY NO-OPS** — its click returns success while the page does
  not change. A return-value-trusting verify layer would be fooled by agent-browser.
- "Did the page change as intended?" (URL/DOM/expected-element delta) is the only signal
  that catches all three modes. This is the postcondition-floor answer, now FORCED by a
  measured engine that lies about success — not merely argued.
- Re-snapshot-before-action (SKILL.md) prevents staleness but does NOT catch a silent
  no-op when staleness slips through; the verify layer is the safety net behind it.
- Hosts the oracle's divergence triage. `verify_method` typed per engine so "verified"
  means a comparable thing across engines.
- **Load-bearing for R11/R13:** quorum must post-state-verify each witness (agent-browser
  would false-confirm); perception must read fresh snapshots and post-state-verify actions.
- Proof: `docs/research/2026-06-13-ref-staleness-verify-layer-findings.md` +
  `src/prototype-playwright-vocab-map/STALENESS-NOTES.md`.

### R8 — Redaction boundary (non-optional)
- Every engine's snapshot/observe output passes through one facade-level redactor before
  reaching the caller. Live proof showed raw snapshots leak real authenticated tab URLs.
- Secrets reported by shape only (extends SKILL.md Safety to all engines).

### R9 — Mapping ownership: live capability-probe
- Per-adapter capability/schema derived from a live probe at attach, not a hand-copied
  static table. Live proof caught real playwright schema drift (`browser_click` wants
  `{target}`, not the documented `{ref, element}`) — a hand-copied mapping would have
  been wrong. This is ADR 0012's "static matrix drifts" warning, demonstrated.

### R10 — Normalizer hygiene
- Filter non-actionable glyph/artifact refs (live proof surfaced stray `"`, `^`, single
  chars from decorative refs) so the oracle and click target only real elements. On
  Wikipedia the stray `"` glyph was the ONLY contested element across all 5 engines —
  filtering it would have given a clean 100% consensus.

### R11 — Confidence-annotated perception + stakes dial — PROVEN
- The default agent-facing snapshot tags each element with its agreement score
  (`seen_by: N/5`); the agent acts freely on consensus elements and investigates contested
  ones. Promotes the oracle from a separate call into the perception payload.
- A `tier: cheap | consensus` dial: `cheap` = fastest single engine (~55-106ms measured);
  `consensus` = full fan-out + scoring (~0.9-1.1s measured). The agent buys confidence
  per-step; consensus is opt-in, not default-on-everything (10× cost).
- Justified by the dynamic-page finding: on link-dense/dynamic pages a meaningful fraction
  of elements are genuinely contested (79/201 on Hacker News), so the consensus tier is
  how an agent avoids name-fragile clicks — not paranoia. (Proof:
  `docs/research/2026-06-12-round2-dividends-and-naming-divergence-findings.md`.)

### R12 — Reproduce-everywhere (anomaly triage) — PROVEN
- `repro(intent)` replays a lookup across all engines and returns a verdict matrix
  classifying an anomaly as: real absence (0/N), present-everywhere (N/N, transient miss),
  or engine/lineage artifact (clean lineage split). Proven for the first two live;
  lineage-artifact attribution requires exact-name matching (see R5).
- Resolves the single most expensive ambiguity in browser automation — "is the element
  gone, or does only my engine think so?" — which a single-engine agent cannot answer.

### R13 — Quorum-gated irreversible actions + signed receipt — PROVEN
- For a `stakes:critical` action, k engines independently re-read the critical element
  before firing; commit only if ≥k confirm, else REFUSE and surface dissent. One
  stale/lying engine cannot push a destructive action through (Byzantine-fault-tolerant).
- Emit a tamper-evident receipt `{intent, critical, host, quorum, confirmed_by, dissent,
  actor, ts, sha256}`, secret-redacted to host only — the audit artifact.
- Opt-in for high-stakes steps only (cost). Proven live: 5/5 commit with sha256 receipt;
  0/5 correctly refused. (Proof:
  `docs/research/2026-06-12-round2-dividends-and-naming-divergence-findings.md` +
  `src/prototype-playwright-vocab-map/DIVIDENDS-ROUND2B-NOTES.md`.)

### R14 — Drive-observe composition — CONVENIENCE (not a structural moat)
- One task composes two engines: a robust DRIVER (auto-wait) acts while a debug OBSERVER
  (network + console) captures side-effects; emit one combined record.
- **Reclassified by the moat audit** (`docs/research/2026-06-12-moat-audit-what-only-n-engines-can-do.md`):
  a single capable engine (chrome-devtools, 44 tools) can click AND read network itself,
  so drive-observe is NOT something one engine cannot do. It only beats a single engine
  when the DRIVER GAP is real (auto-wait lands a click fire-and-forget misses) — an edge
  case that could not be cleanly staged live this session.
- Keep as a lower-priority nice-to-have; do NOT sell it as part of the "why not just chrome?"
  moat case. The combined-record demo ran clean on example.com but that page had no driver gap.

## Success criteria

- [ ] One capability-addressed facade call drives all 5 adapters with no caller change.
- [ ] Adding a 6th engine in an existing lineage requires 0 new parsers (measured).
- [ ] Cost table is populated by live measurement; routing selects by it.
- [ ] Oracle emits consensus + disagreement on a rich page; verdict is machine-readable.
- [ ] Oracle flags accessible-NAME divergence (same element, different name per lineage),
      not only presence divergence.
- [ ] Snapshot payload carries per-element `seen_by: N/5`; the cheap/consensus tier dial works.
- [ ] `repro(intent)` returns a verdict matrix separating real-absence / transient-miss /
      lineage-artifact on live pages.
- [ ] Quorum gate: a `stakes:critical` action commits only on ≥k engine agreement, else
      refuses; commit emits a tamper-evident, secret-redacted receipt.
- [ ] Drive-observe: a driver engine acts while an observer engine captures network/console;
      a failed request flips the combined verdict even when the driver reports success.
- [ ] Fallback chain: real engine kill is absorbed transparently; total outage fails loud.
- [ ] Redaction: no authenticated URL or secret reaches the caller from any engine.
- [ ] Capability/schema is probed live; a deliberate upstream schema change is absorbed
      without a code edit to the mapping table.
- [ ] Warm Chrome invariant (ADR 0006) holds for every adapter.

## Scope boundaries

### In
- The production facade contract, two-axis mapping, 5-adapter roster, cost-routing,
  oracle, degradation, verify layer, redaction, live capability-probe, normalizer hygiene.

### Deferred for later
- WebMCP (Chrome 149 origin trial; ~2027 for real adoption) — do not design around it.
- Swappability dividends still unproven this session (e.g. record-at-facade replay,
  cost-aware self-tuning ledger) — revisit after the proven set ships. NOTE: quorum (R13),
  perception+dial (R11), and repro (R12) are now PROVEN structural-moat dividends, moved
  into the requirement set above. Drive-observe (R14) is reclassified a CONVENIENCE (a
  single capable engine could do it — see the moat audit), not a moat dividend.
- 6th+ engines beyond the initial roster.

### Outside this product's identity
- A "universal browser API" that hides adapter boundaries or fakes capability uniformity
  (explicitly rejected by ADR 0012 — the facade negotiates real capabilities, loud).
- Collapsing the Router / manifests / adapter-proof machinery — it is the facade's
  sanctioned selection mechanism, validated by N>1.

## Dependencies / assumptions

- Warm Chrome on loopback CDP (ADR 0006) — shared precondition across all CDP adapters.
- mcporter for MCP-backed engines (self-heals on `daemon stop` — a resilience plus, but
  means fallback logic must be tested with genuine failures or a deterministic kill-switch).
- N5 chrome-devtools CLI connection model — RESOLVED: despite contradictory daemon args
  (`--browser-url http://127.0.0.1:9222` AND `--headless --isolated`), N5 drives WARM
  Chrome. Proof: N5 `list_pages`, N1 MCP `list_pages`, and raw CDP `/json/list` return
  byte-identical tab sets — `--browser-url` wins, `--isolated` is inert when an endpoint
  exists. All N5 measurements (cost, matrix, staleness verdict) are valid.
  (`src/prototype-playwright-vocab-map/N5-WARM-VS-ISOLATED-NOTES.md`.)

## Outstanding questions

- **Oracle default posture:** opt-in per task vs always-on-for-unknown-pages — cost vs
  safety tradeoff to settle.
- **Cost-table freshness:** how often is the per-adapter cost re-measured (static-at-attach
  vs rolling average of real calls)?
- **Capability-probe vs hand-craft boundary:** R9 commits to probe; confirm whether any
  per-adapter detail genuinely cannot be probed and must stay hand-authored.

## Decision trail

- Promote prototypes to production facade (full commitment), not a research record or a
  2-adapter pilot — the session's N=5 live proof cleared the evidence bar.
- Mapping ownership = live probe over hand-craft, driven by the schema-drift finding.
- The four remaining-work items (verify, redaction, probe-ownership, normalizer hygiene)
  are required sub-tasks (R7–R10), not deferred — the spikes proved each is load-bearing.
- Oracle is a mechanical diff the LLM consumes, NOT the LLM — the architectural crux of
  why the facade catches what a single-engine agent can't.

## Next step

Hand to `ce-plan` to sequence the build (mapping layer → roster wiring → cost/oracle/
degradation → verify/redaction/probe/hygiene). The throwaway prototypes
(`run-*way.ts`, `run-metrics.ts`, `run-degrade.ts`) seed the harnesses; `ref-normalizer.ts`
and `vocab-map.ts` seed the production mapping layer.
