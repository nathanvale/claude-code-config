/** Human-facing CLI name used in help and repair guidance. */
export const COMMAND_NAME = "session-recovery"
/** Stable identifier for recovery inventory, extraction, and validation payloads. */
export const CONTRACT_ID = "session-recovery.review"
/** Version of the machine-readable result vocabulary. */
export const SCHEMA_VERSION = "1"
/** Default number of normalized messages returned by extract. */
export const EXTRACT_DEFAULT_LIMIT = 40
/** Maximum number of normalized messages returned by one extract call. */
export const EXTRACT_MAX_LIMIT = 200
/** Default and maximum per-message character budget for extract. */
export const MAX_MESSAGE_CHARS = 2000

/** Maintainer-authored discovery text for the public command surface. */
export const HELP_TEXT = `Usage: session-recovery <command> [options]

Inventory private Claude Code and Codex sessions, extract bounded evidence, and
validate an agent-authored accounting ledger. Commands are read-only. Vault
writes require a separate foreground proposal and human approval.

Commands:
  scan       Account for sessions overlapping an explicit time window
  extract    Return one redacted, paginated message slice
  validate   Reconcile an inventory JSON file with a review JSONL file

Scan:
  session-recovery scan --from <date|timestamp> --to <date|timestamp>
    [--source claude|codex ...] [--repo <path>] [--session <source:id> ...] [--json]

Extract:
  session-recovery extract --session <source:id>
    [--offset <n>] [--limit <n>] [--max-message-chars <n>] [--json]

Validate:
  session-recovery validate --inventory <scan.json> --ledger <review.jsonl> [--json]

Window semantics:
  --from is inclusive; --to is exclusive.
  YYYY-MM-DD values use the machine's local timezone.
  Timestamps must be ISO 8601 and include an offset or Z.

Options:
  --from <value>              Inclusive scan boundary
  --to <value>                Exclusive scan boundary
  --source <name>             Selected runtime; repeatable; default: both
  --repo <path>               Optional Git repository filter
  --session <source:id>       Exact session filter; repeatable for scan
  --offset <n>                Extract message offset (default: 0)
  --limit <n>                 Extract page size (default: ${EXTRACT_DEFAULT_LIMIT}; max: ${EXTRACT_MAX_LIMIT})
  --max-message-chars <n>     Per-message text budget (default/max: ${MAX_MESSAGE_CHARS})
  --inventory <path>          Scan JSON envelope or data payload
  --ledger <path>             One review row per JSONL line
  --json                      Emit a stable JSON envelope
  -h, --help                  Show help

Exit codes:
  0  Success or help
  2  Invalid usage
  3  Discovery, extraction, or file failure
  4  Review ledger invalid
`

/** Closed command set aligned with parser acceptance and help. */
export const COMMANDS = ["scan", "extract", "validate"] as const

/** Long flags rendered by help and accepted by the parser. */
export const LONG_OPTIONS = [
	"--from",
	"--to",
	"--source",
	"--repo",
	"--session",
	"--offset",
	"--limit",
	"--max-message-chars",
	"--inventory",
	"--ledger",
	"--json",
	"--help",
] as const
