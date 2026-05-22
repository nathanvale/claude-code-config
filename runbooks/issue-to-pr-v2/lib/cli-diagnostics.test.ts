import { describe, expect, test } from "bun:test";

import { BufferWriter, newRunId } from "./cli-envelope";
import {
  CLI_DIAGNOSTIC_LEVELS,
  CLI_DIAGNOSTIC_MODES,
  type CliDiagnosticRecord,
  emitDiagnostic,
  parseDiagnosticArgv,
} from "./cli-diagnostics";

describe("CLI_DIAGNOSTIC_MODES", () => {
  test("enumerates quiet | default | verbose | debug", () => {
    expect(CLI_DIAGNOSTIC_MODES).toEqual([
      "quiet",
      "default",
      "verbose",
      "debug",
    ]);
  });
});

describe("CLI_DIAGNOSTIC_LEVELS", () => {
  test("enumerates debug | info | warning | error", () => {
    expect(CLI_DIAGNOSTIC_LEVELS).toEqual([
      "debug",
      "info",
      "warning",
      "error",
    ]);
  });
});

describe("parseDiagnosticArgv", () => {
  test("defaults to mode: default when no verbosity flag is present", () => {
    const parsed = parseDiagnosticArgv(["state", "ledger.md"]);
    expect(parsed.mode).toBe("default");
    expect(parsed.argv).toEqual(["state", "ledger.md"]);
  });

  test("strips --quiet and selects mode: quiet", () => {
    const parsed = parseDiagnosticArgv(["--quiet", "state", "ledger.md"]);
    expect(parsed.mode).toBe("quiet");
    expect(parsed.argv).toEqual(["state", "ledger.md"]);
  });

  test("strips --verbose and selects mode: verbose", () => {
    const parsed = parseDiagnosticArgv(["state", "--verbose", "ledger.md"]);
    expect(parsed.mode).toBe("verbose");
    expect(parsed.argv).toEqual(["state", "ledger.md"]);
  });

  test("strips --debug and selects mode: debug", () => {
    const parsed = parseDiagnosticArgv(["state", "ledger.md", "--debug"]);
    expect(parsed.mode).toBe("debug");
    expect(parsed.argv).toEqual(["state", "ledger.md"]);
  });

  test("debug beats verbose beats quiet when multiple flags appear", () => {
    expect(parseDiagnosticArgv(["--quiet", "--verbose"]).mode).toBe("verbose");
    expect(parseDiagnosticArgv(["--quiet", "--debug"]).mode).toBe("debug");
    expect(parseDiagnosticArgv(["--verbose", "--debug"]).mode).toBe("debug");
    expect(
      parseDiagnosticArgv(["--quiet", "--verbose", "--debug"]).mode,
    ).toBe("debug");
  });

  test("passes through unknown flags for command-specific parsing", () => {
    const parsed = parseDiagnosticArgv([
      "state",
      "--json",
      "ledger.md",
      "--bogus",
    ]);
    expect(parsed.argv).toEqual(["state", "--json", "ledger.md", "--bogus"]);
    expect(parsed.mode).toBe("default");
  });
});

describe("emitDiagnostic", () => {
  const runId = "test-run";
  const startedAtMs = Date.now();
  function readLines(buf: BufferWriter): CliDiagnosticRecord[] {
    return buf
      .toString()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CliDiagnosticRecord);
  }

  test("emits nothing in quiet mode at any level", () => {
    const stderr = new BufferWriter();
    for (const level of CLI_DIAGNOSTIC_LEVELS) {
      emitDiagnostic(
        stderr,
        { mode: "quiet", runId, startedAtMs },
        { level, category: "test", message: `level=${level}` },
      );
    }
    expect(stderr.toString()).toBe("");
  });

  test("default mode emits warning and error but skips debug and info", () => {
    const stderr = new BufferWriter();
    for (const level of CLI_DIAGNOSTIC_LEVELS) {
      emitDiagnostic(
        stderr,
        { mode: "default", runId, startedAtMs },
        { level, category: "test", message: `level=${level}` },
      );
    }
    const records = readLines(stderr);
    expect(records.map((r) => r.level)).toEqual(["warning", "error"]);
  });

  test("verbose mode emits info, warning, error but skips debug", () => {
    const stderr = new BufferWriter();
    for (const level of CLI_DIAGNOSTIC_LEVELS) {
      emitDiagnostic(
        stderr,
        { mode: "verbose", runId, startedAtMs },
        { level, category: "test", message: `level=${level}` },
      );
    }
    const records = readLines(stderr);
    expect(records.map((r) => r.level)).toEqual(["info", "warning", "error"]);
  });

  test("debug mode emits every level", () => {
    const stderr = new BufferWriter();
    for (const level of CLI_DIAGNOSTIC_LEVELS) {
      emitDiagnostic(
        stderr,
        { mode: "debug", runId, startedAtMs },
        { level, category: "test", message: `level=${level}` },
      );
    }
    const records = readLines(stderr);
    expect(records.map((r) => r.level)).toEqual([
      "debug",
      "info",
      "warning",
      "error",
    ]);
  });

  test("emitted record carries the documented shape", () => {
    const stderr = new BufferWriter();
    const localRunId = newRunId();
    const localStartedAt = Date.now();
    emitDiagnostic(
      stderr,
      { mode: "debug", runId: localRunId, startedAtMs: localStartedAt },
      {
        level: "info",
        category: "cli.state.read-frontmatter",
        message: "frontmatter read",
        event: "frontmatter.read",
        attributes: { ledger_path: "/tmp/x.md" },
      },
    );
    const [record] = readLines(stderr);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.run_id).toBe(localRunId);
    expect(record.level).toBe("info");
    expect(record.category).toBe("cli.state.read-frontmatter");
    expect(record.message).toBe("frontmatter read");
    expect(record.event).toBe("frontmatter.read");
    expect(record.ledger_path).toBe("/tmp/x.md");
    expect(record.started_at_ms).toBe(localStartedAt);
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof record.timestamp).toBe("string");
  });

  test("omits the event field when not provided", () => {
    const stderr = new BufferWriter();
    emitDiagnostic(
      stderr,
      { mode: "debug", runId, startedAtMs },
      { level: "info", category: "test", message: "no event" },
    );
    const [record] = readLines(stderr);
    expect(record).toBeDefined();
    if (!record) return;
    expect("event" in record).toBe(false);
  });

  test("F011: caller-supplied attributes cannot shadow structured fields (genuine load-bearing strip)", () => {
    const stderr = new BufferWriter();
    emitDiagnostic(
      stderr,
      { mode: "debug", runId: "canonical-run-id", startedAtMs: 1000 },
      {
        level: "info",
        category: "real.category",
        message: "real message",
        attributes: {
          // Adversarial input: every reserved key tries to shadow the
          // structured value.
          run_id: "ATTACKER",
          level: "debug" as const,
          category: "fake.category",
          message: "fake message",
          started_at_ms: 99999,
          duration_ms: -1,
          timestamp: "1970-01-01T00:00:00.000Z",
          event: "fake.event",
          // A non-reserved attribute should still come through.
          custom_field: "preserved",
        },
      },
    );
    const [record] = readLines(stderr);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.run_id).toBe("canonical-run-id");
    expect(record.level).toBe("info");
    expect(record.category).toBe("real.category");
    expect(record.message).toBe("real message");
    expect(record.started_at_ms).toBe(1000);
    // duration_ms shadowing must fail too — without the strip helper,
    // the spread order would let the attacker overwrite it.
    expect(record.duration_ms).not.toBe(-1);
    expect(typeof record.duration_ms).toBe("number");
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
    expect(record.timestamp).not.toBe("1970-01-01T00:00:00.000Z");
    expect("event" in record).toBe(false); // event wasn't supplied
    // Non-reserved attribute survives.
    expect(record.custom_field).toBe("preserved");
  });
});
