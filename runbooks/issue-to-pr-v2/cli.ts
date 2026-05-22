#!/usr/bin/env bun

/**
 * Issue-to-PR v2 CLI front door (U4).
 *
 * Deterministic CLI that emits **facts**, not orchestration. Four
 * JSON-only commands:
 *
 *   cli.ts state <ledger> --json
 *   cli.ts next <ledger> --json
 *   cli.ts contract <slice> --json
 *   cli.ts diagnose <ledger> --json
 *
 * Every command writes exactly one `CliSuccessEnvelope<TData>` or
 * `CliErrorEnvelope` to stdout (newline-terminated). Diagnostics — when
 * `--verbose` or `--debug` is passed — go to stderr as JSON Lines
 * records. The two streams are strictly separated per ADR 0002.
 *
 * The CLI never mutates ledger state, never invokes git mutations, never
 * calls into v1 `runbooks/issue-to-pr/decompose.ts`. It is a read-only
 * fact emitter.
 */

import { argv, exit, stderr, stdout } from "node:process";

import {
  BATCH_STATUSES,
  BUILDER_ATTEMPT_STATUSES,
  CONFIRMATION_STATES,
  EXECUTION_MODES,
  FINAL_VERDICTS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  TERMINAL_BATCH_STATUSES,
} from "./lib/contract";
import {
  AGENT_HINT_ACTIONS,
  type AgentHintAction,
  CLI_ENVELOPE_SCHEMA_VERSION,
  type CliWriter,
  createErrorEnvelope,
  createSuccessEnvelope,
  newRunId,
  RUNTIME_ERROR_RECOVERABILITIES,
  type RuntimeErrorRecoverability,
  RUNTIME_ERROR_SEVERITIES,
  type RuntimeErrorSeverity,
  writeJson,
} from "./lib/cli-envelope";
import {
  CLI_DIAGNOSTIC_LEVELS,
  type CliDiagnosticOptions,
  emitDiagnostic,
  parseDiagnosticArgv,
} from "./lib/cli-diagnostics";
import {
  DecomposeError,
  readLedgerSnapshot,
  withFailMode,
} from "./lib/ledger";
import {
  PacketRenderError,
  renderBuilderPacket,
  renderCePlanPacket,
  renderPatchProposalPacket,
  renderProposerPacket,
  renderValidatorPacket,
} from "./lib/packets";
import {
  blockingGatesFor,
  buildDiagnoseDrift,
  classifyRoute,
  computeDigestDrift,
  installedArtifactPresence,
  ROUTE_IDS,
  requiredReferenceIdsFor,
} from "./lib/route";

const CONTRACT_SLICES = [
  "batch_statuses",
  "builder_attempt_statuses",
  "confirmation_states",
  "execution_modes",
  "final_verdicts",
  "finding_severities",
  "finding_statuses",
  "route_ids",
  "terminal_batch_statuses",
  // F005 fix: agent-discoverable enums from lib/cli-envelope.ts +
  // lib/cli-diagnostics.ts so --help consumers can enumerate every error
  // taxonomy without reading source.
  "agent_hint_actions",
  "runtime_error_severities",
  "runtime_error_recoverabilities",
  "diagnostic_levels",
  "exit_codes",
  // F010 fix: expose packet_roles via the contract subcommand so the
  // packet vocabulary lives alongside the other agent-discoverable
  // enums (route_ids, agent_hint_actions, etc.).
  "packet_roles",
] as const;
type ContractSlice = (typeof CONTRACT_SLICES)[number];

/**
 * F003 fix: every contract slice carries an explicit `ordering`
 * discriminator. `sorted` = alphabetical, set semantics; `catalog` = the
 * source-declared order is contractually significant (precedence walks,
 * stage progression, etc.).
 */
type ContractSliceOrdering = "sorted" | "catalog";

/**
 * F024 fix: `values` accepts a union of primitive and structured entries
 * so slices like `exit_codes` can emit `{ code, meaning }` records
 * symmetric with `HELP_DATA.exit_codes`.
 */
type ContractSliceValueItem =
  | string
  | number
  | { readonly [k: string]: unknown };

type ContractSliceValue = {
  values: readonly ContractSliceValueItem[];
  ordering: ContractSliceOrdering;
};

/**
 * Static exit-code catalog the CLI promises. Bumping a code is a
 * schema_version change.
 */
const EXIT_CODES = [
  { code: 0, meaning: "success" },
  { code: 1, meaning: "ledger validation failed" },
  { code: 64, meaning: "usage error (missing command / flag / argument)" },
  { code: 70, meaning: "unexpected internal error" },
] as const satisfies readonly { code: number; meaning: string }[];

const CONTRACT_SLICE_VALUES: Record<ContractSlice, ContractSliceValue> = {
  batch_statuses: { values: [...BATCH_STATUSES].sort(), ordering: "sorted" },
  builder_attempt_statuses: {
    values: [...BUILDER_ATTEMPT_STATUSES].sort(),
    ordering: "sorted",
  },
  confirmation_states: {
    values: [...CONFIRMATION_STATES].sort(),
    ordering: "sorted",
  },
  execution_modes: { values: [...EXECUTION_MODES].sort(), ordering: "sorted" },
  final_verdicts: { values: [...FINAL_VERDICTS].sort(), ordering: "sorted" },
  finding_severities: {
    values: [...FINDING_SEVERITIES].sort(),
    ordering: "sorted",
  },
  finding_statuses: {
    values: [...FINDING_STATUSES].sort(),
    ordering: "sorted",
  },
  route_ids: { values: [...ROUTE_IDS], ordering: "catalog" },
  terminal_batch_statuses: {
    values: [...TERMINAL_BATCH_STATUSES].sort(),
    ordering: "sorted",
  },
  agent_hint_actions: {
    values: [...AGENT_HINT_ACTIONS],
    ordering: "catalog",
  },
  runtime_error_severities: {
    values: [...RUNTIME_ERROR_SEVERITIES],
    ordering: "catalog",
  },
  runtime_error_recoverabilities: {
    values: [...RUNTIME_ERROR_RECOVERABILITIES],
    ordering: "catalog",
  },
  diagnostic_levels: {
    values: [...CLI_DIAGNOSTIC_LEVELS],
    ordering: "catalog",
  },
  exit_codes: {
    // F024 fix: emit the full {code, meaning} records so the slice
    // surface is symmetric with HELP_DATA.exit_codes — an agent can
    // route off either without shape transformation.
    values: EXIT_CODES.map((e) => ({ code: e.code, meaning: e.meaning })),
    ordering: "catalog",
  },
  packet_roles: {
    values: ["builder", "proposer", "validator", "patch-proposal", "ce-plan"],
    ordering: "catalog",
  },
};

/**
 * Help payload emitted to stdout as a `CliSuccessEnvelope` `data` shape
 * when an agent invokes `--help` / `-h`. The CLI is an agent-to-agent
 * interface — there is no human-readable usage prose. Everything an
 * agent needs to dispatch the right command lives in this JSON object.
 */
/**
 * Static error-code catalog (F005 fix). Every code the dispatcher can
 * emit is listed here so an agent can enumerate failure modes from
 * --help alone, without grepping the source. New codes are additive;
 * removing one is a schema_version bump.
 *
 * F023 fix: the `hint` field is nested as `{ action: AgentHintAction }`
 * to mirror the runtime `error.hint.action` shape verbatim. An agent
 * reading this catalog can copy each entry into a router with no path
 * transformation.
 *
 * F026 fix: every entry carries `severity` and `retryable`, the two
 * fields createErrorEnvelope always emits, so the help catalog is a
 * complete contract reference.
 *
 * F014 fix: type-annotated against the canonical AgentHintAction and
 * RuntimeErrorRecoverability / RuntimeErrorSeverity enums so a future
 * sweep that renames a value forces this catalog to update at compile
 * time. `satisfies` preserves the literal types for HELP_DATA `as
 * const` consumption.
 */
type ErrorCodeEntry = {
  readonly code: string;
  readonly exit_code: number;
  readonly severity: RuntimeErrorSeverity;
  readonly recoverability: RuntimeErrorRecoverability;
  readonly retryable: boolean;
  readonly hint: { readonly action: AgentHintAction };
};

const ERROR_CODES = [
  { code: "missing-command", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "missing-json-flag", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "missing-required-arg", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "unknown-command", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "open_docs" } },
  { code: "unknown-contract-slice", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "unknown-packet-role", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "missing-packet-flag", exit_code: 64, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "change_input" } },
  { code: "packet-render-failed", exit_code: 1, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "repair_state" } },
  { code: "ledger-validation-failed", exit_code: 1, severity: "error", recoverability: "user-action-required", retryable: false, hint: { action: "repair_state" } },
  { code: "unexpected-error", exit_code: 70, severity: "fatal", recoverability: "unrecoverable", retryable: false, hint: { action: "contact_support" } },
] as const satisfies readonly ErrorCodeEntry[];

const HELP_DATA = {
  audience: "agents",
  schema_version: CLI_ENVELOPE_SCHEMA_VERSION,
  message:
    "This CLI is a machine-readable fact emitter. Every command requires --json and writes one CliSuccessEnvelope or CliErrorEnvelope to stdout.",
  commands: [
    {
      name: "state",
      summary:
        "Read the ledger's durable state. Returns confirmation_state, digest_drift, version_skew, route_id, required_reference_ids, and blocking_gates.",
      argv: ["state", "<ledger-path>", "--json"],
    },
    {
      name: "next",
      summary:
        "Return the minimal next route_id as a fact (no imperative instructions).",
      argv: ["next", "<ledger-path>", "--json"],
    },
    {
      name: "contract",
      summary:
        "Emit a runtime contract slice from lib/contract.ts (see `contract_slices`).",
      argv: ["contract", "<slice>", "--json"],
    },
    {
      name: "diagnose",
      summary:
        "Report inferred state, expected references, installed artifact presence, drift, and version skew.",
      argv: ["diagnose", "<ledger-path>", "--json"],
    },
    {
      name: "packet",
      summary:
        "Render a complete role packet (Builder, Proposer, Validator, patch-proposal, ce-plan) from templates + ledger state. Read-only; returns the packet body plus dispatch evidence shape. U6 owns the ledger Notes write.",
      argv: ["packet", "<role>", "--ledger", "<ledger-path>", "--json"],
    },
  ],
  packet_roles: ["builder", "proposer", "validator", "patch-proposal", "ce-plan"],
  packet_flags: {
    "--ledger": "Path to issue-N ledger (required for builder, proposer, validator, patch-proposal).",
    "--batch": "Batch id (builder, validator).",
    "--attempt-type": "implementation | repair (builder).",
    "--target-finding-signature": "Repair target signature (builder repair attempts).",
    "--finding": "Finding id (proposer, patch-proposal).",
    "--persona": "Validator persona skill name (validator).",
    "--commit": "Commit ref or range (validator).",
    "--touched-file": "Repeatable touched-file path (validator).",
    "--patch-id": "patch-NNN candidate id (patch-proposal).",
    "--patch-name": "Title (patch-proposal).",
    "--patch-goal": "Goal sentence (patch-proposal).",
    "--patch-file": "Repeatable patch file (patch-proposal).",
    "--patch-depends-on": "Repeatable terminal batch id (patch-proposal).",
    "--patch-execution-mode": "tdd | proof_first | change_first (patch-proposal).",
    "--patch-acceptance-test": "Repeatable acceptance test (patch-proposal).",
    "--patch-rationale": "Rationale (patch-proposal).",
  },
  // F009 fix: declarative per-role required-flag matrix so an agent
  // can enumerate required vs optional flags without parsing prose.
  packet_role_flags: {
    builder: {
      required: ["--ledger", "--batch", "--attempt-type"],
      optional: ["--target-finding-signature"],
      enum: { "--attempt-type": ["implementation", "repair"] },
    },
    proposer: {
      required: ["--ledger", "--finding"],
      optional: [],
      enum: {},
    },
    validator: {
      required: ["--ledger", "--batch", "--persona", "--commit"],
      optional: [],
      repeatable: ["--touched-file"],
      enum: {},
    },
    "patch-proposal": {
      required: [
        "--ledger",
        "--finding",
        "--patch-id",
        "--patch-name",
        "--patch-goal",
        "--patch-execution-mode",
        "--patch-rationale",
      ],
      optional: [],
      repeatable: ["--patch-file", "--patch-depends-on", "--patch-acceptance-test"],
      enum: {
        "--patch-execution-mode": ["tdd", "proof_first", "change_first"],
      },
    },
    "ce-plan": {
      required: [],
      optional: [],
      enum: {},
    },
  },
  // F008 / F013 fix: declare the success-envelope data shape and the
  // semantics of packet_markdown vs packet so agents do not need to
  // read source to dispatch.
  packet_response_shape: {
    role: "string (one of packet_roles); discriminator for the `packet` union",
    packet:
      "role-discriminated union — see lib/packets.ts BuilderPacketData / ProposerPacketData / ValidatorPacketData / PatchProposalPacketData / CePlanPacketData",
    packet_markdown:
      "Deterministically rendered from packet data; suitable for direct dispatch to a role agent prompt. `packet` is the canonical machine-readable form.",
    dispatch_evidence:
      "{ timestamp: ISO-8601, role: PacketRole, target_id: string, loaded_references: string[], loaded_templates: string[], cli_route_id: string }; defined in U5, persisted by U6.",
  },
  contract_slices: CONTRACT_SLICES,
  // F025 fix: document the `ordering` discriminator on contract
  // responses so agents can route without invoking the command first.
  contract_slice_response_shape: {
    slice: "string (one of contract_slices)",
    values: "array of primitives or {code, meaning}-style records",
    ordering: {
      sorted: "alphabetical; set semantics; order is not contractual",
      catalog: "source-declared order is contractually significant (precedence, stage progression, severity escalation)",
    },
  },
  error_codes: ERROR_CODES,
  exit_codes: EXIT_CODES,
  agent_hint_actions: AGENT_HINT_ACTIONS,
  runtime_error_severities: RUNTIME_ERROR_SEVERITIES,
  runtime_error_recoverabilities: RUNTIME_ERROR_RECOVERABILITIES,
  diagnostic_levels: CLI_DIAGNOSTIC_LEVELS,
  diagnostic_flags: {
    quiet:
      "Suppress every stderr diagnostic record. stdout envelope still emitted.",
    verbose: "Emit info / warning / error diagnostics on stderr as JSON Lines.",
    debug: "Emit every diagnostic level on stderr as JSON Lines.",
  },
  envelope_streams: {
    stdout: "Exactly one CliSuccessEnvelope or CliErrorEnvelope, newline-terminated.",
    stderr:
      "Zero-or-more JSON Lines diagnostic records when --verbose or --debug is passed.",
  },
} as const;

export type RunOptions = {
  stdoutWriter: CliWriter;
  stderrWriter: CliWriter;
  argv: readonly string[];
};

export type RunResult = {
  exit_code: number;
};

/**
 * Dispatch a single CLI invocation. Exported for in-process testing —
 * the top-level script tail at the bottom of this file calls run() with
 * `process.argv` and exits with the returned code.
 */
export function run(options: RunOptions): RunResult {
  const runId = newRunId();
  const startedAtMs = Date.now();

  // Strip verbosity flags so command-specific parsing below works.
  const parsed = parseDiagnosticArgv(options.argv);
  const diagnosticOptions = {
    mode: parsed.mode,
    runId,
    startedAtMs,
  };

  const remaining = [...parsed.argv];
  const command = remaining[0];

  if (command === "--help" || command === "-h") {
    writeJson(
      options.stdoutWriter,
      createSuccessEnvelope({
        runId,
        startedAtMs,
        data: HELP_DATA,
      }),
    );
    return { exit_code: 0 };
  }

  if (!command) {
    writeJson(
      options.stdoutWriter,
      createErrorEnvelope({
        runId,
        startedAtMs,
        code: "missing-command",
        message:
          "no command provided; this CLI is agent-only and requires one of state | next | contract | diagnose with --json",
        exitCode: 64,
        hint: {
          summary:
            "Invoke cli.ts --help --json (or read the source) for the command catalog. Every command requires --json.",
          action: "change_input",
        },
      }),
    );
    return { exit_code: 64 };
  }

  // `--json` is required on every machine-consumed command.
  const jsonIndex = remaining.indexOf("--json");
  if (jsonIndex === -1) {
    writeJson(
      options.stdoutWriter,
      createErrorEnvelope({
        runId,
        startedAtMs,
        code: "missing-json-flag",
        message: `command "${command}" requires --json`,
        exitCode: 64,
        recoverability: "user-action-required",
        hint: {
          summary: "Add --json to the command. Every v2 CLI command emits machine-readable JSON envelopes only.",
          action: "change_input",
        },
      }),
    );
    return { exit_code: 64 };
  }
  remaining.splice(jsonIndex, 1);

  emitDiagnostic(options.stderrWriter, diagnosticOptions, {
    level: "info",
    category: `cli.${command}`,
    message: `command dispatched`,
    event: "command.dispatch",
    attributes: { command, argv: remaining.slice(1) },
  });

  switch (command) {
    case "state":
      return runStateCommand({
        ...options,
        runId,
        startedAtMs,
        args: remaining.slice(1),
        diagnosticOptions,
      });
    case "next":
      return runNextCommand({
        ...options,
        runId,
        startedAtMs,
        args: remaining.slice(1),
        diagnosticOptions,
      });
    case "contract":
      return runContractCommand({
        ...options,
        runId,
        startedAtMs,
        args: remaining.slice(1),
        diagnosticOptions,
      });
    case "diagnose":
      return runDiagnoseCommand({
        ...options,
        runId,
        startedAtMs,
        args: remaining.slice(1),
        diagnosticOptions,
      });
    case "packet":
      return runPacketCommand({
        ...options,
        runId,
        startedAtMs,
        args: remaining.slice(1),
        diagnosticOptions,
      });
    default:
      writeJson(
        options.stdoutWriter,
        createErrorEnvelope({
          runId,
          startedAtMs,
          code: "unknown-command",
          message: `unknown command "${command}"`,
          exitCode: 64,
          hint: {
            summary:
              "Invoke cli.ts --help --json for the supported command list.",
            action: "open_docs",
          },
        }),
      );
      return { exit_code: 64 };
  }
}

type CommandContext = RunOptions & {
  runId: string;
  startedAtMs: number;
  args: string[];
  diagnosticOptions: CliDiagnosticOptions;
};

function expectOneArg(
  ctx: CommandContext,
  commandName: string,
  argLabel: string,
): string | null {
  if (ctx.args.length !== 1 || !ctx.args[0]) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "missing-required-arg",
        message: `${commandName} requires exactly one ${argLabel}`,
        exitCode: 64,
        hint: {
          summary: `Pass the ${argLabel} as the single positional argument.`,
          action: "change_input",
        },
      }),
    );
    return null;
  }
  return ctx.args[0];
}

function runStateCommand(ctx: CommandContext): RunResult {
  const ledgerPath = expectOneArg(ctx, "state", "ledger path");
  if (ledgerPath === null) return { exit_code: 64 };

  try {
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    const route = classifyRoute({
      ledger_exists: snapshot.ledger_exists,
      acceptance_criteria: snapshot.confirmation_state.acceptance_criteria,
      batch_contract: snapshot.confirmation_state.batch_contract,
      digests: snapshot.confirmation_state.digests,
      plan_path: snapshot.plan_path,
      has_batches: snapshot.has_batches,
      all_batches_terminal: snapshot.all_batches_terminal,
      final_reviewed_at: snapshot.final_reviewed_at,
      pr_url: snapshot.pr_url,
      frontmatter_status: snapshot.frontmatter_status,
      runbook_version_skew: snapshot.runbook_version_skew,
    });

    writeJson(
      ctx.stdoutWriter,
      createSuccessEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        data: {
          ledger_path: snapshot.ledger_path,
          ledger_exists: snapshot.ledger_exists,
          confirmation_state: snapshot.confirmation_state,
          digest_drift: computeDigestDrift(snapshot.confirmation_state),
          version_skew: snapshot.runbook_version_skew ?? "matched",
          route_id: route,
          required_reference_ids: requiredReferenceIdsFor(route),
          blocking_gates: blockingGatesFor({
            route,
            confirmation_state: snapshot.confirmation_state,
            frontmatter_status: snapshot.frontmatter_status,
          }),
          plan_path: snapshot.plan_path,
          has_batches: snapshot.has_batches,
          all_batches_terminal: snapshot.all_batches_terminal,
          final_reviewed_at: snapshot.final_reviewed_at,
          pr_url: snapshot.pr_url,
          frontmatter_status: snapshot.frontmatter_status,
        },
      }),
    );
    return { exit_code: 0 };
  } catch (error) {
    return emitErrorFromException(ctx, "state", error);
  }
}

function runNextCommand(ctx: CommandContext): RunResult {
  const ledgerPath = expectOneArg(ctx, "next", "ledger path");
  if (ledgerPath === null) return { exit_code: 64 };

  try {
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    const route = classifyRoute({
      ledger_exists: snapshot.ledger_exists,
      acceptance_criteria: snapshot.confirmation_state.acceptance_criteria,
      batch_contract: snapshot.confirmation_state.batch_contract,
      digests: snapshot.confirmation_state.digests,
      plan_path: snapshot.plan_path,
      has_batches: snapshot.has_batches,
      all_batches_terminal: snapshot.all_batches_terminal,
      final_reviewed_at: snapshot.final_reviewed_at,
      pr_url: snapshot.pr_url,
      frontmatter_status: snapshot.frontmatter_status,
      runbook_version_skew: snapshot.runbook_version_skew,
    });

    writeJson(
      ctx.stdoutWriter,
      createSuccessEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        data: {
          route_id: route,
          // No imperative instructions. The hot router decides action;
          // this CLI only reports facts.
          ledger_exists: snapshot.ledger_exists,
        },
      }),
    );
    return { exit_code: 0 };
  } catch (error) {
    return emitErrorFromException(ctx, "next", error);
  }
}

function runContractCommand(ctx: CommandContext): RunResult {
  const slice = expectOneArg(ctx, "contract", "contract slice name");
  if (slice === null) return { exit_code: 64 };

  if (!isContractSlice(slice)) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "unknown-contract-slice",
        message: `unknown contract slice "${slice}"; allowed: ${CONTRACT_SLICES.join(", ")}`,
        exitCode: 64,
        hint: {
          summary: "Pass one of the catalogued slice names.",
          action: "change_input",
        },
      }),
    );
    return { exit_code: 64 };
  }

  const sliceValue = CONTRACT_SLICE_VALUES[slice];
  writeJson(
    ctx.stdoutWriter,
    createSuccessEnvelope({
      runId: ctx.runId,
      startedAtMs: ctx.startedAtMs,
      data: {
        slice,
        values: sliceValue.values,
        ordering: sliceValue.ordering,
      },
    }),
  );
  return { exit_code: 0 };
}

function runDiagnoseCommand(ctx: CommandContext): RunResult {
  const ledgerPath = expectOneArg(ctx, "diagnose", "ledger path");
  if (ledgerPath === null) return { exit_code: 64 };

  try {
    const snapshot = withFailMode("throw", () => readLedgerSnapshot(ledgerPath));
    const route = classifyRoute({
      ledger_exists: snapshot.ledger_exists,
      acceptance_criteria: snapshot.confirmation_state.acceptance_criteria,
      batch_contract: snapshot.confirmation_state.batch_contract,
      digests: snapshot.confirmation_state.digests,
      plan_path: snapshot.plan_path,
      has_batches: snapshot.has_batches,
      all_batches_terminal: snapshot.all_batches_terminal,
      final_reviewed_at: snapshot.final_reviewed_at,
      pr_url: snapshot.pr_url,
      frontmatter_status: snapshot.frontmatter_status,
      runbook_version_skew: snapshot.runbook_version_skew,
    });

    writeJson(
      ctx.stdoutWriter,
      createSuccessEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        data: {
          ledger_path: snapshot.ledger_path,
          ledger_exists: snapshot.ledger_exists,
          inferred_route_id: route,
          expected_reference_ids: requiredReferenceIdsFor(route),
          installed_artifact_presence: installedArtifactPresence(),
          drift: buildDiagnoseDrift(snapshot),
          version_skew: snapshot.runbook_version_skew ?? "matched",
        },
      }),
    );
    return { exit_code: 0 };
  } catch (error) {
    return emitErrorFromException(ctx, "diagnose", error);
  }
}

const PACKET_ROLES = [
  "builder",
  "proposer",
  "validator",
  "patch-proposal",
  "ce-plan",
] as const;
type PacketRoleArg = (typeof PACKET_ROLES)[number];

/**
 * `packet <role>` dispatcher. Stays thin per R3 / U4 F020: argv parsing
 * and envelope wrapping live here; all rendering logic lives in
 * `lib/packets.ts`. Each role-specific renderer returns a typed payload
 * that we forward as the success envelope `data`, plus dispatch evidence
 * the orchestrator can journal (U6 owns the write).
 */
function runPacketCommand(ctx: CommandContext): RunResult {
  const role = ctx.args[0];
  if (!role) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "missing-required-arg",
        message: `packet requires exactly one role`,
        exitCode: 64,
        hint: {
          summary: `Pass one of: ${PACKET_ROLES.join(", ")}.`,
          action: "change_input",
        },
      }),
    );
    return { exit_code: 64 };
  }
  if (!isPacketRole(role)) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "unknown-packet-role",
        message: `unknown packet role "${role}"; allowed: ${PACKET_ROLES.join(", ")}`,
        exitCode: 64,
        hint: {
          summary: "Pass one of the catalogued packet roles.",
          action: "change_input",
        },
      }),
    );
    return { exit_code: 64 };
  }

  const flags = parsePacketFlags(ctx.args.slice(1));

  try {
    const packet = dispatchPacketRender(role, flags);
    writeJson(
      ctx.stdoutWriter,
      createSuccessEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        data: {
          role: packet.role,
          packet: packet.data,
          packet_markdown: packet.packet_markdown,
          dispatch_evidence: packet.dispatch_evidence,
        },
      }),
    );
    return { exit_code: 0 };
  } catch (error) {
    return emitPacketError(ctx, role, error);
  }
}

type PacketFlags = {
  ledger?: string;
  batch?: string;
  attemptType?: string;
  targetFindingSignature?: string;
  finding?: string;
  persona?: string;
  commit?: string;
  touchedFiles: string[];
  patchId?: string;
  patchName?: string;
  patchGoal?: string;
  patchFiles: string[];
  patchDependsOn: string[];
  patchExecutionMode?: string;
  patchAcceptanceTests: string[];
  patchRationale?: string;
};

function parsePacketFlags(args: readonly string[]): PacketFlags {
  const flags: PacketFlags = {
    touchedFiles: [],
    patchFiles: [],
    patchDependsOn: [],
    patchAcceptanceTests: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    switch (arg) {
      case "--ledger": flags.ledger = value; i++; break;
      case "--batch": flags.batch = value; i++; break;
      case "--attempt-type": flags.attemptType = value; i++; break;
      case "--target-finding-signature":
        flags.targetFindingSignature = value; i++; break;
      case "--finding": flags.finding = value; i++; break;
      case "--persona": flags.persona = value; i++; break;
      case "--commit": flags.commit = value; i++; break;
      case "--touched-file":
        if (value) flags.touchedFiles.push(value);
        i++;
        break;
      case "--patch-id": flags.patchId = value; i++; break;
      case "--patch-name": flags.patchName = value; i++; break;
      case "--patch-goal": flags.patchGoal = value; i++; break;
      case "--patch-file":
        if (value) flags.patchFiles.push(value);
        i++;
        break;
      case "--patch-depends-on":
        if (value) flags.patchDependsOn.push(value);
        i++;
        break;
      case "--patch-execution-mode":
        flags.patchExecutionMode = value; i++; break;
      case "--patch-acceptance-test":
        if (value) flags.patchAcceptanceTests.push(value);
        i++;
        break;
      case "--patch-rationale": flags.patchRationale = value; i++; break;
      default:
        // Unknown flags fall through; missing required flags are caught
        // by dispatchPacketRender with structured errors.
        break;
    }
  }
  return flags;
}

function dispatchPacketRender(role: PacketRoleArg, flags: PacketFlags) {
  switch (role) {
    case "builder": {
      requireFlag(flags.ledger, "builder", "--ledger");
      requireFlag(flags.batch, "builder", "--batch");
      requireFlag(flags.attemptType, "builder", "--attempt-type");
      const attemptType = flags.attemptType as "implementation" | "repair";
      if (attemptType !== "implementation" && attemptType !== "repair") {
        throw new PacketFlagError(
          `--attempt-type must be "implementation" or "repair"`,
        );
      }
      return renderBuilderPacket({
        ledgerPath: flags.ledger ?? "",
        batchId: flags.batch ?? "",
        attemptType,
        targetFindingSignature: flags.targetFindingSignature ?? null,
      });
    }
    case "proposer": {
      requireFlag(flags.ledger, "proposer", "--ledger");
      requireFlag(flags.finding, "proposer", "--finding");
      return renderProposerPacket({
        ledgerPath: flags.ledger ?? "",
        findingId: flags.finding ?? "",
      });
    }
    case "validator": {
      requireFlag(flags.ledger, "validator", "--ledger");
      requireFlag(flags.batch, "validator", "--batch");
      requireFlag(flags.persona, "validator", "--persona");
      requireFlag(flags.commit, "validator", "--commit");
      return renderValidatorPacket({
        ledgerPath: flags.ledger ?? "",
        batchId: flags.batch ?? "",
        persona: flags.persona ?? "",
        commitRefOrRange: flags.commit ?? "",
        touchedFiles: flags.touchedFiles,
      });
    }
    case "patch-proposal": {
      requireFlag(flags.ledger, "patch-proposal", "--ledger");
      requireFlag(flags.finding, "patch-proposal", "--finding");
      requireFlag(flags.patchId, "patch-proposal", "--patch-id");
      requireFlag(flags.patchName, "patch-proposal", "--patch-name");
      requireFlag(flags.patchGoal, "patch-proposal", "--patch-goal");
      requireFlag(
        flags.patchExecutionMode,
        "patch-proposal",
        "--patch-execution-mode",
      );
      requireFlag(flags.patchRationale, "patch-proposal", "--patch-rationale");
      return renderPatchProposalPacket({
        ledgerPath: flags.ledger ?? "",
        findingId: flags.finding ?? "",
        candidatePatchBatch: {
          id: flags.patchId ?? "",
          name: flags.patchName ?? "",
          goal: flags.patchGoal ?? "",
          files: flags.patchFiles,
          depends_on: flags.patchDependsOn,
          execution_mode: flags.patchExecutionMode ?? "",
          acceptance_tests: flags.patchAcceptanceTests,
          rationale: flags.patchRationale ?? "",
        },
      });
    }
    case "ce-plan":
      return renderCePlanPacket({});
    default: {
      // Type narrowing exhaustiveness check.
      const _exhaustive: never = role;
      throw new PacketFlagError(`unhandled packet role: ${String(_exhaustive)}`);
    }
  }
}

class PacketFlagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacketFlagError";
  }
}

function requireFlag(
  value: string | undefined,
  role: string,
  flag: string,
): void {
  if (!value) {
    throw new PacketFlagError(`packet ${role} requires ${flag}`);
  }
}

function emitPacketError(
  ctx: CommandContext,
  role: string,
  error: unknown,
): RunResult {
  if (error instanceof PacketFlagError) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "missing-packet-flag",
        message: error.message,
        exitCode: 64,
        hint: {
          summary: "Pass the missing flag with a non-empty value.",
          action: "change_input",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.packet.${role}`,
      message: error.message,
      event: "command.fail",
      attributes: { reason: "PacketFlagError" },
    });
    return { exit_code: 64 };
  }
  if (error instanceof PacketRenderError) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "packet-render-failed",
        message: error.message,
        severity: "error",
        recoverability: "user-action-required",
        retryable: false,
        hint: {
          summary: "Repair the input or ledger to satisfy the packet contract.",
          action: "repair_state",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.packet.${role}`,
      message: error.message,
      event: "command.fail",
      attributes: { reason: "PacketRenderError", code: error.code },
    });
    return { exit_code: 1 };
  }
  if (error instanceof DecomposeError) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "ledger-validation-failed",
        message: error.message,
        severity: "error",
        recoverability: "user-action-required",
        retryable: false,
        hint: {
          summary: "Repair the ledger to satisfy the violated invariant.",
          action: "repair_state",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.packet.${role}`,
      message: error.message,
      event: "command.fail",
      attributes: { reason: "DecomposeError" },
    });
    return { exit_code: 1 };
  }
  if (error instanceof Error) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "unexpected-error",
        message: error.message,
        exitCode: 70,
        severity: "fatal",
        recoverability: "unrecoverable",
        hint: {
          summary:
            "Unexpected internal error. Capture run_id and report to the runbook maintainer.",
          action: "contact_support",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.packet.${role}`,
      message: error.message,
      event: "command.fail.unexpected",
      attributes: { error_name: error.name },
    });
    return { exit_code: 70 };
  }
  throw error;
}

function isPacketRole(value: string): value is PacketRoleArg {
  return (PACKET_ROLES as readonly string[]).includes(value);
}

function emitErrorFromException(
  ctx: CommandContext,
  command: string,
  error: unknown,
): RunResult {
  if (error instanceof DecomposeError) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "ledger-validation-failed",
        message: error.message,
        severity: "error",
        recoverability: "user-action-required",
        retryable: false,
        hint: {
          summary: "Repair the ledger to satisfy the violated invariant.",
          action: "repair_state",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.${command}`,
      message: error.message,
      event: "command.fail",
      attributes: { reason: "DecomposeError" },
    });
    return { exit_code: 1 };
  }
  // Unknown error path: surface via envelope + diagnostic, exit 70.
  if (error instanceof Error) {
    writeJson(
      ctx.stdoutWriter,
      createErrorEnvelope({
        runId: ctx.runId,
        startedAtMs: ctx.startedAtMs,
        code: "unexpected-error",
        message: error.message,
        exitCode: 70,
        severity: "fatal",
        recoverability: "unrecoverable",
        hint: {
          summary:
            "Unexpected internal error. Capture run_id and report to the runbook maintainer.",
          action: "contact_support",
        },
      }),
    );
    emitDiagnostic(ctx.stderrWriter, ctx.diagnosticOptions, {
      level: "error",
      category: `cli.${command}`,
      message: error.message,
      event: "command.fail.unexpected",
      attributes: { error_name: error.name },
    });
    return { exit_code: 70 };
  }
  throw error;
}

function isContractSlice(value: string): value is ContractSlice {
  return (CONTRACT_SLICES as readonly string[]).includes(value);
}

// Top-level script entrypoint. Only runs when the file is executed
// directly (Bun's import.meta.main is true for the entry script).
if (import.meta.main) {
  const result = run({
    stdoutWriter: stdout,
    stderrWriter: stderr,
    argv: argv.slice(2),
  });
  exit(result.exit_code);
}
