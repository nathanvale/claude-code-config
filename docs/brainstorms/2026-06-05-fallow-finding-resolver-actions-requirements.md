---
date: 2026-06-05
topic: fallow-finding-resolver-actions
title: "Fallow finding resolver actions"
type: brainstorm
---

# Fallow Finding Resolver Actions Requirements

## Summary

Add Finding resolver actions for introduced traceable `remove-export` findings.
The finding advertises a tiny runnable continuation, addressed by file and
export, and the resolver returns evidence-grade-first output with any verdict
or action derived from that evidence.

## Problem Frame

Audit attribution now separates introduced findings from inherited findings.
When introduced is zero, the runner already tells the agent to continue without
per-finding triage.

The remaining sharp problem is narrower: when audit surfaces an introduced
`remove-export` finding on a contract-like export, an agent needs deterministic
reachability evidence before treating removal as safe. The spike proved
`trace_export` can supply that evidence, but a command-first `why` shape would
make agents remember another route before the finding proves it is worth
tracing.

The proposed shape keeps the finding as the decision surface. The runner marks
only eligible findings with a Finding resolver action. The action points at a
discoverable runnable target; the resolver output explains the evidence without
turning absence of trace references into deletion proof.

## Key Decisions

- **Actions-first resolver surface.** Findings advertise resolver actions. The
  resolver command may exist, but docs and workflows teach agents to start from
  the finding.
- **Introduced traceable findings only.** V1 advertises resolver actions only
  for introduced `remove-export` findings that carry file and export
  coordinates.
- **Coordinates-first target.** The runnable target is addressed by file and
  export. Finding-id addressing and last-run state are deferred.
- **Evidence-grade-first output.** Resolver evidence grades are the source of
  truth. Verdicts and next actions are derived helpers.
- **No `likely-dead` wording.** Use evidence wording such as
  `unreferenced_by_trace` and action wording such as `candidate_remove`.
- **Tiny action payload.** Finding resolver actions carry only enough
  information to identify the continuation and required coordinates.
- **Visible but secondary command.** The runnable target is discoverable
  through help and command discovery. Skill docs keep the action-first route.
- **Docs route, code owns contracts.** Prose names when to follow resolver
  actions. Runtime code, help, discovery, and tests own exact contracts.
- **V2 parking lot only.** Future trace ideas are captured but do not become
  MVP acceptance criteria.

## Actors

- A1. **Skill driver:** Agent or human using Fallow evidence to review current
  work.
- A2. **Runner Facade:** Fallow wrapper that normalizes analyzer evidence,
  issue references, discovery, and repair hints.
- A3. **Analyzer finding:** Fallow finding projected into runner issue
  references.
- A4. **Finding resolver action:** Per-finding continuation that gathers more
  evidence for one finding.
- A5. **Resolver target:** Discoverable runnable command behind the Finding
  resolver action.
- A6. **Fallow decision log:** Durable source for accepted resolver decisions.

## Requirements

**Resolver eligibility**

- R1. The runner advertises Finding resolver actions only for introduced
  findings.
- R2. The runner advertises Finding resolver actions only for traceable
  findings.
- R3. A v1 Traceable finding is an introduced `remove-export` finding with file
  and export coordinates.
- R4. Inherited findings do not advertise Finding resolver actions in normal
  audit output.
- R5. Findings without the required coordinates do not advertise Finding
  resolver actions.
- R6. `needs_trace` remains a broad summary signal and does not by itself make a
  finding traceable.

**Action surface**

- R7. A Finding resolver action names a runnable target.
- R8. A Finding resolver action stays distinct from blocked-run repair actions.
- R9. A Finding resolver action payload stays tiny: action identity, runnable
  target, required coordinates, and reason.
- R10. A Finding resolver action does not copy command help, output contracts,
  or parser details into the issue reference.
- R11. The runnable target is visible in command discovery and help.
- R12. Skill and workflow docs teach the action-first route, not command-first
  audit triage.

**Resolver target behavior**

- R13. The resolver target accepts file and export coordinates.
- R14. The resolver target gathers deterministic export reachability evidence.
- R15. The resolver target maps transport or setup failures to blocked-run
  recovery.
- R16. The resolver target maps missing or invalid coordinates to input
  recovery.
- R17. The resolver target does not require finding-id lookup or last-run state
  in v1.

**Output meaning**

- R18. Resolver output uses evidence grades as the primary meaning.
- R19. Resolver output may derive a concise verdict or next safe action from
  the evidence grade.
- R20. Resolver output avoids `likely-dead` wording in JSON and plain output.
- R21. `unreferenced_by_trace` means deletion candidate, not deletion proof.
- R22. Referenced or entry-point evidence means stop and keep the export.
- R23. Unresolved or unavailable trace evidence blocks deletion action.
- R24. Top-level runner status remains `ok`, `issues`, or `blocked`.
- R25. Resolver-specific meaning lives in mode evidence or equivalent
  package-owned result vocabulary.

**Documentation and ownership**

- R26. `SKILL.md` routes agents to read introduced findings first and follow
  advertised Finding resolver actions only when present.
- R27. `references/workflows.md` explains the audit gate and cleanup boundary.
- R28. `references/commands.md` points to resolver command discovery without
  copying exact contracts.
- R29. Runtime contract code, generated discovery, rendered help, parser tests,
  and runtime tests own exact command and output semantics.
- R30. The resolver requirements cite the Fallow decision log as accepted
  decision source.

**V2 parking lot**

- R31. V2 candidates are listed as deferred ideas, not MVP requirements.
- R32. Planning treats V2 candidates as non-goals unless a later decision
  promotes one.
- R33. Implementation workers preserve the MVP boundary from the decision log.

## Key Flow

- F1. **Introduced traceable export resolver**
  - **Trigger:** Audit emits an introduced `remove-export` finding with file and
    export coordinates.
  - **Actors:** A1, A2, A3, A4, A5
  - **Steps:** The runner projects the finding, advertises a tiny Finding
    resolver action, the skill driver follows the runnable target, and the
    resolver returns evidence-grade-first output.
  - **Outcome:** The agent gets deterministic reachability evidence and a
    derived next safe action without re-triaging inherited findings.
  - **Covers:** R1-R5, R7-R13, R18-R25

- F2. **Zero introduced stop**
  - **Trigger:** Audit attribution reports zero introduced findings.
  - **Actors:** A1, A2
  - **Steps:** The runner reports the stop/continue signal. The skill driver
    does not inspect inherited findings for resolver actions.
  - **Outcome:** Existing audit attribution remains the first gate.
  - **Covers:** R1, R4, R6, R12, R26

## Acceptance Examples

- AE1. **Covers R1-R5.** Given an audit result with one introduced
  `remove-export` finding and one inherited `remove-export` finding, when the
  runner projects issue references, then only the introduced traceable finding
  advertises a Finding resolver action.
- AE2. **Covers R5, R13, R17.** Given an introduced `remove-export` finding
  missing file or export coordinates, when the runner projects the finding,
  then no Finding resolver action is advertised for that finding.
- AE3. **Covers R6.** Given a finding or summary carries a broad trace signal
  but lacks the v1 traceable finding shape, when the runner projects issue
  references, then it does not advertise a runnable resolver action.
- AE4. **Covers R18-R23.** Given the resolver target returns referenced
  evidence, when the runner renders JSON and plain output, then the evidence
  grade is the source of truth and the derived action tells the agent to keep
  the export.
- AE5. **Covers R20-R21.** Given the resolver target finds no direct
  references, when output renders, then the result uses evidence wording such
  as `unreferenced_by_trace` and treats removal as a candidate action only.
- AE6. **Covers R24-R25.** Given any resolver result, when the runner emits its
  envelope, then top-level status remains in the existing runner status set and
  resolver-specific meaning stays in package-owned mode evidence.
- AE7. **Covers R26-R29.** Given a reader opens Fallow skill docs, then docs
  explain when to follow Finding resolver actions without copying exact command
  payloads, flags, parser rules, or output schemas.

## Success Criteria

- Agents can discover the resolver continuation from the finding that needs it.
- Zero-introduced audit runs still stop without per-finding triage.
- Introduced traceable findings expose a runnable continuation with no prose
  interpretation needed.
- Resolver output reduces false-positive deletion risk without overclaiming
  deletion safety.
- Command discovery, help, parser acceptance, and runtime semantics cannot drift
  silently.
- Planning can proceed without inventing the resolver's user-facing behavior or
  scope boundaries.

## Scope Boundaries

Deferred for later:

- Finding-id addressing.
- Last-run state or saved envelope lookup.
- Resolver registry by finding kind.
- Batch trace for all introduced traceable findings.
- Broader trace command family.
- Non-audit baseline or regression proof.
- Resolver actions for explicit cleanup outside normal audit.
- Shared mcporter utility after a third consumer exists.
- Trace evidence artifact ledger.

Out of scope for the MVP:

- Advertising resolver actions for inherited audit findings.
- Advertising resolver actions from `needs_trace` alone.
- Treating static trace absence as deletion proof.
- Copying exact command or output contracts into skill prose.
- Designing a general trace framework.

## Dependencies And Assumptions

- The runner can project introduced state, action, path, and symbol from Fallow
  output when present.
- The proven export trace path remains available through Fallow MCP and local
  transport.
- `CONTEXT.md` owns the canonical terms Finding resolver action and Traceable
  finding.
- `docs/decisions/2026-06-04-fallow-agent-native-decision-log.md` remains the
  accepted decision source for Fallow runner design.

## Outstanding Questions

Resolve before planning:

- Choose the public command spelling for the visible resolver target.
- Decide whether coordinate input uses positional form, flags, or another
  command-discovery-owned shape after checking facade support.

Deferred to planning:

- Decide exact evidence-grade literals.
- Decide exact derived verdict and next-action literals.
- Decide exact transport adapter shape and test seams.
- Decide whether existing issue-reference fields need a new nested resolver
  action projection or can extend current model safely.

## Sources

- `docs/ideation/2026-06-05-fallow-why-resolver-ideation.md`
- `docs/decisions/2026-06-04-fallow-agent-native-decision-log.md`
- `docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md`
- `docs/plans/2026-06-05-002-feat-fallow-why-subcommand-plan.md`
- `skills/fallow/scripts/prototype-why-symbol/NOTES.md`
- `skills/fallow/references/workflows.md`
- `CONTEXT.md`
