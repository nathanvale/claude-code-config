/** Human-facing command name used in help and diagnostics. */
export const COMMAND_NAME = "domain-retrospective"
/** Stable identifier for successful session evidence payloads. */
export const CONTRACT_ID = "domain-modeling-retrospective.sessions"
/** Version of the machine-readable success payload. */
export const SCHEMA_VERSION = "1"

/** Maintainer-authored discovery text for the public command surface. */
export const HELP_TEXT = `Usage: domain-retrospective <command> [options]

Discover private Claude Code and Codex session evidence for one Git repository.
The command is read-only and never writes domain documentation.

Commands:
  scan       Rank repository-scoped sessions without emitting conversation text
  extract    Return one redacted, paginated message slice from a discovered session

Scan:
  domain-retrospective scan --repo <path> [--term <text> ...] [--limit <n>] [--json]

Extract:
  domain-retrospective extract --repo <path> --session <source:id>
    [--offset <n>] [--limit <n>] [--max-message-chars <n>] [--json]

Options:
  --repo <path>               Git repository or linked worktree
  --term <text>               Current domain term to match; repeatable
  --session <source:id>       Opaque session id returned by scan
  --offset <n>                Message offset for extract (default: 0)
  --limit <n>                 Scan result or extracted-message limit
  --max-message-chars <n>     Per-message text limit (default: 2000)
  --json                      Emit a stable JSON result envelope
  -h, --help                  Show help

Session sources:
  Claude Code: ~/.claude/projects
  Codex:       ~/.codex/sessions and ~/.codex/archived_sessions

Exit codes:
  0  Success or help
  2  Invalid usage
  3  Discovery or extraction failure
`

/** Closed command set kept aligned with parser acceptance and rendered help. */
export const COMMANDS = ["scan", "extract"] as const
