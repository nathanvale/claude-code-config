/** Human-facing CLI name used in help and repair guidance. */
export const COMMAND_NAME = "browser-use-support-ticket"

/** Stable identifier for machine-readable support-ticket results. */
export const CONTRACT_ID = "browser-use.support-ticket"

/** Version of the machine-readable result and embedded ticket vocabulary. */
export const SCHEMA_VERSION = "2"

/** Fixed public issue owner. */
export const SUPPORT_REPOSITORY = "nathanvale/claude-code-config"

/** Required issue label. */
export const SUPPORT_LABEL = "browser-use"

/** Required GitHub identity for the support repository. */
export const SUPPORT_GITHUB_LOGIN = "nathanvale"

/** Closed defect classes accepted by the public support-ticket input. */
export const SUPPORT_FAILURE_KINDS = [
	"runtime-terminal",
	"prose-routing",
	"prose-outcome",
] as const

/** User-visible task state at the failure boundary. */
export const SUPPORT_STATUSES = ["blocked", "degraded"] as const

/** Known state of an externally visible browser mutation. */
export const EXTERNAL_EFFECTS = ["none", "dispatched", "confirmed", "unknown"] as const

/** Same-input retry decision exposed to human and agent readers. */
export const RETRY_DISPOSITIONS = ["safe", "unsafe", "reconcile-first"] as const

/** Per-command terminal result. */
export const COMMAND_OUTCOMES = ["passed", "failed", "unknown"] as const

/** Per-command effect classification. */
export const COMMAND_SIDE_EFFECTS = [
	"none",
	"read",
	"write-attempted",
	"write-confirmed",
	"unknown",
] as const

/** Publication classification checked before any public GitHub write. */
export const PRIVACY_CLASSIFICATIONS = [
	"public-safe",
	"personal",
	"commercial-sensitive",
	"security-sensitive",
	"unknown",
] as const

/** Actor that performed the explicit public-data review. */
export const PRIVACY_REVIEWERS = ["agent", "human"] as const

/** Browser Use toolchain owners accepted by the public ticket contract. */
export const SUPPORT_COMPONENTS = [
	"browser-use",
	"browser-connect",
	"warm-chrome",
	"agent-browser",
	"chrome-devtools-mcp",
	"playwright-cdp",
	"browser-use-security",
	"cross-component",
	"other-toolchain",
] as const

/** Maintainer-authored discovery text for the public command surface. */
export const HELP_TEXT = `Usage: browser-use-support-ticket <preview|file> --input <path|-> [--json] [--execute] [--preview-digest <sha256>]

Render or file one redacted, deduplicated Browser Use support ticket.

Commands:
  preview   Validate and render the sanitized ticket without network access
  file      Check identity, label, and open duplicates; then create the issue

Options:
  --input <path|->   JSON support-ticket input; use - for stdin
  --execute          Required with file; authorizes the external GitHub write
  --preview-digest   Exact content digest returned by preview; required with file
  --json             Emit a stable JSON envelope
  -h, --help         Show help

Input JSON:
  component         Browser Use CLI, adapter, security, or cross-component owner
  failureKind       runtime-terminal | prose-routing | prose-outcome
  status            blocked | degraded
  errorCode         Stable defect code; uppercase snake case
  failureLocus      Stable component or workflow location
  correlationId     Public-safe occurrence identifier
  requestSummary    Sanitized summary of the user's requested outcome
  summary, impact, expected, actual, minimalReproduction
  externalEffect    none | dispatched | confirmed | unknown
  retry             Same-input disposition and next safe action
  commands[]        Complete ordered command, outcome, error, exit, and effect
  failureEvidence[] Proof of the runtime, route, or outcome failure
  diagnostics[]     Optional bounded diagnostic facts; never raw logs
  environment       Optional harness, OS, tool versions, revision, install channel
  privacy           Required public-data classification, reviewer, and redactions

Safety:
  file refuses the wrong GitHub identity, a missing browser-use label, invalid
  failure evidence, unsafe retry claims, non-public data, or sensitive output.
  Security-sensitive evidence routes to private vulnerability reporting.

Exit codes:
  0  Previewed, created, deduplicated, or help
  2  Invalid usage
  3  Invalid input
  4  GitHub CLI unavailable, unauthenticated, or wrong identity
  5  Required repository label missing
  6  GitHub read or write failed
`

/** Closed command set aligned with parser acceptance and help. */
export const COMMANDS = ["preview", "file"] as const

/** Long flags rendered by help and accepted by the parser. */
export const LONG_OPTIONS = [
	"--input",
	"--execute",
	"--preview-digest",
	"--json",
	"--help",
] as const
