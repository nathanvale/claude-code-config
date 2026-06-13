# browser-use docs index

Authored docs for the `browser-use` skill: plans, research, brainstorms, and
decision logs. Co-located here per the `**/docs/` placement rule (see
`skills/context-advisor/references/storage-routing.md`).

ADRs stay in repo-root `docs/adr/` — they are cross-referenced by other domains
(create-cli, prototypes) and bind repo-wide architecture, so they are root-level
records. They are linked below but not moved.

---

## Product

- [PRODUCT.md](PRODUCT.md) — what the core product IS: one warm Chrome driven by N independent engines over CDP; the trust-signal moat ("no engine can be a second opinion on itself"); who it's for; what it is NOT; plus the product-trio ideation and top-5 directions. Start here.
- [PRODUCT-BASELINE.md](PRODUCT-BASELINE.md) — current-state baseline of the skill's shape.
- [USE-CASES.md](USE-CASES.md) — the two daily-driver modes: engineering driver (human-supervised Figma-parity / WCAG / React memory-perf, engine-strength composition) and no-touch life-admin (timesheets/appointments via runbooks + 1Password, where the trust layer is a requirement not a feature).

## Plans

- [Harden browser-use preflight agent feedback](plans/2026-06-01-002-fix-browser-use-preflight-agent-feedback-plan.md) — safety + JSON continuation contract for Warm Chrome preflight.
- [Resolve Warm Chrome port through discovery](plans/2026-06-01-003-fix-warm-chrome-port-lifecycle-plan.md) — port resolution via discovery, not disagreeing defaults (superseded by ADR 0009).
- [Apply runtime continuation guidance to Warm Chrome preflight](plans/2026-06-01-004-fix-warm-chrome-runtime-continuation-plan.md) — migrate preflight envelopes to the runtime continuation contract.
- [Add browser-use adapter proof observability](plans/2026-06-02-001-fix-browser-use-adapter-proof-observability-plan.md) — Chrome DevTools Browser Adapter Proof layer after Warm Chrome.
- [Fix browser-use mcporter command resolution](plans/2026-06-02-003-fix-browser-use-mcporter-command-resolution-plan.md) — PATH-first resolution, JSON-array override, diagnostic codes.
- [Design browser-use Browser Adapter Router](plans/2026-06-02-004-design-browser-use-adapter-router-plan.md) — evidence-first routing, adapter manifests, capability bundles.
- [Router recovery metadata module](plans/2026-06-03-001-refactor-router-recovery-metadata-plan.md) — extract recovery/continuation/action-lookup into its own module.
- [Router command discovery flags](plans/2026-06-03-002-refactor-router-command-flag-contract-plan.md) — narrow router command flags per command + drift tests.
- [Rewrite Browser Adapter Router clean](plans/2026-06-03-004-rewrite-browser-adapter-router-clean-plan.md) — clean router rewrite: route/report/status surface, selection policy.
- [Implement browser-use prepare and operation front door](plans/2026-06-04-001-feat-browser-use-prepare-operation-front-door-plan.md) — prepare + targets/operate CLI, route-proof-target-operation binding.
- [Split browser-use.ts into cohesive modules](plans/2026-06-10-001-refactor-browser-use-module-split-plan.md) — the 8-module acyclic split of the 4,449-line driver.

## Research

- [Connecting browser-use to a warm real Chrome](research/2026-05-30-browser-use-warm-chrome-findings.md) — CDP/9222, dedicated profile, dual-mode adapter, pre-flight state record.
- [Tape format for record-replay browser automation](research/2026-05-30-tape-format-record-replay-browser-automation.md) — deterministic JSON spine, variable-slot layer, tiered self-healing.
- [Browser Adapter Router research stock](research/2026-06-02-browser-adapter-router-research-stock.md) — capability matrix for Playwright MCP, Chrome DevTools MCP, agent-browser.
- [Multi-engine facade — N=5 spike findings](research/2026-06-12-multi-engine-facade-n5-spike-findings.md) — live proof of one facade over 5 engines: vocabulary-bound transport, two-axis mapping, measured cost-routing, differential oracle, graceful degradation.
- [Round-2 dividends + accessible-name divergence](research/2026-06-12-round2-dividends-and-naming-divergence-findings.md) — live proof of confidence-annotated perception + stakes dial and reproduce-everywhere; the Hacker News finding that engines disagree on element NAMES (same link = "119 comments" vs "3 hours ago"), making single-engine agents silently fragile. Also: round-2b quorum-gated action + signed receipt, and drive-observe.
- [Moat audit — what only N engines can do](research/2026-06-12-moat-audit-what-only-n-engines-can-do.md) — the honest line between structural moats (consensus/quorum/failover/repro — impossible for one engine) and conveniences (drive-observe, payload tiering — a single capable engine could do them). Answers "why not just chrome-devtools?"
- [Ref-staleness → verify-layer spec](research/2026-06-13-ref-staleness-verify-layer-findings.md) — live staleness characterization settling R7: engines split three ways (hard-error / auto-recover / SILENT no-op), agent-browser lies about success, so the verify layer must check post-state, not return values.
- [Protocol-vs-CDP experiment](research/2026-06-13-protocol-vs-cdp-experiment.md) — settles the product identity: 9 non-browser substrates tested, none gives N independent observers + cheap fan-out for free. Verdict B — the moat is CDP-specific (a browser is one world that honestly disagrees with itself); do NOT reposition as a general agent-trust protocol.
- [Cloak-Catcher fingerprint spike](research/2026-06-13-cloak-catcher-fingerprint-spike.md) — the last open question, answered NO: all 5 engines share one warm Chrome → one fingerprint → nothing to diff at the serving layer. Cloaking detection is architecturally opposed to the product (N lenses vs N identities); ruled out. Discovery converged.

## Ideation

- [browser-use × Chrome DevTools for Agents 1.0](ideation/2026-06-12-browser-use-chrome-devtools-agents-ideation.html) — facade reframe; subtraction vs addition; what Chrome 1.0 buys; the swappability dividends.
- [Floor-verb semantics × ADR 0012](ideation/2026-06-12-floor-verb-semantics-adr0012-ideation.html) — same-verb-different-behavior across engines; converged on postcondition-floor + verify-as-leveler + loud typed divergence.
- [Facade dividends — round 2](ideation/2026-06-12-facade-dividends-round-2-ideation.html) — NEW dividends beyond the proven 4: confidence-annotated perception + stakes dial, quorum-gated actions + signed receipts, drive-observe split, reproduce-everywhere, self-healing cost ledger, cloaking detection.

## Brainstorms

- [Requirements: browser-use + browser-domain-memory](brainstorms/2026-05-30-browse-play-record-replay-requirements.md) — warm Chrome recipe, operate/prepare workflow, capture/replay.
- [browse + play record/replay skills (seed)](brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md) — lean record/replay seed: tape format, agent Chrome on :9223, auth injection.
- [Playwright spike — validate/kill the facade dream](brainstorms/2026-06-12-browser-facade-playwright-spike-requirements.md) — the pre-spike hypothesis: two-part bar (codec cheap + diff works) with an explicit kill condition.
- [browser-use multi-engine facade (requirements)](brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md) — production facade after N=5 proof: two-axis mapping, 5-adapter roster, cost-routing, oracle, degradation, verify/redaction/probe/hygiene. Ready for ce-plan.

## Decisions

- [Browser Adapter Multi-Adapter Decision Log](decisions/2026-06-03-browser-adapter-multi-adapter-decision-log.md) — adapter lifecycle gates, recovery contract ownership, proof handler registry.
- [Browser Use Prepare And Operation Decision Log](decisions/2026-06-03-browser-use-prepare-operation-decision-log.md) — prepare/route/operate seam, target discovery/selection, privacy gates.
- [Browser-Use Module Split](decisions/2026-06-10-002-browser-use-module-split-decision-log.md) — acyclic 8-module split, test-carving strategy, cycle-break decisions.
- [GoF Pattern Naming](decisions/2026-06-13-001-gof-pattern-naming-decision-log.md) — pressure-earned pattern verdicts: Adapter kept, Strategy rejected (→ evidence-first selection), Facade qualified to the action surface, the oracle is N-version programming (not Facade — it surfaces divergence, doesn't hide it).

## ADRs (in repo-root `docs/adr/`)

- [0006 — Warm Chrome via dedicated debug profile](../../../docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md)
- [0008 — browser-use owns Warm Chrome binding lifecycle](../../../docs/adr/0008-browser-use-owns-warm-chrome-binding-lifecycle.md) *(superseded by 0009)*
- [0009 — browser-use fixed CDP convention and runtime proof](../../../docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md)
- [0012 — Browser Adapter Router uses evidence-first routing](../../../docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md)
- [0013 — Router research recovery uses diagnostic trail](../../../docs/adr/0013-router-research-recovery-uses-diagnostic-trail.md)

## Related (not collated — other domains)

These touch browser-use but are owned elsewhere; left in repo-root `docs/`:

- `docs/plans/2026-05-30-001` + `2026-05-31-001` + `2026-06-01-001` — browser-domain-memory (its own skill; browser-use is a consumer).
- `docs/plans/2026-06-03-003-feat-facade-operator-recovery-choices-plan.md` — CLI facade contract (browser-use is the adopting consumer).
