---
status: accepted
date: 2026-08-14
---

# Task Lifecycle owns Completion Task choreography, extracted from the CLI

The launch, acknowledgement, and terminalisation choreography for a [Completion Task] — and the at-most-one-owner and Attempt-fencing invariants that make it correct — lived inline in `cli.ts`, a file whose declared job is envelope translation. The launch-winner decision was recomputed at four sites, the [Launch Acknowledgement Window] was a bare `1_500` literal at three, and the staleness half of the same fence lived apart in `task-reconciliation.ts`. Two independent architecture reviews found this from opposite ends (interface-width and deletion-test), which is why it earned a decision rather than a quiet refactor. We extract a single [Task Lifecycle] module that owns this choreography, and `cli.ts` becomes an adapter that maps its result to an envelope.

## Considered Options

- **Pure module behind the existing runtime seam (chosen).** All process, spawn, and clock effects already reach the choreography through one injected `VaultGitBackgroundCompletionRuntime`, so the state decisions extract with zero OS calls. The interface is the test surface: every fence branch — launch-winner, launch expiry, worker-lost — is reachable with a fake runtime and no real subprocess.
- **Fat module that owns spawn and process-identity IO directly.** Rejected: it would keep the choreography untestable without spawning workers, defeating the reason to extract it.

## Consequences

- The module returns a discriminated outcome — `{ kind: "settled", state } | { kind: "refused", reason }` over a closed reason set — rather than returning a bare state and throwing on refusal. The refusal reasons become part of the interface a caller and a test read directly, not a control-flow path they must catch.
- The foreground-launcher vs in-worker mode, today an out-of-band `VAULT_GIT_TASK_ID` env read mid-dispatcher, becomes a typed `role` input resolved once at composition. The env read leaves the dispatcher.
- The [Launch Acknowledgement Window] and the staleness budget are named, sibling constants; the fence is written and checked in one module instead of split across two.
- Prerequisite ordering: the three behaviour-preserving correctness dedups (the acknowledgement-window constant, the resumed-commit predicate, and the [Durable Exclusive Publish] core) land first, each proven to change no observable fence outcome, `EEXIST` return, or durability order, before this larger extraction moves what remains.

[Completion Task]: ../../CONTEXT.md
[Task Lifecycle]: ../../CONTEXT.md
[Launch Acknowledgement Window]: ../../CONTEXT.md
[Durable Exclusive Publish]: ../../CONTEXT.md
