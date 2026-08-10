# Tool Execution Context

`tool-execution` is the deterministic controller for prepared CLI requests,
task-policy dispatch approval, private receipts, result classification,
checkpoints, and durable resume. It does not proxy native MCP calls.

## Language

**Prepared request**: validated provider intent represented by a redacted
fingerprint, exact adapter route, attempt, checkpoint, and qualification cell.
It has not crossed the provider boundary.

**Dispatch checkpoint**: atomic `dispatched` receipt persisted immediately
before the provider child spawn attempt.

**Unknown outcome**: dispatched work with no complete persisted result class.
It blocks automatic continuation.

**Terminal outcome**: denied work or work with one complete disjoint result
class. Resume skips it.

**Qualification lane**: one of Claude Code CLI, Codex CLI/TUI, Codex Desktop,
or explicit CLI. Each lane is proved independently.

**Native observation**: redacted evidence from a client-owned native call,
accepted only when every active provenance binding matches. It is not a
controller dispatch claim.

**Untrusted provider data**: returned content usable as evidence only. It has
no authority over execution, route, approval, fallback, repair, or retry.

## CLI brief

- Command: `tool-execution`.
- Users: agents prepare and inspect; externally approved task policy gates approve, call, and retry; governance reads receipts.
- No args: bounded read-only dashboard.
- Commands: `contract`, `checkpoint`, `prepare`, `approve`, `call`, `observe`, `resume`, `receipts`.
- Input: JSON file or stdin. Keep secret-bearing data out of argv.
- Approval: TTY state is receipt UX only, never proof of human presence. Obtain task-policy approval before `--approve` or `--approve-retry`.
- Output: concise human text or stable `--json`; stdout owns data, stderr owns diagnostics.
- Correlation: facade-owned run id on JSON envelopes.
- Side effects: command metadata declares reads, private state writes, and provider network dispatch.
- Recovery: terminal skips; unknown stops; exact task-policy retry creates a linked attempt.
- Smoke: `tool-execution contract --json`.

## Relationships

- CLI metadata and runtime envelopes use `@side-quest/cli-command-facade`.
- Child execution uses `@side-quest/mcporter-transport`.
- `firecrawl-cli` permits search only.
- `mcporter-cli` calls the U6-owned `mcporter-mac-mini` explicit-config wrapper.
- `mcporter-cli` permits one explicit server and tool selector.
- Later lifecycle admission belongs to `runtime/agent-tools`, not this package.
