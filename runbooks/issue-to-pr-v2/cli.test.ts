import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BufferWriter } from "./lib/cli-envelope";
import { ROUTE_IDS } from "./lib/route";
import { run } from "./cli";

/**
 * Process-boundary tests for the v2 CLI front door (U4).
 *
 * Every test invokes `run({ stdoutWriter, stderrWriter, argv })` in-process
 * and asserts on the JSON envelope written to stdout (and, where relevant,
 * the JSON Lines records on stderr). No subprocess spawn needed — the
 * lib stack is pure enough to test directly.
 *
 * AC coverage (issue #52):
 *   AC1 — every machine-consumed command requires --json
 *   AC2 — state reports confirmation_state + drift + version_skew + route + refs + gates
 *   AC3 — next reports the minimal next route id without imperative verbs
 *   AC4 — diagnose reports inferred state + expected refs + artifact presence + drift + skew
 *   AC5 — contract emits runtime contract slices from lib/contract.ts
 *   AC6 — route ids deterministic and factual
 *   AC7 — happy / no-ledger / stale / version-skew / missing / no-imperative cases
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // best-effort
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "u4-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeLedger(content: string): string {
  const dir = makeTempDir();
  const path = join(dir, "ledger.md");
  writeFileSync(path, content);
  return path;
}

function nonExistentLedgerPath(): string {
  return join(makeTempDir(), "missing-ledger.md");
}

/**
 * Run the CLI with the given argv and return the parsed stdout envelope
 * plus the raw stderr text and exit code.
 */
function invoke(argv: readonly string[]): {
  stdout: string;
  stderr: string;
  envelope: Record<string, unknown>;
  exit_code: number;
} {
  const stdoutBuf = new BufferWriter();
  const stderrBuf = new BufferWriter();
  const result = run({
    stdoutWriter: stdoutBuf,
    stderrWriter: stderrBuf,
    argv,
  });
  const stdoutText = stdoutBuf.toString();
  let envelope: Record<string, unknown> = {};
  if (stdoutText.length > 0) {
    const firstLine = stdoutText.split("\n").find((line) => line.length > 0);
    if (firstLine) envelope = JSON.parse(firstLine) as Record<string, unknown>;
  }
  return {
    stdout: stdoutText,
    stderr: stderrBuf.toString(),
    envelope,
    exit_code: result.exit_code,
  };
}

function minimalConfirmedLedger(extra: { final_reviewed_at?: string; pr_url?: string; status?: string } = {}): string {
  const frontmatterLines = [
    "---",
    "issue_number: 1",
    `status: ${extra.status ?? "in-progress"}`,
    "ac_confirmation_status: confirmed",
    "batch_contract_confirmation_status: confirmed",
    "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
  ];
  if (extra.final_reviewed_at) {
    frontmatterLines.push(`final_reviewed_at: ${extra.final_reviewed_at}`);
  }
  if (extra.pr_url) frontmatterLines.push(`pr_url: ${extra.pr_url}`);
  frontmatterLines.push("---");
  return writeLedger(
    [
      ...frontmatterLines,
      "",
      "# Issue 1",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
      "## Batches",
      "",
      "```yaml",
      "batches: []",
      "```",
      "",
      "## Findings data",
      "",
      "```yaml",
      "findings: []",
      "```",
      "",
      "## Findings",
      "",
      "| id | batch_id | signature | persona | severity | status | summary | resolution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n"),
  );
}

// ---------------- AC1: --json is required ----------------

describe("AC1: --json is required on every machine-consumed command", () => {
  test("state without --json returns missing-json-flag error envelope", () => {
    const { envelope, exit_code } = invoke(["state", "/tmp/ledger.md"]);
    expect(envelope.status).toBe("error");
    expect((envelope.error as { code: string }).code).toBe("missing-json-flag");
    expect(exit_code).toBe(64);
  });

  test("next without --json returns missing-json-flag error envelope", () => {
    const { envelope, exit_code } = invoke(["next", "/tmp/ledger.md"]);
    expect((envelope.error as { code: string }).code).toBe("missing-json-flag");
    expect(exit_code).toBe(64);
  });

  test("contract without --json returns missing-json-flag error envelope", () => {
    const { envelope, exit_code } = invoke(["contract", "execution_modes"]);
    expect((envelope.error as { code: string }).code).toBe("missing-json-flag");
    expect(exit_code).toBe(64);
  });

  test("diagnose without --json returns missing-json-flag error envelope", () => {
    const { envelope, exit_code } = invoke(["diagnose", "/tmp/ledger.md"]);
    expect((envelope.error as { code: string }).code).toBe("missing-json-flag");
    expect(exit_code).toBe(64);
  });

  test("unknown command returns unknown-command error envelope", () => {
    const { envelope, exit_code } = invoke(["bogus", "--json"]);
    expect((envelope.error as { code: string }).code).toBe("unknown-command");
    expect(exit_code).toBe(64);
  });
});

// ---------------- AC7: no-ledger case ----------------

describe("AC7: no-ledger case", () => {
  test("state reports route_id: no-ledger when the ledger file is missing", () => {
    const { envelope, exit_code } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as { route_id: string; ledger_exists: boolean };
    expect(data.route_id).toBe("no-ledger");
    expect(data.ledger_exists).toBe(false);
    expect(exit_code).toBe(0);
  });

  test("next reports route_id: no-ledger when the ledger file is missing", () => {
    const { envelope } = invoke(["next", nonExistentLedgerPath(), "--json"]);
    expect(envelope.status).toBe("ok");
    expect((envelope.data as { route_id: string }).route_id).toBe("no-ledger");
  });
});

// ---------------- AC2: state reports the full state shape ----------------

describe("AC2: state reports the documented JSON shape", () => {
  test("envelope carries the stable success shape (status/run_id/started_at_ms/duration_ms/data)", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    expect(envelope.status).toBe("ok");
    expect(typeof envelope.run_id).toBe("string");
    expect(typeof envelope.started_at_ms).toBe("number");
    expect(typeof envelope.duration_ms).toBe("number");
    expect(envelope.data).toBeDefined();
  });

  test("data carries confirmation_state, digest_drift, version_skew, route_id, required_reference_ids, blocking_gates", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const data = envelope.data as Record<string, unknown>;
    expect(data.confirmation_state).toBeDefined();
    expect(data.digest_drift).toBeDefined();
    // F015 fix: assert the literal "matched" default rather than just
    // toBeDefined(). A regression dropping the `?? "matched"` fallback
    // (so version_skew becomes null in JSON) would fail this.
    expect(data.version_skew).toBe("matched");
    expect(typeof data.route_id).toBe("string");
    expect(Array.isArray(data.required_reference_ids)).toBe(true);
    expect(Array.isArray(data.blocking_gates)).toBe(true);
  });

  test("F002 fix: digest_drift carries the full three-axis shape", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const drift = (
      envelope.data as {
        digest_drift: {
          acceptance_criteria: boolean;
          batch_contract: boolean;
          digests: boolean;
          any: boolean;
        };
      }
    ).digest_drift;
    expect(typeof drift.acceptance_criteria).toBe("boolean");
    expect(typeof drift.batch_contract).toBe("boolean");
    expect(typeof drift.digests).toBe("boolean");
    expect(typeof drift.any).toBe("boolean");
  });

  test("F004 fix: envelope carries schema_version: '1'", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    expect(envelope.schema_version).toBe("1");
  });

  test("F001 fix: usage-error envelope error.exit_code matches process exit_code", () => {
    const { envelope, exit_code } = invoke(["state", "/tmp/ledger.md"]);
    expect((envelope.error as { exit_code: number }).exit_code).toBe(64);
    expect(exit_code).toBe(64);
  });

  test("F004 fix: error envelope also carries schema_version: '1'", () => {
    const { envelope } = invoke(["state", "/tmp/ledger.md"]); // missing --json
    expect(envelope.schema_version).toBe("1");
  });

  test("confirmation_state is a triple of (acceptance_criteria, batch_contract, digests)", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const state = (envelope.data as { confirmation_state: Record<string, string> }).confirmation_state;
    expect(state.acceptance_criteria).toBeDefined();
    expect(state.batch_contract).toBeDefined();
    expect(state.digests).toBeDefined();
  });
});

// ---------------- AC3: next reports the minimal route id with no imperative verbs ----------------

describe("AC3: next emits a minimal route id with no imperative instructions", () => {
  test("data contains only route_id and ledger_exists — no imperative fields", () => {
    const { envelope } = invoke(["next", nonExistentLedgerPath(), "--json"]);
    const data = envelope.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["ledger_exists", "route_id"]);
  });

  test("the entire stdout payload contains no imperative verbs (F013: word-boundary regex)", () => {
    const { stdout } = invoke(["next", nonExistentLedgerPath(), "--json"]);
    // ADR 0002: CLI emits facts, not orchestration. F013 fix — switch
    // from space-bracketed patterns to \b word boundaries so verbs inside
    // JSON string values like "route_id":"run-..." are also caught.
    const forbidden = [
      /\brun\b/i,
      /\bexecute\b/i,
      /\binvoke\b/i,
      /\bdispatch\b/i,
      /\bplease\b/i,
      /\bshould\b/i,
      /\bmust\b/i,
      /\bnext, /i,
    ];
    for (const pattern of forbidden) {
      expect(stdout).not.toMatch(pattern);
    }
  });
});

// ---------------- AC4: diagnose reports the documented shape ----------------

describe("AC4: diagnose reports the documented diagnostic shape", () => {
  test("data carries inferred_route_id, expected_reference_ids, installed_artifact_presence, drift, version_skew", () => {
    const { envelope } = invoke([
      "diagnose",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const data = envelope.data as Record<string, unknown>;
    expect(typeof data.inferred_route_id).toBe("string");
    expect(Array.isArray(data.expected_reference_ids)).toBe(true);
    expect(data.installed_artifact_presence).toBeDefined();
    expect(data.drift).toBeDefined();
    expect(data.version_skew).toBeDefined();
  });

  test("F037 hoist: drift carries the full DiagnoseDrift shape (digest_drift four-axis + findings_table_drift: null)", () => {
    const { envelope } = invoke([
      "diagnose",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const drift = (
      envelope.data as {
        drift: {
          digest_drift: {
            acceptance_criteria: boolean;
            batch_contract: boolean;
            digests: boolean;
            any: boolean;
          };
          findings_table_drift: null;
        };
      }
    ).drift;
    expect(typeof drift.digest_drift.acceptance_criteria).toBe("boolean");
    expect(typeof drift.digest_drift.batch_contract).toBe("boolean");
    expect(typeof drift.digest_drift.digests).toBe("boolean");
    expect(typeof drift.digest_drift.any).toBe("boolean");
    // Forward-compat pin: findings_table_drift is null in U4. A future
    // widening (U6/U9) will require updating this assertion.
    expect(drift.findings_table_drift).toBe(null);
  });

  test("installed_artifact_presence reports cli, lib, references, templates as the static U4 baseline true (F016 fix: literal value, not just typeof)", () => {
    const { envelope } = invoke([
      "diagnose",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const presence = (envelope.data as {
      installed_artifact_presence: Record<string, boolean>;
    }).installed_artifact_presence;
    expect(presence.cli).toBe(true);
    expect(presence.lib).toBe(true);
    expect(presence.references).toBe(true);
    expect(presence.templates).toBe(true);
  });

  test("diagnose envelope carries the documented version_skew default", () => {
    const { envelope } = invoke([
      "diagnose",
      nonExistentLedgerPath(),
      "--json",
    ]);
    expect((envelope.data as { version_skew: string }).version_skew).toBe(
      "matched",
    );
  });
});

// ---------------- AC5: contract emits runtime contract slices ----------------

describe("AC5: contract emits runtime contract slices from lib/contract.ts", () => {
  test("execution_modes slice returns the tdd | proof_first | change_first set", () => {
    const { envelope } = invoke(["contract", "execution_modes", "--json"]);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as { slice: string; values: string[] };
    expect(data.slice).toBe("execution_modes");
    expect(new Set(data.values)).toEqual(
      new Set(["tdd", "proof_first", "change_first"]),
    );
  });

  test("route_ids slice returns the complete route id catalog", () => {
    const { envelope } = invoke(["contract", "route_ids", "--json"]);
    const data = envelope.data as { slice: string; values: string[] };
    expect(data.slice).toBe("route_ids");
    expect(data.values).toEqual([...ROUTE_IDS]);
  });

  test("finding_severities slice returns P0/P1/P2/P3", () => {
    const { envelope } = invoke(["contract", "finding_severities", "--json"]);
    expect(new Set((envelope.data as { values: string[] }).values)).toEqual(
      new Set(["P0", "P1", "P2", "P3"]),
    );
  });

  test("unknown slice returns unknown-contract-slice error", () => {
    const { envelope, exit_code } = invoke([
      "contract",
      "bogus_slice",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "unknown-contract-slice",
    );
    expect(exit_code).toBe(64);
  });

  test("F003 fix: sorted slices report ordering: 'sorted'", () => {
    const { envelope } = invoke(["contract", "execution_modes", "--json"]);
    expect((envelope.data as { ordering: string }).ordering).toBe("sorted");
  });

  test("F003 fix: catalog-ordered slices report ordering: 'catalog'", () => {
    const { envelope } = invoke(["contract", "route_ids", "--json"]);
    expect((envelope.data as { ordering: string }).ordering).toBe("catalog");
  });

  test("F005 fix: agent_hint_actions slice returns the AgentHintAction enum in catalog order", () => {
    const { envelope } = invoke(["contract", "agent_hint_actions", "--json"]);
    const data = envelope.data as { values: string[]; ordering: string };
    expect(data.ordering).toBe("catalog");
    expect(data.values).toContain("retry");
    expect(data.values).toContain("contact_support");
  });

  test("F005 fix: runtime_error_severities slice returns the severity enum", () => {
    const { envelope } = invoke([
      "contract",
      "runtime_error_severities",
      "--json",
    ]);
    expect(
      new Set((envelope.data as { values: string[] }).values),
    ).toEqual(new Set(["info", "warning", "error", "fatal"]));
  });

  test("F005 fix: runtime_error_recoverabilities slice returns the recoverability enum", () => {
    const { envelope } = invoke([
      "contract",
      "runtime_error_recoverabilities",
      "--json",
    ]);
    expect(
      new Set((envelope.data as { values: string[] }).values),
    ).toEqual(
      new Set(["recoverable", "user-action-required", "unrecoverable"]),
    );
  });

  test("F005 fix: diagnostic_levels slice returns debug/info/warning/error", () => {
    const { envelope } = invoke(["contract", "diagnostic_levels", "--json"]);
    expect((envelope.data as { values: string[] }).values).toEqual([
      "debug",
      "info",
      "warning",
      "error",
    ]);
  });

  test("F024 fix: exit_codes slice returns {code, meaning} records (not bare numbers)", () => {
    const { envelope } = invoke(["contract", "exit_codes", "--json"]);
    const values = (
      envelope.data as { values: Array<{ code: number; meaning: string }> }
    ).values;
    expect(values.find((v) => v.code === 0)?.meaning).toBe("success");
    expect(values.find((v) => v.code === 64)?.meaning).toContain("usage error");
  });
});

// ---------------- AC6: route ids deterministic ----------------

describe("AC6: route ids deterministic and factual", () => {
  test("running state twice on the same ledger yields the same route_id", () => {
    const ledger = minimalConfirmedLedger();
    const a = invoke(["state", ledger, "--json"]);
    const b = invoke(["state", ledger, "--json"]);
    expect((a.envelope.data as { route_id: string }).route_id).toBe(
      (b.envelope.data as { route_id: string }).route_id,
    );
  });

  test("route_id is always a member of the documented ROUTE_IDS catalog", () => {
    const { envelope } = invoke([
      "state",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const routeId = (envelope.data as { route_id: string }).route_id;
    expect((ROUTE_IDS as readonly string[]).includes(routeId)).toBe(true);
  });
});

// ---------------- AC7: happy / stale / version-skew / missing-artifact / no-imperative cases ----------------

describe("AC7: stale and blocked ledger scenarios", () => {
  test("ledger with frontmatter status: blocked reports blocked-frontmatter-blocked-reason", () => {
    const ledger = minimalConfirmedLedger({ status: "blocked" });
    const { envelope } = invoke(["state", ledger, "--json"]);
    expect((envelope.data as { route_id: string }).route_id).toBe(
      "blocked-frontmatter-blocked-reason",
    );
  });

  test("F014 fix: ac_confirmation_status: stale produces blocked-acceptance-criteria-stale", () => {
    const ledger = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: stale",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        "```yaml",
        "batches: []",
        "```",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", ledger, "--json"]);
    expect((envelope.data as { route_id: string }).route_id).toBe(
      "blocked-acceptance-criteria-stale",
    );
  });

  test("F014 fix: batch_contract_confirmation_status: stale produces blocked-batch-contract-stale", () => {
    const ledger = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: stale",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", ledger, "--json"]);
    expect((envelope.data as { route_id: string }).route_id).toBe(
      "blocked-batch-contract-stale",
    );
  });

  test("F017 partial: ledger with confirmed-but-no-digest frontmatter falls back to pick-issue (real happy-path stages need digest writes, deferred to U6+)", () => {
    // Without a stored ac_digest in frontmatter, readAcceptanceCriteriaState
    // computes `pending` even when ac_confirmation_status: confirmed is
    // declared. This is correct per the v1 contract — confirmation is
    // anchored to the digest, not the status string. Real happy-path
    // routes (plan, decompose, batch-loop, ...) need digest write helpers
    // that U4 does not own. Documented in U4 ledger as residual coverage.
    const ledger = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: pending",
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", ledger, "--json"]);
    expect((envelope.data as { route_id: string }).route_id).toBe("pick-issue");
  });

  test("blocking_gates surface the frontmatter blocked status as typed records", () => {
    const ledger = minimalConfirmedLedger({ status: "blocked" });
    const { envelope } = invoke(["state", ledger, "--json"]);
    const gates = (
      envelope.data as {
        blocking_gates: Array<
          | { kind: "route_id"; value: string }
          | { kind: "field"; field: string; value: string }
        >;
      }
    ).blocking_gates;
    expect(gates).toContainEqual({
      kind: "route_id",
      value: "blocked-frontmatter-blocked-reason",
    });
    expect(gates).toContainEqual({
      kind: "field",
      field: "frontmatter.status",
      value: "blocked",
    });
  });
});

describe("AC7: malformed ledger surfaces structured error, not process.exit", () => {
  test("ledger with missing frontmatter returns ledger-validation-failed envelope", () => {
    const ledger = writeLedger("# No frontmatter\n\nbody\n");
    const { envelope, exit_code } = invoke(["state", ledger, "--json"]);
    expect(envelope.status).toBe("error");
    expect((envelope.error as { code: string }).code).toBe(
      "ledger-validation-failed",
    );
    expect((envelope.error as { hint: { action: string } }).hint.action).toBe(
      "repair_state",
    );
    expect(exit_code).toBe(1);
  });
});

describe("AC7: diagnostics on stderr stay separated from stdout payload", () => {
  test("default verbosity emits nothing on stderr for a happy command", () => {
    const { stderr } = invoke([
      "contract",
      "execution_modes",
      "--json",
    ]);
    expect(stderr).toBe("");
  });

  test("--verbose emits info-level dispatch record on stderr (one JSON line)", () => {
    const stdoutBuf = new BufferWriter();
    const stderrBuf = new BufferWriter();
    run({
      stdoutWriter: stdoutBuf,
      stderrWriter: stderrBuf,
      argv: ["contract", "execution_modes", "--json", "--verbose"],
    });
    const stderrText = stderrBuf.toString();
    const lines = stderrText.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    // Every stderr line is a valid JSON object.
    for (const line of lines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record.run_id).toBeDefined();
      expect(record.level).toBeDefined();
      expect(record.category).toBeDefined();
    }
  });

  test("--quiet suppresses stderr even on error-path commands (F018 fix: use a real error scenario)", () => {
    // Use a malformed ledger so the dispatcher emits a level: error
    // diagnostic on stderr in default mode. With --quiet, stderr stays
    // empty even though the command fails.
    const malformed = writeLedger("# No frontmatter\n\nbody\n");
    const stdoutBuf = new BufferWriter();
    const stderrBuf = new BufferWriter();
    run({
      stdoutWriter: stdoutBuf,
      stderrWriter: stderrBuf,
      argv: ["state", "--quiet", "--json", malformed],
    });
    expect(stderrBuf.toString()).toBe("");
    // The stdout envelope should still surface the error.
    const envelope = JSON.parse(
      stdoutBuf.toString().split("\n").find((l) => l.length > 0) ?? "{}",
    ) as { status: string };
    expect(envelope.status).toBe("error");
  });

  test("F018 positive control: SAME malformed ledger DOES emit a level:error stderr record without --quiet", () => {
    // Pairs with the F018 test above. If --quiet's suppression broke,
    // this default-mode test would still pass (proves the emission
    // exists in the first place). Together they prove suppression.
    const malformed = writeLedger("# No frontmatter\n\nbody\n");
    const stdoutBuf = new BufferWriter();
    const stderrBuf = new BufferWriter();
    run({
      stdoutWriter: stdoutBuf,
      stderrWriter: stderrBuf,
      argv: ["state", "--json", malformed],
    });
    const stderrLines = stderrBuf
      .toString()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { level: string; event?: string });
    expect(stderrLines.length).toBeGreaterThan(0);
    expect(stderrLines.some((r) => r.level === "error")).toBe(true);
  });
});

describe("AC7: stdout payload is exactly one JSON object terminated by newline", () => {
  test("stdout is one line, JSON-parseable, terminated by \\n", () => {
    const { stdout } = invoke([
      "contract",
      "execution_modes",
      "--json",
    ]);
    expect(stdout.endsWith("\n")).toBe(true);
    const nonEmptyLines = stdout.split("\n").filter((line) => line.length > 0);
    expect(nonEmptyLines).toHaveLength(1);
    expect(() => JSON.parse(nonEmptyLines[0] ?? "")).not.toThrow();
  });
});

// ---------------- Help flag (agent-only JSON shape) ----------------

describe("Help flag emits a machine-readable JSON envelope (agents, not humans)", () => {
  test("--help writes a CliSuccessEnvelope on stdout and exits 0", () => {
    const { envelope, exit_code } = invoke(["--help"]);
    expect(envelope.status).toBe("ok");
    expect(exit_code).toBe(0);
  });

  test("--help carries audience: agents and a command catalog", () => {
    const { envelope } = invoke(["--help"]);
    const data = envelope.data as {
      audience: string;
      commands: Array<{ name: string; argv: string[] }>;
      contract_slices: readonly string[];
    };
    expect(data.audience).toBe("agents");
    expect(data.commands.map((c) => c.name).sort()).toEqual([
      "contract",
      "diagnose",
      "next",
      "state",
    ]);
    expect(data.contract_slices.length).toBeGreaterThan(0);
  });

  test("F005 fix: --help exposes the full error and exit-code discovery surface", () => {
    const { envelope } = invoke(["--help"]);
    const data = envelope.data as Record<string, unknown>;
    expect(Array.isArray(data.error_codes)).toBe(true);
    expect(Array.isArray(data.exit_codes)).toBe(true);
    expect(Array.isArray(data.agent_hint_actions)).toBe(true);
    expect(Array.isArray(data.runtime_error_severities)).toBe(true);
    expect(Array.isArray(data.runtime_error_recoverabilities)).toBe(true);
    expect(Array.isArray(data.diagnostic_levels)).toBe(true);
  });

  test("F023 fix: every --help error_codes entry uses nested hint.action matching the runtime envelope shape", () => {
    const { envelope } = invoke(["--help"]);
    const errorCodes = (
      envelope.data as {
        error_codes: Array<{
          code: string;
          hint: { action: string };
          severity: string;
          retryable: boolean;
        }>;
      }
    ).error_codes;
    for (const entry of errorCodes) {
      expect(typeof entry.hint).toBe("object");
      expect(typeof entry.hint.action).toBe("string");
      // F026 fix: every entry must also carry severity and retryable.
      expect(typeof entry.severity).toBe("string");
      expect(typeof entry.retryable).toBe("boolean");
    }
  });

  test("F023 + F026 fix: HELP_DATA error_codes entry shape matches the runtime CliErrorEnvelope.error shape", () => {
    // Pick a known-failing path (missing-json-flag) and verify the
    // documented help-catalog entry actually matches what the runtime
    // envelope emits for the same code.
    const { envelope: helpEnvelope } = invoke(["--help"]);
    const helpEntry = (
      helpEnvelope.data as {
        error_codes: Array<{
          code: string;
          hint: { action: string };
          severity: string;
          recoverability: string;
          retryable: boolean;
          exit_code: number;
        }>;
      }
    ).error_codes.find((e) => e.code === "missing-json-flag");
    expect(helpEntry).toBeDefined();
    if (!helpEntry) return;
    const { envelope: errEnvelope } = invoke(["state", "/tmp/ledger.md"]);
    const err = errEnvelope.error as {
      code: string;
      hint: { action: string };
      severity: string;
      recoverability: string;
      retryable: boolean;
      exit_code: number;
    };
    expect(err.code).toBe(helpEntry.code);
    expect(err.hint.action).toBe(helpEntry.hint.action);
    expect(err.severity).toBe(helpEntry.severity);
    expect(err.recoverability).toBe(helpEntry.recoverability);
    expect(err.retryable).toBe(helpEntry.retryable);
    expect(err.exit_code).toBe(helpEntry.exit_code);
  });

  test("F025 fix: --help documents the contract slice response shape and ordering semantics", () => {
    const { envelope } = invoke(["--help"]);
    const shape = (envelope.data as {
      contract_slice_response_shape: {
        slice: string;
        values: string;
        ordering: Record<string, string>;
      };
    }).contract_slice_response_shape;
    expect(shape.slice).toContain("string");
    expect(shape.values).toBeTruthy();
    expect(shape.ordering.sorted).toContain("alphabetical");
    expect(shape.ordering.catalog).toContain("contractually");
  });

  test("--help emits no human-style prose on stderr", () => {
    const stdoutBuf = new BufferWriter();
    const stderrBuf = new BufferWriter();
    run({
      stdoutWriter: stdoutBuf,
      stderrWriter: stderrBuf,
      argv: ["--help"],
    });
    expect(stderrBuf.toString()).toBe("");
  });

  test("-h is an alias for --help", () => {
    const { envelope } = invoke(["-h"]);
    expect(envelope.status).toBe("ok");
    expect((envelope.data as { audience: string }).audience).toBe("agents");
  });

  test("empty argv returns missing-command error envelope on stdout, exit 64", () => {
    const { envelope, exit_code, stderr } = invoke([]);
    expect(envelope.status).toBe("error");
    expect((envelope.error as { code: string }).code).toBe("missing-command");
    expect(
      (envelope.error as { hint: { action: string } }).hint.action,
    ).toBe("change_input");
    expect(exit_code).toBe(64);
    // No human-style prose on stderr — the error envelope on stdout is
    // the single source of truth for agents.
    expect(stderr).toBe("");
  });
});
