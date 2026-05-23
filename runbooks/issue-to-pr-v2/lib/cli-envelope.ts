/**
 * CLI envelope contract for the Issue-to-PR v2 CLI front door (U4).
 *
 * The shapes here are lifted from the patterns established in
 * `@side-quest/cli-command-facade`
 * (see `/Users/nathanvale/code/side-quest-engineering/packages/cli-command-facade/src/command-facade.ts`)
 * but kept lightweight — this module has no external dependencies and
 * matches only the surface this seam needs.
 *
 * ADR 0002 (CLI emits facts, not orchestration): every command output
 * is either a `CliSuccessEnvelope<TData>` carrying durable state facts
 * or a `CliErrorEnvelope` carrying a structured error. There is no
 * imperative instruction surface. The optional `agent_hint` on errors
 * names *what* went wrong and *what category of recovery* applies, never
 * "run command X next".
 */

import { randomUUID } from "node:crypto";

/**
 * Allowed agent-hint action categories. Mirrors the sidequest taxonomy
 * (`retry`, `change_input`, `authenticate`, `repair_state`, `open_docs`,
 * `contact_support`) — keep the set in sync with that vocabulary so
 * future consumers can route on a shared enum.
 */
export const AGENT_HINT_ACTIONS = [
  "retry",
  "change_input",
  "authenticate",
  "repair_state",
  "open_docs",
  "contact_support",
] as const;

export type AgentHintAction = (typeof AGENT_HINT_ACTIONS)[number];

/**
 * Optional hint attached to a recoverable error. The summary is the
 * human/agent-readable description of what category of recovery applies;
 * the action is the machine-readable enum. `docs_url` is reserved for
 * U7+ when the hot router can point at versioned runbook prose.
 */
export type AgentHint = {
  summary: string;
  action?: AgentHintAction;
  docs_url?: string;
};

export const RUNTIME_ERROR_SEVERITIES = [
  "info",
  "warning",
  "error",
  "fatal",
] as const;
export type RuntimeErrorSeverity = (typeof RUNTIME_ERROR_SEVERITIES)[number];

export const RUNTIME_ERROR_RECOVERABILITIES = [
  "recoverable",
  "user-action-required",
  "unrecoverable",
] as const;
export type RuntimeErrorRecoverability =
  (typeof RUNTIME_ERROR_RECOVERABILITIES)[number];

/**
 * Structured error surfaced inside a `CliErrorEnvelope`. Every field is
 * machine-consumable so a future router can dispatch without parsing
 * the human message.
 */
export type StructuredRuntimeError = {
  run_id: string;
  code: string;
  message: string;
  exit_code: number;
  severity: RuntimeErrorSeverity;
  recoverability: RuntimeErrorRecoverability;
  retryable: boolean;
  hint?: AgentHint;
};

/**
 * Wire-format schema version (F004 fix). Bump on any breaking change to
 * either envelope shape so old consumers can detect drift. New optional
 * fields are additive and do not require a bump.
 */
export const CLI_ENVELOPE_SCHEMA_VERSION = "1" as const;
export type CliEnvelopeSchemaVersion = typeof CLI_ENVELOPE_SCHEMA_VERSION;

export type CliSuccessEnvelope<TData = unknown> = {
  status: "ok";
  schema_version: CliEnvelopeSchemaVersion;
  run_id: string;
  started_at_ms: number;
  duration_ms: number;
  data: TData;
};

export type CliErrorEnvelope = {
  status: "error";
  schema_version: CliEnvelopeSchemaVersion;
  run_id: string;
  started_at_ms: number;
  duration_ms: number;
  error: StructuredRuntimeError;
};

/**
 * Minimal writer Interface — `process.stdout` satisfies this. Tests pass
 * a `BufferWriter` so output can be asserted without spawn overhead.
 */
export type CliWriter = {
  write(chunk: string): unknown;
};

/**
 * In-memory writer for tests. Concatenates every `write()` call into a
 * single string buffer.
 */
export class BufferWriter implements CliWriter {
  private buffer = "";

  write(chunk: string): true {
    this.buffer += chunk;
    return true;
  }

  toString(): string {
    return this.buffer;
  }
}

/**
 * Emit a single JSON value as one stdout line (trailing newline included).
 *
 * Every CLI command writes exactly one JSON object via this writer.
 * Diagnostics (events, logs, debug records) go to stderr via
 * `lib/cli-diagnostics.ts`; this keeps stdout consumers free of any
 * mixed line stream.
 */
export function writeJson(stdout: CliWriter, value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Generate a new run id. UUIDv4 keeps the id 64 chars or less and matches
 * the sidequest run-id pattern (`/^[A-Za-z0-9._-]{1,64}$/`).
 */
export function newRunId(): string {
  return randomUUID();
}

/**
 * Wrap a successful command result in a `CliSuccessEnvelope`. `startedAtMs`
 * is captured at command-entry; `duration_ms` is derived from the current
 * monotonic-ish clock at envelope-creation time.
 */
export function createSuccessEnvelope<TData>(input: {
  runId: string;
  startedAtMs: number;
  data: TData;
}): CliSuccessEnvelope<TData> {
  return {
    status: "ok",
    schema_version: CLI_ENVELOPE_SCHEMA_VERSION,
    run_id: input.runId,
    started_at_ms: input.startedAtMs,
    duration_ms: Date.now() - input.startedAtMs,
    data: input.data,
  };
}

/**
 * Wrap a failed command into a `CliErrorEnvelope` with a structured
 * runtime error. Defaults exit_code to 1 (the v1 helper's exit code),
 * severity to "error", recoverability to "user-action-required", and
 * retryable to false — every caller may override.
 */
export function createErrorEnvelope(input: {
  runId: string;
  startedAtMs: number;
  code: string;
  message: string;
  exitCode?: number;
  severity?: RuntimeErrorSeverity;
  recoverability?: RuntimeErrorRecoverability;
  retryable?: boolean;
  hint?: AgentHint;
}): CliErrorEnvelope {
  return {
    status: "error",
    schema_version: CLI_ENVELOPE_SCHEMA_VERSION,
    run_id: input.runId,
    started_at_ms: input.startedAtMs,
    duration_ms: Date.now() - input.startedAtMs,
    error: {
      run_id: input.runId,
      code: input.code,
      message: input.message,
      exit_code: input.exitCode ?? 1,
      severity: input.severity ?? "error",
      recoverability: input.recoverability ?? "user-action-required",
      retryable: input.retryable ?? false,
      hint: input.hint,
    },
  };
}
