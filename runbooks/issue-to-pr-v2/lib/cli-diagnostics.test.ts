import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { BufferWriter, newRunId } from "./cli-envelope";
import {
  CLI_DIAGNOSTIC_LEVELS,
  CLI_DIAGNOSTIC_MODES,
  type CliDiagnosticRecord,
  configureCliDiagnostics,
  currentCliDiagnosticConfig,
  emitDiagnostic,
  getCurrentCliDiagnosticContext,
  parseDiagnosticArgv,
  resetCliDiagnostics,
  withCliDiagnosticContext,
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

  test("U7: configured LogTape backend routes records through the category tree to the configured writer", () => {
    const writer = new BufferWriter();
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
    });
    // stderr argument is unused once configureCliDiagnostics has been
    // called — the writer registered above is the sink. Pass a sentinel
    // stderr that would fail loudly if it ever got written to.
    const sentinelStderr = new BufferWriter();
    emitDiagnostic(
      sentinelStderr,
      { mode: "debug", runId: "run-123", startedAtMs: 1000 },
      {
        level: "info",
        category: "cli.state.read-frontmatter",
        message: "frontmatter read",
        event: "frontmatter.read",
        attributes: { ledger_path: "/tmp/x.md" },
      },
    );
    // No double-emission via the legacy stderr path.
    expect(sentinelStderr.toString()).toBe("");
    const lines = writer
      .toString()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] as string) as CliDiagnosticRecord;
    expect(parsed.run_id).toBe("run-123");
    expect(parsed.level).toBe("info");
    expect(parsed.category).toBe("cli.state.read-frontmatter");
    expect(parsed.event).toBe("frontmatter.read");
    expect(parsed.ledger_path).toBe("/tmp/x.md");
    expect(parsed.started_at_ms).toBe(1000);
    expect(typeof parsed.duration_ms).toBe("number");
    expect(typeof parsed.timestamp).toBe("string");
    const config = currentCliDiagnosticConfig();
    expect(config).not.toBeNull();
    expect(config?.categoryRoot).toBe("issue-to-pr-v2");
    expect(config?.hasRedactor).toBe(false);
  });

  test("U7: a parent-category subscription receives every descendant record (true LogTape inheritance)", async () => {
    // F012 fix: the previous version of this test installed exactly
    // one sink at the categoryRoot and would have passed even if
    // LogTape used flat routing. The new test wires TWO sinks via the
    // LogTape API directly: one at the root (sees everything) and one
    // at the intermediate `issue-to-pr-v2.cli` category (must see
    // `cli.*` records but NOT `lib.*` records). This pins genuine
    // parent-sees-descendant inheritance plus sibling isolation.
    const rootWriter = new BufferWriter();
    const cliBranchWriter = new BufferWriter();
    const { configureSync, reset: ltReset } = await import(
      "@logtape/logtape"
    );
    // Reset any leftover LogTape state from a prior test.
    ltReset();
    configureSync({
      reset: true,
      sinks: {
        root: (rec) => {
          rootWriter.write(`${JSON.stringify(rec.properties.__cli_record)}\n`);
        },
        cliBranch: (rec) => {
          cliBranchWriter.write(
            `${JSON.stringify(rec.properties.__cli_record)}\n`,
          );
        },
      },
      loggers: [
        { category: "issue-to-pr-v2", sinks: ["root"], lowestLevel: "debug" },
        {
          category: ["issue-to-pr-v2", "cli"],
          sinks: ["cliBranch"],
          lowestLevel: "debug",
        },
        { category: "logtape", sinks: ["root"], lowestLevel: "warning" },
      ],
    });
    // Because we configured LogTape directly above, we must NOT call
    // configureCliDiagnostics — that would reset our setup. We route
    // records through LogTape using getLogger directly so this test
    // exercises the inheritance contract independent of our singleton.
    const { getLogger } = await import("@logtape/logtape");
    function emitForCategory(
      categorySegments: readonly [string, ...string[]],
      record: Record<string, unknown>,
    ): void {
      getLogger(categorySegments).emit({
        timestamp: Date.now(),
        level: "info",
        message: ["test"],
        rawMessage: "test",
        properties: { __cli_record: record },
      });
    }
    emitForCategory(["issue-to-pr-v2", "cli", "next", "classify-route"], {
      category: "cli.next.classify-route",
    });
    emitForCategory(["issue-to-pr-v2", "lib", "route"], {
      category: "lib.route",
    });
    const rootCategories = rootWriter
      .toString()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as { category: string }).category);
    const branchCategories = cliBranchWriter
      .toString()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => (JSON.parse(l) as { category: string }).category);
    // Root sink subscribes at `issue-to-pr-v2` so it sees BOTH the
    // `cli.*` descendant and the sibling `lib.*` record.
    expect(rootCategories).toEqual([
      "cli.next.classify-route",
      "lib.route",
    ]);
    // Branch sink subscribes at `issue-to-pr-v2.cli` so it sees the
    // `cli.*` descendant but NOT the `lib.*` sibling.
    expect(branchCategories).toEqual(["cli.next.classify-route"]);
    ltReset();
  });

  test("U7: redactor sees the canonical record and can rewrite credential-like values inside attributes", () => {
    const writer = new BufferWriter();
    // The hostile ledger value: a Builder commit ref note that
    // contains a leaked GitHub token. The hot router surfaces ledger
    // excerpts on the diagnostic stream; the redactor must scrub
    // anything matching a credential pattern before the line hits
    // stderr.
    // F023 fix: use a NON-global regex with `.replace()` directly
    // instead of `.test()` in a loop. A `/g` regex carries stateful
    // `lastIndex` across `.test()` calls — the second matching value
    // in the same redact() invocation would silently miss its
    // credential. The non-global pattern is safe for copy-paste.
    const CREDENTIAL_PATTERN = /ghp_[A-Za-z0-9]{36}/;
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
      redact: (record) => {
        const next: CliDiagnosticRecord = { ...record };
        for (const [key, value] of Object.entries(record)) {
          if (typeof value === "string" && CREDENTIAL_PATTERN.test(value)) {
            next[key] = value.replace(CREDENTIAL_PATTERN, "[REDACTED]");
          }
        }
        return next;
      },
    });
    emitDiagnostic(
      new BufferWriter(),
      { mode: "debug", runId: "r-h", startedAtMs: 0 },
      {
        level: "info",
        category: "cli.diagnose.finding-summary",
        message: "finding summary captured",
        attributes: {
          builder_commit_ref:
            "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked in commit body",
          finding_signature: "stale-token-in-summary",
        },
      },
    );
    const line = writer
      .toString()
      .split("\n")
      .filter((l) => l.length > 0)[0] as string;
    const record = JSON.parse(line) as CliDiagnosticRecord;
    expect(record.builder_commit_ref).toBe(
      "[REDACTED] leaked in commit body",
    );
    // Non-sensitive attribute survived.
    expect(record.finding_signature).toBe("stale-token-in-summary");
    expect(currentCliDiagnosticConfig()?.hasRedactor).toBe(true);
  });

  test("U7: a redactor that returns null drops the record entirely", () => {
    const writer = new BufferWriter();
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
      redact: () => null,
    });
    emitDiagnostic(
      new BufferWriter(),
      { mode: "debug", runId: "r-drop", startedAtMs: 0 },
      { level: "warning", category: "cli.state", message: "would have logged" },
    );
    expect(writer.toString()).toBe("");
  });

  test("U7: AsyncLocalStorage context propagates the runId to deeply-called helpers", async () => {
    const ctx = { runId: "als-run", startedAtMs: 42, mode: "debug" as const };
    type ObservedCtx = ReturnType<typeof getCurrentCliDiagnosticContext>;
    const observed: ObservedCtx[] = [];

    async function inner(): Promise<void> {
      // Yield once so the async boundary really exercises the
      // AsyncLocalStorage propagation rather than synchronous capture.
      await Promise.resolve();
      observed.push(getCurrentCliDiagnosticContext());
    }

    expect(getCurrentCliDiagnosticContext()).toBeNull();
    await withCliDiagnosticContext(ctx, async () => {
      await inner();
    });
    expect(getCurrentCliDiagnosticContext()).toBeNull();
    expect(observed.length).toBe(1);
    expect(observed[0]).toEqual(ctx);
  });

  test("U7: nested withCliDiagnosticContext restores the outer context on return", () => {
    const outer = { runId: "outer", startedAtMs: 1, mode: "debug" as const };
    const inner = { runId: "inner", startedAtMs: 2, mode: "verbose" as const };
    withCliDiagnosticContext(outer, () => {
      expect(getCurrentCliDiagnosticContext()).toEqual(outer);
      withCliDiagnosticContext(inner, () => {
        expect(getCurrentCliDiagnosticContext()).toEqual(inner);
      });
      // The outer context must be restored — important for the hot
      // router's pattern of fanning out short-lived child contexts.
      expect(getCurrentCliDiagnosticContext()).toEqual(outer);
    });
  });

  test("U7: concurrent withCliDiagnosticContext calls do not bleed run ids across promises", async () => {
    const observed: Record<string, string | null> = {};
    async function capture(name: string, ms: number): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, ms));
      observed[name] = getCurrentCliDiagnosticContext()?.runId ?? null;
    }
    await Promise.all([
      withCliDiagnosticContext(
        { runId: "alpha", startedAtMs: 0, mode: "default" },
        () => capture("alpha", 5),
      ),
      withCliDiagnosticContext(
        { runId: "beta", startedAtMs: 0, mode: "default" },
        () => capture("beta", 1),
      ),
      withCliDiagnosticContext(
        { runId: "gamma", startedAtMs: 0, mode: "default" },
        () => capture("gamma", 3),
      ),
    ]);
    expect(observed).toEqual({
      alpha: "alpha",
      beta: "beta",
      gamma: "gamma",
    });
  });

  test("U7: resetCliDiagnostics reverts emitDiagnostic to the U4 direct-to-stderr path", () => {
    const writer = new BufferWriter();
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
    });
    expect(currentCliDiagnosticConfig()).not.toBeNull();
    resetCliDiagnostics();
    expect(currentCliDiagnosticConfig()).toBeNull();
    const stderr = new BufferWriter();
    emitDiagnostic(
      stderr,
      { mode: "debug", runId: "back-to-u4", startedAtMs: 0 },
      { level: "info", category: "cli.state", message: "post-reset" },
    );
    // After reset, the configured writer must not receive anything new;
    // emission falls back to the supplied stderr stream.
    expect(writer.toString()).toContain(""); // existing buffer is preserved but no new line
    expect(
      writer
        .toString()
        .split("\n")
        .filter((l) => l.length > 0).length,
    ).toBe(0);
    const lines = stderr
      .toString()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
  });

  test("U7: a redactor that mutates a nested attribute does NOT mutate the carrier (structuredClone isolation)", () => {
    // F013 fix: pins the F003 deep-clone contract. A redactor that
    // walks a nested attribute object and rewrites a credential-like
    // value in place must not affect any other observer that might
    // hold the same carrier object.
    const writer = new BufferWriter();
    const sharedNestedAttribute = {
      body: "leaked: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      signature: "stale-token",
    };
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
      redact: (record) => {
        const builderAttempt = record.builder_attempt as {
          body: string;
          signature: string;
        };
        builderAttempt.body = builderAttempt.body.replace(
          /ghp_[A-Za-z0-9]{36}/,
          "[REDACTED]",
        );
        return record;
      },
    });
    emitDiagnostic(
      new BufferWriter(),
      { mode: "debug", runId: "r-deep", startedAtMs: 0 },
      {
        level: "info",
        category: "cli.builder.attempt",
        message: "builder attempt logged",
        attributes: { builder_attempt: sharedNestedAttribute },
      },
    );
    // The original shared attribute object must be unmodified.
    expect(sharedNestedAttribute.body).toBe(
      "leaked: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    // The emitted record IS scrubbed.
    const emittedLine = writer
      .toString()
      .split("\n")
      .filter((l) => l.length > 0)[0] as string;
    const emitted = JSON.parse(emittedLine) as CliDiagnosticRecord;
    const emittedAttempt = emitted.builder_attempt as {
      body: string;
      signature: string;
    };
    expect(emittedAttempt.body).toBe("leaked: [REDACTED]");
    expect(emittedAttempt.signature).toBe("stale-token");
  });

  test("U7: a redactor that throws drops the record and does NOT crash the CLI (F019/F022 defence)", () => {
    const writer = new BufferWriter();
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
      redact: () => {
        throw new Error("boom — redactor failure path");
      },
    });
    expect(() =>
      emitDiagnostic(
        new BufferWriter(),
        { mode: "debug", runId: "r-throw", startedAtMs: 0 },
        {
          level: "warning",
          category: "cli.state",
          message: "should be dropped",
          attributes: { credential: "secret-content" },
        },
      ),
    ).not.toThrow();
    expect(writer.toString()).toBe("");
  });

  test("U7: a redactor that strips a required U4 field drops the record (F004/F020 shape re-validation)", () => {
    const writer = new BufferWriter();
    configureCliDiagnostics({
      categoryRoot: "issue-to-pr-v2",
      diagnosticWriter: writer,
      redact: (record) => {
        const broken: Record<string, unknown> = { ...record };
        delete broken.run_id;
        return broken as unknown as CliDiagnosticRecord;
      },
    });
    emitDiagnostic(
      new BufferWriter(),
      { mode: "debug", runId: "r-malformed", startedAtMs: 0 },
      { level: "info", category: "cli.state", message: "malformed-redact" },
    );
    expect(writer.toString()).toBe("");
  });

  test("U7: the U4 record shape is preserved byte-for-byte across both emit paths (F014)", () => {
    // F014 fix: emit the same input through the legacy direct-to-stderr
    // path AND the configured LogTape path; assert the resulting
    // canonical CLI records carry identical keys plus identical values
    // on every reserved U4 field.
    const fixedNow = 1779_000_000_000;
    const dateNowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    const isoSpy = spyOn(Date.prototype, "toISOString").mockReturnValue(
      "2026-05-23T00:00:00.000Z",
    );
    try {
      const directStderr = new BufferWriter();
      emitDiagnostic(
        directStderr,
        { mode: "debug", runId: "shape-parity", startedAtMs: fixedNow - 50 },
        {
          level: "info",
          category: "cli.state.read-frontmatter",
          message: "frontmatter read",
          event: "frontmatter.read",
          attributes: { ledger_path: "/tmp/parity.md" },
        },
      );
      const directLine = directStderr
        .toString()
        .split("\n")
        .filter((l) => l.length > 0)[0] as string;
      const directRecord = JSON.parse(directLine) as CliDiagnosticRecord;

      const tapeWriter = new BufferWriter();
      configureCliDiagnostics({
        categoryRoot: "issue-to-pr-v2",
        diagnosticWriter: tapeWriter,
      });
      emitDiagnostic(
        new BufferWriter(),
        { mode: "debug", runId: "shape-parity", startedAtMs: fixedNow - 50 },
        {
          level: "info",
          category: "cli.state.read-frontmatter",
          message: "frontmatter read",
          event: "frontmatter.read",
          attributes: { ledger_path: "/tmp/parity.md" },
        },
      );
      const tapeLine = tapeWriter
        .toString()
        .split("\n")
        .filter((l) => l.length > 0)[0] as string;
      const tapeRecord = JSON.parse(tapeLine) as CliDiagnosticRecord;

      expect(Object.keys(tapeRecord).sort()).toEqual(
        Object.keys(directRecord).sort(),
      );
      for (const key of [
        "timestamp",
        "level",
        "category",
        "message",
        "event",
        "run_id",
        "started_at_ms",
        "duration_ms",
      ] as const) {
        expect(tapeRecord[key]).toEqual(directRecord[key]);
      }
      expect(tapeRecord.ledger_path).toBe(directRecord.ledger_path);
    } finally {
      dateNowSpy.mockRestore();
      isoSpy.mockRestore();
    }
  });

  afterEach(() => {
    // Every U7 test that calls configureCliDiagnostics must reset, or
    // later tests in this file (and the rest of the suite that imports
    // this module) will see a stale singleton.
    resetCliDiagnostics();
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
