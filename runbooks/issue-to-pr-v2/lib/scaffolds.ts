import {
  ALWAYS_ON_VALIDATOR_PERSONAS,
  ATTEMPT_LANE_VALUES,
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_ATTEMPT_STATUSES,
  BUILDER_ATTEMPT_TYPE_VALUES,
  BUILDER_RETURN_FIELDS,
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
  CANDIDATE_BATCH_FIELDS,
  CHANGE_FIRST_EXCEPTION_PREFIX,
  EXECUTION_MODES,
  FINDING_FIELDS,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX,
  HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX,
  INVESTIGATION_RATIONALE,
  LEDGER_BATCH_LIFECYCLE_DEFAULTS,
  LEDGER_BATCH_LIFECYCLE_FIELDS,
  NEW_FILE_PATCH_EXCEPTION_PREFIX,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_FIELDS,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
  NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_ROOT_KEY,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
  NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_ROOT_KEY,
  NOTES_VALIDATOR_WAVE_COMPLETED_FIELDS,
  NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
  NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY,
  NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS,
  PROPOSER_FAIL_STOP_ENVELOPE_FIELDS,
  PROPOSER_SUCCESS_ENVELOPE_FIELDS,
  RUNBOOK_VERSION,
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
  VALIDATOR_RETURN_ENVELOPE_FIELDS,
  VALIDATOR_WAVE_OUTCOMES,
} from "./contract";

export type ScaffoldOutputKind = "yaml";
export type ScaffoldOrdering = "catalog";

type ScaffoldDefinition = {
  output_kind: ScaffoldOutputKind;
  source: string;
  ordering: ScaffoldOrdering;
  marker?: string;
  renderBody: () => string;
};

const SCAFFOLD_DEFINITIONS = {
  "ce-plan-candidate-batch": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ce-plan-candidate-batch",
    ordering: "catalog",
    renderBody: () => renderCandidateBatchBody("ce-plan"),
  },
  "replacement-candidate-batch": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#replacement-candidate-batch",
    ordering: "catalog",
    renderBody: () => renderCandidateBatchBody("replacement"),
  },
  "patch-proposal-candidate-batch": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#patch-proposal-candidate-batch",
    ordering: "catalog",
    renderBody: () => renderCandidateBatchBody("patch-proposal"),
  },
  "builder-return-envelope": {
    output_kind: "yaml",
    source: "runbooks/issue-to-pr-v2/lib/scaffolds.ts#builder-return-envelope",
    ordering: "catalog",
    renderBody: renderBuilderReturnEnvelopeBody,
  },
  "builder-attempt-compact": {
    output_kind: "yaml",
    source: "runbooks/issue-to-pr-v2/lib/scaffolds.ts#builder-attempt-compact",
    ordering: "catalog",
    renderBody: renderBuilderAttemptCompactBody,
  },
  "validator-builder-evidence": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#validator-builder-evidence",
    ordering: "catalog",
    renderBody: renderValidatorBuilderEvidenceBody,
  },
  "validator-inline-evidence": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#validator-inline-evidence",
    ordering: "catalog",
    renderBody: renderValidatorInlineEvidenceBody,
  },
  "proposer-success-envelope": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#proposer-success-envelope",
    ordering: "catalog",
    renderBody: renderProposerSuccessEnvelopeBody,
  },
  "proposer-fail-stop-envelope": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#proposer-fail-stop-envelope",
    ordering: "catalog",
    renderBody: renderProposerFailStopEnvelopeBody,
  },
  "validator-return-envelope": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#validator-return-envelope",
    ordering: "catalog",
    renderBody: renderValidatorReturnEnvelopeBody,
  },
  "ledger-empty-batches": {
    output_kind: "yaml",
    source: "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ledger-empty-batches",
    ordering: "catalog",
    renderBody: () => "batches: []\n",
  },
  "ledger-empty-findings-data": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ledger-empty-findings-data",
    ordering: "catalog",
    renderBody: () => "findings: []\n",
  },
  "ledger-batch-lifecycle-defaults": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ledger-batch-lifecycle-defaults",
    ordering: "catalog",
    renderBody: renderLedgerBatchLifecycleDefaultsBody,
  },
  "ledger-finding-row": {
    output_kind: "yaml",
    source: "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ledger-finding-row",
    ordering: "catalog",
    renderBody: renderLedgerFindingRowBody,
  },
  "notes-implementation-attempt-checkpoint": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#notes-implementation-attempt-checkpoint",
    ordering: "catalog",
    marker: NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_MARKER,
    renderBody: renderNotesImplementationAttemptCheckpointBody,
  },
  "notes-validator-wave-completed": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#notes-validator-wave-completed",
    ordering: "catalog",
    marker: NOTES_VALIDATOR_WAVE_COMPLETED_MARKER,
    renderBody: renderNotesValidatorWaveCompletedBody,
  },
  "notes-runbook-version-skew-continuation": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#notes-runbook-version-skew-continuation",
    ordering: "catalog",
    marker: NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_MARKER,
    renderBody: renderNotesRunbookVersionSkewContinuationBody,
  },
  "workflow-learnings-empty": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#workflow-learnings-empty",
    ordering: "catalog",
    renderBody: () => "workflow_learnings: []\n",
  },
} as const satisfies Record<string, ScaffoldDefinition>;

// Explicit ordering pinned at the type level. A new scaffold added to
// SCAFFOLD_DEFINITIONS must also appear here, or the `satisfies` check fails.
// Matches the ROUTE_IDS / BLOCKED_ROUTE_IDS pattern and keeps the order of
// `cli.ts contract scaffold_ids --json` stable across formatter / codegen
// changes that might otherwise reorder the SCAFFOLD_DEFINITIONS literal.
export const SCAFFOLD_IDS = [
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
] as const satisfies ReadonlyArray<keyof typeof SCAFFOLD_DEFINITIONS>;
export type ScaffoldId = (typeof SCAFFOLD_IDS)[number];

// Type-level exhaustiveness: a key added to SCAFFOLD_DEFINITIONS but missing
// from SCAFFOLD_IDS resolves to `never` here and fails the compile. Pairs
// with the `satisfies` clause above (which catches the reverse: a tuple
// member not in the catalog).
type _ScaffoldIdsExhaustive = Exclude<
  keyof typeof SCAFFOLD_DEFINITIONS,
  ScaffoldId
> extends never
  ? true
  : never;
const _scaffoldIdsExhaustive: _ScaffoldIdsExhaustive = true;
void _scaffoldIdsExhaustive;

export type ScaffoldRenderResult = {
  scaffold_id: ScaffoldId;
  output_kind: ScaffoldOutputKind;
  source: string;
  ordering: ScaffoldOrdering;
  marker?: string;
  body: string;
};

export type ScaffoldCatalogEntry = Omit<ScaffoldRenderResult, "body">;

type BuilderReturnProjectionField =
  | (typeof BUILDER_RETURN_FIELDS)[number]
  | (typeof BUILDER_ATTEMPT_FIELDS)[number]
  | (typeof BUILDER_VALIDATOR_EVIDENCE_FIELDS)[number];
type ValidatorInlineEvidenceField =
  (typeof VALIDATOR_INLINE_EVIDENCE_FIELDS)[number];
type CandidateBatchField = (typeof CANDIDATE_BATCH_FIELDS)[number];
type CandidateBatchProjection = "ce-plan" | "replacement" | "patch-proposal";
type LedgerBatchLifecycleField =
  (typeof LEDGER_BATCH_LIFECYCLE_FIELDS)[number];
type FindingField = (typeof FINDING_FIELDS)[number];

export class ScaffoldRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScaffoldRenderError";
    this.code = code;
  }
}

const CE_PLAN_CANDIDATE_BATCH_FIELDS = candidateBatchFieldsWithoutSupersedes();
const PATCH_PROPOSAL_CANDIDATE_BATCH_FIELDS =
  candidateBatchFieldsWithoutSupersedes();

function candidateBatchFieldsWithoutSupersedes(): Exclude<
  CandidateBatchField,
  "supersedes"
>[] {
  return CANDIDATE_BATCH_FIELDS.filter(
    (field): field is Exclude<CandidateBatchField, "supersedes"> =>
      field !== "supersedes",
  );
}

function renderCandidateBatchBody(projection: CandidateBatchProjection): string {
  if (projection === "patch-proposal") {
    return renderPatchProposalCandidateBatchBody();
  }

  const fields =
    projection === "replacement"
      ? CANDIDATE_BATCH_FIELDS
      : CE_PLAN_CANDIDATE_BATCH_FIELDS;
  const lines = fields.flatMap((field) =>
    renderCandidateBatchField(field, projection),
  );

  return `${lines.join("\n")}\n`;
}

function renderPatchProposalCandidateBatchBody(): string {
  const lines = ["patch_batches:"];
  PATCH_PROPOSAL_CANDIDATE_BATCH_FIELDS.forEach((field, index) => {
    const rendered = renderCandidateBatchField(field, "patch-proposal", "    ");
    if (index === 0) {
      lines.push(rendered[0].replace(/^    /, "  - "));
      lines.push(...rendered.slice(1));
    } else {
      lines.push(...rendered);
    }
  });
  return `${lines.join("\n")}\n`;
}

function renderCandidateBatchField(
  field: CandidateBatchField,
  projection: CandidateBatchProjection,
  indent = "",
): string[] {
  const executionModes = [...EXECUTION_MODES].join(" | ");

  switch (field) {
    case "id":
      if (projection === "patch-proposal") {
        return [`${indent}id: patch-<NNN>`];
      }
      if (projection === "replacement") {
        return [`${indent}id: <replacement-stable-slug>`];
      }
      return [`${indent}id: <stable-slug>`];
    case "name":
      if (projection === "patch-proposal") {
        return [`${indent}name: "<Title>"`];
      }
      return [`${indent}name: <Title from the Implementation Unit heading>`];
    case "goal":
      if (projection === "patch-proposal") {
        return [
          `${indent}goal: "<one-sentence outcome that addresses the final-review finding>"`,
        ];
      }
      return [
        `${indent}goal: <one-sentence outcome, ideally the AC verbatim>`,
      ];
    case "files":
      return projection === "patch-proposal"
        ? [
            `${indent}files:`,
            `${indent}  - <repo-relative path>`,
          ]
        : [
            `${indent}files:`,
            `${indent}  - <repo-relative path>`,
            `${indent}  - <repo-relative path>`,
          ];
    case "depends_on":
      return projection === "patch-proposal"
        ? [
            `${indent}depends_on:`,
            `${indent}  - <terminal ledger-backed batch id>`,
          ]
        : [
            `${indent}depends_on: []  # or list of ids; emit [] explicitly when none`,
          ];
    case "supersedes":
      return projection === "replacement"
        ? [`${indent}supersedes: <blocked-batch-id>`]
        : [];
    case "execution_mode":
      return [`${indent}execution_mode: tdd  # ${executionModes}`];
    case "acceptance_tests":
      return [
        `${indent}acceptance_tests:`,
        `${indent}  - "AC <i> holds: <verifiable behaviour>"`,
      ];
    case "ac_mapping":
      if (projection === "patch-proposal") {
        return [`${indent}ac_mapping: []`];
      }
      return [
        `${indent}ac_mapping:`,
        `${indent}  - <i>   # AC index (1-based) this batch satisfies; list multiple if merged`,
      ];
    case "rationale":
      if (projection === "replacement") {
        return [`${indent}rationale: "replacement-contract: <reason>"`];
      }
      if (projection === "patch-proposal") {
        return [
          `${indent}rationale: "<may begin with ${NEW_FILE_PATCH_EXCEPTION_PREFIX} | ${HIGH_RISK_NEW_FILE_PATCH_EXCEPTION_PREFIX} | contract-softening-exception: | ${CHANGE_FIRST_EXCEPTION_PREFIX} | ${HIGH_RISK_CHANGE_FIRST_EXCEPTION_PREFIX} when applicable>"`,
        ];
      }
      return [
        `${indent}rationale: null  # string only for split/merge, placeholders such as "${INVESTIGATION_RATIONALE}", or change_first exceptions`,
      ];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-candidate-batch-field",
        `unknown candidate batch scaffold field "${unknownField}"`,
      );
    }
  }
}

function renderBuilderReturnEnvelopeBody(): string {
  return `${BUILDER_RETURN_FIELDS.flatMap((field) =>
    renderBuilderReturnField(field),
  ).join("\n")}\n`;
}

function renderBuilderAttemptCompactBody(): string {
  return `${BUILDER_ATTEMPT_FIELDS.flatMap((field) =>
    renderBuilderReturnField(field),
  ).join("\n")}\n`;
}

function renderValidatorBuilderEvidenceBody(): string {
  const lines = ["builder_evidence:"];
  for (const field of BUILDER_VALIDATOR_EVIDENCE_FIELDS) {
    lines.push(...renderBuilderReturnField(field, "  "));
  }
  return `${lines.join("\n")}\n`;
}

function renderValidatorInlineEvidenceBody(): string {
  const lines = ["inline_evidence:"];
  for (const field of VALIDATOR_INLINE_EVIDENCE_FIELDS) {
    lines.push(...renderValidatorInlineEvidenceField(field));
  }
  return `${lines.join("\n")}\n`;
}

function renderValidatorInlineEvidenceField(
  field: ValidatorInlineEvidenceField,
): string[] {
  switch (field) {
    case "implementation_commit":
      return ['  implementation_commit: "<commit-sha>"'];
    case "touched_files":
      return ["  touched_files: []"];
    case "inline_validity_note":
      return ['  inline_validity_note: "<why inline eligibility still held>"'];
    case "user_confirmed_exception_note":
      return ["  user_confirmed_exception_note: null"];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-validator-inline-evidence-field",
        `unknown Validator inline evidence field "${unknownField}"`,
      );
    }
  }
}

type ProposerSuccessEnvelopeField =
  (typeof PROPOSER_SUCCESS_ENVELOPE_FIELDS)[number];
type ProposerFailStopEnvelopeField =
  (typeof PROPOSER_FAIL_STOP_ENVELOPE_FIELDS)[number];
type ValidatorReturnEnvelopeField =
  (typeof VALIDATOR_RETURN_ENVELOPE_FIELDS)[number];

function renderProposerSuccessEnvelopeBody(): string {
  return `${PROPOSER_SUCCESS_ENVELOPE_FIELDS.flatMap((field) =>
    renderProposerSuccessEnvelopeField(field),
  ).join("\n")}\n`;
}

function renderProposerSuccessEnvelopeField(
  field: ProposerSuccessEnvelopeField,
): string[] {
  switch (field) {
    case "status":
      return ["status: candidate-patch-batch"];
    case "candidate_patch_batch":
      return [
        "candidate_patch_batch:",
        "  # <one object matching patch_batches[0] in the patch-proposal candidate scaffold>",
        "  # Resolve via: cli.ts scaffold patch-proposal-candidate-batch --json",
      ];
    case "evidence_summary":
      return [
        'evidence_summary: "<one paragraph: ledger and code evidence consulted; no edits performed>"',
      ];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-proposer-success-envelope-field",
        `unknown Proposer success envelope field "${unknownField}"`,
      );
    }
  }
}

function renderProposerFailStopEnvelopeBody(): string {
  return `${PROPOSER_FAIL_STOP_ENVELOPE_FIELDS.flatMap((field) =>
    renderProposerFailStopEnvelopeField(field),
  ).join("\n")}\n`;
}

function renderProposerFailStopEnvelopeField(
  field: ProposerFailStopEnvelopeField,
): string[] {
  switch (field) {
    case "status":
      return ["status: fail-stop"];
    case "blockers":
      return ["blockers: []  # one short statement per blocker"];
    case "probe_results":
      return ["probe_results: []  # one short statement per probe"];
    case "route_hint":
      return [
        'route_hint: "<next-owner guidance, not authoritative>"',
      ];
    case "notes":
      return ['notes: ""'];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-proposer-fail-stop-envelope-field",
        `unknown Proposer fail-stop envelope field "${unknownField}"`,
      );
    }
  }
}

function renderValidatorReturnEnvelopeBody(): string {
  return `${VALIDATOR_RETURN_ENVELOPE_FIELDS.flatMap((field) =>
    renderValidatorReturnEnvelopeField(field),
  ).join("\n")}\n`;
}

function renderValidatorReturnEnvelopeField(
  field: ValidatorReturnEnvelopeField,
): string[] {
  switch (field) {
    case "reviewer":
      return ["reviewer: <persona>"];
    case "findings":
      return [
        "findings: []  # each non-empty row matches cli.ts scaffold ledger-finding-row --json",
      ];
    case "residual_risks":
      return ["residual_risks: []"];
    case "testing_gaps":
      return ["testing_gaps: []"];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-validator-return-envelope-field",
        `unknown Validator return envelope field "${unknownField}"`,
      );
    }
  }
}

function renderBuilderReturnField(
  field: BuilderReturnProjectionField,
  indent = "",
): string[] {
  const attemptTypes = [...BUILDER_ATTEMPT_TYPE_VALUES].join(" | ");
  const statuses = [...BUILDER_ATTEMPT_STATUSES].join(" | ");

  switch (field) {
    case "attempt_type":
      return [`${indent}attempt_type: implementation  # ${attemptTypes}`];
    case "target_finding_signature":
      return [
        `${indent}target_finding_signature: null  # string for repair; null for implementation`,
      ];
    case "status":
      return [`${indent}status: committed  # ${statuses}`];
    case "commit_sha":
      return [`${indent}commit_sha: "<commit-sha>"`];
    case "files_touched":
      return [`${indent}files_touched: []`];
    case "route_hint":
      return [`${indent}route_hint: null`];
    case "blockers":
      return [`${indent}blockers: []`];
    case "probe_results":
      return [`${indent}probe_results: []`];
    case "suggested_scope_changes":
      return [`${indent}suggested_scope_changes: []`];
    case "implementation_steps":
      return [`${indent}implementation_steps: []`];
    case "existing_seams_used":
      return [`${indent}existing_seams_used: []`];
    case "tests_run":
      return [`${indent}tests_run: []`];
    case "assumptions":
      return [`${indent}assumptions: []`];
    case "risks":
      return [`${indent}risks: []`];
    case "deferred":
      return [`${indent}deferred: []`];
    case "suggested_validator_focus":
      return [`${indent}suggested_validator_focus: []`];
    case "notes":
      return [`${indent}notes: "<attempt summary>"`];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-builder-return-field",
        `unknown Builder return field "${unknownField}"`,
      );
    }
  }
}

function renderLedgerBatchLifecycleDefaultsBody(): string {
  return `${LEDGER_BATCH_LIFECYCLE_FIELDS.map(
    (field) =>
      `${field}: ${renderLedgerBatchLifecycleDefaultValue(field)}`,
  ).join("\n")}\n`;
}

function renderLedgerBatchLifecycleDefaultValue(
  field: LedgerBatchLifecycleField,
): string {
  const value = LEDGER_BATCH_LIFECYCLE_DEFAULTS[field];
  if (Array.isArray(value)) return "[]";
  if (value === null) return "null";
  return String(value);
}

function renderLedgerFindingRowBody(): string {
  return `${FINDING_FIELDS.flatMap((field) =>
    renderLedgerFindingRowField(field),
  ).join("\n")}\n`;
}

function renderLedgerFindingRowField(field: FindingField): string[] {
  const severities = [...FINDING_SEVERITIES].join(" | ");
  const statuses = [...FINDING_STATUSES].join(" | ");

  switch (field) {
    case "id":
      return ["id: <finding-id>"];
    case "batch_id":
      return ["batch_id: <batch-id | stage-3 | final>"];
    case "signature":
      return ["signature: <stable-kebab-signature>"];
    case "persona":
      return ["persona: <reviewer>"];
    case "severity":
      return [`severity: P2  # ${severities}`];
    case "status":
      return [`status: open  # ${statuses} | ADR-contradicts-<id>`];
    case "summary":
      return ['summary: "<verbatim table summary>"'];
    case "resolution":
      return ["resolution: null"];
    default: {
      const unknownField: never = field;
      throw new ScaffoldRenderError(
        "unknown-finding-field",
        `unknown finding scaffold field "${unknownField}"`,
      );
    }
  }
}

function renderNotesImplementationAttemptCheckpointBody(): string {
  return renderTwoSpaceScalarEvidenceBody(
    NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_ROOT_KEY,
    NOTES_IMPLEMENTATION_ATTEMPT_CHECKPOINT_FIELDS,
    renderImplementationAttemptCheckpointField,
  );
}

function renderImplementationAttemptCheckpointField(field: string): string {
  switch (field) {
    case "batch_id":
      return '"<batch-id>"';
    case "implementation_commit":
      return '"<sha>"';
    case "attempt_lane":
      return `"<${ATTEMPT_LANE_VALUES.join(" | ")}>"`;
    case "timestamp":
      return '"<ISO 8601>"';
    default:
      throw new ScaffoldRenderError(
        "unknown-notes-implementation-checkpoint-field",
        `unknown implementation checkpoint evidence field "${field}"`,
      );
  }
}

function renderNotesValidatorWaveCompletedBody(): string {
  const lines = [`${NOTES_VALIDATOR_WAVE_COMPLETED_ROOT_KEY}:`];
  for (const field of NOTES_VALIDATOR_WAVE_COMPLETED_FIELDS) {
    switch (field) {
      case "batch_id":
        lines.push('  batch_id: "<batch-id>"');
        break;
      case "implementation_commit":
        lines.push('  implementation_commit: "<sha>"');
        break;
      case "attempt_lane":
        lines.push(`  attempt_lane: "<${ATTEMPT_LANE_VALUES.join(" | ")}>"`);
        break;
      case "personas":
        lines.push("  personas:");
        for (const persona of ALWAYS_ON_VALIDATOR_PERSONAS) {
          lines.push(`    - "${persona}"`);
        }
        break;
      case "dispatch_evidence":
        lines.push("  dispatch_evidence:");
        for (const dispatchField of NOTES_VALIDATOR_WAVE_DISPATCH_EVIDENCE_FIELDS) {
          lines.push(
            `    ${dispatchField}: ${renderValidatorDispatchEvidenceField(
              dispatchField,
            )}`,
          );
        }
        break;
      case "outcome":
        lines.push(`  outcome: "<${VALIDATOR_WAVE_OUTCOMES.join(" | ")}>"`);
        break;
      case "findings":
        lines.push("  findings: []");
        break;
      default: {
        const unknownField: never = field;
        throw new ScaffoldRenderError(
          "unknown-notes-validator-wave-field",
          `unknown Validator-wave evidence field "${unknownField}"`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderValidatorDispatchEvidenceField(field: string): string {
  switch (field) {
    case "role":
      return '"validator"';
    case "target_id":
      return '"<batch-id>@<sha>"';
    case "cli_route_id":
      return '"packet.validator"';
    default:
      throw new ScaffoldRenderError(
        "unknown-notes-validator-dispatch-field",
        `unknown Validator-wave dispatch evidence field "${field}"`,
      );
  }
}

function renderNotesRunbookVersionSkewContinuationBody(): string {
  return renderTwoSpaceScalarEvidenceBody(
    NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_ROOT_KEY,
    NOTES_RUNBOOK_VERSION_SKEW_CONTINUATION_FIELDS,
    renderRunbookVersionSkewContinuationField,
  );
}

function renderRunbookVersionSkewContinuationField(field: string): string {
  switch (field) {
    case "ledger_version":
      return "null";
    case "runtime_version":
      return `"${RUNBOOK_VERSION}"`;
    case "operator_decision":
      return '"<actor>"';
    case "timestamp":
      return '"<ISO 8601>"';
    case "route_context":
      return '"<route id at the time of decision>"';
    case "reference_context":
      return '"<reference file the operator consulted>"';
    case "accepted_risk":
      return '"<one-line reason>"';
    default:
      throw new ScaffoldRenderError(
        "unknown-notes-runbook-version-skew-field",
        `unknown runbook-version skew evidence field "${field}"`,
      );
  }
}

function renderTwoSpaceScalarEvidenceBody(
  rootKey: string,
  fields: readonly string[],
  renderField: (field: string) => string,
): string {
  return `${[
    `${rootKey}:`,
    ...fields.map((field) => `  ${field}: ${renderField(field)}`),
  ].join("\n")}\n`;
}

function scaffoldDefinitionToCatalogEntry(
  scaffold_id: ScaffoldId,
  definition: ScaffoldDefinition,
): ScaffoldCatalogEntry {
  const { output_kind, source, ordering } = definition;
  return {
    scaffold_id,
    output_kind,
    source,
    ordering,
    ...(definition.marker ? { marker: definition.marker } : {}),
  };
}

export function getScaffoldCatalog(): readonly ScaffoldCatalogEntry[] {
  return SCAFFOLD_IDS.map((id) =>
    scaffoldDefinitionToCatalogEntry(id, SCAFFOLD_DEFINITIONS[id]),
  );
}

export function isScaffoldId(value: string): value is ScaffoldId {
  return Object.hasOwn(SCAFFOLD_DEFINITIONS, value);
}

export function renderScaffold(id: ScaffoldId): ScaffoldRenderResult {
  const definition: ScaffoldDefinition = SCAFFOLD_DEFINITIONS[id];
  if (!definition) {
    throw new ScaffoldRenderError(
      "unknown-scaffold-id",
      `unknown scaffold id "${id}"`,
    );
  }

  return {
    scaffold_id: id,
    output_kind: definition.output_kind,
    source: definition.source,
    ordering: definition.ordering,
    ...(definition.marker ? { marker: definition.marker } : {}),
    body: definition.renderBody(),
  };
}
