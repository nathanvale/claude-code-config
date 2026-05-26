/**
 * U10: CLI process-boundary smoke matrix.
 *
 * The cli.test.ts file exercises the CLI via in-process `run(...)` calls.
 * That pattern is faster but skips the install-path symlink, real argv
 * parsing, real stdout/stderr stream handling, and the actual process
 * exit code. U10 spawns `bun cli.ts ...` as a child process and pins the
 * documented HELP_DATA contract surface at the process boundary.
 *
 * Coverage (per docs/runbooks/issue-to-pr-v2-refactor/u10-cli-smoke-matrix.md):
 *   Block 1  - Envelope-shape invariants (cross-command)
 *   Block 2  - Every command x --json requirement
 *   Block 3  - `state` command x ledger states
 *   Block 4  - `next` command x no-imperative contract (ADR 0002)
 *   Block 5  - `contract` command x every documented slice
 *   Block 6  - `diagnose` command x ledger states
 *   Block 7  - `packet` command x every role x required-flag matrix
 *   Block 8  - Every documented error_code
 *   Block 9  - Stdout/stderr separation
 *   Block 10 - Process exit code alignment with envelope exit_code
 *
 * Note on process exit codes:
 *   The U10 seam runbook initially flagged a suspected divergence
 *   between envelope `exit_code` and process exit code (based on a
 *   shell artifact during U9 manual smoke). Block 10 verified this
 *   was a false alarm: process exit codes today DO match the
 *   documented envelope `exit_code` values for both success (0) and
 *   usage errors (64). See u10-cli-smoke-matrix-ledger.md finding
 *   `false-alarm-process-exit-divergence` for the audit trail.
 */

import { beforeAll, afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

import {
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_ATTEMPT_TYPE_VALUES,
  CANDIDATE_BATCH_FIELDS,
  FINDING_FIELDS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  LEDGER_SCHEMA_POINTER_SLICES,
  ORCHESTRATOR_INLINE_ATTEMPT_FIELDS,
} from "./lib/contract";
import {
  requiredReferenceIdsFor,
  ROUTE_IDS,
  type RouteId,
} from "./lib/route";
import { renderScaffold } from "./lib/scaffolds";

const scriptPath = join(import.meta.dir, "cli.ts");
const bunExecutable = execPath;
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
  const dir = mkdtempSync(join(tmpdir(), "u10-cli-smoke-"));
  tempDirs.push(dir);
  return dir;
}

function writeLedger(content: string): string {
  const dir = makeTempDir();
  const path = join(dir, "ledger.md");
  writeFileSync(path, content);
  return path;
}

function sha256Digest(payload: string): string {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function nonExistentLedgerPath(): string {
  return join(makeTempDir(), "missing-ledger.md");
}

type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** The first non-empty stdout line, parsed as JSON. Consumers MUST gate
   *  on `envelopeParsed` before reading `envelope`. */
  envelope: Record<string, unknown>;
  envelopeParsed: boolean;
};

async function runCli(args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn([bunExecutable, scriptPath, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  let stdout = "";
  let stderr = "";
  let exitCode = -1;
  try {
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  } finally {
    // Reap on any failure path. proc.kill() is a no-op for already-exited
    // children; protects against future hangs in cli.ts paths.
    if (proc.exitCode === null) {
      proc.kill();
    }
  }
  const firstLine = stdout.split("\n").find((line) => line.length > 0) ?? "";
  let envelope: Record<string, unknown> = {};
  let envelopeParsed = false;
  if (firstLine) {
    try {
      envelope = JSON.parse(firstLine) as Record<string, unknown>;
      envelopeParsed = true;
    } catch {
      // envelopeParsed stays false; downstream assertions surface the
      // raw stdout via expect(envelopeParsed).toBe(true) failure context.
    }
  }
  return { stdout, stderr, exitCode, envelope, envelopeParsed };
}

// HELP_DATA cache - read once per test file, reused across blocks. This
// is the U10 implementation-pattern rule: never hardcode contract
// strings; always read them from the running CLI's own catalog so the
// smoke fails loudly when the catalog drifts.
let HELP_DATA: Record<string, unknown> = {};

beforeAll(async () => {
  const result = await runCli(["--help", "--json"]);
  if (!result.envelopeParsed) {
    throw new Error(
      `cli.ts --help --json failed to emit a parseable envelope. exitCode=${result.exitCode} stdout=${result.stdout.slice(0, 400)} stderr=${result.stderr.slice(0, 400)}`,
    );
  }
  HELP_DATA = result.envelope.data as Record<string, unknown>;
});

function assertHelpDataLoaded(): void {
  if (Object.keys(HELP_DATA).length === 0) {
    throw new Error(
      "HELP_DATA cache is empty; beforeAll did not populate it. Smoke catalog accessors cannot be used before beforeAll.",
    );
  }
}

function helpCommands(): Array<{ name: string; argv: readonly string[] }> {
  assertHelpDataLoaded();
  return HELP_DATA.commands as Array<{ name: string; argv: readonly string[] }>;
}

function helpContractSlices(): readonly string[] {
  assertHelpDataLoaded();
  return HELP_DATA.contract_slices as readonly string[];
}

function helpPacketRoles(): readonly string[] {
  assertHelpDataLoaded();
  return HELP_DATA.packet_roles as readonly string[];
}

function helpScaffoldIds(): readonly string[] {
  assertHelpDataLoaded();
  return HELP_DATA.scaffold_ids as readonly string[];
}

type PacketRoleFlagSpec = {
  required: readonly string[];
  optional?: readonly string[];
  repeatable?: readonly string[];
  enum?: Record<string, readonly string[]>;
};

function helpPacketRoleFlags(role: string): PacketRoleFlagSpec {
  assertHelpDataLoaded();
  const matrix = HELP_DATA.packet_role_flags as Record<string, PacketRoleFlagSpec>;
  const entry = matrix[role];
  if (!entry) {
    throw new Error(
      `helpPacketRoleFlags: role ${role} is not present in HELP_DATA.packet_role_flags (known: ${Object.keys(matrix).join(", ")})`,
    );
  }
  return entry;
}

type ErrorCodeEntry = {
  code: string;
  exit_code: number;
  severity: string;
  recoverability: string;
  retryable: boolean;
  hint: { action: string };
};

function helpErrorCodes(): readonly ErrorCodeEntry[] {
  assertHelpDataLoaded();
  return HELP_DATA.error_codes as readonly ErrorCodeEntry[];
}

type RouteRequiredReferenceRecord = {
  route_id: RouteId;
  required_reference_ids: string[];
};

async function routeRequiredReferencesFromContract(): Promise<
  RouteRequiredReferenceRecord[]
> {
  const result = await runCli([
    "contract",
    "route_required_references",
    "--json",
  ]);
  assertSuccessEnvelopeShape(result.envelope);
  const data = result.envelope.data as {
    values: RouteRequiredReferenceRecord[];
  };
  return data.values;
}

function requiredReferencesForRouteFromContract(
  records: readonly RouteRequiredReferenceRecord[],
  routeId: string,
): string[] {
  const record = records.find((entry) => entry.route_id === routeId);
  if (!record) {
    throw new Error(`missing route_required_references entry for ${routeId}`);
  }
  return record.required_reference_ids;
}

function findErrorCodeEntry(code: string): ErrorCodeEntry {
  const entry = helpErrorCodes().find((e) => e.code === code);
  if (!entry) {
    throw new Error(
      `findErrorCodeEntry: ${code} is not present in HELP_DATA.error_codes (known: ${helpErrorCodes().map((e) => e.code).join(", ")})`,
    );
  }
  return entry;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ADR 0002 imperative-verb regex pinned at the process boundary. The
// verb set is the runbook's Block 4 spec (u10-cli-smoke-matrix.md:175-177),
// not cli.test.ts AC3's verb set - the two surfaces deliberately pin
// different policies (smoke pins minimal action verbs at the JSON-stdout
// payload level; AC3 pins a broader prose-policy lexicon). Word boundaries
// avoid false positives on substrings like `run_id` or `ask_user`.
const IMPERATIVE_VERB_REGEX = /\b(run|execute|dispatch|ask|tell|invoke|call|do)\b/i;

/**
 * Pin a documented `string | null` field exactly. `typeof null === "object"`
 * so a `["string", "object"]` `typeof` check also accepts arrays and bare
 * objects, which the documented schema does NOT permit. This helper
 * rejects those by requiring the value to be `null` or a primitive string.
 */
function assertNullableString(value: unknown, label: string): void {
  if (value === null) return;
  if (typeof value === "string") return;
  // `JSON.stringify(undefined)` returns `undefined` (not a string), and
  // the same is true for symbols / bigints. Guard the diagnostic so the
  // helper surfaces the intended "expected string or null" message
  // rather than a TypeError inside the template literal.
  const repr = JSON.stringify(value) ?? String(value);
  throw new Error(
    `expected ${label} to be string or null, got ${typeof value} (${repr.slice(0, 80)})`,
  );
}

/**
 * Pin a value as a plain non-null, non-array object. `typeof === "object"`
 * alone accepts `null` (typeof null === "object") and arrays (typeof [] ===
 * "object"), which the documented envelope contract does not permit for
 * `data`, `error`, or `error.hint`. This helper enforces the documented
 * shape — a plain `Record<string, unknown>` — by rejecting both.
 */
function assertPlainObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `expected ${label} to be a plain object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`,
    );
  }
}

function assertSuccessEnvelopeShape(envelope: Record<string, unknown>): void {
  expect(envelope.status).toBe("ok");
  expect(envelope.schema_version).toBe("1");
  expect(typeof envelope.run_id).toBe("string");
  expect(envelope.run_id as string).toMatch(UUID_REGEX);
  expect(typeof envelope.started_at_ms).toBe("number");
  expect(envelope.started_at_ms as number).toBeGreaterThan(0);
  expect(typeof envelope.duration_ms).toBe("number");
  expect(envelope.duration_ms as number).toBeGreaterThanOrEqual(0);
  assertPlainObject(envelope.data, "envelope.data");
}

/**
 * Assert error-envelope shape AND cross-check the envelope's error fields
 * against the HELP_DATA.error_codes catalog entry for `expectedCode`. A
 * runtime drift between the emitted envelope and the documented catalog
 * (e.g., wrong exit_code, severity, recoverability, hint.action) surfaces
 * here as a smoke failure with a clear assertion.
 */
function assertErrorEnvelopeShape(
  envelope: Record<string, unknown>,
  expectedCode: string,
  context?: string,
): void {
  const ctx = context ? ` [${context}]` : "";
  try {
    expect(envelope.status).toBe("error");
    expect(envelope.schema_version).toBe("1");
    expect(typeof envelope.run_id).toBe("string");
    expect(envelope.run_id as string).toMatch(UUID_REGEX);
    expect(typeof envelope.started_at_ms).toBe("number");
    expect(typeof envelope.duration_ms).toBe("number");
    const error = envelope.error as Record<string, unknown>;
    assertPlainObject(error, "envelope.error");
    expect(error.code).toBe(expectedCode);
    const catalog = findErrorCodeEntry(expectedCode);
    expect(error.exit_code).toBe(catalog.exit_code);
    expect(error.severity).toBe(catalog.severity);
    expect(error.recoverability).toBe(catalog.recoverability);
    expect(error.retryable).toBe(catalog.retryable);
    const hint = error.hint as Record<string, unknown>;
    assertPlainObject(hint, "envelope.error.hint");
    expect(hint.action).toBe(catalog.hint.action);
  } catch (err) {
    if (context && err instanceof Error) {
      err.message = `${err.message}${ctx}`;
    }
    throw err;
  }
}

// =====================================================================
// Ledger fixture builder. Inline templates per U10 implementation
// pattern (no separate fixture directory). The common scaffolding
// (heading + AC + Batches + Findings) is the same for every fixture;
// only frontmatter and the Batches body differ.
// =====================================================================

type LedgerFixtureOpts = {
  frontmatter: Record<string, string>;
  batchesYaml?: string;
};

function buildLedger(opts: LedgerFixtureOpts): string {
  const fmLines = ["---"];
  for (const [key, value] of Object.entries(opts.frontmatter)) {
    fmLines.push(`${key}: ${value}`);
  }
  fmLines.push("---");
  const batchesBody = opts.batchesYaml ?? "batches: []";
  return writeLedger(
    [
      ...fmLines,
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
      batchesBody,
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

function ledgerPendingAc(): string {
  return buildLedger({
    frontmatter: {
      issue_number: "1",
      status: "in-progress",
      ac_confirmation_status: "pending",
      batch_contract_confirmation_status: "pending",
      runbook_version: '"3"',
    },
  });
}

function ledgerBlockedFrontmatter(): string {
  return buildLedger({
    frontmatter: {
      issue_number: "1",
      status: "blocked",
      blocked_reason: "host-builder-tools-unavailable",
      ac_confirmation_status: "confirmed",
      batch_contract_confirmation_status: "confirmed",
      runbook_version: '"3"',
    },
  });
}

function ledgerVersionSkewMismatched(): string {
  return buildLedger({
    frontmatter: {
      issue_number: "1",
      status: "in-progress",
      ac_confirmation_status: "confirmed",
      batch_contract_confirmation_status: "confirmed",
      runbook_version: '"1"',
    },
  });
}

function ledgerConfirmedBatchLoop(): string {
  const dir = makeTempDir();
  const planContent = "# Plan\n\nOne batch.\n";
  const planPath = join(dir, "plan.md");
  writeFileSync(planPath, planContent);

  const contractPayload = JSON.stringify([
    {
      id: "u1",
      name: "U1",
      goal: "Keep the batch pending",
      files: ["README.md"],
      depends_on: [],
      execution_mode: "change_first",
      acceptance_tests: ["AC 1"],
      ac_mapping: [1],
      rationale: null,
    },
  ]);

  return buildLedger({
    frontmatter: {
      issue_number: "1",
      status: "in-progress",
      ac_confirmation_status: "confirmed",
      batch_contract_confirmation_status: "confirmed",
      plan_path: JSON.stringify(planPath),
      runbook_version: '"3"',
      ac_digest: JSON.stringify(sha256Digest("- [ ] AC 1")),
      plan_digest: JSON.stringify(sha256Digest(planContent)),
      batch_contract_digest: JSON.stringify(sha256Digest(contractPayload)),
    },
    batchesYaml: [
      "batches:",
      '  - id: "u1"',
      '    name: "U1"',
      '    goal: "Keep the batch pending"',
      "    files:",
      '      - "README.md"',
      "    depends_on: []",
      "    execution_mode: change_first",
      "    acceptance_tests:",
      '      - "AC 1"',
      "    ac_mapping:",
      "      - 1",
      "    rationale: null",
      "    status: pending",
      "    builder_commits: []",
      "    builder_attempts: []",
      "    orchestrator_inline_attempts: []",
      "    iterations: 0",
      "    final_verdict: null",
    ].join("\n"),
  });
}

/**
 * Ledger with no frontmatter delimiter at all. This is the most
 * aggressive malformed shape: the ledger reader's frontmatter parse
 * fails deterministically with a DecomposeError, which maps to
 * `ledger-validation-failed` (exit_code 1). Picked over a malformed
 * Batches YAML body because the latter goes through `parseLedgerBatchRows`
 * whose tolerance is parser-internal; this path is contract-stable.
 */
function ledgerNoFrontmatter(): string {
  return writeLedger(
    [
      "no frontmatter delimiter at all",
      "",
      "## Acceptance criteria",
      "",
      "- [ ] AC 1",
      "",
    ].join("\n"),
  );
}

// =====================================================================
// Block 1 - Envelope-shape invariants (cross-command)
// =====================================================================

describe("Block 1: Envelope-shape invariants (cross-command)", () => {
  test("--help --json returns a parseable success envelope with the documented shape", async () => {
    const result = await runCli(["--help", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("state --json returns a success envelope with all required top-level fields", async () => {
    const ledger = nonExistentLedgerPath();
    const result = await runCli(["state", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("next --json returns a success envelope with all required top-level fields", async () => {
    const ledger = nonExistentLedgerPath();
    const result = await runCli(["next", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("diagnose --json returns a success envelope with all required top-level fields", async () => {
    const ledger = nonExistentLedgerPath();
    const result = await runCli(["diagnose", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("contract route_ids --json returns a success envelope with all required top-level fields", async () => {
    const result = await runCli(["contract", "route_ids", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("packet ce-plan --json returns a success envelope with all required top-level fields", async () => {
    // ce-plan is the one packet role with no required flags; the only
    // command branch whose success envelope is not otherwise exercised
    // by Blocks 3, 4, 5, 6. Pins the packet command's envelope shape at
    // the process boundary.
    const result = await runCli(["packet", "ce-plan", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  test("envelope schema_version is the literal '1' string for both success and error", async () => {
    const success = await runCli(["contract", "route_ids", "--json"]);
    expect(success.envelope.schema_version).toBe("1");
    const error = await runCli(["unknown-command", "--json"]);
    expect(error.envelope.schema_version).toBe("1");
  });
});

// =====================================================================
// Block 2 - Every command x --json requirement
// =====================================================================

describe("Block 2: Every command × --json requirement", () => {
  test("every JSON-only command without --json returns missing-json-flag with exit_code 64", async () => {
    // Drive the iteration from HELP_DATA.commands so a new command
    // gains coverage automatically and dropping a command from the
    // catalog surfaces here.
    const commands = helpCommands().map((c) => c.name);
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const args =
        cmd === "contract"
          ? ["contract", "route_ids"]
          : cmd === "packet"
            ? ["packet", "builder"]
            : [cmd, nonExistentLedgerPath()];
      const result = await runCli(args);
      if (!result.envelopeParsed) {
        throw new Error(
          `[command=${cmd}] envelope did not parse. stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`,
        );
      }
      assertErrorEnvelopeShape(result.envelope, "missing-json-flag", `command=${cmd}`);
    }
  });
});

// =====================================================================
// Block 3 - `state` command × ledger states
// =====================================================================

describe("Block 3: state command × ledger states", () => {
  test("no-ledger ledger reports route_id: no-ledger and ledger_exists: false", async () => {
    const result = await runCli(["state", nonExistentLedgerPath(), "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.route_id).toBe("no-ledger");
    expect(data.ledger_exists).toBe(false);
  });

  test("pending AC ledger reports route_id: pick-issue with full confirmation_state shape", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli(["state", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.route_id).toBe("pick-issue");
    expect(data.ledger_exists).toBe(true);
    const confirmation = data.confirmation_state as Record<string, unknown>;
    // Pin all three documented confirmation_state sub-keys, not just AC.
    expect(typeof confirmation.acceptance_criteria).toBe("string");
    expect(typeof confirmation.batch_contract).toBe("string");
    expect(typeof confirmation.digests).toBe("string");
    expect(confirmation.acceptance_criteria).toBe("pending");
  });

  test("confirmed not-terminal ledger reports route_id: batch-loop", async () => {
    const ledger = ledgerConfirmedBatchLoop();
    const result = await runCli(["state", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.route_id).toBe("batch-loop");
    expect(data.has_batches).toBe(true);
    expect(data.all_batches_terminal).toBe(false);
  });

  test("frontmatter status: blocked ledger reports blocked-frontmatter-blocked-reason", async () => {
    const ledger = ledgerBlockedFrontmatter();
    const result = await runCli(["state", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.route_id).toBe("blocked-frontmatter-blocked-reason");
  });

  test("mismatched runbook_version ledger reports blocked-runbook-version-skew with stop-required gate", async () => {
    const ledger = ledgerVersionSkewMismatched();
    const result = await runCli(["state", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.route_id).toBe("blocked-runbook-version-skew");
    expect(data.runbook_version_skew).toBe("mismatched");
    const gates = data.blocking_gates as Array<Record<string, unknown>>;
    expect(
      gates.some(
        (g) => g.kind === "field" && g.field === "frontmatter.runbook_version",
      ),
    ).toBe(true);
  });

  test("state envelope carries the full documented state_response_shape field set", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli(["state", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    // Documented in HELP_DATA.state_response_shape. Pin every top-level
    // key by presence + type so renames/removals fail loudly. Sub-object
    // fields use assertPlainObject to reject null and arrays per the
    // documented contract (typeof === "object" alone would accept both).
    assertPlainObject(data.confirmation_state, "data.confirmation_state");
    assertPlainObject(data.digest_drift, "data.digest_drift");
    expect(typeof data.version_skew).toBe("string");
    expect(typeof data.route_id).toBe("string");
    expect(Array.isArray(data.required_reference_ids)).toBe(true);
    expect(Array.isArray(data.blocking_gates)).toBe(true);
    assertPlainObject(data.installed_artifact_presence, "data.installed_artifact_presence");
    expect(typeof data.ledger_path).toBe("string");
    expect(typeof data.ledger_exists).toBe("boolean");
    // runbook_version and runbook_version_skew are documented as
    // "string or null"; nullable-string helper pins null OR string
    // exactly (rejects arrays/objects that also satisfy `typeof === "object"`).
    assertNullableString(data.runbook_version, "runbook_version");
    assertNullableString(data.runbook_version_skew, "runbook_version_skew");
    expect(typeof data.frontmatter_status).toBe("string");
    // Remaining documented state_response_shape fields: nullable
    // strings + booleans surfacing batch progress and PR state.
    assertNullableString(data.plan_path, "plan_path");
    expect(typeof data.has_batches).toBe("boolean");
    expect(typeof data.all_batches_terminal).toBe("boolean");
    assertNullableString(data.final_reviewed_at, "final_reviewed_at");
    assertNullableString(data.pr_url, "pr_url");
  });

  test("state required_reference_ids match route_required_references for representative routes", async () => {
    const contractRecords = await routeRequiredReferencesFromContract();
    const ledgers = [
      nonExistentLedgerPath(),
      ledgerPendingAc(),
      ledgerConfirmedBatchLoop(),
      ledgerBlockedFrontmatter(),
      ledgerVersionSkewMismatched(),
    ];
    for (const ledger of ledgers) {
      const result = await runCli(["state", ledger, "--json"]);
      assertSuccessEnvelopeShape(result.envelope);
      const data = result.envelope.data as {
        route_id: string;
        required_reference_ids: string[];
      };
      expect(data.required_reference_ids).toEqual(
        requiredReferencesForRouteFromContract(contractRecords, data.route_id),
      );
      expect(data.required_reference_ids).not.toContain(
        "first-run-gotchas.md",
      );
    }
  });
});

// =====================================================================
// Block 4 - `next` command × no-imperative contract (ADR 0002)
// =====================================================================

describe("Block 4: next command × no-imperative contract (ADR 0002)", () => {
  test("next envelope data contains only route_id and ledger_exists (no imperative fields)", async () => {
    const result = await runCli(["next", nonExistentLedgerPath(), "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(["ledger_exists", "route_id"]);
  });

  test("next stdout payload contains no imperative verbs (word-boundary regex)", async () => {
    const result = await runCli(["next", nonExistentLedgerPath(), "--json"]);
    expect(result.stdout).not.toMatch(IMPERATIVE_VERB_REGEX);
  });

  test("next on a real ledger still avoids imperative verbs in stdout", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli(["next", ledger, "--json"]);
    expect(result.stdout).not.toMatch(IMPERATIVE_VERB_REGEX);
  });
});

// =====================================================================
// Block 5 - `contract` command × every documented slice
// =====================================================================

describe("Block 5: contract command × every documented slice", () => {
  test("contract_slices is non-empty (sanity)", () => {
    expect(helpContractSlices().length).toBeGreaterThan(0);
  });

  test("every documented contract slice returns success with data.slice, data.values, data.ordering pinned", async () => {
    for (const slice of helpContractSlices()) {
      const result = await runCli(["contract", slice, "--json"]);
      if (!result.envelopeParsed) {
        throw new Error(
          `[slice=${slice}] envelope did not parse. stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`,
        );
      }
      try {
        assertSuccessEnvelopeShape(result.envelope);
        const data = result.envelope.data as Record<string, unknown>;
        expect(data.slice).toBe(slice);
        expect(Array.isArray(data.values)).toBe(true);
        expect((data.values as unknown[]).length).toBeGreaterThan(0);
        // ordering discriminator is documented in
        // HELP_DATA.contract_slice_response_shape and must be `sorted` or
        // `catalog`. Pinning this surfaces a drop or rename of the field.
        expect(["sorted", "catalog"]).toContain(data.ordering as string);
      } catch (err) {
        if (err instanceof Error) {
          err.message = `${err.message} [slice=${slice}]`;
        }
        throw err;
      }
    }
  });

  test("route_required_references returns catalog-ordered route records", async () => {
    const result = await runCli([
      "contract",
      "route_required_references",
      "--json",
    ]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as {
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

  test("ledger schema contract slices return catalog-ordered runtime facts", async () => {
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
      const result = await runCli(["contract", slice, "--json"]);
      assertSuccessEnvelopeShape(result.envelope);
      const data = result.envelope.data as {
        slice: string;
        values: readonly string[];
        ordering: string;
      };
      expect(data.slice).toBe(slice);
      expect(data.ordering).toBe("catalog");
      expect(data.values).toEqual([...expected]);
    }
  });

  test("unknown slice returns unknown-contract-slice error with exit_code 64", async () => {
    const result = await runCli([
      "contract",
      "definitely-not-a-real-slice",
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-contract-slice");
  });
});

// =====================================================================
// Block 5b - `scaffold` command × every documented scaffold
// =====================================================================

describe("Block 5b: scaffold command × every documented scaffold", () => {
  test("scaffold_ids is non-empty (sanity)", () => {
    expect(helpScaffoldIds().length).toBeGreaterThan(0);
  });

  test("every documented scaffold id returns success with metadata and body", async () => {
    for (const scaffoldId of helpScaffoldIds()) {
      const result = await runCli(["scaffold", scaffoldId, "--json"]);
      if (!result.envelopeParsed) {
        throw new Error(
          `[scaffold=${scaffoldId}] envelope did not parse. stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`,
        );
      }
      assertSuccessEnvelopeShape(result.envelope);
      const data = result.envelope.data as Record<string, unknown>;
      expect(data.scaffold_id).toBe(scaffoldId);
      expect(data.output_kind).toBe("yaml");
      expect(data.ordering).toBe("catalog");
      expect(typeof data.source).toBe("string");
      const rendered = renderScaffold(
        scaffoldId as Parameters<typeof renderScaffold>[0],
      );
      expect(data.body).toBe(rendered.body);
      expect(data.marker).toBe(rendered.marker);
    }
  });

  test("unknown scaffold id returns unknown-scaffold-id error with exit_code 64", async () => {
    const result = await runCli([
      "scaffold",
      "definitely-not-a-real-scaffold",
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-scaffold-id");
  });

  test("missing scaffold id returns missing-required-arg error with exit_code 64", async () => {
    const result = await runCli(["scaffold", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    expect(result.exitCode).toBe(64);
    assertErrorEnvelopeShape(result.envelope, "missing-required-arg");
    expect((result.envelope.error as { message: string }).message).toContain(
      "scaffold id",
    );
  });
});

// =====================================================================
// Block 6 - `diagnose` command × ledger states
// =====================================================================

describe("Block 6: diagnose command × ledger states", () => {
  test("diagnose envelope carries the full documented diagnose_response_shape field set", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli(["diagnose", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    // Documented in HELP_DATA.diagnose_response_shape. Sub-object fields
    // use assertPlainObject to reject null and arrays per contract.
    expect(typeof data.inferred_route_id).toBe("string");
    expect(Array.isArray(data.expected_reference_ids)).toBe(true);
    assertPlainObject(data.installed_artifact_presence, "data.installed_artifact_presence");
    assertPlainObject(data.drift, "data.drift");
    expect(typeof data.version_skew).toBe("string");
    expect(Array.isArray(data.blocking_gates)).toBe(true);
    expect(typeof data.ledger_path).toBe("string");
    expect(typeof data.ledger_exists).toBe("boolean");
    // runbook_version / runbook_version_skew documented as nullable
    // ("string or null for the no-ledger case"); nullable-string
    // helper pins null OR string exactly.
    assertNullableString(data.runbook_version, "runbook_version");
    assertNullableString(data.runbook_version_skew, "runbook_version_skew");
  });

  test("diagnose installed_artifact_presence reports all_present: true against the in-repo install", async () => {
    // installedArtifactPresence walks the install-root derived from
    // import.meta.url and ignores the ledger arg. Passing a non-existent
    // ledger isolates the assertion to the install-topology surface.
    const result = await runCli(["diagnose", nonExistentLedgerPath(), "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    const presence = data.installed_artifact_presence as Record<string, unknown>;
    expect(presence.references).toBe(true);
    expect(presence.templates).toBe(true);
    expect(presence.cli_ts).toBe(true);
    expect(presence.lib_dir).toBe(true);
    expect(presence.all_present).toBe(true);
    expect(Array.isArray(presence.missing)).toBe(true);
    expect((presence.missing as unknown[]).length).toBe(0);
  });

  test("diagnose drift carries digest_drift four-axis + findings_table_drift forward-compat slot", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli(["diagnose", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    const drift = data.drift as Record<string, unknown>;
    const digestDrift = drift.digest_drift as Record<string, unknown>;
    expect(typeof digestDrift.acceptance_criteria).toBe("boolean");
    expect(typeof digestDrift.batch_contract).toBe("boolean");
    expect(typeof digestDrift.digests).toBe("boolean");
    expect(typeof digestDrift.any).toBe("boolean");
    // findings_table_drift is null today (forward-compat slot per F037 hoist)
    expect(drift.findings_table_drift).toBeNull();
  });

  test("diagnose on mismatched runbook_version ledger surfaces the stop-required field gate", async () => {
    const ledger = ledgerVersionSkewMismatched();
    const result = await runCli(["diagnose", ledger, "--json"]);
    assertSuccessEnvelopeShape(result.envelope);
    const data = result.envelope.data as Record<string, unknown>;
    expect(data.runbook_version_skew).toBe("mismatched");
    const gates = data.blocking_gates as Array<Record<string, unknown>>;
    expect(
      gates.some(
        (g) => g.kind === "field" && g.field === "frontmatter.runbook_version",
      ),
    ).toBe(true);
  });

  test("diagnose expected_reference_ids match route_required_references for representative routes", async () => {
    const contractRecords = await routeRequiredReferencesFromContract();
    const ledgers = [
      nonExistentLedgerPath(),
      ledgerPendingAc(),
      ledgerConfirmedBatchLoop(),
      ledgerBlockedFrontmatter(),
      ledgerVersionSkewMismatched(),
    ];
    for (const ledger of ledgers) {
      const result = await runCli(["diagnose", ledger, "--json"]);
      assertSuccessEnvelopeShape(result.envelope);
      const data = result.envelope.data as {
        inferred_route_id: string;
        expected_reference_ids: string[];
      };
      expect(data.expected_reference_ids).toEqual(
        requiredReferencesForRouteFromContract(
          contractRecords,
          data.inferred_route_id,
        ),
      );
      expect(data.expected_reference_ids).not.toContain(
        "first-run-gotchas.md",
      );
    }
  });
});

// =====================================================================
// Block 7 - `packet` command × every role × required-flag matrix
// =====================================================================

describe("Block 7: packet command × every role × required-flag matrix", () => {
  test("packet_roles catalog is non-empty (sanity)", () => {
    expect(helpPacketRoles().length).toBeGreaterThan(0);
  });

  test("unknown packet role returns unknown-packet-role error", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli([
      "packet",
      "unknown-role",
      "--ledger",
      ledger,
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-packet-role");
  });

  test("missing role returns missing-required-arg", async () => {
    const result = await runCli(["packet", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "missing-required-arg");
  });

  test("ce-plan role has no required flags and produces a success envelope when given just --json", async () => {
    const flags = helpPacketRoleFlags("ce-plan");
    expect(flags.required.length).toBe(0);
    const result = await runCli(["packet", "ce-plan", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertSuccessEnvelopeShape(result.envelope);
  });

  // Drive the required-flag matrix from HELP_DATA so a new role gains
  // coverage automatically. Only roles WITH required flags are tested
  // here; ce-plan (zero required flags) is covered by the happy-path
  // test above.
  const rolesWithRequiredFlags = (): string[] =>
    helpPacketRoles().filter(
      (r) => helpPacketRoleFlags(r).required.length > 0,
    );

  test("every role with required flags missing each flag returns missing-packet-flag", async () => {
    const roles = rolesWithRequiredFlags();
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      const required = helpPacketRoleFlags(role).required;
      for (const drop of required) {
        const args = ["packet", role];
        for (const flag of required) {
          if (flag === drop) continue;
          args.push(flag);
          if (flag === "--ledger") {
            args.push(ledgerPendingAc());
          } else if (flag === "--attempt-type") {
            args.push("implementation");
          } else if (flag === "--patch-execution-mode") {
            args.push("tdd");
          } else {
            args.push(`smoke-${flag.replace(/^--/, "")}`);
          }
        }
        args.push("--json");
        const result = await runCli(args);
        if (!result.envelopeParsed) {
          throw new Error(
            `[role=${role} drop=${drop}] envelope did not parse. stdout=${result.stdout.slice(0, 200)} stderr=${result.stderr.slice(0, 200)}`,
          );
        }
        assertErrorEnvelopeShape(
          result.envelope,
          "missing-packet-flag",
          `role=${role} drop=${drop}`,
        );
      }
    }
  });
});

// =====================================================================
// Block 8 - Every documented error_code
// =====================================================================

describe("Block 8: Every documented error_code", () => {
  test("error_codes catalog is non-empty (sanity)", () => {
    expect(helpErrorCodes().length).toBeGreaterThan(0);
  });

  test("error_codes catalog membership is exhaustively pinned to the documented set", () => {
    // Catalog-completeness pin. A future addition or removal of an
    // entry in HELP_DATA.error_codes will surface here. The pinned set
    // matches cli.ts ERROR_CODES.
    const codes = helpErrorCodes().map((e) => e.code).sort();
    expect(codes).toEqual(
      [
        "ledger-validation-failed",
        "missing-command",
        "missing-json-flag",
        "missing-packet-flag",
        "missing-required-arg",
        "packet-render-failed",
        "unexpected-error",
        "unknown-command",
        "unknown-contract-slice",
        "unknown-packet-role",
        "unknown-scaffold-id",
      ].sort(),
    );
  });

  test("missing-command: cli.ts with no args", async () => {
    const result = await runCli([]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "missing-command");
  });

  test("missing-json-flag: any command without --json (smoke-link to Block 2)", async () => {
    const result = await runCli(["state", nonExistentLedgerPath()]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "missing-json-flag");
  });

  test("missing-required-arg: state without a ledger path", async () => {
    const result = await runCli(["state", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "missing-required-arg");
  });

  test("unknown-command: cli.ts unknown-cmd --json", async () => {
    const result = await runCli(["unknown-cmd", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-command");
  });

  test("unknown-contract-slice: contract unknown-slice --json (smoke-link to Block 5)", async () => {
    const result = await runCli(["contract", "totally-unknown", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-contract-slice");
  });

  test("unknown-packet-role: packet unknown-role --ledger ... --json (smoke-link to Block 7)", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli([
      "packet",
      "unknown-role",
      "--ledger",
      ledger,
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-packet-role");
  });

  test("unknown-scaffold-id: scaffold unknown-scaffold --json (smoke-link to Block 5b)", async () => {
    const result = await runCli([
      "scaffold",
      "totally-unknown-scaffold",
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "unknown-scaffold-id");
  });

  test("missing-packet-flag: packet builder --ledger ... --json (missing --batch and --attempt-type)", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli([
      "packet",
      "builder",
      "--ledger",
      ledger,
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "missing-packet-flag");
  });

  test("ledger-validation-failed: state on a no-frontmatter ledger triggers the validator deterministically", async () => {
    // ledgerNoFrontmatter() drops the `---` delimiter entirely. The
    // ledger reader's frontmatter parse is contract-stable here: no
    // delimiter = DecomposeError = ledger-validation-failed. Single
    // explicit assertion; no conditional branching.
    const ledger = ledgerNoFrontmatter();
    const result = await runCli(["state", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "ledger-validation-failed");
  });

  test("packet-render-failed: packet builder against a ledger whose batch lookup fails", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli([
      "packet",
      "builder",
      "--ledger",
      ledger,
      "--batch",
      "nonexistent-batch",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    assertErrorEnvelopeShape(result.envelope, "packet-render-failed");
  });

  test("unexpected-error remains documented in HELP_DATA.error_codes even though the process boundary cannot reach it", () => {
    // The unexpected-error code (exit_code 70) is reserved for the
    // top-level catch in cli.ts. From the process boundary, we have no
    // clean way to inject a panic without modifying lib source - which
    // the U10 anti-list forbids. This test pins the catalog entry as
    // documented residual; alignment work belongs in a separate issue
    // if there's a way to provoke it via the published surface.
    const entry = findErrorCodeEntry("unexpected-error");
    expect(entry.exit_code).toBe(70);
    expect(entry.severity).toBe("fatal");
    expect(entry.recoverability).toBe("unrecoverable");
  });
});

// =====================================================================
// Block 9 - Stdout/stderr separation
// =====================================================================

describe("Block 9: Stdout/stderr separation", () => {
  test("stdout contains exactly one envelope (one newline, terminating the JSON object) on success", async () => {
    const result = await runCli(["contract", "route_ids", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    // Count newlines explicitly; the documented contract is
    // "exactly one CliSuccessEnvelope, newline-terminated".
    const newlineCount = (result.stdout.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  test("stdout contains exactly one envelope on error too", async () => {
    const result = await runCli(["unknown-command", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    const newlineCount = (result.stdout.match(/\n/g) ?? []).length;
    expect(newlineCount).toBe(1);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  test("stderr is empty by default for usage errors and successes (no diagnostic emit threshold reached)", async () => {
    // Pinning the documented threshold: by default, `unknown-command`
    // and other usage-error paths short-circuit BEFORE the `command.fail`
    // emit (which is error-rank), so stderr stays empty. This test and
    // the "error-level diagnostics on stderr" test below pin the
    // *opposite* sides of the same MODE_MIN_LEVEL threshold contract;
    // a regression that lowered the default threshold (or raised the
    // unknown-command emit level) would surface here while the
    // diagnostic-on-stderr test below would still pass.
    const success = await runCli(["contract", "route_ids", "--json"]);
    expect(success.stderr).toBe("");
    const unknownCmd = await runCli(["unknown-command", "--json"]);
    expect(unknownCmd.stderr).toBe("");
  });

  test("error-level diagnostics on stderr stay JSON Lines and never contaminate the stdout envelope", async () => {
    // ledger-validation-failed routes through the `command.fail`
    // LogTape emit, so stderr carries an error-level diagnostic by
    // default (rank 3 > MODE_MIN_LEVEL default rank 2). This exercises
    // the documented envelope_streams contract: envelope on stdout,
    // JSON Lines diagnostic on stderr, no cross-contamination.
    const ledger = ledgerNoFrontmatter();
    const result = await runCli(["state", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    // Stdout side: exactly one envelope, no diagnostic content. The
    // "exactly one envelope" pin (newlineCount === 1 + trailing newline)
    // already proves no diagnostic records can fit; we additionally
    // parse stdout's first line and assert no `event` top-level key
    // (a JSON-parse check, not a substring check on the whole stream).
    expect((result.stdout.match(/\n/g) ?? []).length).toBe(1);
    expect(result.stdout.endsWith("\n")).toBe(true);
    const stdoutEnvelope = JSON.parse(result.stdout.trim()) as Record<
      string,
      unknown
    >;
    expect(stdoutEnvelope).not.toHaveProperty("event");
    // Stderr side: one or more JSON Lines records, each parseable as
    // JSON, none of which is an envelope. `event` is OPTIONAL on
    // CliDiagnosticRecord (lib/cli-diagnostics.ts: `event?: string`)
    // so we do not over-pin it; we pin the documented disjoint shape:
    // diagnostic records carry `level`, envelopes carry `status` +
    // `schema_version`.
    const stderrLines = result.stderr
      .split("\n")
      .filter((line) => line.length > 0);
    expect(stderrLines.length).toBeGreaterThan(0);
    for (const line of stderrLines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record).not.toHaveProperty("status");
      expect(record).not.toHaveProperty("schema_version");
      expect(typeof record.level).toBe("string");
    }
  });

  test("--verbose emits info-level diagnostics on stderr while stdout stays a single envelope", async () => {
    // Verbose lowers the diagnostic-emit threshold to info (rank 1).
    // The `command.dispatch` info record is documented at cli.ts:535
    // and now lands on stderr. Pins the documented diagnostic_flags
    // contract.
    const result = await runCli([
      "contract",
      "route_ids",
      "--json",
      "--verbose",
    ]);
    expect(result.envelopeParsed).toBe(true);
    // Stdout side still single envelope, newline-terminated.
    expect((result.stdout.match(/\n/g) ?? []).length).toBe(1);
    expect(result.stdout.endsWith("\n")).toBe(true);
    // Stderr side carries one or more JSON Lines diagnostic records,
    // each obeying the disjoint shape (no envelope fields). `event`
    // is optional per the documented record shape.
    const stderrLines = result.stderr
      .split("\n")
      .filter((line) => line.length > 0);
    expect(stderrLines.length).toBeGreaterThan(0);
    for (const line of stderrLines) {
      const record = JSON.parse(line) as Record<string, unknown>;
      expect(record).not.toHaveProperty("status");
      expect(record).not.toHaveProperty("schema_version");
      expect(typeof record.level).toBe("string");
    }
  });
});

// =====================================================================
// Block 10 - Process exit code alignment (matches envelope exit_code)
// =====================================================================
//
// The U10 seam runbook initially named "process-exit-vs-envelope
// divergence" as the central drift-residual U10 would pin. Writing the
// smoke tests disproved that premise - process exit codes today
// already align with the envelope's documented `exit_code` values
// (success -> 0, usage errors -> 64, validation errors -> 1, unexpected
// errors -> 70). U9's earlier manual-smoke "exit=$?" reading was a
// shell artifact (a piped `head -3` swallowed the real exit code).
//
// Block 10 pins the actual alignment so future drift surfaces here
// loudly. See u10-cli-smoke-matrix-ledger.md finding
// `false-alarm-process-exit-divergence` for the audit trail.

describe("Block 10: Process exit code alignment with envelope exit_code", () => {
  test("success envelope: process exits 0", async () => {
    const result = await runCli(["contract", "route_ids", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.envelope.status).toBe("ok");
  });

  test("usage error envelope (missing-json-flag): process exit matches envelope.error.exit_code (64)", async () => {
    const result = await runCli(["state", nonExistentLedgerPath()]);
    expect(result.envelopeParsed).toBe(true);
    const error = result.envelope.error as Record<string, unknown>;
    expect(error.code).toBe("missing-json-flag");
    expect(error.exit_code).toBe(64);
    expect(result.exitCode).toBe(64);
  });

  test("missing-command error: process exits 64 matching envelope", async () => {
    const result = await runCli([]);
    expect(result.envelopeParsed).toBe(true);
    const error = result.envelope.error as Record<string, unknown>;
    expect(error.exit_code).toBe(64);
    expect(result.exitCode).toBe(64);
  });

  test("unknown-command error: process exits 64 matching envelope", async () => {
    const result = await runCli(["unknown-cmd", "--json"]);
    expect(result.envelopeParsed).toBe(true);
    const error = result.envelope.error as Record<string, unknown>;
    expect(error.exit_code).toBe(64);
    expect(result.exitCode).toBe(64);
  });

  test("packet-render-failed error: process exits 1 matching envelope", async () => {
    const ledger = ledgerPendingAc();
    const result = await runCli([
      "packet",
      "builder",
      "--ledger",
      ledger,
      "--batch",
      "nonexistent-batch",
      "--attempt-type",
      "implementation",
      "--json",
    ]);
    expect(result.envelopeParsed).toBe(true);
    const error = result.envelope.error as Record<string, unknown>;
    expect(error.exit_code).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  test("ledger-validation-failed error: process exits 1 matching envelope", async () => {
    // Pins the second documented validation-error class. Without this,
    // a future drift where the validator returns exit_code 1 in the
    // envelope but the process exits 0 (or vice versa) would not
    // surface from Block 10.
    const ledger = ledgerNoFrontmatter();
    const result = await runCli(["state", ledger, "--json"]);
    expect(result.envelopeParsed).toBe(true);
    const error = result.envelope.error as Record<string, unknown>;
    expect(error.code).toBe("ledger-validation-failed");
    expect(error.exit_code).toBe(1);
    expect(result.exitCode).toBe(1);
  });
});
