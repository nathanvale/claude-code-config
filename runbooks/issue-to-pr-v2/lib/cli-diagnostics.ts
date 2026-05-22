/**
 * CLI diagnostics for the Issue-to-PR v2 CLI front door (U4).
 *
 * Patterns lifted from `@side-quest/cli-command-facade`'s `cli-diagnostics.ts`
 * (run-id propagation, started-at-ms timing, --quiet/--verbose/--debug
 * verbosity ladder, JSON Lines stderr stream) but **without** LogTape as a
 * runtime dependency. The shapes mirror LogTape's so a U7+ migration to
 * full LogTape integration can swap the emitter without rewriting call
 * sites.
 *
 * Two streams, strictly separated:
 *
 * - **stdout** carries exactly one JSON envelope per command (see
 *   `lib/cli-envelope.ts`).
 * - **stderr** carries zero-or-more JSON Lines diagnostic records, one per
 *   line. Records are skipped entirely in `quiet` mode, emitted at the
 *   default verbosity for `level: "info"` and above, and emitted at every
 *   level in `debug` mode.
 *
 * Mixing the two streams is a P1 violation per the U4 seam runbook.
 */

import type { CliWriter } from "./cli-envelope";

export const CLI_DIAGNOSTIC_MODES = [
  "quiet",
  "default",
  "verbose",
  "debug",
] as const;
export type CliDiagnosticMode = (typeof CLI_DIAGNOSTIC_MODES)[number];

export const CLI_DIAGNOSTIC_LEVELS = [
  "debug",
  "info",
  "warning",
  "error",
] as const;
export type CliDiagnosticLevel = (typeof CLI_DIAGNOSTIC_LEVELS)[number];

const LEVEL_RANK: Record<CliDiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

const MODE_MIN_LEVEL: Record<CliDiagnosticMode, number> = {
  quiet: Number.POSITIVE_INFINITY, // emit nothing
  default: LEVEL_RANK.warning, // warnings and errors only
  verbose: LEVEL_RANK.info,
  debug: LEVEL_RANK.debug,
};

export type CliDiagnosticOptions = {
  mode: CliDiagnosticMode;
  runId: string;
  startedAtMs: number;
};

export type ParsedDiagnosticArgv = {
  argv: string[];
  mode: CliDiagnosticMode;
};

/**
 * Parse and strip `--quiet`, `--verbose`, `--debug` flags from argv.
 *
 * Returns the remaining argv (with the verbosity flags removed) and the
 * resolved mode. If multiple flags are present, the most verbose wins
 * (`debug` > `verbose` > `default` > `quiet`); this matches sidequest's
 * tolerance for redundant flags. Unknown flags pass through to the caller
 * for command-specific parsing.
 */
export function parseDiagnosticArgv(
  argv: readonly string[],
): ParsedDiagnosticArgv {
  const out: string[] = [];
  let quiet = false;
  let verbose = false;
  let debug = false;
  for (const arg of argv) {
    if (arg === "--quiet") {
      quiet = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--debug") {
      debug = true;
      continue;
    }
    out.push(arg);
  }
  let mode: CliDiagnosticMode = "default";
  if (debug) mode = "debug";
  else if (verbose) mode = "verbose";
  else if (quiet) mode = "quiet";
  return { argv: out, mode };
}

/**
 * Structured diagnostic record. One per line on stderr, JSON-encoded.
 *
 * Schema:
 * - `timestamp`: ISO 8601 string at emission time.
 * - `level`: one of `debug | info | warning | error`.
 * - `category`: dot-separated namespace (e.g. `cli.state.read-frontmatter`).
 * - `message`: human/agent-readable summary.
 * - `event`: optional machine-readable event name for routing.
 * - `run_id`: the same run id stamped on the stdout envelope, so any
 *   stderr line can be correlated to its command invocation.
 * - `started_at_ms`: command-entry timestamp.
 * - `duration_ms`: derived from now − started_at_ms at emission time.
 * - extra fields: arbitrary key/value pairs the caller adds.
 */
export type CliDiagnosticRecord = {
  timestamp: string;
  level: CliDiagnosticLevel;
  category: string;
  message: string;
  event?: string;
  run_id: string;
  started_at_ms: number;
  duration_ms: number;
  [key: string]: unknown;
};

export type EmitDiagnosticInput = {
  level: CliDiagnosticLevel;
  category: string;
  message: string;
  event?: string;
  attributes?: Record<string, unknown>;
};

/**
 * Emit one JSON Lines diagnostic record to stderr if the mode allows it.
 *
 * No-ops when `options.mode === "quiet"` or when the input level is below
 * the mode's threshold. Always writes a single line with a trailing `\n`.
 */
export function emitDiagnostic(
  stderr: CliWriter,
  options: CliDiagnosticOptions,
  input: EmitDiagnosticInput,
): void {
  const minLevel = MODE_MIN_LEVEL[options.mode];
  if (LEVEL_RANK[input.level] < minLevel) return;
  // F011 fix: build the structured fields FIRST, then spread the
  // filtered attributes. `stripReservedDiagnosticKeys` removes the eight
  // reserved keys so a caller-supplied `attributes: { run_id: "fake" }`
  // cannot shadow the canonical run_id and break stdout/stderr
  // correlation. With this order, the strip helper is genuinely
  // load-bearing for every reserved key, not just `event`.
  const filteredAttributes = stripReservedDiagnosticKeys(input.attributes);
  const record: CliDiagnosticRecord = {
    timestamp: new Date().toISOString(),
    level: input.level,
    category: input.category,
    message: input.message,
    run_id: options.runId,
    started_at_ms: options.startedAtMs,
    duration_ms: Date.now() - options.startedAtMs,
    ...(input.event === undefined ? {} : { event: input.event }),
    ...filteredAttributes,
  };
  stderr.write(`${JSON.stringify(record)}\n`);
}

const RESERVED_DIAGNOSTIC_KEYS = new Set([
  "timestamp",
  "level",
  "category",
  "message",
  "run_id",
  "started_at_ms",
  "duration_ms",
  "event",
]);

function stripReservedDiagnosticKeys(
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!attributes) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!RESERVED_DIAGNOSTIC_KEYS.has(key)) out[key] = value;
  }
  return out;
}
