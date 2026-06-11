# cli-probe-loop — prototype notes

**Status:** PROTOTYPE. Throwaway. Delete or absorb once the decision lands.

## Question

Does the self-auditing loop (loop-engineering Pattern 9) generalize from
instruction-contradiction auditing (what `skill-self-audit-loop` does) to
**probing a CLI's branches for bugs until a full pass finds none new** — the
goal being the same "probe → fix → repeat until zero new" we did by hand on
`heal-skill`?

## Answer: yes, the loop core generalizes — proven

Driving `probe-loop.ts` with the real heal-skill probe history:

```
pass1: active     new=2  open=2          first probe finds 2 bugs
pass2: active     new=1  dedup=2          re-finds the 2 (dedup), 1 NEW via fresh angle
pass3: converged  new=0                   zero new in a full pass => CONVERGED
                  ...with 3 still open    convergence != all-fixed
after fixes: open=0  history kept=3       resolving keeps history, never deletes
```

Three properties confirmed:

1. **Dedup by signature** (`branch::shape`) — re-running probes counts knowns as
   dedup, not new. Without it the loop never converges (Pattern 2's token-drain trap).
2. **Stop oracle = zero NEW, not zero total** — converged with 3 findings still
   open. Discovery converges independently of repair. Matches Pattern 9's
   `new_findings_since_last_run == 0`, never `total == 0`, never agent self-report.
3. **Fix preserves history** — matches the audit loop's "do not delete findings".

## Design implication

`probe-loop.ts` has zero CLI- or contradiction-specific logic. The loop core is
**finding-type-agnostic**. Only three things differ between skill-audit and
cli-probe: the accepted **shapes**, the **finding generator**, and the **repair
handoff**. → Evidence for extracting a shared convergence-loop core with
`skill-self-audit-loop` and a future `cli-probe-loop` as thin scoped consumers,
rather than overloading the audit skill (whose tight contradiction taxonomy is
what makes it converge).

## The limit the prototype does NOT solve

The loop converges on "no new findings *the probes look for*." If the probe set
is blind to a bug class, it converges while missing it — same risk the audit
loop's Candidate Shapes mechanism fights. A production cli-probe-loop needs
**branch-coverage instrumentation** (loop until every parser branch is exercised),
not just "agents ran out of angles." That's the real next question, unanswered here.

## Files

- `probe-loop.ts` — the pure convergence ledger (the bit worth keeping).
- `tui.ts` — throwaway hand-drive shell: `bun run prototypes/cli-probe-loop/tui.ts`
  ([p] run pass, [r] resolve finding, [R] reset, [q] quit).
