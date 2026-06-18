# Decision Mode Examples

## Architecture Fork

```md
**Win**
This keeps the package boundary clear and avoids a future cleanup tax.

**Choice**
1. Keep it local: fastest, but duplicates behavior.
2. Extract a shared Module: more setup, but improves Locality if reused.

**My Pick**
2, Soft Pick. The evidence suggests reuse, but I would confirm one more caller.

**Next**
Reply `1`, `2`, `riff | r`, `mermaid | m`, or `why?`.
```

## Product Tradeoff

```md
**Win**
This chooses what the user feels first: speed or confidence.

**Choice**
1. Optimistic flow: fastest path, but errors arrive later.
2. Confirm-first flow: slower, but clearer recovery and trust.
3. Hybrid flow: default fast path with confirmation only on risky cases.

**My Pick**
3, Strong Pick. It keeps the happy path light and protects high-cost mistakes.

**Next**
Reply `1`, `2`, `3`, `riff | r`, `mermaid | m`, or `why?`.
```

## Voice-Calibrated Decision

```md
**Win**
This keeps the decision small: one boundary now, fewer surprise branches later.

**Choice**
1. Put the rule in `AGENTS.md`: best for agent procedure, but not domain
   meaning.
2. Put the term in `CONTEXT.md`: best for shared language, but only if the
   meaning is durable.
3. Keep it in the plan: best while the idea is still forming.

**My Pick**
3, Soft Pick. The term is promising, but it has not earned glossary weight yet.
Let's park it where it can mature without calcifying. Tiny win, no concrete
shoes.

**Next**
Reply `1`, `2`, `3`, `riff | r`, `mermaid | m`, or `why?`.
```

## No Real Choice Skip

```md
No real Decision Mode needed here: this is a reversible formatting default.
I will use the repo formatter and continue.
```

## Durable Doc Follow-Up

```md
**Win**
This prevents the same ownership question from being re-litigated later.

**Choice**
1. Record in the plan: best for temporary sequencing and open questions.
2. Record in an ADR: best for a hard-to-reverse tradeoff.
3. Record in `CONTEXT.md`: best for durable domain language.

**My Pick**
2, Soft Pick. This sounds like a durable architecture tradeoff, but I would
check whether an accepted ADR already owns it.

**Drift**
If we skip the owner, future agents may rediscover the same debate and encode a
different boundary.

**Next**
Reply `1`, `2`, `3`, `riff | r`, `mermaid | m`, or `why?`.
```
