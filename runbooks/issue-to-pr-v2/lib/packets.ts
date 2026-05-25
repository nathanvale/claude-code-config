/**
 * V2 packet rendering seam (U5).
 *
 * Renders complete role packets (Builder, Proposer, Validator,
 * patch-proposal, ce-plan) deterministically from the U2 templates plus
 * durable ledger state. The CLI invokes these renderers via the additive
 * `packet <role>` subcommands; prose decides *when* to invoke (that wiring
 * is U7).
 *
 * Central invariant: **no context leaks**. Every packet has a documented
 * MUST-include allow-list and a MUST-NOT-leak deny-list. Tests assert both
 * directions. The renderers here scope inputs to the target id only and
 * strip Builder fix prose from Validator inputs before render.
 *
 * Read-only by construction: this module reads ledger and template files
 * and returns rendered payloads. It never writes to disk, mutates ledger
 * state, or calls git. The dispatch evidence shape is *returned* — U6
 * owns the ledger Notes write.
 *
 * Uses only the existing U3 typed exports (`readLedgerSnapshot`,
 * `readLedgerBatchContext`, `parse`, `withFailMode`, `DecomposeError`)
 * plus the U4 envelope helpers via the CLI dispatch layer. Per R10
 * (preserve U3/U4 split), no new exports are added to U3 modules.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  type Batch,
  BUILDER_ATTEMPT_KEYS,
  EXECUTION_MODES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  STAGE_3_BATCH_ID,
} from "./contract";
import {
  type LedgerBatchContext,
  readLedgerBatchContext,
  readLedgerSnapshot,
  withFailMode,
} from "./ledger";

// ----- shared types -----------------------------------------------------

export type PacketRole =
  | "builder"
  | "proposer"
  | "validator"
  | "patch-proposal"
  | "ce-plan";

/**
 * Dispatch evidence returned with every packet. **Defined here** so the
 * shape is stable; **not persisted here** — U6 owns the ledger Notes
 * write. The CLI surfaces this on the packet envelope so callers can
 * later journal it without re-deriving.
 */
export type DispatchEvidence = {
  timestamp: string;
  role: PacketRole;
  target_id: string;
  loaded_references: string[];
  loaded_templates: string[];
  cli_route_id: string;
};

/**
 * Compact prior Builder-attempt record carried into the Builder packet.
 * Mirrors the ledger `builder_attempts` row shape minus rich evidence
 * that must not flow back to the next attempt (see deny-list).
 */
export type CompactBuilderAttempt = {
  attempt_type: string;
  status: string;
  commit_sha: string | null;
  files_touched: string[];
  route_hint: string | null;
  blockers: string[];
  probe_results: string[];
  notes: string;
};

export type FindingRow = {
  id: string;
  batch_id: string;
  signature: string;
  persona: string;
  severity: string;
  status: string;
  summary: string;
  resolution: string | null;
};

// ----- packet shapes ---------------------------------------------------

export type BuilderPacketData = {
  issue_number: number;
  target_repo: string;
  attempt_type: "implementation" | "repair";
  target_finding_signature: string | null;
  batch_contract: Batch;
  iteration: number;
  builder_commits: string[];
  prior_builder_attempts: CompactBuilderAttempt[];
  findings_data_for_this_batch: FindingRow[];
  notes_summary_for_this_batch: string;
  local_law_read_order: string;
  authority_boundary: string;
  preflight_checklist: string;
  allowed_probes: string;
  output_contract: string;
};

export type BuilderPacket = {
  role: "builder";
  data: BuilderPacketData;
  packet_markdown: string;
  dispatch_evidence: DispatchEvidence;
};

export type ProposerBatchSummary = {
  id: string;
  files: string[];
  status: "converged" | "accepted-risk";
};

export type ProposerPacketData = {
  issue_number: number;
  target_repo: string;
  final_finding_row: {
    id: string;
    signature: string;
    persona: string;
    severity: "P0" | "P1";
    summary: string;
    evidence: string;
  };
  confirmed_batch_summaries: ProposerBatchSummary[];
  confirmation_state_snapshot: {
    acceptance_criteria: string;
    batch_contract: string;
    digests: string;
  };
  local_law_read_order: string;
  patch_proposal_helper_contract: string;
  scratch_proposal_schema: string;
};

export type ProposerPacket = {
  role: "proposer";
  data: ProposerPacketData;
  packet_markdown: string;
  dispatch_evidence: DispatchEvidence;
};

export type BuilderEvidence = {
  implementation_steps: string[];
  existing_seams_used: string[];
  tests_run: string[];
  assumptions: string[];
  risks: string[];
  deferred: string[];
  suggested_validator_focus: string[];
};

export type ValidatorPacketData = {
  persona: string;
  commit_ref_or_range: string;
  touched_files: string[];
  batch_id: string;
  batch_goal: string;
  batch_files: string[];
  execution_mode: string;
  acceptance_tests: string[];
  ac_mapping: number[];
  relevant_ledger_findings: FindingRow[];
  builder_evidence: BuilderEvidence;
  orchestrator_transient_focus: string[];
};

export type ValidatorPacket = {
  role: "validator";
  data: ValidatorPacketData;
  packet_markdown: string;
  dispatch_evidence: DispatchEvidence;
};

export type PatchProposalPacketData = {
  final_finding: {
    id: string;
    signature: string;
    persona: string;
    severity: "P0" | "P1";
    summary: string;
  };
  patch_batches: [
    {
      id: string;
      name: string;
      goal: string;
      files: string[];
      depends_on: string[];
      execution_mode: string;
      acceptance_tests: string[];
      ac_mapping: [];
      rationale: string;
    },
  ];
};

export type PatchProposalPacket = {
  role: "patch-proposal";
  data: PatchProposalPacketData;
  packet_markdown: string;
  dispatch_evidence: DispatchEvidence;
};

export type CePlanPacketData = {
  addendum_body: string;
};

export type CePlanPacket = {
  role: "ce-plan";
  data: CePlanPacketData;
  packet_markdown: string;
  dispatch_evidence: DispatchEvidence;
};

// ----- error type ------------------------------------------------------

/**
 * Raised by the packet renderers when an input is missing, the target id
 * does not exist, or a packet contract cannot be satisfied. The CLI
 * converts this into a `packet-render-failed` error envelope.
 */
export class PacketRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PacketRenderError";
    this.code = code;
  }
}

// ----- builder packet --------------------------------------------------

export type BuilderRenderInput = {
  ledgerPath: string;
  batchId: string;
  attemptType: "implementation" | "repair";
  targetFindingSignature?: string | null;
  issueNumber?: number;
  targetRepo?: string;
  /**
   * Optional Orchestrator-provided transient focus passed only as
   * suggested context. Never persisted as Orchestrator-authored findings.
   */
  orchestratorTransientFocus?: string[];
  /**
   * Frozen wall-clock for deterministic tests. Defaults to current time
   * in production; tests pass a fixed instant.
   */
  now?: Date;
};

export function renderBuilderPacket(input: BuilderRenderInput): BuilderPacket {
  if (input.attemptType === "repair" && !input.targetFindingSignature) {
    throw new PacketRenderError(
      "missing-target-finding-signature",
      "builder packet repair attempt requires target_finding_signature",
    );
  }
  if (input.attemptType === "implementation" && input.targetFindingSignature) {
    throw new PacketRenderError(
      "unexpected-target-finding-signature",
      "builder packet implementation attempt must use target_finding_signature: null",
    );
  }
  // F006 fix: the Builder renderer derives its batch contract directly
  // from the ledger ## Batches block via parseLedgerBatchRows below; the
  // strict readLedgerBatchContext validator (which shells to git for
  // every terminal-success builder commit) is not needed on this path
  // and would only add latency without changing the rendered output.
  //
  // F032 note: confirmation_state gating is the Orchestrator's
  // responsibility. The Orchestrator must invoke
  // `cli.ts state <ledger> --json` before dispatching a Builder packet
  // and refuse to render when batch_contract is not "confirmed". The
  // renderer is intentionally permissive — a stage-3 or stage-1 caller
  // may legitimately render against a pending state for diagnostic
  // purposes.
  const ledgerSrc = readLedgerSource(input.ledgerPath);
  const { batch, row } = lookupLedgerBatch(ledgerSrc, input.batchId);
  const iterationRaw = String(row.iterations ?? "0").trim();
  const iteration = Number.parseInt(iterationRaw, 10);
  if (!Number.isFinite(iteration) || iteration < 0) {
    throw new PacketRenderError(
      "invalid-iterations",
      `ledger batch ${input.batchId} has invalid iterations "${iterationRaw}"`,
    );
  }
  // F035 fix: route builder_commits through the same guarded helper
  // F004 introduced for the other batch arrays. Missing key now
  // produces a typed PacketRenderError("malformed-ledger-row") with
  // exit 1, not a raw TypeError surfaced as exit 70.
  const builderCommits = requireRowArray(row, "builder_commits", input.batchId).map(
    (c) => c.trim(),
  );
  const priorAttempts = compactPriorAttempts(row.builder_attempts, input.batchId);
  const allFindings = parseFindingsTableRowsFromSource(
    ledgerSrc,
    input.ledgerPath,
  );
  const findingsForBatch = selectBuilderPacketFindings({
    allFindings,
    batchId: input.batchId,
    attemptType: input.attemptType,
    targetFindingSignature: input.targetFindingSignature ?? null,
  });
  const notesForBatch = extractNotesForBatch(ledgerSrc, input.batchId);

  const issueNumber = input.issueNumber ?? readFrontmatterIssueNumber(ledgerSrc);
  const targetRepo =
    input.targetRepo ?? readFrontmatterScalar(ledgerSrc, "target_repo") ?? "";

  const localLaw = BUILDER_LOCAL_LAW_TEXT;
  const authorityBoundary = BUILDER_AUTHORITY_BOUNDARY_TEXT;
  const preflight = BUILDER_PREFLIGHT_TEXT;
  const allowedProbes = BUILDER_PROBE_TEXT;
  const outputContract = BUILDER_OUTPUT_CONTRACT_TEXT;

  const data: BuilderPacketData = {
    issue_number: issueNumber,
    target_repo: targetRepo,
    attempt_type: input.attemptType,
    target_finding_signature: input.targetFindingSignature ?? null,
    batch_contract: batch,
    iteration,
    builder_commits: builderCommits,
    prior_builder_attempts: priorAttempts,
    findings_data_for_this_batch: findingsForBatch,
    notes_summary_for_this_batch: notesForBatch,
    local_law_read_order: localLaw,
    authority_boundary: authorityBoundary,
    preflight_checklist: preflight,
    allowed_probes: allowedProbes,
    output_contract: outputContract,
  };

  return {
    role: "builder",
    data,
    packet_markdown: renderBuilderMarkdown(data),
    dispatch_evidence: makeDispatchEvidence({
      role: "builder",
      targetId: input.batchId,
      loadedReferences: [
        "references/builder-dispatch.md",
        "references/host-adapters.md",
        "references/stage-4-batch-loop.md",
      ],
      loadedTemplates: ["templates/builder-work-packet.md"],
      cliRouteId: "packet.builder",
      now: input.now,
    }),
  };
}

// ----- proposer packet -------------------------------------------------

export type ProposerRenderInput = {
  ledgerPath: string;
  findingId: string;
  issueNumber?: number;
  targetRepo?: string;
  now?: Date;
};

export function renderProposerPacket(
  input: ProposerRenderInput,
): ProposerPacket {
  const ledgerSrc = readLedgerSource(input.ledgerPath);
  const snapshot = withFailMode("throw", () =>
    readLedgerSnapshot(input.ledgerPath),
  );

  const allFindings = parseFindingsTableRowsFromSource(
    ledgerSrc,
    input.ledgerPath,
  );
  const finding = allFindings.find((f) => f.id === input.findingId);
  if (!finding) {
    throw new PacketRenderError(
      "unknown-finding",
      `proposer packet: finding "${input.findingId}" not found in ## Findings`,
    );
  }
  if (finding.batch_id !== "final") {
    throw new PacketRenderError(
      "non-final-finding",
      `proposer packet: finding "${input.findingId}" has batch_id "${finding.batch_id}"; proposer only operates on batch_id: final`,
    );
  }
  if (finding.severity !== "P0" && finding.severity !== "P1") {
    throw new PacketRenderError(
      "non-blocking-severity",
      `proposer packet: finding "${input.findingId}" has severity ${finding.severity}; proposer only operates on P0/P1`,
    );
  }
  if (finding.status !== "open") {
    throw new PacketRenderError(
      "finding-not-open",
      `proposer packet: finding "${input.findingId}" has status ${finding.status}; proposer only operates on open findings`,
    );
  }

  // Validate input invariants *before* invoking the heavy ledger
  // validator. This lets us return clean PacketRenderError envelopes for
  // contract violations even when the ledger is mid-Stage-3 with no
  // confirmed batches yet. Batch-context validation only runs if a
  // confirmed-batch summary is actually needed.
  const batchContext = tryReadLedgerBatchContext(input.ledgerPath);
  const confirmedSummaries = batchContext
    ? buildConfirmedBatchSummaries(ledgerSrc, batchContext)
    : [];

  const issueNumber = input.issueNumber ?? readFrontmatterIssueNumber(ledgerSrc);
  const targetRepo =
    input.targetRepo ?? readFrontmatterScalar(ledgerSrc, "target_repo") ?? "";

  const data: ProposerPacketData = {
    issue_number: issueNumber,
    target_repo: targetRepo,
    final_finding_row: {
      id: finding.id,
      signature: finding.signature,
      persona: finding.persona,
      severity: finding.severity as "P0" | "P1",
      // F005 fix: strip Builder fix prose from BOTH summary and
      // evidence so a Proposer never sees recommended fixes from the
      // original Validator persona as authorized prompt content. The
      // ledger's ## Findings table has no separate evidence column, so
      // the renderer derives evidence from the same source as summary
      // and strips both in lock-step.
      summary: stripFixProse(finding.summary),
      evidence: stripFixProse(finding.summary),
    },
    confirmed_batch_summaries: confirmedSummaries,
    confirmation_state_snapshot: {
      acceptance_criteria: snapshot.confirmation_state.acceptance_criteria,
      batch_contract: snapshot.confirmation_state.batch_contract,
      digests: snapshot.confirmation_state.digests,
    },
    local_law_read_order: PROPOSER_LOCAL_LAW_POINTER,
    patch_proposal_helper_contract: PROPOSER_HELPER_POINTER,
    scratch_proposal_schema: PROPOSER_SCRATCH_POINTER,
  };

  return {
    role: "proposer",
    data,
    packet_markdown: renderProposerMarkdown(data),
    dispatch_evidence: makeDispatchEvidence({
      role: "proposer",
      targetId: input.findingId,
      loadedReferences: [
        "references/builder-dispatch.md",
        "references/stage-4-batch-loop.md",
        "references/stage-5-final-review.md",
        "references/findings-and-validators.md",
      ],
      loadedTemplates: [
        "templates/proposer-envelope.md",
        "templates/patch-proposal.md",
      ],
      cliRouteId: "packet.proposer",
      now: input.now,
    }),
  };
}

// ----- validator packet ------------------------------------------------

export type ValidatorRenderInput = {
  ledgerPath: string;
  batchId: string;
  persona: string;
  commitRefOrRange: string;
  touchedFiles: string[];
  builderEvidence?: Partial<BuilderEvidence> & {
    /**
     * Builder envelope `notes` and free prose are not forwarded. The
     * validator packet strips Builder fix recommendations by construction:
     * only the seven evidence arrays in `BuilderEvidence` flow through.
     */
    notes?: string;
    suggested_scope_changes?: string[];
  };
  orchestratorTransientFocus?: string[];
  now?: Date;
};

export function renderValidatorPacket(
  input: ValidatorRenderInput,
): ValidatorPacket {
  const ledgerSrc = readLedgerSource(input.ledgerPath);

  let batch: Batch;
  if (input.batchId === STAGE_3_BATCH_ID || input.batchId === "final") {
    batch = {
      id: input.batchId,
      name: input.batchId === STAGE_3_BATCH_ID ? "Stage 3 Contract Review" : "Final Review",
      goal: input.batchId === STAGE_3_BATCH_ID
        ? "review the candidate batch DAG for contract violations"
        : "review terminal state for blocking findings",
      files: [],
      depends_on: [],
      supersedes: null,
      execution_mode: "proof_first",
      acceptance_tests: [],
      ac_mapping: [],
      rationale: null,
    };
  } else {
    const { batch: lookedUp } = lookupLedgerBatch(ledgerSrc, input.batchId);
    batch = lookedUp;
  }

  const allFindings = parseFindingsTableRowsFromSource(
    ledgerSrc,
    input.ledgerPath,
  );
  const relevant = allFindings.filter((f) => f.batch_id === input.batchId);

  // Strip Builder fix prose: only the seven typed evidence arrays cross
  // the boundary. notes/suggested_scope_changes are intentionally not
  // copied — they may carry Builder fix recommendations that the
  // validator must not see as authorized prompt content.
  const evidence: BuilderEvidence = {
    implementation_steps: input.builderEvidence?.implementation_steps ?? [],
    existing_seams_used: input.builderEvidence?.existing_seams_used ?? [],
    tests_run: input.builderEvidence?.tests_run ?? [],
    assumptions: input.builderEvidence?.assumptions ?? [],
    risks: input.builderEvidence?.risks ?? [],
    deferred: input.builderEvidence?.deferred ?? [],
    suggested_validator_focus:
      input.builderEvidence?.suggested_validator_focus ?? [],
  };

  const data: ValidatorPacketData = {
    persona: input.persona,
    commit_ref_or_range: input.commitRefOrRange,
    touched_files: input.touchedFiles,
    batch_id: input.batchId,
    batch_goal: batch.goal,
    batch_files: batch.files,
    execution_mode: batch.execution_mode,
    acceptance_tests: batch.acceptance_tests,
    ac_mapping: batch.ac_mapping,
    relevant_ledger_findings: relevant,
    builder_evidence: evidence,
    orchestrator_transient_focus: input.orchestratorTransientFocus ?? [],
  };

  return {
    role: "validator",
    data,
    packet_markdown: renderValidatorMarkdown(data),
    dispatch_evidence: makeDispatchEvidence({
      role: "validator",
      targetId: `${input.batchId}@${input.commitRefOrRange}`,
      loadedReferences: ["references/findings-and-validators.md"],
      loadedTemplates: ["templates/validator-envelope.md"],
      cliRouteId: "packet.validator",
      now: input.now,
    }),
  };
}

// ----- patch-proposal packet -------------------------------------------

export type PatchProposalRenderInput = {
  ledgerPath: string;
  findingId: string;
  candidatePatchBatch: {
    id: string;
    name: string;
    goal: string;
    files: string[];
    depends_on: string[];
    execution_mode: string;
    acceptance_tests: string[];
    rationale: string;
  };
  now?: Date;
};

export function renderPatchProposalPacket(
  input: PatchProposalRenderInput,
): PatchProposalPacket {
  const ledgerSrc = readLedgerSource(input.ledgerPath);
  const allFindings = parseFindingsTableRowsFromSource(
    ledgerSrc,
    input.ledgerPath,
  );
  const finding = allFindings.find((f) => f.id === input.findingId);
  if (!finding) {
    throw new PacketRenderError(
      "unknown-finding",
      `patch-proposal packet: finding "${input.findingId}" not found in ## Findings`,
    );
  }
  if (finding.batch_id !== "final") {
    throw new PacketRenderError(
      "non-final-finding",
      `patch-proposal packet: finding "${input.findingId}" has batch_id "${finding.batch_id}"; patch-proposal only operates on batch_id: final`,
    );
  }
  if (finding.severity !== "P0" && finding.severity !== "P1") {
    throw new PacketRenderError(
      "non-blocking-severity",
      `patch-proposal packet: finding "${input.findingId}" has severity ${finding.severity}; patch-proposal only operates on P0/P1`,
    );
  }
  if (!/^patch-\d{3}$/.test(input.candidatePatchBatch.id)) {
    throw new PacketRenderError(
      "invalid-patch-id",
      `patch-proposal packet: patch id "${input.candidatePatchBatch.id}" must match patch-NNN`,
    );
  }
  // F003 fix: the runbook deny-list names "Wildcard paths" explicitly
  // for the patch-proposal scratch file. Reject glob characters before
  // we render, so the helper validation downstream never sees a wild
  // path slipped in via the candidate envelope.
  for (const file of input.candidatePatchBatch.files) {
    if (/[*?[\]]/.test(file) || file.startsWith("!")) {
      throw new PacketRenderError(
        "wildcard-path",
        `patch-proposal packet: file "${file}" contains wildcard characters; concrete repo-relative paths only`,
      );
    }
  }
  // Reject contract-invalid execution_mode values up front, matching the
  // ledger-derived path (validateExecutionMode is reused so the error
  // code/message stays consistent across both batch sources).
  const validatedExecutionMode = validateExecutionMode(
    input.candidatePatchBatch.execution_mode,
    input.candidatePatchBatch.id,
  );

  const data: PatchProposalPacketData = {
    final_finding: {
      id: finding.id,
      signature: finding.signature,
      persona: finding.persona,
      severity: finding.severity as "P0" | "P1",
      summary: finding.summary,
    },
    patch_batches: [
      {
        id: input.candidatePatchBatch.id,
        name: input.candidatePatchBatch.name,
        goal: input.candidatePatchBatch.goal,
        files: input.candidatePatchBatch.files,
        depends_on: input.candidatePatchBatch.depends_on,
        execution_mode: validatedExecutionMode,
        acceptance_tests: input.candidatePatchBatch.acceptance_tests,
        ac_mapping: [],
        rationale: input.candidatePatchBatch.rationale,
      },
    ],
  };

  return {
    role: "patch-proposal",
    data,
    packet_markdown: renderPatchProposalMarkdown(data),
    dispatch_evidence: makeDispatchEvidence({
      role: "patch-proposal",
      targetId: input.findingId,
      loadedReferences: [
        "references/stage-4-batch-loop.md",
        "references/ledger-and-helper.md",
        "references/stage-5-final-review.md",
      ],
      loadedTemplates: ["templates/patch-proposal.md"],
      cliRouteId: "packet.patch-proposal",
      now: input.now,
    }),
  };
}

// ----- ce-plan packet --------------------------------------------------

export type CePlanRenderInput = {
  templatesDir?: string;
  now?: Date;
};

export function renderCePlanPacket(input: CePlanRenderInput = {}): CePlanPacket {
  const templateBody = readCePlanAddendumBody(input.templatesDir);
  const data: CePlanPacketData = { addendum_body: templateBody };

  return {
    role: "ce-plan",
    data,
    packet_markdown: templateBody,
    dispatch_evidence: makeDispatchEvidence({
      role: "ce-plan",
      targetId: "addendum",
      loadedReferences: [
        "references/stage-2-plan.md",
        "references/stage-3-decompose.md",
      ],
      loadedTemplates: ["templates/ce-plan-addendum.md"],
      cliRouteId: "packet.ce-plan",
      now: input.now,
    }),
  };
}

// ----- helpers: ledger reading ----------------------------------------

/**
 * Read the strict ledger batch context, returning null **only** when
 * the ledger genuinely has no confirmed batch rows. Other validation
 * errors (malformed Batches block, cyclic supersedes graph,
 * unreachable commits) re-throw so callers cannot silently emit an
 * empty `confirmed_batch_summaries` from a corrupt ledger.
 *
 * F002 fix: previously this swallowed every DecomposeError, which
 * conflated "no confirmed batches yet" with "Batches block is
 * malformed". The narrow allow message is the v1 helper's literal
 * "has no confirmed batch ids" — every other failure mode bubbles.
 */
function tryReadLedgerBatchContext(
  ledgerPath: string,
): LedgerBatchContext | null {
  try {
    return withFailMode("throw", () => readLedgerBatchContext(ledgerPath));
  } catch (error) {
    if (
      error instanceof Error &&
      /has no confirmed batch ids/.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Read the ledger file as utf8.
 *
 * F028 threat model: `--ledger <path>` accepts an arbitrary filesystem
 * path. The CLI **trusts the caller** (the Orchestrator). The
 * Orchestrator is responsible for confining ledger paths to its
 * workspace root before invoking `packet`. The renderer does not
 * symlink-resolve or sandbox the path — that is by design, since the
 * runbook supports running against ledgers in adjacent worktrees or
 * arbitrary temp dirs during dev. If a future deployment surfaces this
 * CLI to untrusted callers (e.g., over HTTP), wrap the entry point
 * with a path allowlist there.
 */
function readLedgerSource(ledgerPath: string): string {
  try {
    return readFileSync(ledgerPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PacketRenderError(
      "ledger-unreadable",
      `cannot read ledger ${ledgerPath}: ${message}`,
    );
  }
}

function readFrontmatterScalar(src: string, key: string): string | null {
  const match = src.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  for (const raw of match[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!field || field[1] !== key) continue;
    const value = field[2].trim();
    if (value === "" || value === "null" || value === "~") return null;
    return unquoteScalar(value);
  }
  return null;
}

function readFrontmatterIssueNumber(src: string): number {
  // F007 fix: fail fast on missing/non-numeric issue_number rather than
  // silently emitting 0. Downstream consumers may use issue_number to
  // open PRs / write commits — a phantom zero is a real footgun.
  const raw = readFrontmatterScalar(src, "issue_number");
  if (!raw) {
    throw new PacketRenderError(
      "missing-issue-number",
      "ledger frontmatter is missing required field issue_number",
    );
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PacketRenderError(
      "invalid-issue-number",
      `ledger frontmatter issue_number "${raw}" is not a positive integer`,
    );
  }
  return n;
}

function unquoteScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function lookupLedgerBatch(
  ledgerSrc: string,
  batchId: string,
): { batch: Batch; row: Record<string, unknown> } {
  const block = extractFencedYaml(ledgerSrc, "Batches");
  if (block === null) {
    throw new PacketRenderError(
      "no-batches-section",
      "ledger has no fenced yaml block under ## Batches",
    );
  }
  const rows = parseLedgerBatchRows(block);
  const idx = rows.findIndex((r) => String(r.id) === batchId);
  if (idx === -1) {
    throw new PacketRenderError(
      "unknown-batch",
      `ledger ## Batches has no entry for batch id "${batchId}"`,
    );
  }
  const row = rows[idx];
  // F004 fix: convert missing/wrong-shape ledger fields into a typed
  // PacketRenderError envelope rather than a raw TypeError surfaced as
  // exit 70 "unexpected-error". The CLI maps PacketRenderError to the
  // packet-render-failed code with exit 1, the documented contract for
  // bad input.
  const batch: Batch = {
    id: String(row.id),
    name: String(row.name ?? ""),
    goal: String(row.goal ?? ""),
    files: requireRowArray(row, "files", input_batchId(row)),
    depends_on: requireRowArray(row, "depends_on", input_batchId(row)),
    supersedes:
      row.supersedes === undefined || row.supersedes === null
        ? null
        : String(row.supersedes),
    execution_mode: validateExecutionMode(row.execution_mode, input_batchId(row)),
    acceptance_tests: requireRowArray(
      row,
      "acceptance_tests",
      input_batchId(row),
    ),
    ac_mapping: requireRowArray(row, "ac_mapping", input_batchId(row)).map((v) => {
      // F037 fix: reject non-numeric ac_mapping cells with a typed
      // PacketRenderError rather than emitting the literal token "NaN"
      // into the rendered YAML packet.
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) {
        throw new PacketRenderError(
          "invalid-ac-mapping",
          `ledger batch "${input_batchId(row)}" has non-numeric ac_mapping entry "${v}"`,
        );
      }
      return n;
    }),
    rationale:
      row.rationale === undefined || row.rationale === null
        ? null
        : String(row.rationale),
  };
  return { batch, row };
}

function input_batchId(row: Record<string, unknown>): string {
  return String(row.id ?? "<unknown>");
}

function validateExecutionMode(
  value: unknown,
  batchId: string,
): Batch["execution_mode"] {
  const candidate = String(value);
  if (!EXECUTION_MODES.has(candidate as Batch["execution_mode"])) {
    throw new PacketRenderError(
      "invalid-execution-mode",
      `ledger batch "${batchId}" has invalid execution_mode "${candidate}"`,
    );
  }
  return candidate as Batch["execution_mode"];
}

function requireRowArray(
  row: Record<string, unknown>,
  key: string,
  batchId: string,
): string[] {
  const value = row[key];
  if (!Array.isArray(value)) {
    throw new PacketRenderError(
      "malformed-ledger-row",
      `ledger batch "${batchId}" is missing required array field "${key}"`,
    );
  }
  return value.map((v) => String(v));
}

/**
 * Minimal extractor for one fenced yaml block under a `## <Name>`
 * section. Tolerant to surrounding markdown. Kept local so packets.ts
 * does not depend on new ledger.ts exports (R10).
 */
function extractFencedYaml(src: string, sectionName: string): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = src.match(
    new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`),
  );
  if (!section) return null;
  const block = section[1].match(/```yaml[^\n]*\n([\s\S]*?)```/i);
  return block ? block[1] : null;
}

/**
 * Lightweight ledger-batch row parser. Matches the structure
 * `lib/ledger.ts` validates but reads only the fields packets.ts needs
 * (avoids re-running git validation on every packet render). The ledger
 * has already been validated upstream by the orchestrator.
 */
function parseLedgerBatchRows(block: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let current: Record<string, unknown> | null = null;
  let currentList: string[] | null = null;
  let currentKey: string | null = null;
  let attemptsList: Record<string, unknown>[] | null = null;
  let currentAttempt: Record<string, unknown> | null = null;
  let currentAttemptList: string[] | null = null;
  let currentAttemptKey: string | null = null;

  function flushList(): void {
    if (current && currentKey && currentList) {
      current[currentKey] = currentList;
    }
    currentKey = null;
    currentList = null;
  }
  function flushAttemptList(): void {
    if (currentAttempt && currentAttemptKey && currentAttemptList) {
      currentAttempt[currentAttemptKey] = currentAttemptList;
    }
    currentAttemptKey = null;
    currentAttemptList = null;
  }
  function flushAttempt(): void {
    flushAttemptList();
    if (currentAttempt && attemptsList) attemptsList.push(currentAttempt);
    currentAttempt = null;
  }
  function flushRow(): void {
    flushAttempt();
    flushList();
    if (current) rows.push(current);
    current = null;
    attemptsList = null;
  }

  for (const raw of block.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*batches:\s*$/.test(line)) continue;
    const firstField = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (firstField) {
      flushRow();
      current = { id: unquoteScalar(firstField[1].trim()) };
      continue;
    }
    if (!current) continue;
    const scalar = line.match(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (scalar) {
      flushAttempt();
      flushList();
      const key = scalar[1];
      const rest = scalar[2];
      if (key === "builder_attempts" && (rest === "" || rest === undefined)) {
        attemptsList = [];
        current[key] = attemptsList;
      } else {
        attemptsList = null;
        if (rest === "" || rest === undefined) {
          currentKey = key;
          currentList = [];
        } else if (rest === "[]") {
          current[key] = [];
        } else if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
          current[key] = parseInlineArray(rest);
        } else {
          current[key] = unquoteScalar(rest.trim());
        }
      }
      continue;
    }
    const attemptFirst = line.match(/^\s{6}-\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (attemptFirst && attemptsList) {
      flushAttempt();
      currentAttempt = {};
      const key = attemptFirst[1];
      const rest = attemptFirst[2];
      const begun = assignAttemptField(currentAttempt, key, rest);
      currentAttemptKey = begun.key;
      currentAttemptList = begun.list;
      continue;
    }
    const attemptScalar = line.match(/^\s{8}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (attemptScalar && currentAttempt) {
      flushAttemptList();
      const key = attemptScalar[1];
      const rest = attemptScalar[2];
      const begun = assignAttemptField(currentAttempt, key, rest);
      currentAttemptKey = begun.key;
      currentAttemptList = begun.list;
      continue;
    }
    const attemptItem = line.match(/^\s{10}-\s+(.*)$/);
    if (attemptItem && currentAttemptList !== null) {
      currentAttemptList.push(unquoteScalar(attemptItem[1].trim()));
      continue;
    }
    const item = line.match(/^\s{6}-\s+(.*)$/);
    if (item && currentList) {
      currentList.push(unquoteScalar(item[1].trim()));
    }
  }
  flushRow();
  return rows;
}

function assignAttemptField(
  attempt: Record<string, unknown>,
  key: string,
  rest: string,
): { key: string | null; list: string[] | null } {
  if (rest === "" || rest === undefined) {
    const list: string[] = [];
    return { key, list };
  }
  if (rest === "[]") {
    attempt[key] = [];
    return { key: null, list: null };
  }
  if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
    attempt[key] = parseInlineArray(rest);
    return { key: null, list: null };
  }
  attempt[key] = unquoteScalar(rest.trim());
  return { key: null, list: null };
}

function parseInlineArray(s: string): string[] {
  const inner = s.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => unquoteScalar(item.trim()));
}

function compactPriorAttempts(
  value: unknown,
  batchId: string,
): CompactBuilderAttempt[] {
  if (!Array.isArray(value)) {
    throw new PacketRenderError(
      "malformed-builder-attempts",
      `ledger batch "${batchId}" is missing required array field "builder_attempts"`,
    );
  }
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PacketRenderError(
        "malformed-builder-attempt",
        `ledger batch "${batchId}" builder_attempts[${index}] must be an object`,
      );
    }
    const r = raw as Record<string, unknown>;
    validateCompactBuilderAttemptKeys(r, batchId, index);
    return {
      attempt_type: requireAttemptScalar(r, "attempt_type", batchId, index),
      status: requireAttemptScalar(r, "status", batchId, index),
      commit_sha: nullableAttemptScalar(r, "commit_sha", batchId, index),
      files_touched: requireAttemptArray(r, "files_touched", batchId, index),
      route_hint: nullableAttemptScalar(r, "route_hint", batchId, index),
      blockers: requireAttemptArray(r, "blockers", batchId, index),
      probe_results: requireAttemptArray(r, "probe_results", batchId, index),
      notes: requireAttemptScalar(r, "notes", batchId, index),
    };
  });
}

// The compact prior-attempt shape the renderer accepts is exactly the
// persisted Builder-attempt key set the ledger validator enforces. Reuse the
// single exported source (contract.ts) so the renderer and ledger cannot drift:
// if a future field is added to persistence, both sides move together.
function validateCompactBuilderAttemptKeys(
  attempt: Record<string, unknown>,
  batchId: string,
  index: number,
): void {
  for (const key of Object.keys(attempt)) {
    if (!BUILDER_ATTEMPT_KEYS.has(key)) {
      throw new PacketRenderError(
        "malformed-builder-attempt",
        `ledger batch "${batchId}" builder_attempts[${index}] contains unexpected field "${key}"`,
      );
    }
  }
  for (const key of BUILDER_ATTEMPT_KEYS) {
    if (!(key in attempt)) {
      throw new PacketRenderError(
        "malformed-builder-attempt",
        `ledger batch "${batchId}" builder_attempts[${index}] is missing required field "${key}"`,
      );
    }
  }
}

function requireAttemptScalar(
  attempt: Record<string, unknown>,
  key: string,
  batchId: string,
  index: number,
): string {
  const value = attempt[key];
  if (
    value === null ||
    value === undefined ||
    Array.isArray(value) ||
    typeof value === "object"
  ) {
    throw new PacketRenderError(
      "malformed-builder-attempt",
      `ledger batch "${batchId}" builder_attempts[${index}].${key} must be a scalar string`,
    );
  }
  return String(value);
}

// Nullable Builder-attempt scalars (commit_sha, route_hint) accept the YAML
// null tokens `null` and `~` and collapse them to null. This collapse is
// load-bearing: the local ledger parser's unquoteScalar only strips quotes, it
// does not convert null tokens the way readFrontmatterScalar does, so a parsed
// `null`/`~` arrives here as the literal string. We trim before BOTH the
// sentinel comparison and the return so a padded value round-trips consistently
// (no trim/return asymmetry). A genuine value equal to the literal `null`/`~`
// cannot be preserved through this lane; commit_sha and route_hint never
// legitimately equal those tokens, and the alternative (a separate quoting
// convention) would diverge from the ledger validator's own null handling.
function nullableAttemptScalar(
  attempt: Record<string, unknown>,
  key: string,
  batchId: string,
  index: number,
): string | null {
  const value = attempt[key];
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) || typeof value === "object") {
    throw new PacketRenderError(
      "malformed-builder-attempt",
      `ledger batch "${batchId}" builder_attempts[${index}].${key} must be a scalar string or null`,
    );
  }
  const scalar = String(value).trim();
  return scalar === "null" || scalar === "~" ? null : scalar;
}

function requireAttemptArray(
  attempt: Record<string, unknown>,
  key: string,
  batchId: string,
  index: number,
): string[] {
  const value = attempt[key];
  if (!Array.isArray(value)) {
    throw new PacketRenderError(
      "malformed-builder-attempt",
      `ledger batch "${batchId}" builder_attempts[${index}].${key} must be an array`,
    );
  }
  return value.map((v) => String(v));
}

function selectBuilderPacketFindings(input: {
  allFindings: FindingRow[];
  batchId: string;
  attemptType: "implementation" | "repair";
  targetFindingSignature: string | null;
}): FindingRow[] {
  const batchFindings = input.allFindings.filter(
    (f) => f.batch_id === input.batchId,
  );
  if (input.attemptType === "implementation") return batchFindings;

  const target = batchFindings.filter(
    (f) =>
      f.signature === input.targetFindingSignature &&
      f.status === "open" &&
      (f.severity === "P0" || f.severity === "P1"),
  );
  if (target.length === 0) {
    throw new PacketRenderError(
      "invalid-target-finding-signature",
      `builder repair packet for batch "${input.batchId}" found no open P0/P1 finding with signature "${input.targetFindingSignature}"`,
    );
  }
  if (target.length > 1) {
    // Distinguish the duplicate-signature ledger corruption from the
    // no-match case: the dedup contract (one non-superseded row per
    // batch_id+signature) has been violated upstream, so the operator must
    // fix the ledger, not the repair argument. A generic "exactly one"
    // message would misdirect them toward a wrong-signature hunt.
    throw new PacketRenderError(
      "invalid-target-finding-signature",
      `builder repair packet for batch "${input.batchId}" found ${target.length} open P0/P1 findings sharing signature "${input.targetFindingSignature}" (duplicate signature without supersede; ledger dedup contract violated)`,
    );
  }
  return target;
}

function parseFindingsTableRowsFromSource(
  src: string,
  ledgerPath: string,
): FindingRow[] {
  const section = src.match(/##\s+Findings\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!section) return [];
  const rows: FindingRow[] = [];
  for (const raw of section[1].split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .slice(1, trimmed.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells.length !== 8) {
      throw new PacketRenderError(
        "malformed-findings-row",
        `ledger ${ledgerPath} ## Findings row "${cells[0] ?? trimmed}" must have exactly 8 columns`,
      );
    }
    if (cells[0] === "id" || /^-+$/.test(cells[0])) continue;
    // F026 fix: enum-validate severity / status before forwarding into
    // a rendered YAML packet. Unquoted enum slots like `severity: ${v}`
    // become a downstream YAML parser surface; a malicious ledger value
    // (`|>`, `: foo`) injects sibling keys. Strict validation against
    // the U3 contract sets closes that vector. F029 (pipe-in-summary)
    // is handled by the cell-count check above (8 columns); enriching
    // the validation here keeps the renderer fail-closed.
    const severity = cells[4];
    const status = cells[5];
    if (!FINDING_SEVERITIES.has(severity)) {
      throw new PacketRenderError(
        "invalid-finding-severity",
        `ledger ${ledgerPath} ## Findings row "${cells[0]}" has invalid severity "${severity}"`,
      );
    }
    if (!FINDING_STATUSES.has(status) && !/^ADR-contradicts-/.test(status)) {
      throw new PacketRenderError(
        "invalid-finding-status",
        `ledger ${ledgerPath} ## Findings row "${cells[0]}" has invalid status "${status}"`,
      );
    }
    rows.push({
      id: cells[0],
      batch_id: cells[1],
      signature: cells[2],
      persona: cells[3],
      severity,
      status,
      summary: cells[6],
      resolution: cells[7] === "" ? null : cells[7],
    });
  }
  return rows;
}

/**
 * Extract Notes-section lines explicitly tagged with the target batch id.
 *
 * F001/F027 fix: substring matching is **not safe** because batch ids can
 * be substrings of each other (b1 vs b10) or appear as substrings in
 * unrelated prose. The strict scoping rule is: only lines that contain
 * the batch id as a whole token (word boundary) survive. If no lines
 * match, the Builder packet carries an empty notes summary rather than
 * leaking the full Notes log.
 *
 * "Whole token" = the batch id appears bounded by characters that are
 * not part of a typical slug (`[A-Za-z0-9_-]`). This catches the
 * canonical template line shapes (`on batch b1;`, `[b1]`, `batch b1`)
 * and rejects substring collisions (`b10` is not a token match for
 * `b1`).
 */
function extractNotesForBatch(src: string, batchId: string): string {
  const section = src.match(/##\s+Notes\s*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!section) return "";
  const escaped = batchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:[^A-Za-z0-9_-]|$)`);
  const lines = section[1]
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith("<append-only log"));
  const scoped = lines.filter((l) => boundary.test(l));
  if (scoped.length === 0) return "";
  return scoped.join("\n");
}

function buildConfirmedBatchSummaries(
  ledgerSrc: string,
  ctx: LedgerBatchContext,
): ProposerBatchSummary[] {
  const block = extractFencedYaml(ledgerSrc, "Batches");
  if (block === null) return [];
  const rows = parseLedgerBatchRows(block);
  const summaries: ProposerBatchSummary[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (!ctx.terminalSuccessIds.has(id)) continue;
    const status = String(row.status ?? "");
    if (status !== "converged" && status !== "accepted-risk") continue;
    summaries.push({
      id,
      files: Array.isArray(row.files)
        ? (row.files as unknown[]).map((v) => String(v))
        : [],
      status,
    });
  }
  return summaries;
}

function stripFixProse(text: string): string {
  // F036 fix: anchor markers at a word boundary so 'prefix:', 'suffix:',
  // 'dispatch:' etc. do not falsely trip the truncation. Previously a
  // legitimate summary like "prefix: validator note about X" was
  // stripped to the empty string by indexOf('fix:').
  //
  // Validator persona summaries occasionally contain phrasing like
  // "fix: <patch>" or "recommended fix: rewrite Y" that the proposer
  // must not see as authorized prompt content. We slice the original
  // string from the boundary capture start so casing is preserved.
  const marker = text.match(
    /(^|[^A-Za-z0-9])(recommended\s+fix|fix|patch):/i,
  );
  if (!marker || marker.index === undefined) return text;
  // marker.index points at the start of the boundary capture; slice
  // immediately AFTER the boundary char so leading whitespace/punct
  // around the marker is preserved as part of the truncation.
  const boundaryStart = marker.index;
  const cutAt =
    marker[1].length === 0 ? boundaryStart : boundaryStart + marker[1].length;
  return text.slice(0, cutAt).trim();
}

// ----- helpers: markdown rendering -----------------------------------

function makeDispatchEvidence(input: {
  role: PacketRole;
  targetId: string;
  loadedReferences: string[];
  loadedTemplates: string[];
  cliRouteId: string;
  now?: Date;
}): DispatchEvidence {
  const ts = (input.now ?? new Date()).toISOString();
  return {
    timestamp: ts,
    role: input.role,
    target_id: input.targetId,
    loaded_references: input.loadedReferences,
    loaded_templates: input.loadedTemplates,
    cli_route_id: input.cliRouteId,
  };
}

function renderBuilderMarkdown(data: BuilderPacketData): string {
  return [
    "# Builder Work Packet (rendered)",
    "",
    "```yaml",
    yamlFromBuilder(data),
    "```",
    "",
    "<local_law_read_order>",
    data.local_law_read_order,
    "</local_law_read_order>",
    "",
    "<authority_boundary>",
    data.authority_boundary,
    "</authority_boundary>",
    "",
    "<preflight_checklist>",
    data.preflight_checklist,
    "</preflight_checklist>",
    "",
    "<allowed_probes>",
    data.allowed_probes,
    "</allowed_probes>",
    "",
    "<output_contract>",
    data.output_contract,
    "</output_contract>",
    "",
  ].join("\n");
}

function yamlFromBuilder(data: BuilderPacketData): string {
  const lines: string[] = [];
  lines.push(`issue_number: ${data.issue_number}`);
  lines.push(`target_repo: ${yamlString(data.target_repo)}`);
  lines.push(`attempt_type: ${data.attempt_type}`);
  lines.push(
    `target_finding_signature: ${
      data.target_finding_signature === null
        ? "null"
        : yamlString(data.target_finding_signature)
    }`,
  );
  lines.push("");
  lines.push("batch_contract:");
  appendBatchYaml(lines, data.batch_contract, "  ");
  lines.push("");
  lines.push(`iteration: ${data.iteration}`);
  lines.push(`builder_commits: ${yamlList(data.builder_commits)}`);
  lines.push("prior_builder_attempts:");
  if (data.prior_builder_attempts.length === 0) {
    lines[lines.length - 1] = "prior_builder_attempts: []";
  } else {
    for (const a of data.prior_builder_attempts) {
      lines.push(`  - attempt_type: ${a.attempt_type}`);
      lines.push(`    status: ${a.status}`);
      lines.push(
        `    commit_sha: ${a.commit_sha === null ? "null" : yamlString(a.commit_sha)}`,
      );
      lines.push(`    files_touched: ${yamlList(a.files_touched)}`);
      lines.push(
        `    route_hint: ${a.route_hint === null ? "null" : yamlString(a.route_hint)}`,
      );
      lines.push(`    blockers: ${yamlList(a.blockers)}`);
      lines.push(`    probe_results: ${yamlList(a.probe_results)}`);
      lines.push(`    notes: ${yamlString(a.notes)}`);
    }
  }
  lines.push("");
  lines.push("findings_data_for_this_batch:");
  if (data.findings_data_for_this_batch.length === 0) {
    lines[lines.length - 1] = "findings_data_for_this_batch: []";
  } else {
    for (const f of data.findings_data_for_this_batch) {
      lines.push(`  - id: ${yamlString(f.id)}`);
      lines.push(`    batch_id: ${yamlString(f.batch_id)}`);
      lines.push(`    signature: ${yamlString(f.signature)}`);
      lines.push(`    persona: ${yamlString(f.persona)}`);
      lines.push(`    severity: ${f.severity}`);
      lines.push(`    status: ${f.status}`);
      lines.push(`    summary: ${yamlString(f.summary)}`);
      lines.push(
        `    resolution: ${f.resolution === null ? "null" : yamlString(f.resolution)}`,
      );
    }
  }
  lines.push("");
  lines.push(
    `notes_summary_for_this_batch: ${yamlString(data.notes_summary_for_this_batch)}`,
  );
  return lines.join("\n");
}

function renderProposerMarkdown(data: ProposerPacketData): string {
  return [
    "# Proposer envelope (rendered)",
    "",
    "```yaml",
    yamlFromProposer(data),
    "```",
    "",
  ].join("\n");
}

function yamlFromProposer(data: ProposerPacketData): string {
  const lines: string[] = [];
  lines.push(`issue_number: ${data.issue_number}`);
  lines.push(`target_repo: ${yamlString(data.target_repo)}`);
  lines.push("");
  lines.push("final_finding_row:");
  lines.push(`  id: ${yamlString(data.final_finding_row.id)}`);
  lines.push(`  signature: ${yamlString(data.final_finding_row.signature)}`);
  lines.push(`  persona: ${yamlString(data.final_finding_row.persona)}`);
  lines.push(`  severity: ${data.final_finding_row.severity}`);
  lines.push(`  summary: ${yamlString(data.final_finding_row.summary)}`);
  lines.push(`  evidence: ${yamlString(data.final_finding_row.evidence)}`);
  lines.push("");
  lines.push("confirmed_batch_summaries:");
  if (data.confirmed_batch_summaries.length === 0) {
    lines[lines.length - 1] = "confirmed_batch_summaries: []";
  } else {
    for (const s of data.confirmed_batch_summaries) {
      lines.push(`  - id: ${yamlString(s.id)}`);
      lines.push(`    files: ${yamlList(s.files)}`);
      lines.push(`    status: ${s.status}`);
    }
  }
  lines.push("");
  lines.push("confirmation_state_snapshot:");
  lines.push(
    `  acceptance_criteria: ${data.confirmation_state_snapshot.acceptance_criteria}`,
  );
  lines.push(
    `  batch_contract: ${data.confirmation_state_snapshot.batch_contract}`,
  );
  lines.push(`  digests: ${data.confirmation_state_snapshot.digests}`);
  lines.push("");
  lines.push(`local_law_read_order: ${yamlString(data.local_law_read_order)}`);
  lines.push(
    `patch_proposal_helper_contract: ${yamlString(data.patch_proposal_helper_contract)}`,
  );
  lines.push(
    `scratch_proposal_schema: ${yamlString(data.scratch_proposal_schema)}`,
  );
  return lines.join("\n");
}

function renderValidatorMarkdown(data: ValidatorPacketData): string {
  return [
    "# Validator envelope (rendered)",
    "",
    "```yaml",
    yamlFromValidator(data),
    "```",
    "",
  ].join("\n");
}

function yamlFromValidator(data: ValidatorPacketData): string {
  const lines: string[] = [];
  lines.push(`persona: ${yamlString(data.persona)}`);
  lines.push(`commit_ref_or_range: ${yamlString(data.commit_ref_or_range)}`);
  lines.push(`touched_files: ${yamlList(data.touched_files)}`);
  lines.push(`batch_id: ${yamlString(data.batch_id)}`);
  lines.push(`batch_goal: ${yamlString(data.batch_goal)}`);
  lines.push(`batch_files: ${yamlList(data.batch_files)}`);
  lines.push(`execution_mode: ${data.execution_mode}`);
  lines.push(`acceptance_tests: ${yamlList(data.acceptance_tests)}`);
  lines.push(
    `ac_mapping: ${
      data.ac_mapping.length === 0
        ? "[]"
        : `[${data.ac_mapping.join(", ")}]`
    }`,
  );
  lines.push("relevant_ledger_findings:");
  if (data.relevant_ledger_findings.length === 0) {
    lines[lines.length - 1] = "relevant_ledger_findings: []";
  } else {
    for (const f of data.relevant_ledger_findings) {
      lines.push(`  - id: ${yamlString(f.id)}`);
      lines.push(`    batch_id: ${yamlString(f.batch_id)}`);
      lines.push(`    signature: ${yamlString(f.signature)}`);
      lines.push(`    persona: ${yamlString(f.persona)}`);
      lines.push(`    severity: ${f.severity}`);
      lines.push(`    status: ${f.status}`);
      lines.push(`    summary: ${yamlString(f.summary)}`);
      lines.push(
        `    resolution: ${f.resolution === null ? "null" : yamlString(f.resolution)}`,
      );
    }
  }
  lines.push("builder_evidence:");
  lines.push(
    `  implementation_steps: ${yamlList(data.builder_evidence.implementation_steps)}`,
  );
  lines.push(
    `  existing_seams_used: ${yamlList(data.builder_evidence.existing_seams_used)}`,
  );
  lines.push(`  tests_run: ${yamlList(data.builder_evidence.tests_run)}`);
  lines.push(`  assumptions: ${yamlList(data.builder_evidence.assumptions)}`);
  lines.push(`  risks: ${yamlList(data.builder_evidence.risks)}`);
  lines.push(`  deferred: ${yamlList(data.builder_evidence.deferred)}`);
  lines.push(
    `  suggested_validator_focus: ${yamlList(data.builder_evidence.suggested_validator_focus)}`,
  );
  lines.push(
    `orchestrator_transient_focus: ${yamlList(data.orchestrator_transient_focus)}`,
  );
  return lines.join("\n");
}

function renderPatchProposalMarkdown(data: PatchProposalPacketData): string {
  return [
    "# Patch proposal scratch file (rendered)",
    "",
    "```yaml",
    yamlFromPatchProposal(data),
    "```",
    "",
  ].join("\n");
}

function yamlFromPatchProposal(data: PatchProposalPacketData): string {
  const lines: string[] = [];
  lines.push("final_finding:");
  lines.push(`  id: ${yamlString(data.final_finding.id)}`);
  lines.push(`  signature: ${yamlString(data.final_finding.signature)}`);
  lines.push(`  persona: ${yamlString(data.final_finding.persona)}`);
  lines.push(`  severity: ${data.final_finding.severity}`);
  lines.push(`  summary: ${yamlString(data.final_finding.summary)}`);
  lines.push("");
  lines.push("patch_batches:");
  const b = data.patch_batches[0];
  lines.push(`  - id: ${yamlString(b.id)}`);
  lines.push(`    name: ${yamlString(b.name)}`);
  lines.push(`    goal: ${yamlString(b.goal)}`);
  lines.push("    files:");
  for (const f of b.files) lines.push(`      - ${yamlString(f)}`);
  lines.push("    depends_on:");
  if (b.depends_on.length === 0) {
    lines[lines.length - 1] = "    depends_on: []";
  } else {
    for (const d of b.depends_on) lines.push(`      - ${yamlString(d)}`);
  }
  lines.push(`    execution_mode: ${b.execution_mode}`);
  lines.push("    acceptance_tests:");
  for (const t of b.acceptance_tests) lines.push(`      - ${yamlString(t)}`);
  lines.push("    ac_mapping: []");
  lines.push(`    rationale: ${yamlString(b.rationale)}`);
  return lines.join("\n");
}

function appendBatchYaml(lines: string[], b: Batch, indent: string): void {
  lines.push(`${indent}id: ${yamlString(b.id)}`);
  lines.push(`${indent}name: ${yamlString(b.name)}`);
  lines.push(`${indent}goal: ${yamlString(b.goal)}`);
  lines.push(`${indent}files:`);
  if (b.files.length === 0) {
    lines[lines.length - 1] = `${indent}files: []`;
  } else {
    for (const f of b.files) lines.push(`${indent}  - ${yamlString(f)}`);
  }
  lines.push(`${indent}depends_on:`);
  if (b.depends_on.length === 0) {
    lines[lines.length - 1] = `${indent}depends_on: []`;
  } else {
    for (const d of b.depends_on) lines.push(`${indent}  - ${yamlString(d)}`);
  }
  lines.push(
    `${indent}supersedes: ${b.supersedes === null ? "null" : yamlString(b.supersedes)}`,
  );
  lines.push(`${indent}execution_mode: ${b.execution_mode}`);
  lines.push(`${indent}acceptance_tests:`);
  if (b.acceptance_tests.length === 0) {
    lines[lines.length - 1] = `${indent}acceptance_tests: []`;
  } else {
    for (const t of b.acceptance_tests) {
      lines.push(`${indent}  - ${yamlString(t)}`);
    }
  }
  lines.push(`${indent}ac_mapping:`);
  if (b.ac_mapping.length === 0) {
    lines[lines.length - 1] = `${indent}ac_mapping: []`;
  } else {
    for (const i of b.ac_mapping) lines.push(`${indent}  - ${i}`);
  }
  lines.push(
    `${indent}rationale: ${b.rationale === null ? "null" : yamlString(b.rationale)}`,
  );
}

function yamlString(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

function yamlList(values: string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map((v) => yamlString(v)).join(", ")}]`;
}

// ----- helpers: prose framing pointers (mirror template prose) --------

const BUILDER_LOCAL_LAW_TEXT = [
  "1. target repo root agent instructions, when present;",
  "2. nearest package AGENTS.md, when present;",
  "3. nearest package CONTEXT.md, when present;",
  "4. package maps, ADRs, runbooks, or governance docs only when referenced by",
  "   local law or triggered by package-boundary/public-contract work;",
  "5. every file in batch_contract.files;",
  "6. nearby tests and implementation needed to understand the existing seam.",
].join("\n");

const BUILDER_AUTHORITY_BOUNDARY_TEXT = [
  "Builder may edit only files in batch_contract.files.",
  "Builder may create a missing path only when that path is already listed in batch_contract.files.",
  "Builder may make exactly one commit when preflight passes.",
  "Builder must not change acceptance criteria, dependencies, execution mode, durable domain language, public contracts, governance docs, or files outside batch_contract.files unless the confirmed batch contract explicitly authorizes that change.",
  "Builder must not append or edit prior builder_attempts rows, edit findings, record Orchestrator-inline evidence, or perform Validator work.",
  "Repair attempts target exactly one open P0/P1 finding by signature; Builder fixes only that target signature.",
].join("\n");

const BUILDER_PREFLIGHT_TEXT = [
  "- task and attempt type are understood;",
  "- acceptance criteria are present;",
  "- package ownership is clear enough for this batch;",
  "- an existing seam is found, or a missing listed path can be created without",
  "  stale-path, typo, wrong-package, or semantic-authorization risk;",
  "- test/proof strategy is clear enough for the confirmed execution_mode;",
  "- public API impact is none or explicitly authorized;",
  "- domain language is existing or safely provisional;",
  "- required fixtures, types, and environment are available or not needed;",
  "- targeted checks can be run, or the inability to run them is explainable.",
].join("\n");

const BUILDER_PROBE_TEXT = [
  "- rename path probe: old path literal to new path literal;",
  "- identity flip probe: old package/plugin identity literal to new identity literal;",
  "- command/path reference probe: command or path literal named in the batch;",
  "- public API probe: exported symbol or manifest surface named in the batch;",
  "- package governance probe: package map, AGENTS.md, CONTEXT.md, and package-knowledge references for package-boundary work.",
].join("\n");

const BUILDER_OUTPUT_CONTRACT_TEXT =
  "Return exactly one envelope per templates/builder-return-envelope.md. The canonical schema lives in references/builder-dispatch.md#return-envelope-v1-l184-213.";

const PROPOSER_LOCAL_LAW_POINTER =
  "See references/builder-dispatch.md#authority-and-local-law-v1-l106-131.";
const PROPOSER_HELPER_POINTER =
  "See references/stage-4-batch-loop.md#final-review-patch-batch-decision-tree-v1-l806-886.";
const PROPOSER_SCRATCH_POINTER =
  "See templates/patch-proposal.md.";

// ----- ce-plan template body extractor --------------------------------

function readCePlanAddendumBody(templatesDir?: string): string {
  const path = templatesDir
    ? resolve(templatesDir, "ce-plan-addendum.md")
    : resolve(
        dirname(new URL(import.meta.url).pathname),
        "..",
        "templates",
        "ce-plan-addendum.md",
      );
  let src: string;
  try {
    src = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PacketRenderError(
      "template-unreadable",
      `cannot read ce-plan addendum template ${path}: ${message}`,
    );
  }
  // The addendum body is the fenced ````markdown block inside the template.
  const block = src.match(/````markdown\n([\s\S]*?)````/);
  if (!block) {
    throw new PacketRenderError(
      "addendum-block-missing",
      "ce-plan addendum template has no fenced markdown block",
    );
  }
  return block[1].replace(/\n+$/, "\n");
}
