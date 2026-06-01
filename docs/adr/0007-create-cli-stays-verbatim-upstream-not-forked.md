---
status: accepted
date: 2026-05-31
---

# create-cli Stays Verbatim-Upstream, Not Forked

The `create-cli` skill is a verbatim copy of steipete/agent-scripts' design-methodology
skill (MIT). `PROVENANCE.md` holds its `SKILL.md` body + `references/cli-guidelines.md`
as byte-diffable against upstream; side-quest facade-awareness attaches only as additive
material (the `references/cli-command-facade.md` doc + one pointer line + the `scripts/`
npm-link). See ADR 0002 (prose orchestrates, code owns determinism) and ADR 0004 (no
hand-maintained prose duplicates deterministic contracts) for the placement lineage.

While planning the facade-aware emission slice
(`docs/plans/2026-05-31-002-feat-facade-aware-create-cli-emission-plan.md`), a real
pressure surfaced: the skill should make an autonomous agent emit a `CommandFacadeContract`
by default. The body's default instruction is "emit a markdown spec"; the contract-emission
lives in the reference behind the pointer. Making the contract the *default* output would
require editing the verbatim body — i.e. forking upstream. This ADR records why we did not.

## Decision

create-cli stays verbatim-upstream. Facade-awareness lands only as additive side-quest
material. We do **not** fork the body to change what the skill emits by default.

The decision was informed by data, not preference: an audit of steipete/agent-scripts
showed `skills/create-cli` is near-frozen — last content change 2026-01-01; the only 2026
touches were frontmatter cosmetics — even though the repo overall is active. So the
"free upstream improvements" benefit of staying verbatim is currently weak. But two
durable reasons hold regardless:

1. **Provenance auditability.** "This is steipete's, here is the license and pull date,
   it is byte-diffable" keeps borrowed code honest and traceable. Forking severs that.
2. **Compose, don't absorb** (the repo's own no-parallel-policy rule). steipete owns the
   CLI-design methodology; we point at it and flavor only the implementation edge. Forking
   absorbs a rubric we do not need to own and would maintain forever.

The provenance constraint is deliberately fork-resistant: its additions are an enumerated
whitelist (the reference, one pointer line, the `scripts/` folder), and it states the line
explicitly — "the design philosophy stays agnostic; only the recommended *implementation*
path is side-quest-flavored." A new steering section in `SKILL.md` (the tempting
middle path) crosses that line as much as a full fork does. There is no sneaky middle.

## Consequences

- The contract-emission deliverable is reachable via the reference + pointer, not the
  body's default output. The plan's R1 is bounded by this (it says "available and
  canonical in the reference", not "the body's default").
- The headroom we legitimately own is the **one pointer line** — it is side-quest material,
  not verbatim, so it may be sharpened to steer harder toward the contract without forking.
- The "10%" the fork would buy is **reliability under autonomy**: an agent reading the body
  first may follow its "emit markdown" default and skip the pointer. A 25-angle functional
  + 55-angle security prototype sweep showed agent-driven contract emission is robust
  *because* the facade catches mistakes and returns applicable fixes — so the reliability
  the fork chases is largely already provided by the catch-and-correct loop.

## Watchable trigger (when to revisit)

Revisit the fork — via a superseding ADR — **if autonomous agents are observed skipping
the pointer and emitting markdown specs instead of contracts** in real use. That is the
concrete signal that the pointer's reliability is insufficient and the body's default needs
to change. Until that is observed, the fork is unjustified: small upside (default vs
pointer-reachable), real-and-permanent cost (own the rubric, lose diffability), and fully
reversible to reconsider.

## Alternatives considered

- **Fork the body** (rewrite `SKILL.md` to emit a contract by default). Strongest R1, but
  breaks provenance, inherits an unmaintained rubric, loses upstream diffability. Rejected
  now; held open behind the trigger above.
- **Add a side-quest steering section to `SKILL.md`** (byte-untouched body, new section).
  Rejected: violates the enumerated-whitelist + agnostic-philosophy line in PROVENANCE.md
  as much as a fork, while being *less* honest (diffable on paper, behaviorally divergent).
- **A separate "agent-CLI-factory" skill.** Explored and rejected: the human-driven and
  agent-driven flows are one skill with two drivers (same clarify questions, same emitted
  contract, differing only in who answers and the high-stakes pause), not two skills. The
  dual-mode guidance lives in the reference (plan U2), not a fork or a parallel skill.
