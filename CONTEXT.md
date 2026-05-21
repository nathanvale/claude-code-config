# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

## Language

**Helper command contract**:
The workflow promise for how an operator starts the Issue-to-PR helper. It covers runner shape and documented invocation, not helper semantics, command modes, or ledger validation behaviour. When contrasting runner families, say package-runner shape, not package-runner path.
_Avoid_: helper invocation contract, command contract, runner path, package-runner path

## Example Dialogue

Dev: "Does changing the helper command contract mean the helper validates different ledger fields?"
Domain expert: "No. The helper command contract is only about how the helper is started. Ledger validation behaviour belongs to the helper semantics."
