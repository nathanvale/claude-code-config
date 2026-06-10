---
title: "Skill composability — handoff principle (provenance; merged into philosophy doc)"
type: brainstorm
status: merged
updated: 2026-05-30
summary: "Provenance for the skill-composability principle. The principle now lives in context/skill-design-philosophy.md (canonical owner). This doc keeps the worked instance + open questions only."
research: docs/research/2026-05-30-skill-composability-handoff-observability.md
related:
  - context/skill-design-philosophy.md
  - skills/browser-use/docs/brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md
---

# Skill composability — handoff principle (provenance)

**The principle is owned by `context/skill-design-philosophy.md` → "Skill composability" section.**
Don't restate it here (no parallel policy). This doc keeps only the worked instance and the open
questions the philosophy section deliberately left unresolved.

Research backing: `docs/research/2026-05-30-skill-composability-handoff-observability.md` (auto-fire
between skills via description matching is a phantom — ~0-50% reliable, no documented skill→skill
auto-handoff; explicit driver call + lifecycle hook is the buildable version).

## Concrete instance: browse + domain-checker + capture-run

(Full design in `skills/browser-use/docs/brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md`.)

```
You: "go to <site> and fill my timesheet"
  → browse (freestyle driver; already exists as browser-use) does its thing
  → hits a domain → browse EXPLICITLY calls Skill(domain-checker):
       "anything in the ledger for this domain? auth pointer / runbook tape / selectors?"
       → hands back what it found → browse keeps driving
  → run finishes → capture-run fires on a STOP HOOK → records the run → feeds the ledger
  → next time, domain-checker finds more. The loop compounds.
```

browse drives and makes the explicit handoff; capture-run fires on a lifecycle hook. The ledger is
the shared deterministic substrate they read/write. (Earlier framing had the two skills auto-firing
off their descriptions — research showed that's ~0-50% reliable and skill→skill auto-handoff isn't a
real mechanism; explicit call + hook is the buildable version.)

## Open questions for the brainstorm

- ANSWERED by research: end-of-run capture should fire on a **Stop hook**, not a description-trigger
  (a hook reliably knows a run finished; a description is ~20-50%).
- Ledger shape (shared with the browse/play tape work): per-domain folder — auth pointer, flow
  tapes, selector ledger. One ledger, three skills read/write it.
- Does domain-checker also cover the auth handoff (point browse at the op item for one-password), or
  is auth its own handed-to skill?
- **OPEN — fan-out:** a handed-to skill hands back to the driver (strong default). Whether it may
  *ever* call a third skill (e.g. a skill needing auth calls the auth skill) is unresolved — "never"
  is simple and kills A→B→A loops, but may be too absolute. Decide before enshrining as a hard rule.
