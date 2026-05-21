# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

## Language

**Helper command contract**:
The workflow promise for how an operator starts the Issue-to-PR helper. It covers runner shape and documented invocation, not helper semantics, command modes, or ledger validation behaviour. When contrasting runner families, say package-runner shape, not package-runner path.
_Avoid_: helper invocation contract, command contract, runner path, package-runner path

**Issue-to-PR v2 runbook**:
The next version of the Issue-to-PR workflow, still treated as a runbook rather than a formal Codex skill. Skill promotion is a separate future artifact migration, not part of v2.
_Avoid_: Issue-to-PR skill v2, formal Issue-to-PR skill, Codex skill promotion

**Proposer**:
An Issue-to-PR role that reads evidence and produces a candidate batch contract for human confirmation. A Proposer does not edit files, commit changes, or append Builder attempts.
_Avoid_: proposal-only Builder, read-only Builder, planner Builder

**Runbook version**:
A workflow-contract version stored in each Issue-to-PR ledger and in runtime contract code. It changes only when ledger interpretation, routing, migration, override evidence, or role packet semantics change.
_Avoid_: release number, date version, source revision, documentation version

## Example Dialogue

Dev: "Does changing the helper command contract mean the helper validates different ledger fields?"
Domain expert: "No. The helper command contract is only about how the helper is started. Ledger validation behaviour belongs to the helper semantics."

Dev: "Should Issue-to-PR v2 ship as a Codex skill?"
Domain expert: "No. Issue-to-PR v2 is a runbook refactor; skill promotion is a later artifact migration."

Dev: "Can the proposal-only Builder return a Builder envelope?"
Domain expert: "No. That role is the Proposer. It returns a candidate batch contract, not a Builder commit or Builder attempt."

Dev: "Should we bump the runbook version after moving text between references?"
Domain expert: "No. Bump the runbook version only when a ledger may be interpreted or routed differently."
