import {
  BUILDER_ATTEMPT_FIELDS,
  BUILDER_ATTEMPT_STATUSES,
  BUILDER_ATTEMPT_TYPE_VALUES,
  BUILDER_RETURN_FIELDS,
  BUILDER_VALIDATOR_EVIDENCE_FIELDS,
  CANDIDATE_BATCH_FIELDS,
  EXECUTION_MODES,
  INVESTIGATION_RATIONALE,
  VALIDATOR_INLINE_EVIDENCE_FIELDS,
} from "./contract";

export type ScaffoldOutputKind = "yaml";
export type ScaffoldOrdering = "catalog";

type ScaffoldDefinition = {
  output_kind: ScaffoldOutputKind;
  source: string;
  ordering: ScaffoldOrdering;
  renderBody: () => string;
};

const SCAFFOLD_DEFINITIONS = {
  "ce-plan-candidate-batch": {
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ce-plan-candidate-batch",
    ordering: "catalog",
    renderBody: renderCePlanCandidateBatchBody,
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
} as const satisfies Record<string, ScaffoldDefinition>;

export const SCAFFOLD_IDS = [
  ...Object.keys(SCAFFOLD_DEFINITIONS),
] as (keyof typeof SCAFFOLD_DEFINITIONS & string)[];
export type ScaffoldId = (typeof SCAFFOLD_IDS)[number];

export type ScaffoldRenderResult = {
  scaffold_id: ScaffoldId;
  output_kind: ScaffoldOutputKind;
  source: string;
  ordering: ScaffoldOrdering;
  body: string;
};

export type ScaffoldCatalogEntry = Omit<ScaffoldRenderResult, "body">;

type BuilderReturnProjectionField =
  | (typeof BUILDER_RETURN_FIELDS)[number]
  | (typeof BUILDER_ATTEMPT_FIELDS)[number]
  | (typeof BUILDER_VALIDATOR_EVIDENCE_FIELDS)[number];
type ValidatorInlineEvidenceField =
  (typeof VALIDATOR_INLINE_EVIDENCE_FIELDS)[number];
type CandidateBatchScaffoldField = Exclude<
  (typeof CANDIDATE_BATCH_FIELDS)[number],
  "supersedes"
>;

export class ScaffoldRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScaffoldRenderError";
    this.code = code;
  }
}

const CE_PLAN_CANDIDATE_BATCH_FIELDS = CANDIDATE_BATCH_FIELDS.filter(
  (field): field is CandidateBatchScaffoldField => field !== "supersedes",
);

function renderCePlanCandidateBatchBody(): string {
  const lines: string[] = [];

  for (const field of CE_PLAN_CANDIDATE_BATCH_FIELDS) {
    lines.push(...renderCePlanCandidateBatchField(field));
  }

  return `${lines.join("\n")}\n`;
}

function renderCePlanCandidateBatchField(
  field: CandidateBatchScaffoldField,
): string[] {
  const executionModes = [...EXECUTION_MODES].join(" | ");

  switch (field) {
    case "id":
      return ["id: <stable-slug>"];
    case "name":
      return ["name: <Title from the Implementation Unit heading>"];
    case "goal":
      return ["goal: <one-sentence outcome, ideally the AC verbatim>"];
    case "files":
      return [
        "files:",
        "  - <repo-relative path>",
        "  - <repo-relative path>",
      ];
    case "depends_on":
      return ["depends_on: []  # or list of ids; emit [] explicitly when none"];
    case "execution_mode":
      return [`execution_mode: tdd  # ${executionModes}`];
    case "acceptance_tests":
      return ["acceptance_tests:", '  - "AC <i> holds: <verifiable behaviour>"'];
    case "ac_mapping":
      return [
        "ac_mapping:",
        "  - <i>   # AC index (1-based) this batch satisfies; list multiple if merged",
      ];
    case "rationale":
      return [
        `rationale: null  # string only for split/merge, placeholders such as "${INVESTIGATION_RATIONALE}", or change_first exceptions`,
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

function scaffoldDefinitionToCatalogEntry(
  scaffold_id: ScaffoldId,
  definition: ScaffoldDefinition,
): ScaffoldCatalogEntry {
  const { output_kind, source, ordering } = definition;
  return { scaffold_id, output_kind, source, ordering };
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
  const definition = SCAFFOLD_DEFINITIONS[id];
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
    body: definition.renderBody(),
  };
}
