# Adversarial Audit v2 — Loop-to-Convergence

A reusable goal prompt for hunting flaws in a system until coverage is provably
exhausted, not until one pass finishes. v1 was: 7 finder lenses → dedup →
refute-by-default verify → survivors. v2 adds the two disciplines the community
convergence harnesses use that v1 skipped:

1. **Positional-bias breaking** — shuffle file/context ordering across finders so
   a bug's location in the input can't hide it from every agent at once.
2. **Coverage-exhaustion terminator** — loop until every category comes back dry
   for K consecutive rounds, with an explicit checklist of what was tried, rather
   than stopping after a single fan-out.

Plus two hardening moves from Anthropic's `defending-code-reference-harness` and
the BugBot "Ralph Wiggum loop":

3. **N-of-M reproducibility** — a finding counts only if independent verifiers
   confirm it ≥N times, killing one-shot hallucinated bugs.
4. **Dedup-before-verify** — collapse duplicates across the whole round before
   spending verification budget, so the same bug isn't refuted five times.

---

## The goal (paste this to run)

> Run an adversarial audit of **<TARGET: files / package / subsystem>** and drive
> it to convergence. I want the confirmed, reproducible flaws ranked by severity —
> not a single pass. Use a Workflow with the structure below. Read the real source
> files first and inject their actual invariants into every finder prompt so agents
> reason about the code as written, not a paraphrase.
>
> **Threat/scope frame:** <what counts as in-model — e.g. "attacker controls the
> lockfile but not the repo"; "concurrent writers exist"; "runs on case-insensitive
> volumes">. State it once; every finder and verifier inherits it.
>
> **Finder lenses (fan out in parallel):** <list the dimensions — e.g. ownership
> collisions, trust-boundary integrity, filesystem/symlink, concurrency/races,
> cross-component topology, upstream-behavior (verify empirically in sandboxed temp
> dirs), operator/workflow holes>. Each lens returns only concrete, reproducible
> findings with exact inputs→wrong-output; empty array if nothing real. No padding.
>
> **Convergence rule:** keep running finder rounds until **2 consecutive rounds**
> surface zero *new* deduped findings. Track a coverage checklist: every lens must
> have run against every shuffle ordering at least once before declaring dry. Log
> what was tried and what came back empty — silent truncation reads as "covered"
> when it wasn't.
>
> **Anti-bias:** across rounds, vary the order in which files/context are presented
> to each finder (shuffle by round index) so positional bias can't uniformly hide a
> region.
>
> **Verify:** dedup the full round first, then run refute-by-default verification —
> each survivor gets independent skeptics who default to REFUTED and must reproduce
> against real code to confirm. A finding survives only on ≥majority confirmation.
> Tighten loose scenarios; drop out-of-model ones (but keep trust-boundary inputs
> in-model).
>
> **Deliver:** confirmed + plausible survivors ranked by corrected severity, each
> with file:line, a reproducible failure scenario, and a one-line fix sketch. Then
> a coverage report: lenses run, rounds to convergence, refuted count, and any
> category that never came back dry (the honest gap).

---

## Workflow skeleton (the orchestrator writes this)

```
export const meta = {
  name: 'adversarial-audit-v2',
  description: 'Loop adversarial finders to coverage-exhaustion, then verify survivors',
  phases: [{ title: 'Find' }, { title: 'Verify' }, { title: 'Report' }],
}

const LENSES = [ /* one {key, prompt} per dimension, threat frame injected */ ]
const CONTEXT = `/* real source excerpts + invariants + threat/scope frame */`

// Coverage-exhaustion loop: run until K dry rounds, not a fixed count.
const seen = new Map()            // canonical key -> finding (dedup memory)
const confirmed = []
let dryRounds = 0, round = 0
const K = 2

while (dryRounds < K) {
  round++
  // Anti-bias: shuffle the file/context ordering per lens by round index.
  const found = (await parallel(LENSES.map((lens, i) => () =>
    agent(shuffleContext(CONTEXT, round + i) + '\n' + lens.prompt,
      { label: `find:r${round}:${lens.key}`, phase: 'Find', schema: FINDING_SCHEMA, effort: 'high' })
  ))).filter(Boolean).flatMap(r => r.findings || [])

  // Dedup-before-verify across the whole round, vs everything seen so far.
  const fresh = found.filter(f => { const k = key(f); if (seen.has(k)) return false; seen.set(k, f); return true })
  if (!fresh.length) { dryRounds++; log(`round ${round}: dry (${dryRounds}/${K})`); continue }
  dryRounds = 0

  // N-of-M refute-by-default verification per fresh finding.
  const verified = await parallel(fresh.map(f => () =>
    parallel(Array.from({ length: 3 }, () => () =>
      agent(refutePrompt(CONTEXT, f),
        { label: `verify:${f.category}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' })))
      .then(vs => ({ ...f, confirmed: vs.filter(Boolean).filter(v => v.verdict !== 'REFUTED').length >= 2 }))))
  confirmed.push(...verified.filter(v => v.confirmed))
  log(`round ${round}: ${fresh.length} fresh, ${verified.filter(v => v.confirmed).length} confirmed`)
}

phase('Report')
// Rank by corrected severity; emit survivors + a coverage report naming any
// lens that never returned dry (the honest gap), rounds-to-convergence, refuted count.
return { survivors: rank(confirmed), rounds: round, refuted: /* ... */, coverage: /* per-lens dry status */ }
```

Helpers to define: `key(f)` = canonical dedup key (category + file + rounded line
+ title prefix; fold ids case+NFC if the target is id-keyed). `shuffleContext` =
deterministic reorder by seed (no `Math.random` in workflow scripts — seed on
round index). `refutePrompt` = "default REFUTED; reproduce against real code or
kill it; trust-boundary inputs are in-model."

---

## What changed from v1 → v2

| Dimension | v1 | v2 |
|---|---|---|
| Termination | single fan-out pass | loop until K dry rounds |
| Coverage proof | implicit | explicit checklist + honest-gap report |
| Positional bias | fixed context order | shuffled per round/lens |
| Verification | 1 skeptic per finding | N-of-M majority (≥2 of 3) |
| Dedup timing | after verify | before verify (saves budget) |

## When NOT to use it

- Trivial diffs (docs, tests-only, a one-line fix) — the loop is overkill; a
  single `/code-review` pass is right.
- When you need a fix, not a finding list — this audits, it doesn't patch. Feed
  survivors to an implementer afterward.

## Provenance

Structure distilled from a 2026-07-03 newsroom investigation into agentic
bug-hunting convergence: Anthropic `defending-code-reference-harness` (7-stage,
3/3 reproducibility), BugBot "Ralph Wiggum loop" (ODC coverage catalog,
shuffled orderings, terminate-on-ALL_CLEAN), and multi-model adversarial
consensus (gh-aw). v1 was the audit run earlier that session on
`runtime/agent-skills`.
