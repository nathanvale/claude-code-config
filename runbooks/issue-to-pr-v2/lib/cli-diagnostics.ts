/**
 * CLI diagnostics for the Issue-to-PR v2 CLI front door (U4 + U7).
 *
 * U4 established the JSON-Lines stderr diagnostic *shape* — `timestamp`,
 * `level`, `category`, `event`, `run_id`, `started_at_ms`, `duration_ms`,
 * `message`, plus arbitrary attributes — and the
 * `--quiet | --verbose | --debug` verbosity ladder.
 *
 * U7 layers the *runtime infrastructure* the hot router needs on top of
 * that shape, without changing the emitted record:
 *
 * 1. LogTape integration. When `configureCliDiagnostics({...})` has been
 *    called, emitDiagnostic routes records through a LogTape category
 *    tree rooted at `categoryRoot` (default `issue-to-pr-v2`) so
 *    consumers can subscribe by namespace (`issue-to-pr-v2.cli.state`,
 *    etc.).
 * 2. AsyncLocalStorage run-id propagation. Deeply-called helpers can
 *    call `getCurrentCliDiagnosticContext()` instead of threading
 *    `runId` through every signature.
 * 3. Redactor hook. `CliDiagnosticRedactor` is applied to every record
 *    just before it hits the writer so an Issue-to-PR-v2-specific
 *    redactor can scrub credentials / tokens / secrets that may appear
 *    inside ledger excerpts (frontmatter values, commit refs, finding
 *    summaries).
 *
 * Forward compatibility: the emitted record shape is identical to U4.
 * Callers that never invoke `configureCliDiagnostics` get the same
 * direct-to-writer JSON Lines stream U4 shipped — the LogTape backend
 * and the redactor are opt-in.
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

import { AsyncLocalStorage } from "node:async_hooks";

import {
  configureSync,
  getLogger,
  reset,
  type LogLevel,
  type LogRecord,
  type Sink,
} from "@logtape/logtape";

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
 * Schema (unchanged from U4):
 * - `timestamp`: ISO 8601 string at emission time.
 * - `level`: one of `debug | info | warning | error`.
 * - `category`: dot-separated namespace (e.g. `cli.state.read-frontmatter`).
 * - `message`: human/agent-readable summary.
 * - `event`: optional machine-readable event name for routing.
 * - `run_id`: the same run id stamped on the stdout envelope.
 * - `started_at_ms`: command-entry timestamp.
 * - `duration_ms`: derived from now - started_at_ms at emission time.
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
 * A redactor callback. Receives a deep-cloned copy of the canonical
 * diagnostic record AFTER the U4-shape fields have been populated.
 * Return either:
 *
 * - A new record (or the cloned input, possibly mutated) to emit;
 * - `null` to drop the record entirely.
 *
 * The redactor MUST NOT widen the record shape: the `timestamp`,
 * `level`, `category`, `message`, `run_id`, `started_at_ms`, and
 * `duration_ms` fields are load-bearing for U4 consumers and any
 * future LogTape sink that depends on them. The sink re-validates
 * the returned record (F004/F020) — a missing-field or wrong-type
 * return drops the record rather than emitting a malformed line.
 *
 * The redactor IS expected to scrub or rewrite sensitive attribute
 * *values* (credential-like patterns in commit refs, finding
 * summaries, frontmatter excerpts, etc.). Because the input is
 * deep-cloned via `structuredClone`, mutating nested objects in
 * place is safe — the carrier object that LogTape holds is
 * unaffected.
 *
 * A throwing redactor is caught inside the sink and the record is
 * dropped; the CLI does not crash and the unredacted record does
 * not leak via LogTape's meta logger (F019/F022).
 */
export type CliDiagnosticRedactor = (
  record: CliDiagnosticRecord,
) => CliDiagnosticRecord | null;

/**
 * The context propagated through AsyncLocalStorage so deeply-called
 * helpers can emit diagnostics without threading the U4 `CommandContext`
 * shape through every signature.
 */
export type CliDiagnosticContext = {
  runId: string;
  startedAtMs: number;
  mode: CliDiagnosticMode;
};

/**
 * Module-level configuration set by `configureCliDiagnostics`. Until it
 * is called, `emitDiagnostic` falls back to the U4 direct-to-stderr path
 * (preserving backward compatibility with every existing caller).
 *
 * Notes on isolation: this is a singleton. Different "runs" within the
 * same process share the LogTape configuration but get independent
 * AsyncLocalStorage scopes via `withCliDiagnosticContext`.
 */
type ConfiguredState = {
  categoryRoot: string;
  diagnosticWriter: CliWriter;
  redact: CliDiagnosticRedactor | null;
};

let configured: ConfiguredState | null = null;
const contextStorage = new AsyncLocalStorage<CliDiagnosticContext>();

/**
 * Configure the diagnostics emitter for the current process.
 *
 * Wires LogTape's category tree under `categoryRoot` (default
 * `issue-to-pr-v2`) so subscribers can filter by namespace (e.g.
 * `issue-to-pr-v2.cli.state`). Every record routed through this
 * configuration lands on `diagnosticWriter` as a single JSON Line in the
 * U4 shape. The optional `redact` callback runs immediately before the
 * write and may return null to suppress the record.
 *
 * Calling this multiple times is supported and idempotent for the
 * LogTape backend: each call resets the LogTape configuration so the
 * sink list does not grow. Tests use this to install per-test writers.
 */
export function configureCliDiagnostics(options: {
  categoryRoot?: string;
  diagnosticWriter: CliWriter;
  redact?: CliDiagnosticRedactor | null;
}): void {
  const categoryRoot = options.categoryRoot ?? "issue-to-pr-v2";
  configured = {
    categoryRoot,
    diagnosticWriter: options.diagnosticWriter,
    redact: options.redact ?? null,
  };
  configureSync({
    reset: true,
    sinks: { cli: buildLogTapeSink() },
    loggers: [
      // Root v2 logger sees everything from `categoryRoot.*`.
      { category: categoryRoot, sinks: ["cli"], lowestLevel: "debug" },
      // LogTape's internal meta logger must be explicitly configured or
      // it complains on configure(). Send it to the same sink at
      // warning to keep stderr quiet in tests.
      { category: "logtape", sinks: ["cli"], lowestLevel: "warning" },
    ],
  });
}

/**
 * Reset the module-level diagnostics state. After this returns,
 * `emitDiagnostic` reverts to the U4 direct-to-stderr path. Tests use
 * this in `afterEach` to keep test isolation; production code never
 * calls it.
 *
 * **Process-global ownership.** This module owns the process-global
 * LogTape configuration. `reset()` is the LogTape mainline reset and
 * will wipe every other LogTape consumer's loggers and sinks if any
 * exist in the same process. The v2 CLI runs in its own short-lived
 * process by contract, so this is acceptable; in-process integrations
 * (a future host that loads cli.ts as a library) must either accept
 * that ownership or wrap their own LogTape state outside this module.
 */
export function resetCliDiagnostics(): void {
  configured = null;
  reset();
}

/**
 * Snapshot of the current configuration; primarily for tests asserting
 * that `configureCliDiagnostics` installed the expected writer/redactor
 * pair.
 */
export function currentCliDiagnosticConfig(): {
  categoryRoot: string;
  hasRedactor: boolean;
} | null {
  if (!configured) return null;
  return {
    categoryRoot: configured.categoryRoot,
    hasRedactor: configured.redact !== null,
  };
}

/**
 * Run `fn` with the supplied diagnostic context active. Any
 * `emitDiagnostic` call inside `fn` (including transitively in async
 * callees) sees the context via `getCurrentCliDiagnosticContext`.
 *
 * Nested calls override the parent context for the duration of `fn`;
 * the parent is restored on return.
 */
export function withCliDiagnosticContext<T>(
  ctx: CliDiagnosticContext,
  fn: () => T,
): T {
  return contextStorage.run(ctx, fn);
}

/**
 * Read the currently active diagnostic context, or `null` if none is
 * installed. Helpers that need `runId` and `startedAtMs` should prefer
 * this over re-plumbing the U4 `CommandContext`.
 */
export function getCurrentCliDiagnosticContext(): CliDiagnosticContext | null {
  return contextStorage.getStore() ?? null;
}

/**
 * Emit one JSON Lines diagnostic record to stderr if the mode allows it.
 *
 * No-ops when `options.mode === "quiet"` or when the input level is below
 * the mode's threshold. Always writes a single line with a trailing `\n`.
 *
 * U7 routing rules:
 * - If `configureCliDiagnostics` has been called, the record is fed to
 *   LogTape via `logger.emit({...})`; the configured sink applies the
 *   optional redactor and writes the canonical JSON line to
 *   `diagnosticWriter`.
 * - Otherwise, the U4 direct-to-stderr path runs (preserves existing
 *   call sites' behaviour byte-for-byte).
 *
 * **Redaction is opt-in.** Callers that never call
 * `configureCliDiagnostics` get the U4 direct stream with NO redactor
 * — any credential-bearing attribute value goes through unscrubbed.
 * The v2 hot router relies on this signalling: orchestration code
 * that handles ledger excerpts must configure a redactor first, and
 * the entry-point that owns process-global ownership (the CLI's main
 * function in cli.ts) is the right place to install the default. Until
 * a default redactor is wired at that entry, every direct caller of
 * `emitDiagnostic` from outside `configureCliDiagnostics` must treat
 * the `stderr` writer as untrusted and avoid passing sensitive
 * attribute values.
 */
export function emitDiagnostic(
  stderr: CliWriter,
  options: CliDiagnosticOptions,
  input: EmitDiagnosticInput,
): void {
  const minLevel = MODE_MIN_LEVEL[options.mode];
  if (LEVEL_RANK[input.level] < minLevel) return;
  const record = buildRecord(options, input);

  if (configured) {
    routeRecordThroughLogTape(input.category, record);
    return;
  }

  stderr.write(`${JSON.stringify(record)}\n`);
}

/**
 * Build the canonical U4-shape record from emit inputs + options. The
 * reserved-key strip stays load-bearing for every key, not just `event`,
 * so a caller-supplied `attributes: { run_id: "fake" }` cannot shadow
 * the canonical run id and break stdout/stderr correlation.
 */
function buildRecord(
  options: CliDiagnosticOptions,
  input: EmitDiagnosticInput,
): CliDiagnosticRecord {
  // F011 fix: build the structured fields FIRST, then spread the
  // filtered attributes. `stripReservedDiagnosticKeys` removes the eight
  // reserved keys so a caller-supplied `attributes: { run_id: "fake" }`
  // cannot shadow the canonical run_id and break stdout/stderr
  // correlation. With this order, the strip helper is genuinely
  // load-bearing for every reserved key, not just `event`.
  const filteredAttributes = stripReservedDiagnosticKeys(input.attributes);
  return {
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
}

const LEVEL_TO_LOGTAPE: Record<CliDiagnosticLevel, LogLevel> = {
  debug: "debug",
  info: "info",
  warning: "warning",
  error: "error",
};

function routeRecordThroughLogTape(
  inputCategory: string,
  record: CliDiagnosticRecord,
): void {
  if (!configured) return;
  const tail = inputCategory
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const segments: readonly [string, ...string[]] = [
    configured.categoryRoot,
    ...tail,
  ];
  const logger = getLogger(segments);
  // Use the low-level emit so the timestamp and the entire CLI record
  // ride through as `properties`. The sink reconstitutes the canonical
  // JSON line from those properties; nothing in LogTape's formatter
  // path can alter the shape.
  logger.emit({
    timestamp: Date.parse(record.timestamp),
    level: LEVEL_TO_LOGTAPE[record.level],
    message: [record.message],
    rawMessage: record.message,
    properties: {
      __cli_record: record,
    },
  });
}

function buildLogTapeSink(): Sink {
  return (logRecord: LogRecord) => {
    if (!configured) return;
    const carried = logRecord.properties?.__cli_record;
    if (!isCliDiagnosticRecord(carried)) return;
    let finalRecord: CliDiagnosticRecord | null = carried;
    if (configured.redact) {
      try {
        finalRecord = configured.redact(cloneRecord(carried));
      } catch {
        // F019/F022 defence: a throwing redactor must not crash the
        // CLI and must not let LogTape's catch path emit the
        // unredacted record via the meta logger to any future
        // additional sink. Drop the record silently here; we do not
        // re-route to LogTape (re-entrancy risk) and we do not write
        // the (potentially sensitive) original record to stderr as a
        // fallback.
        return;
      }
    }
    if (finalRecord === null) return;
    // F004/F020 defence: re-validate the post-redact shape so a
    // misbehaving redactor that drops a required U4 field cannot
    // produce a malformed JSON line on the diagnostic stream.
    if (!isCliDiagnosticRecord(finalRecord)) return;
    configured.diagnosticWriter.write(`${JSON.stringify(finalRecord)}\n`);
  };
}

function isCliDiagnosticRecord(value: unknown): value is CliDiagnosticRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.timestamp === "string" &&
    typeof candidate.level === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.run_id === "string" &&
    typeof candidate.started_at_ms === "number" &&
    typeof candidate.duration_ms === "number"
  );
}

function cloneRecord(record: CliDiagnosticRecord): CliDiagnosticRecord {
  // F003 fix: deep-clone via structuredClone so a redactor that
  // mutates a nested attribute object cannot corrupt the carrier the
  // emitter built. structuredClone is built into Node and Bun and
  // handles plain objects, arrays, dates, and primitives — all the
  // shapes a diagnostic attribute can carry.
  return structuredClone(record);
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
