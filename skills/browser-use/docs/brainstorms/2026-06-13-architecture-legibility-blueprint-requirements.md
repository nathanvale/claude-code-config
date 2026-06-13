---
date: 2026-06-13
topic: architecture-legibility-blueprint
status: requirements
mode: deep-product
seeded_from:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
  - skills/browser-use/docs/decisions/2026-06-13-001-gof-pattern-naming-decision-log.md
  - skills/browser-use/docs/decisions/2026-06-10-002-browser-use-module-split-decision-log.md
  - skills/browser-use/src/prototype-agent-browser-vertical-slice/NOTES.md
proof_artifacts:
  - skills/browser-use/src/prototype-agent-browser-vertical-slice/prototype.ts
  - skills/browser-use/docs/research/2026-06-13-firefox-third-lineage-spike.md
  - skills/browser-use/docs/research/2026-06-13-vision-sixth-lineage-spike.md
related:
  - skills/create-cli/SKILL.md
  - skills/create-cli/references/cli-command-facade.md
  - skills/browser-use/CONTEXT.md
  - docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md
---

# Architecture-legibility blueprint — requirements

## Summary

The product behavior is settled (R1–R14, `2026-06-12-browser-use-multi-engine-facade-requirements.md`).
This doc commits to the **architecture-legibility layer**: the target file structure and
naming convention that make the GoF + ICA seams obvious to an LLM maintaining the code.
The blueprint is the architecture contract `ce-plan` units build against — it does NOT
re-spec R1–R14 behavior. Two axes, kept orthogonal: a **seam-directory** layout organizes
the CODE; a **single facade command-contract** organizes the CLI. A pattern name attaches to
a seam only after that seam passes its proof gate — names follow proof, never precede it.

## Why now — the names are settled, the tree is not

Three inputs converged this session:

- **Pattern names are pressure-earned** (`2026-06-13-001-gof-pattern-naming-decision-log.md`):
  Adapter KEPT, Strategy REJECTED (→ evidence-first selection), Facade QUALIFIED to the
  action surface, the oracle named N-version programming (NOT Facade — it surfaces divergence,
  the opposite of hiding it). Vocabulary is fixed; the file tree does not yet reflect it.
- **Names follow proof, demonstrated** (vertical-slice prototype, `prototype-agent-browser-vertical-slice/NOTES.md`):
  an engine earns the Adapter name only after passing a lifecycle gate
  (`known → provable → mapped → selectable`); Template Method and Abstract Factory stayed
  DEFERRED because no second proof path exists yet. The tree must encode this — a directory
  named for a pattern must not claim the pattern is earned when it is still provisional.
- **The CLI is constrained to one level deep** (`create-cli` command-contract): a facade
  front door is a flat command set. Distinct domains do not get nested subcommands; they get
  flat verbs on one front door, or a separate front door. This forces the CLI axis to stay
  separate from the seam axis.

## The two axes (the core idea)

Legibility comes from refusing to conflate two things the current flat `src/` blurs:

- **CODE axis — seam directories.** One directory per ICA seam, the earned GoF name in the
  directory name. An LLM answers "where is the oracle?" by listing directories; pattern name
  and location are the same lookup.
- **CLI axis — one facade command-contract.** A single `browser-use` front door exposes flat
  verbs (`observe`, `operate`, `verify`, `repro`, `preflight`). Internal seams (oracle,
  perception, router, verify, redaction) are reached THROUGH those verbs, never as their own
  binaries. One-level-deep is honored without proliferating front doors.

The axes are independent: **adding a seam directory does NOT add a front door.** This is the
load-bearing invariant — it is what lets the code grow seam-by-seam while the CLI surface
stays one flat, maintainable contract.

## Target shape

### Code — seam directories

```
src/
  facade/        # GoF Facade (QUALIFIED): operate/observe/verify action surface
  adapter/       # GoF Adapter (EARNED): two-axis mapping, one file per engine
    chrome-devtools.ts
    playwright.ts
    agent-browser.ts
    ...
  oracle/        # N-version programming (EARNED): mechanical Set-diff over N engines
  router/        # evidence-first selection (NOT Strategy): admission-gated selection
  perception/    # sum type {RefObservation | PixelObservation} (vision spike)
  verify/        # post-state verify layer (R7)
  redaction/     # non-optional boundary (R8)
  core/          # shared leaf — imported by all seams, imports none (acyclic keystone)
```

### CLI — one front door, flat verbs

```
browser-use observe [--tier cheap|consensus]   # perception + oracle, reached via facade
browser-use operate [--stakes critical]        # quorum gate, reached via facade
browser-use verify
browser-use repro
browser-use preflight
```

One command-contract. Oracle, perception, verify are CODE seams the verbs route into — never
their own CLIs.

## Requirements

### A1 — Seam-directory layout
- One directory per ICA seam under `src/`; the earned GoF/ICA name is the directory name.
- `adapter/` holds one file per engine; adding an engine adds a file, not a new convention.
- The seam set at scaffold: facade, adapter, oracle, router, perception, verify, redaction, core.

### A2 — Names follow proof (the promotion marker)
- A seam directory may be scaffolded before its pattern is proven, but it must not imply the
  pattern is earned. Each seam carries a promotion status: `earned` vs `provisional`.
- Status lives where an LLM reads it without running code — a one-line header comment in the
  seam's entry file stating the earned/provisional verdict and its deletion-test.
- A pattern moves `provisional → earned` only when its proof gate passes (the vertical-slice
  lifecycle for adapters; an equivalent gate per seam). Template Method and Abstract Factory
  stay absent until a second proof path earns them — no speculative directories.

### A3 — Deletion-test comment per seam
- Each seam's entry file opens with its deletion-test (from the GoF decision log): one line
  stating what breaks if the seam is removed. This is the legibility primitive — an LLM reads
  why the seam exists before reading how it works.

### A4 — One facade command-contract (CLI axis)
- A single `browser-use` front door, flat command set, per the `create-cli` command-contract.
- Internal seams are reached through facade verbs; no seam gets its own front-door binary.
- Adding a seam directory must NOT add a front door (the orthogonality invariant).

### A5 — Acyclic keystone
- `core/` imports nothing internal and is imported by every seam (per the module-split log's
  keystone-leaf rule). A cycle surfaces as a typecheck error, not a runtime surprise.
- The dependency direction is one-way: facade → {adapter, oracle, router, perception, verify,
  redaction} → core. Document the allowed direction so an LLM placing new code knows where it goes.

### A6 — No banned-name drift
- The router seam is never named or commented "Strategy" (rejected pattern). The oracle seam
  is never named "Facade" (inverts intent). CONTEXT.md owns the `_Avoid_` alias list; the tree
  must not reintroduce a rejected name.

### A7 — Migration is non-destructive
- The existing 8-module split + adapter-router family migrate into seam directories without a
  big-bang rewrite; acyclic at every step (module-split log constraint). Test files move with
  their seam. (Migration sequencing is a ce-plan concern; this requirement only fixes the
  end-state and the no-big-bang constraint.)

## Success criteria

- [ ] An LLM answers "where is the oracle / router / perception?" by listing `src/` directories.
- [ ] Each seam's entry file states its earned/provisional status and deletion-test in the header.
- [ ] No directory exists for an unproven pattern claiming it is earned (Template Method /
      Abstract Factory absent until a second proof path earns them).
- [ ] The CLI is one flat `browser-use` front door; no seam has its own binary.
- [ ] Adding a new engine = one file in `adapter/`, zero new front doors, zero new conventions.
- [ ] `core/` imports nothing internal; the dependency direction is one-way and documented.
- [ ] No seam is named or commented with a rejected pattern name (Strategy on router, Facade
      on oracle).
- [ ] Migration from today's flat `src/` is acyclic at every step; no big-bang rewrite.

## Scope boundaries

### In
- The target seam-directory layout, the earned-name mapping, the promotion-marker convention,
  the one-front-door CLI invariant, the acyclic dependency direction, and the non-destructive
  migration end-state.

### Deferred for later
- Template Method / Abstract Factory directories — absent until a second proof path earns the
  names (vertical-slice verdict).
- A second CLI front door — only if a domain becomes independently agent-invoked (not the case
  for any current seam; all reach the agent through facade verbs).
- Per-seam proof gates beyond the adapter lifecycle — define each when that seam is built.

### Outside this product's identity
- Nested CLI subcommands per domain (`browser-use oracle diff ...`) — violates the
  one-level-deep command-contract; rejected.
- A directory whose name claims a pattern the code has not earned — the tree must not lie
  about which patterns are proven.

## Dependencies / assumptions
- `create-cli` command-contract enforces one-level-deep; the single-front-door invariant
  depends on it staying true.
- The GoF decision log's verdicts are the naming source of truth; this blueprint inherits them.
- ASSUMPTION (durability): the seam set is stable enough that directory churn is a one-time
  cost. If R-level behavior later splits a seam (e.g. oracle into diff + quorum), the
  promotion-marker convention absorbs it without renaming the axis.

## ce-plan extraction — how many plans

The blueprint decomposes into **three ce-plans**, ordered by dependency. They are
architecture-legibility plans; they consume R1–R14 behavior, they do not redefine it.

1. **Plan 1 — Seam scaffold + naming convention.** Create the seam directories, the
   promotion-marker + deletion-test header convention (A2/A3), the acyclic dependency
   direction (A5), and the banned-name guard (A6). Establishes the tree and the legibility
   primitives before any code moves. Smallest, unblocks the rest.
2. **Plan 2 — Non-destructive migration.** Move the existing 8 modules + adapter-router family
   into the seams, acyclic at every step, tests carried with their seam (A7). Depends on Plan 1.
3. **Plan 3 — One-front-door CLI alignment.** Collapse/confirm the CLI to a single facade
   command-contract with flat verbs (A4), prove discovery/help/argv/runtime cannot drift
   (`create-cli` facade proof expectations), and enforce the no-new-front-door invariant.
   Depends on Plan 2 (seams must exist before verbs route into them).

Rationale for three, not one: each has a distinct owner and a distinct proof (tree convention
/ acyclic migration / CLI drift-proof) and a clean dependency edge between them — bundling
them hides the migration risk behind naming theory and couples the CLI proof to incomplete
seams. Not more than three: the seams are reached through one contract, so there is no
per-domain CLI plan to extract.

## Outstanding questions
- **Promotion-marker mechanism:** header comment only, or a machine-checkable marker (a
  `STATUS` const the banned-name guard / a drift check can read)? Header is the floor; the
  machine-checkable form is a Plan 1 design call.
- **core/ contents boundary:** which existing shared symbols are truly leaf vs belong in a
  seam — resolved during Plan 2 by the typecheck-cycle signal, not pre-decided here.

## Decision trail
- Seam directories over flat prefixes — pattern name and file location become one lookup;
  accepted the one-time move churn for permanent navigation legibility.
- One front door, flat verbs over per-seam front doors — the command-contract is one level
  deep; seams reach the agent through facade verbs, so per-domain binaries would be carrying
  cost with no agent-invocation to justify them.
- Names follow proof — inherited from the vertical-slice verdict; the tree encodes earned vs
  provisional so it never claims an unproven pattern.
- Three ce-plans — one edge between each (convention → migration → CLI proof); fewer hides
  risk, more over-fits.

## Next step
Hand to `ce-plan` three times in order (scaffold → migration → CLI alignment), OR plan all
three with explicit dependency edges. Each plan consumes this blueprint plus R1–R14 for
behavior and the GoF decision log for names.
