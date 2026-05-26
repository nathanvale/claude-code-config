import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BufferWriter } from "./lib/cli-envelope";
import {
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_ATTEMPT_TYPE_VALUES,
  CANDIDATE_BATCH_FIELDS,
  FINDING_FIELDS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  LEDGER_SCHEMA_POINTER_SLICES,
  ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
  RUNBOOK_VERSION,
} from "./lib/contract";
import {
  requiredReferenceIdsFor,
  ROUTE_IDS,
  type RouteId,
} from "./lib/route";
import {
  SCAFFOLD_IDS,
  renderScaffold,
} from "./lib/scaffolds";
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

type RouteRequiredReferenceRecord = {
  route_id: RouteId;
  required_reference_ids: string[];
};

function contractRouteRequiredReferences(): RouteRequiredReferenceRecord[] {
  const { envelope } = invoke([
    "contract",
    "route_required_references",
    "--json",
  ]);
  const data = envelope.data as {
    values: RouteRequiredReferenceRecord[];
  };
  return data.values;
}

function requiredReferencesFromContractFor(routeId: string): string[] {
  const record = contractRouteRequiredReferences().find(
    (entry) => entry.route_id === routeId,
  );
  if (!record) {
    throw new Error(`missing route_required_references entry for ${routeId}`);
  }
  return record.required_reference_ids;
}

function minimalConfirmedLedger(extra: { final_reviewed_at?: string; pr_url?: string; status?: string } = {}): string {
  const frontmatterLines = [
    "---",
    "issue_number: 1",
    `status: ${extra.status ?? "in-progress"}`,
    "ac_confirmation_status: confirmed",
    "batch_contract_confirmation_status: confirmed",
    "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
    'runbook_version: "3"',
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

  test("installed_artifact_presence carries the U6 shape (cli_ts/lib_dir/references/templates + all_present + missing)", () => {
    const { envelope } = invoke([
      "diagnose",
      nonExistentLedgerPath(),
      "--json",
    ]);
    const presence = (envelope.data as {
      installed_artifact_presence: {
        references: boolean;
        templates: boolean;
        cli_ts: boolean;
        lib_dir: boolean;
        all_present: boolean;
        missing: string[];
      };
    }).installed_artifact_presence;
    expect(presence.references).toBe(true);
    expect(presence.templates).toBe(true);
    expect(presence.cli_ts).toBe(true);
    expect(presence.lib_dir).toBe(true);
    expect(presence.all_present).toBe(true);
    expect(presence.missing).toEqual([]);
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

describe("AC5: contract emits runtime contract slices", () => {
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

  test("route_required_references slice returns the catalog-ordered route/reference mapping", () => {
    const { envelope } = invoke([
      "contract",
      "route_required_references",
      "--json",
    ]);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      slice: string;
      values: RouteRequiredReferenceRecord[];
      ordering: string;
    };
    expect(data.slice).toBe("route_required_references");
    expect(data.ordering).toBe("catalog");
    expect(data.values.map((entry) => entry.route_id)).toEqual([...ROUTE_IDS]);
    for (const entry of data.values) {
      expect(entry.required_reference_ids).toEqual(
        [...requiredReferenceIdsFor(entry.route_id)],
      );
      expect(entry.required_reference_ids).not.toContain(
        "first-run-gotchas.md",
      );
    }
    expect(
      data.values.find((entry) => entry.route_id === "shipped")
        ?.required_reference_ids,
    ).toEqual([]);
  });

  test("finding_severities slice returns P0/P1/P2/P3", () => {
    const { envelope } = invoke(["contract", "finding_severities", "--json"]);
    expect(new Set((envelope.data as { values: string[] }).values)).toEqual(
      new Set(["P0", "P1", "P2", "P3"]),
    );
  });

  test("ledger schema field-set slices return the ordered runtime facts", () => {
    const cases = [
      ["candidate_batch_fields", CANDIDATE_BATCH_FIELDS],
      ["ledger_batch_lifecycle_fields", LEDGER_BATCH_LIFECYCLE_FIELDS],
      ["builder_attempt_fields", BUILDER_ATTEMPT_FIELDS],
      [
        "orchestrator_inline_attempt_fields",
        ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
      ],
      ["finding_fields", FINDING_FIELDS],
      ["builder_attempt_types", BUILDER_ATTEMPT_TYPE_VALUES],
      ["ledger_schema_pointer_slices", LEDGER_SCHEMA_POINTER_SLICES],
    ] as const;

    for (const [slice, expected] of cases) {
      const { envelope } = invoke(["contract", slice, "--json"]);
      expect(envelope.status).toBe("ok");
      const data = envelope.data as {
        slice: string;
        values: readonly string[];
        ordering: string;
      };
      expect(data.slice).toBe(slice);
      expect(data.ordering).toBe("catalog");
      expect(data.values).toEqual([...expected]);
    }
  });

  test("scaffold_ids slice returns the catalog-ordered scaffold ids", () => {
    const { envelope } = invoke(["contract", "scaffold_ids", "--json"]);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      slice: string;
      values: readonly string[];
      ordering: string;
    };
    expect(data.slice).toBe("scaffold_ids");
    expect(data.ordering).toBe("catalog");
    expect(data.values).toEqual([...SCAFFOLD_IDS]);
    expect(data.values).toEqual([
      "ce-plan-candidate-batch",
      "replacement-candidate-batch",
      "patch-proposal-candidate-batch",
      "builder-return-envelope",
      "builder-attempt-compact",
      "validator-builder-evidence",
      "validator-inline-evidence",
      "proposer-success-envelope",
      "proposer-fail-stop-envelope",
      "validator-return-envelope",
      "ledger-empty-batches",
      "ledger-empty-findings-data",
      "ledger-batch-lifecycle-defaults",
      "ledger-finding-row",
      "notes-implementation-attempt-checkpoint",
      "notes-validator-wave-completed",
      "notes-runbook-version-skew-continuation",
      "workflow-learnings-empty",
    ]);
  });

  test("scaffold_catalog slice returns structured records in catalog order", () => {
    const { envelope } = invoke(["contract", "scaffold_catalog", "--json"]);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      slice: string;
      values: readonly {
        scaffold_id: string;
        output_kind: string;
        source: string;
        ordering: string;
        marker?: string;
      }[];
      ordering: string;
    };
    expect(data.slice).toBe("scaffold_catalog");
    expect(data.ordering).toBe("catalog");
    expect(data.values.map((entry) => entry.scaffold_id)).toEqual([
      ...SCAFFOLD_IDS,
    ]);
    for (const entry of data.values) {
      expect(entry.output_kind).toBe("yaml");
      expect(entry.ordering).toBe("catalog");
      expect(entry.source).toBe(
        `runbooks/issue-to-pr-v2/lib/scaffolds.ts#${entry.scaffold_id}`,
      );
    }
    const markered = data.values.find(
      (entry) => entry.scaffold_id === "notes-implementation-attempt-checkpoint",
    );
    expect(markered?.marker).toBeDefined();
    expect(typeof markered?.marker).toBe("string");
    const unmarkered = data.values.find(
      (entry) => entry.scaffold_id === "ledger-empty-batches",
    );
    expect(unmarkered).toBeDefined();
    expect(unmarkered).not.toHaveProperty("marker");
  });

  test("scaffold_catalog entry agrees with scaffold <id> --json for that id", () => {
    const { envelope: catalogEnvelope } = invoke([
      "contract",
      "scaffold_catalog",
      "--json",
    ]);
    const catalogData = catalogEnvelope.data as {
      values: readonly {
        scaffold_id: string;
        output_kind: string;
        source: string;
        ordering: string;
        marker?: string;
      }[];
    };

    for (const id of SCAFFOLD_IDS) {
      const catalogEntry = catalogData.values.find(
        (entry) => entry.scaffold_id === id,
      );
      expect(catalogEntry).toBeDefined();

      const { envelope: scaffoldEnvelope } = invoke(["scaffold", id, "--json"]);
      const scaffoldData = scaffoldEnvelope.data as {
        scaffold_id: string;
        output_kind: string;
        source: string;
        ordering: string;
        marker?: string;
        body: string;
      };
      expect(scaffoldData.scaffold_id).toBe(catalogEntry?.scaffold_id);
      expect(scaffoldData.output_kind).toBe(catalogEntry?.output_kind);
      expect(scaffoldData.source).toBe(catalogEntry?.source);
      expect(scaffoldData.ordering).toBe(catalogEntry?.ordering);
      expect(scaffoldData.marker).toBe(catalogEntry?.marker);
    }
  });

  test("--help advertises the scaffold_catalog contract slice and HELP_DATA snapshot", () => {
    const { envelope } = invoke(["--help", "--json"]);
    expect(envelope.status).toBe("ok");
    const help = envelope.data as {
      contract_slices: readonly string[];
      scaffold_catalog: readonly { scaffold_id: string }[];
    };
    expect(help.contract_slices).toContain("scaffold_catalog");
    expect(help.scaffold_catalog.map((entry) => entry.scaffold_id)).toEqual([
      ...SCAFFOLD_IDS,
    ]);
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

describe("route_required_references parity with state and diagnose", () => {
  function expectStateAndDiagnoseMatchContract(ledger: string): void {
    const state = invoke(["state", ledger, "--json"]);
    const stateData = state.envelope.data as {
      route_id: string;
      required_reference_ids: string[];
    };
    const expectedStateRefs = requiredReferencesFromContractFor(
      stateData.route_id,
    );
    expect(stateData.required_reference_ids).toEqual(expectedStateRefs);
    expect(stateData.required_reference_ids).not.toContain(
      "first-run-gotchas.md",
    );

    const diagnose = invoke(["diagnose", ledger, "--json"]);
    const diagnoseData = diagnose.envelope.data as {
      inferred_route_id: string;
      expected_reference_ids: string[];
    };
    const expectedDiagnoseRefs = requiredReferencesFromContractFor(
      diagnoseData.inferred_route_id,
    );
    expect(diagnoseData.expected_reference_ids).toEqual(expectedDiagnoseRefs);
    expect(diagnoseData.expected_reference_ids).not.toContain(
      "first-run-gotchas.md",
    );
  }

  test("no-ledger state and diagnose match the no-ledger contract record", () => {
    expectStateAndDiagnoseMatchContract(nonExistentLedgerPath());
  });

  test("stage-route state and diagnose match the emitted contract record", () => {
    expectStateAndDiagnoseMatchContract(minimalConfirmedLedger());
  });

  test("blocked frontmatter state and diagnose match the emitted contract record", () => {
    expectStateAndDiagnoseMatchContract(
      minimalConfirmedLedger({ status: "blocked" }),
    );
  });

  test("blocked version-skew state and diagnose match the emitted contract record", () => {
    const ledger = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        'runbook_version: "1"',
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
    expectStateAndDiagnoseMatchContract(ledger);
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
        'runbook_version: "3"',
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
        'runbook_version: "3"',
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
    // declared. This is correct per the v2 contract — confirmation is
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
        'runbook_version: "3"',
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
      "ledger-init",
      "next",
      "packet",
      "scaffold",
      "state",
    ]);
    expect(data.contract_slices.length).toBeGreaterThan(0);
    expect(data.contract_slices).toContain("route_required_references");
    expect(data.contract_slices).toContain("candidate_batch_fields");
    expect(data.contract_slices).toContain("ledger_batch_lifecycle_fields");
    expect(data.contract_slices).toContain("ledger_schema_pointer_slices");
    expect(data.contract_slices).toContain("builder_attempt_fields");
    expect(data.contract_slices).toContain(
      "orchestrator_inline_attempt_fields",
    );
    expect(data.contract_slices).toContain("finding_fields");
    expect(data.contract_slices).toContain("builder_attempt_types");
    expect(data.contract_slices).toContain("scaffold_ids");
  });

  test("--help documents scaffold ids and response shape", () => {
    const { envelope } = invoke(["--help"]);
    const data = envelope.data as {
      scaffold_ids: readonly string[];
      scaffold_response_shape: Record<string, string>;
    };
    expect(data.scaffold_ids).toEqual([...SCAFFOLD_IDS]);
    expect(data.scaffold_ids).toContain("ce-plan-candidate-batch");
    expect(data.scaffold_ids).toContain("replacement-candidate-batch");
    expect(data.scaffold_ids).toContain("patch-proposal-candidate-batch");
    expect(data.scaffold_ids).toContain("builder-return-envelope");
    expect(data.scaffold_ids).toContain("builder-attempt-compact");
    expect(data.scaffold_ids).toContain("validator-builder-evidence");
    expect(data.scaffold_ids).toContain("validator-inline-evidence");
    expect(data.scaffold_ids).toContain("ledger-empty-batches");
    expect(data.scaffold_ids).toContain("ledger-empty-findings-data");
    expect(data.scaffold_ids).toContain("ledger-batch-lifecycle-defaults");
    expect(data.scaffold_ids).toContain("ledger-finding-row");
    expect(data.scaffold_ids).toContain(
      "notes-implementation-attempt-checkpoint",
    );
    expect(data.scaffold_ids).toContain("notes-validator-wave-completed");
    expect(data.scaffold_ids).toContain(
      "notes-runbook-version-skew-continuation",
    );
    expect(data.scaffold_ids).toContain("workflow-learnings-empty");
    expect(data.scaffold_response_shape.scaffold_id).toContain("scaffold_ids");
    expect(data.scaffold_response_shape.body).toContain("rendered scaffold");
    expect(data.scaffold_response_shape.marker).toContain("Notes evidence");
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

  test("--help documents ledger-init flags and response shape", () => {
    const { envelope } = invoke(["--help"]);
    const data = envelope.data as {
      ledger_init_flags: Record<string, string>;
      ledger_init_response_shape: Record<string, string>;
    };

    expect(data.ledger_init_flags["--issue-number"]).toContain("integer");
    expect(data.ledger_init_flags["--ac"]).toContain("Repeatable");
    expect(data.ledger_init_response_shape.ledger_markdown).toContain(
      "Complete initial ledger",
    );
    expect(data.ledger_init_response_shape.metadata).toContain("ac_digest");
  });
});

// ---------------- ledger-init command ----------------

describe("ledger-init command", () => {
  const argv = [
    "ledger-init",
    "--issue-number",
    "77",
    "--issue-title",
    'Quote "safe" title',
    "--issue-url",
    "https://github.com/acme/widgets/issues/77",
    "--target-repo",
    "acme/widgets",
    "--started-at",
    "2026-05-26T10:30:00+10:00",
    "--ac-source",
    "gold-standard",
    "--ac",
    "First confirmed behaviour",
    "--ac",
    "Second confirmed behaviour",
    "--json",
  ] as const;

  test("emits a success envelope without writing a file", () => {
    const { envelope, exit_code } = invoke(argv);
    const data = envelope.data as {
      ledger_markdown: string;
      metadata: {
        runbook_version: string;
        ac_digest: string;
        section_order: string[];
      };
    };

    expect(envelope.status).toBe("ok");
    expect(exit_code).toBe(0);
    expect(data.ledger_markdown).toContain('issue_number: 77');
    expect(data.ledger_markdown).toContain('issue_title: "Quote \\"safe\\" title"');
    expect(data.ledger_markdown).toContain("batches: []");
    expect(data.ledger_markdown).toContain("findings: []");
    expect(data.ledger_markdown).toContain("workflow_learnings: []");
    expect(data.metadata.ac_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(data.metadata.section_order).toEqual([
      "Acceptance criteria",
      "Batches",
      "Findings data",
      "Findings",
      "Notes",
      "Workflow Learnings",
    ]);
  });

  test("missing required input returns a usage error envelope", () => {
    const { envelope, exit_code } = invoke([
      "ledger-init",
      "--issue-number",
      "77",
      "--json",
    ]);

    expect(envelope.status).toBe("error");
    expect((envelope.error as { code: string }).code).toBe(
      "missing-required-arg",
    );
    expect(exit_code).toBe(64);
  });
});

// ---------------- packet command (U5) ----------------

describe("packet command (U5)", () => {
  function writePacketLedger(): string {
    return writeLedger(
      [
        "---",
        "issue_number: 5",
        "target_repo: \"acme/widgets\"",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        "---",
        "",
        "# Issue 5",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Batches",
        "",
        "```yaml",
        "batches:",
        "  - id: b1",
        "    name: \"Batch one\"",
        "    goal: \"implement one\"",
        "    files:",
        "      - app/one.ts",
        "    depends_on: []",
        "    execution_mode: tdd",
        "    acceptance_tests:",
        "      - \"AC 1 holds: behavior\"",
        "    ac_mapping:",
        "      - 1",
        "    rationale: null",
        "    status: pending",
        "    builder_commits: []",
        "    builder_attempts: []",
        "    iterations: 0",
        "    final_verdict: null",
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
        "## Notes",
        "",
        "",
      ].join("\n"),
    );
  }

  test("requires --json", () => {
    const { envelope, exit_code } = invoke(["packet", "builder"]);
    expect(envelope.status).toBe("error");
    expect((envelope.error as { code: string }).code).toBe("missing-json-flag");
    expect(exit_code).toBe(64);
  });

  test("missing role returns missing-required-arg", () => {
    const { envelope, exit_code } = invoke(["packet", "--json"]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-required-arg",
    );
    expect(exit_code).toBe(64);
  });

  test("unknown role returns unknown-packet-role", () => {
    const { envelope, exit_code } = invoke(["packet", "wizard", "--json"]);
    expect((envelope.error as { code: string }).code).toBe(
      "unknown-packet-role",
    );
    expect(exit_code).toBe(64);
  });

  test("builder packet emits success envelope with packet + dispatch_evidence", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      role: string;
      packet: { batch_contract: { id: string } };
      packet_markdown: string;
      dispatch_evidence: { role: string; cli_route_id: string };
    };
    expect(data.role).toBe("builder");
    expect(data.packet.batch_contract.id).toBe("b1");
    expect(data.packet_markdown).toContain("<local_law_read_order>");
    expect(data.dispatch_evidence.role).toBe("builder");
    expect(data.dispatch_evidence.cli_route_id).toBe("packet.builder");
  });

  test("builder missing --ledger returns missing-packet-flag", () => {
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-packet-flag",
    );
    expect(exit_code).toBe(64);
  });

  test("builder rejects unknown packet flag (typo) with missing-packet-flag", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--legder",
      ledgerPath,
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-packet-flag",
    );
    expect((envelope.error as { message: string }).message).toContain(
      "unknown packet flag --legder",
    );
    expect(exit_code).toBe(64);
  });

  test("builder rejects --ledger with missing value as missing-packet-flag", () => {
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--ledger",
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-packet-flag",
    );
    expect((envelope.error as { message: string }).message).toContain(
      "flag --ledger requires a value",
    );
    expect(exit_code).toBe(64);
  });

  test("builder unknown batch returns packet-render-failed", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--ledger",
      ledgerPath,
      "--batch",
      "no-such-batch",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "packet-render-failed",
    );
    expect(exit_code).toBe(1);
  });

  test("envelope carries schema_version: '1' and run_id (preserves U4 contract)", () => {
    const ledgerPath = writePacketLedger();
    const { envelope } = invoke([
      "packet",
      "builder",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect(envelope.schema_version).toBe("1");
    expect(typeof envelope.run_id).toBe("string");
    expect(typeof envelope.started_at_ms).toBe("number");
    expect(typeof envelope.duration_ms).toBe("number");
  });

  test("ce-plan packet does not require any ledger flag", () => {
    const { envelope, exit_code } = invoke(["packet", "ce-plan", "--json"]);
    expect(exit_code).toBe(0);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      role: string;
      packet: { addendum_body: string };
    };
    expect(data.role).toBe("ce-plan");
    expect(data.packet.addendum_body).toContain("Structured-output requirement");
  });

  test("help catalog lists packet command and packet_roles", () => {
    const { envelope } = invoke(["--help"]);
    const help = envelope.data as {
      commands: Array<{ name: string }>;
      packet_roles: string[];
    };
    expect(help.commands.map((c) => c.name)).toContain("packet");
    expect(help.packet_roles).toEqual([
      "builder",
      "proposer",
      "validator",
      "patch-proposal",
      "ce-plan",
    ]);
  });

  // F020 / F034 / F021 fix — CLI-level happy-path coverage for the
  // three previously-uncovered roles, including dispatch_evidence
  // shape assertions and deny-list spot checks at the CLI boundary.

  function writeProposerLedger(): string {
    return writeLedger(
      [
        "---",
        "issue_number: 5",
        "target_repo: \"acme/widgets\"",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        "---",
        "",
        "# Issue 5",
        "## Acceptance criteria",
        "- [ ] AC 1",
        "## Batches",
        "```yaml",
        "batches: []",
        "```",
        "## Findings data",
        "```yaml",
        "findings: []",
        "```",
        "## Findings",
        "| id | batch_id | signature | persona | severity | status | summary | resolution |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| ff1 | final | sig-x | reviewer | P1 | open | a final blocker | |",
        "## Notes",
        "",
      ].join("\n"),
    );
  }

  test("proposer packet through CLI emits role + dispatch_evidence and no commit-write slot", () => {
    const ledgerPath = writeProposerLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "proposer",
      "--ledger",
      ledgerPath,
      "--finding",
      "ff1",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    const data = envelope.data as {
      role: string;
      packet: unknown;
      dispatch_evidence: { role: string; cli_route_id: string; target_id: string };
    };
    expect(data.role).toBe("proposer");
    expect(data.dispatch_evidence.cli_route_id).toBe("packet.proposer");
    expect(data.dispatch_evidence.target_id).toBe("ff1");
    const json = JSON.stringify(data.packet);
    expect(json).not.toContain("commit_sha");
    expect(json).not.toContain("builder_commits");
  });

  test("validator packet through CLI emits role + dispatch_evidence + scoped findings", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "validator",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--persona",
      "compound-engineering:ce-correctness-reviewer",
      "--commit",
      "abc1234",
      "--touched-file",
      "app/one.ts",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    const data = envelope.data as {
      role: string;
      packet: { batch_id: string };
      dispatch_evidence: { cli_route_id: string };
    };
    expect(data.role).toBe("validator");
    expect(data.packet.batch_id).toBe("b1");
    expect(data.dispatch_evidence.cli_route_id).toBe("packet.validator");
  });

  test("validator packet through CLI emits inline evidence source when requested", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "validator",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--persona",
      "compound-engineering:ce-correctness-reviewer",
      "--commit",
      "abc1234",
      "--touched-file",
      "app/one.ts",
      "--evidence-source",
      "orchestrator_inline",
      "--inline-validity-note",
      "bounded one-file inline attempt",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    const data = envelope.data as {
      packet: {
        evidence_source: string;
        inline_evidence: {
          implementation_commit: string;
          inline_validity_note: string;
        };
        builder_evidence?: unknown;
      };
      dispatch_evidence: { cli_route_id: string };
    };
    expect(data.packet.evidence_source).toBe("orchestrator_inline");
    expect(data.packet.inline_evidence.implementation_commit).toBe("abc1234");
    expect(data.packet.inline_evidence.inline_validity_note).toBe(
      "bounded one-file inline attempt",
    );
    expect(data.packet.builder_evidence).toBeUndefined();
    expect(data.dispatch_evidence.cli_route_id).toBe("packet.validator");
  });

  test("validator packet rejects inline-only flags without inline evidence source", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "validator",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--persona",
      "compound-engineering:ce-correctness-reviewer",
      "--commit",
      "abc1234",
      "--inline-validity-note",
      "bounded one-file inline attempt",
      "--json",
    ]);

    expect(exit_code).toBe(64);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-packet-flag",
    );
    expect((envelope.error as { message: string }).message).toContain(
      "inline evidence flags require --evidence-source orchestrator_inline",
    );
  });

  test("patch-proposal packet through CLI emits ac_mapping: [] and exactly one patch_batches entry", () => {
    const ledgerPath = writeProposerLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "patch-proposal",
      "--ledger",
      ledgerPath,
      "--finding",
      "ff1",
      "--patch-id",
      "patch-001",
      "--patch-name",
      "Patch one",
      "--patch-goal",
      "fix the bug",
      "--patch-file",
      "app/x.ts",
      "--patch-file",
      "app/x.test.ts",
      "--patch-depends-on",
      "b-terminal",
      "--patch-execution-mode",
      "tdd",
      "--patch-acceptance-test",
      "AC 1 holds: bug gone",
      "--patch-rationale",
      "new-file-patch-exception: test sibling",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    const data = envelope.data as {
      role: string;
      packet: {
        patch_batches: Array<{
          id: string;
          ac_mapping: number[];
          files: string[];
        }>;
      };
    };
    expect(data.role).toBe("patch-proposal");
    expect(data.packet.patch_batches.length).toBe(1);
    expect(data.packet.patch_batches[0].id).toBe("patch-001");
    expect(data.packet.patch_batches[0].ac_mapping).toEqual([]);
    expect(data.packet.patch_batches[0].files).toEqual([
      "app/x.ts",
      "app/x.test.ts",
    ]);
  });

  test("F024: invalid --attempt-type value surfaces missing-packet-flag", () => {
    const ledgerPath = writePacketLedger();
    const { envelope, exit_code } = invoke([
      "packet",
      "builder",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--attempt-type",
      "wizard",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-packet-flag",
    );
    expect(exit_code).toBe(64);
  });

  test("F011: dispatch_evidence carries all six documented fields", () => {
    const ledgerPath = writePacketLedger();
    const { envelope } = invoke([
      "packet",
      "builder",
      "--ledger",
      ledgerPath,
      "--batch",
      "b1",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    const evidence = (envelope.data as {
      dispatch_evidence: {
        timestamp: string;
        role: string;
        target_id: string;
        loaded_references: string[];
        loaded_templates: string[];
        cli_route_id: string;
      };
    }).dispatch_evidence;
    expect(typeof evidence.timestamp).toBe("string");
    expect(evidence.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(evidence.role).toBe("builder");
    expect(evidence.target_id).toBe("b1");
    expect(Array.isArray(evidence.loaded_references)).toBe(true);
    expect(evidence.loaded_references.length).toBeGreaterThan(0);
    expect(Array.isArray(evidence.loaded_templates)).toBe(true);
    expect(evidence.loaded_templates.length).toBeGreaterThan(0);
    expect(evidence.cli_route_id).toBe("packet.builder");
  });
});

// ---------------- U6: runbook_version surface through state + diagnose ----------------

describe("U6: runbook_version surfaced on state command", () => {
  function ledger(extra: {
    runbookVersion?: string | null;
    notesBody?: string[];
  } = {}): string {
    const frontmatter = [
      "---",
      "issue_number: 1",
      "status: in-progress",
      "ac_confirmation_status: confirmed",
      "batch_contract_confirmation_status: confirmed",
      "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
    ];
    if (extra.runbookVersion !== null && extra.runbookVersion !== undefined) {
      frontmatter.push(`runbook_version: "${extra.runbookVersion}"`);
    }
    frontmatter.push("---");
    return writeLedger(
      [
        ...frontmatter,
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
        ...(extra.notesBody ?? []),
      ].join("\n"),
    );
  }

  test("matched skew surfaces runbook_version + runbook_version_skew on state", () => {
    const path = ledger({ runbookVersion: RUNBOOK_VERSION });
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      runbook_version: string | null;
      runbook_version_skew: string | null;
      version_skew: string;
    };
    expect(data.runbook_version).toBe(RUNBOOK_VERSION);
    expect(data.runbook_version_skew).toBe("matched");
    expect(data.version_skew).toBe("matched");
  });

  test("missing skew routes to blocked-runbook-version-skew with stop-required gate", () => {
    const path = ledger({ runbookVersion: null });
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      route_id: string;
      runbook_version: string | null;
      runbook_version_skew: string;
      blocking_gates: Array<
        | { kind: "route_id"; value: string }
        | { kind: "field"; field: string; value: string }
      >;
    };
    expect(data.route_id).toBe("blocked-runbook-version-skew");
    expect(data.runbook_version).toBe(null);
    expect(data.runbook_version_skew).toBe("missing");
    expect(data.blocking_gates).toContainEqual({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: "missing",
    });
  });

  test("mismatched skew routes to blocked-runbook-version-skew with stop-required gate", () => {
    const path = ledger({ runbookVersion: "1" });
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      route_id: string;
      runbook_version_skew: string;
      blocking_gates: Array<
        | { kind: "route_id"; value: string }
        | { kind: "field"; field: string; value: string }
      >;
    };
    expect(data.route_id).toBe("blocked-runbook-version-skew");
    expect(data.runbook_version_skew).toBe("mismatched");
    expect(data.blocking_gates).toContainEqual({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: "mismatched",
    });
  });

  test("continuation-evidence-present clears the stop-required gate and lets routing proceed", () => {
    const notes = [
      "## Notes",
      "",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      '  ledger_version: "1"',
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan @ 2026-05-22T19:00"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      '  reference_context: "references/ledger-and-helper.md"',
      '  accepted_risk: "legacy ledger resumed"',
      "```",
      "",
    ];
    const path = ledger({ runbookVersion: "1", notesBody: notes });
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      route_id: string;
      runbook_version_skew: string;
      blocking_gates: Array<{ kind: string; field?: string; value: string }>;
    };
    expect(data.runbook_version_skew).toBe("continuation-evidence-present");
    expect(data.route_id).not.toBe("blocked-runbook-version-skew");
    for (const gate of data.blocking_gates) {
      if (gate.kind === "field") {
        expect(gate.field).not.toBe("frontmatter.runbook_version");
      }
    }
  });

  test("partial continuation evidence (missing field) is rejected; skew stays mismatched", () => {
    const notes = [
      "## Notes",
      "",
      "<!-- runbook-version-skew-continuation -->",
      "```yaml",
      "runbook_version_skew_continuation:",
      '  ledger_version: "1"',
      `  runtime_version: "${RUNBOOK_VERSION}"`,
      '  operator_decision: "Nathan"',
      '  timestamp: "2026-05-22T19:00:00+10:00"',
      '  route_context: "batch-loop"',
      // reference_context omitted
      '  accepted_risk: "x"',
      "```",
      "",
    ];
    const path = ledger({ runbookVersion: "1", notesBody: notes });
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      route_id: string;
      runbook_version_skew: string;
    };
    expect(data.runbook_version_skew).toBe("mismatched");
    expect(data.route_id).toBe("blocked-runbook-version-skew");
  });
});

describe("U6: runbook_version surfaced on diagnose command", () => {
  test("diagnose envelope mirrors state on runbook_version + runbook_version_skew", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        'runbook_version: "3"',
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
    const { envelope } = invoke(["diagnose", path, "--json"]);
    const data = envelope.data as {
      runbook_version: string | null;
      runbook_version_skew: string;
      installed_artifact_presence: { all_present: boolean };
      blocking_gates: unknown[];
    };
    expect(data.runbook_version).toBe(RUNBOOK_VERSION);
    expect(data.runbook_version_skew).toBe("matched");
    expect(data.installed_artifact_presence.all_present).toBe(true);
    expect(data.blocking_gates).toEqual([]);
  });

  test("diagnose envelope surfaces frontmatter.runbook_version stop-required gate on missing skew", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
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
    const { envelope } = invoke(["diagnose", path, "--json"]);
    const data = envelope.data as {
      runbook_version_skew: string;
      blocking_gates: Array<
        | { kind: "route_id"; value: string }
        | { kind: "field"; field: string; value: string }
      >;
    };
    expect(data.runbook_version_skew).toBe("missing");
    expect(data.blocking_gates).toContainEqual({
      kind: "field",
      field: "frontmatter.runbook_version",
      value: "missing",
    });
  });
});

describe("U6: U4 envelope shape preserved (additive only)", () => {
  test("envelope still carries the U4 schema_version 1 + run_id/started_at_ms/duration_ms fields", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        'runbook_version: "3"',
        "---",
        "",
        "# Issue 1",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", path, "--json"]);
    expect(envelope.status).toBe("ok");
    expect(envelope.schema_version).toBe("1");
    expect(typeof envelope.run_id).toBe("string");
    expect(typeof envelope.started_at_ms).toBe("number");
    expect(typeof envelope.duration_ms).toBe("number");
  });
});

describe("U6: verbatim runbook_version + skew determinism", () => {
  test("CLI surfaces a non-trivial runbook_version verbatim (no numeric coercion)", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        'runbook_version: "2.0-beta"',
        "---",
        "",
        "# Issue 1",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as {
      runbook_version: string | null;
      runbook_version_skew: string;
    };
    expect(data.runbook_version).toBe("2.0-beta");
    expect(typeof data.runbook_version).toBe("string");
    expect(data.runbook_version_skew).toBe("mismatched");
  });

  test("running state twice on a mismatched + evidence-bearing ledger yields the same skew + gates", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        "ac_confirmation_status: confirmed",
        "batch_contract_confirmation_status: confirmed",
        "plan_path: docs/plans/2026-05-22-001-feat-thing.md",
        'runbook_version: "1"',
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Notes",
        "",
        "<!-- runbook-version-skew-continuation -->",
        "```yaml",
        "runbook_version_skew_continuation:",
        '  ledger_version: "1"',
        `  runtime_version: "${RUNBOOK_VERSION}"`,
        '  operator_decision: "Nathan @ 2026-05-22T19:00"',
        '  timestamp: "2026-05-22T19:00:00+10:00"',
        '  route_context: "batch-loop"',
        '  reference_context: "references/ledger-and-helper.md"',
        '  accepted_risk: "legacy ledger resumed"',
        "```",
        "",
      ].join("\n"),
    );
    const a = invoke(["state", path, "--json"]);
    const b = invoke(["state", path, "--json"]);
    const dataA = a.envelope.data as {
      runbook_version: string | null;
      runbook_version_skew: string;
      blocking_gates: unknown[];
    };
    const dataB = b.envelope.data as {
      runbook_version: string | null;
      runbook_version_skew: string;
      blocking_gates: unknown[];
    };
    expect(dataA.runbook_version).toBe(dataB.runbook_version);
    expect(dataA.runbook_version_skew).toBe(dataB.runbook_version_skew);
    expect(dataA.blocking_gates).toEqual(dataB.blocking_gates);
  });

  test("F-U6-SEC-002 through the CLI: a nested-fence smuggled marker does not change the skew classification", () => {
    const path = writeLedger(
      [
        "---",
        "issue_number: 1",
        "status: in-progress",
        'runbook_version: "1"',
        "---",
        "",
        "# Issue 1",
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1",
        "",
        "## Notes",
        "",
        "````text",
        "<!-- runbook-version-skew-continuation -->",
        "```yaml",
        "runbook_version_skew_continuation:",
        '  ledger_version: "1"',
        `  runtime_version: "${RUNBOOK_VERSION}"`,
        '  operator_decision: "Hostile"',
        '  timestamp: "2026-05-22T19:00:00+10:00"',
        '  route_context: "batch-loop"',
        '  reference_context: "references/ledger-and-helper.md"',
        '  accepted_risk: "smuggled"',
        "```",
        "````",
        "",
      ].join("\n"),
    );
    const { envelope } = invoke(["state", path, "--json"]);
    const data = envelope.data as { runbook_version_skew: string; route_id: string };
    expect(data.runbook_version_skew).toBe("mismatched");
    expect(data.route_id).toBe("blocked-runbook-version-skew");
  });
});

describe("U6: contract slice for runbook_version_skew_states", () => {
  test("contract runbook_version_skew_states returns the catalog-ordered four states", () => {
    const { envelope } = invoke([
      "contract",
      "runbook_version_skew_states",
      "--json",
    ]);
    const data = envelope.data as {
      slice: string;
      values: string[];
      ordering: string;
    };
    expect(data.slice).toBe("runbook_version_skew_states");
    expect(data.ordering).toBe("catalog");
    expect(data.values).toEqual([
      "matched",
      "missing",
      "mismatched",
      "continuation-evidence-present",
    ]);
  });
});

describe("U6: contract slice for blocking_gate_field_names", () => {
  test("contract blocking_gate_field_names returns the catalog-ordered four field names", () => {
    const { envelope } = invoke([
      "contract",
      "blocking_gate_field_names",
      "--json",
    ]);
    const data = envelope.data as {
      slice: string;
      values: string[];
      ordering: string;
    };
    expect(data.slice).toBe("blocking_gate_field_names");
    expect(data.ordering).toBe("catalog");
    expect(data.values).toEqual([
      "frontmatter.status",
      "ac_confirmation_status",
      "batch_contract_confirmation_status",
      "frontmatter.runbook_version",
    ]);
  });
});

// ---------------- scaffold command (issue 114 tracer) ----------------

describe("scaffold command", () => {
  test("renders the ce-plan candidate batch scaffold with metadata", () => {
    const { envelope, exit_code } = invoke([
      "scaffold",
      "ce-plan-candidate-batch",
      "--json",
    ]);
    expect(exit_code).toBe(0);
    expect(envelope.status).toBe("ok");
    const data = envelope.data as {
      scaffold_id: string;
      output_kind: string;
      source: string;
      ordering: string;
      body: string;
    };
    expect(data.scaffold_id).toBe("ce-plan-candidate-batch");
    expect(data.output_kind).toBe("yaml");
    expect(data.ordering).toBe("catalog");
    expect(data.source).toContain("lib/scaffolds.ts");
    expect(data.body).toBe(renderScaffold("ce-plan-candidate-batch").body);
  });

  test("renders every additional scaffold with unchanged envelope shape", () => {
    for (const scaffoldId of SCAFFOLD_IDS.filter(
      (id) => id !== "ce-plan-candidate-batch",
    )) {
      const { envelope, exit_code } = invoke([
        "scaffold",
        scaffoldId,
        "--json",
      ]);
      expect(exit_code).toBe(0);
      expect(envelope.status).toBe("ok");
      const data = envelope.data as {
        scaffold_id: string;
        output_kind: string;
        source: string;
        ordering: string;
        body: string;
      };
      expect(data.scaffold_id).toBe(scaffoldId);
      expect(data.output_kind).toBe("yaml");
      expect(data.ordering).toBe("catalog");
      expect(data.source).toContain("lib/scaffolds.ts");
      expect(data.body).toBe(renderScaffold(scaffoldId).body);
    }
  });

  test("marker-aware Notes scaffolds expose marker metadata additively", () => {
    for (const scaffoldId of [
      "notes-implementation-attempt-checkpoint",
      "notes-validator-wave-completed",
      "notes-runbook-version-skew-continuation",
    ] as const) {
      const { envelope } = invoke(["scaffold", scaffoldId, "--json"]);
      const data = envelope.data as { marker?: string };
      expect(data.marker).toBe(renderScaffold(scaffoldId).marker);
    }

    const { envelope } = invoke(["scaffold", "ledger-empty-batches", "--json"]);
    expect((envelope.data as { marker?: string }).marker).toBeUndefined();
  });

  test("unknown scaffold id returns unknown-scaffold-id", () => {
    const { envelope, exit_code } = invoke([
      "scaffold",
      "not-a-scaffold",
      "--json",
    ]);
    expect((envelope.error as { code: string }).code).toBe(
      "unknown-scaffold-id",
    );
    expect(exit_code).toBe(64);
  });

  test("missing scaffold id returns missing-required-arg", () => {
    const { envelope, exit_code } = invoke(["scaffold", "--json"]);
    expect((envelope.error as { code: string }).code).toBe(
      "missing-required-arg",
    );
    expect((envelope.error as { message: string }).message).toContain(
      "scaffold id",
    );
    expect(exit_code).toBe(64);
  });
});

describe("U6: HELP_DATA documents the state + diagnose response shapes", () => {
  test("--help envelope enumerates state_response_shape + diagnose_response_shape", () => {
    const { envelope } = invoke(["--help"]);
    const data = envelope.data as {
      state_response_shape: Record<string, string>;
      diagnose_response_shape: Record<string, string>;
      contract_slices: readonly string[];
    };
    expect(data.state_response_shape.runbook_version).toMatch(/verbatim/i);
    expect(data.state_response_shape.runbook_version_skew).toMatch(
      /runbook_version_skew_states/,
    );
    expect(data.state_response_shape.installed_artifact_presence).toMatch(
      /cli_ts/,
    );
    expect(data.state_response_shape.blocking_gates).toMatch(
      /frontmatter\.runbook_version/,
    );
    expect(data.diagnose_response_shape.runbook_version).toBeDefined();
    expect(data.diagnose_response_shape.runbook_version_skew).toBeDefined();
    expect(data.contract_slices).toContain("runbook_version_skew_states");
  });
});
