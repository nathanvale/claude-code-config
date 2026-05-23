import { describe, expect, test } from "bun:test";

import {
  AGENT_HINT_ACTIONS,
  BufferWriter,
  type CliErrorEnvelope,
  type CliSuccessEnvelope,
  createErrorEnvelope,
  createSuccessEnvelope,
  newRunId,
  RUNTIME_ERROR_RECOVERABILITIES,
  RUNTIME_ERROR_SEVERITIES,
  writeJson,
} from "./cli-envelope";

describe("AGENT_HINT_ACTIONS catalog", () => {
  test("matches the sidequest taxonomy verbatim", () => {
    expect(AGENT_HINT_ACTIONS).toEqual([
      "retry",
      "change_input",
      "authenticate",
      "repair_state",
      "open_docs",
      "contact_support",
    ]);
  });
});

describe("RUNTIME_ERROR_SEVERITIES catalog", () => {
  test("enumerates info | warning | error | fatal in escalation order", () => {
    expect(RUNTIME_ERROR_SEVERITIES).toEqual([
      "info",
      "warning",
      "error",
      "fatal",
    ]);
  });
});

describe("RUNTIME_ERROR_RECOVERABILITIES catalog", () => {
  test("enumerates recoverable | user-action-required | unrecoverable", () => {
    expect(RUNTIME_ERROR_RECOVERABILITIES).toEqual([
      "recoverable",
      "user-action-required",
      "unrecoverable",
    ]);
  });
});

describe("newRunId", () => {
  test("returns a UUIDv4-shaped string", () => {
    const id = newRunId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("matches the sidequest run-id pattern /^[A-Za-z0-9._-]{1,64}$/", () => {
    expect(newRunId()).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });

  test("returns distinct ids on each call", () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});

describe("createSuccessEnvelope", () => {
  test("returns the documented stable envelope shape", () => {
    const runId = "test-run-1";
    const startedAtMs = Date.now();
    const envelope = createSuccessEnvelope({
      runId,
      startedAtMs,
      data: { foo: "bar" },
    });
    expect(envelope.status).toBe("ok");
    expect(envelope.run_id).toBe(runId);
    expect(envelope.started_at_ms).toBe(startedAtMs);
    expect(envelope.duration_ms).toBeGreaterThanOrEqual(0);
    expect(envelope.data).toEqual({ foo: "bar" });
  });

  test("preserves the TData generic in `data`", () => {
    type State = { acceptance_criteria: "confirmed" };
    const envelope: CliSuccessEnvelope<State> = createSuccessEnvelope<State>({
      runId: "r",
      startedAtMs: Date.now(),
      data: { acceptance_criteria: "confirmed" },
    });
    expect(envelope.data.acceptance_criteria).toBe("confirmed");
  });
});

describe("createErrorEnvelope", () => {
  test("returns the documented stable error shape with defaults", () => {
    const runId = "test-run-2";
    const startedAtMs = Date.now();
    const envelope: CliErrorEnvelope = createErrorEnvelope({
      runId,
      startedAtMs,
      code: "no-ledger",
      message: "ledger file not found",
    });
    expect(envelope.status).toBe("error");
    expect(envelope.run_id).toBe(runId);
    expect(envelope.error.run_id).toBe(runId);
    expect(envelope.error.code).toBe("no-ledger");
    expect(envelope.error.message).toBe("ledger file not found");
    expect(envelope.error.exit_code).toBe(1);
    expect(envelope.error.severity).toBe("error");
    expect(envelope.error.recoverability).toBe("user-action-required");
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.hint).toBeUndefined();
  });

  test("threads an agent hint when provided", () => {
    const envelope = createErrorEnvelope({
      runId: "r",
      startedAtMs: Date.now(),
      code: "version-skew",
      message: "ledger runbook_version mismatch",
      severity: "warning",
      recoverability: "user-action-required",
      retryable: false,
      hint: {
        summary: "Ledger was created under an older runbook version.",
        action: "repair_state",
      },
    });
    expect(envelope.error.severity).toBe("warning");
    expect(envelope.error.hint).toEqual({
      summary: "Ledger was created under an older runbook version.",
      action: "repair_state",
    });
  });
});

describe("writeJson + BufferWriter", () => {
  test("emits exactly one trailing-newline-terminated JSON line", () => {
    const buf = new BufferWriter();
    writeJson(buf, { hello: "world" });
    expect(buf.toString()).toBe('{"hello":"world"}\n');
  });

  test("two writes produce two newline-separated JSON objects on stdout", () => {
    const buf = new BufferWriter();
    writeJson(buf, { a: 1 });
    writeJson(buf, { b: 2 });
    expect(buf.toString()).toBe('{"a":1}\n{"b":2}\n');
  });
});
