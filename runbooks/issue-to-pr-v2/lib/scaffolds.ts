import {
  CANDIDATE_BATCH_FIELDS,
  EXECUTION_MODES,
  INVESTIGATION_RATIONALE,
} from "./contract";

export const SCAFFOLD_IDS = ["ce-plan-candidate-batch"] as const;
export type ScaffoldId = (typeof SCAFFOLD_IDS)[number];
export type ScaffoldOutputKind = "yaml";
export type ScaffoldOrdering = "catalog";

export type ScaffoldRenderResult = {
  scaffold_id: ScaffoldId;
  output_kind: ScaffoldOutputKind;
  source: string;
  ordering: ScaffoldOrdering;
  body: string;
};

export type ScaffoldCatalogEntry = Omit<ScaffoldRenderResult, "body">;

type ScaffoldDefinition = ScaffoldCatalogEntry & {
  renderBody: () => string;
};

export class ScaffoldRenderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScaffoldRenderError";
    this.code = code;
  }
}

const CE_PLAN_CANDIDATE_BATCH_FIELDS = CANDIDATE_BATCH_FIELDS.filter(
  (field) => field !== "supersedes",
);

const SCAFFOLD_DEFINITIONS = [
  {
    scaffold_id: "ce-plan-candidate-batch",
    output_kind: "yaml",
    source:
      "runbooks/issue-to-pr-v2/lib/scaffolds.ts#ce-plan-candidate-batch",
    ordering: "catalog",
    renderBody: renderCePlanCandidateBatchBody,
  },
] as const satisfies readonly ScaffoldDefinition[];

function renderCePlanCandidateBatchBody(): string {
  const executionModes = [...EXECUTION_MODES].join(" | ");
  const lines: string[] = [];

  for (const field of CE_PLAN_CANDIDATE_BATCH_FIELDS) {
    switch (field) {
      case "id":
        lines.push("id: <stable-slug>");
        break;
      case "name":
        lines.push("name: <Title from the Implementation Unit heading>");
        break;
      case "goal":
        lines.push("goal: <one-sentence outcome, ideally the AC verbatim>");
        break;
      case "files":
        lines.push("files:");
        lines.push("  - <repo-relative path>");
        lines.push("  - <repo-relative path>");
        break;
      case "depends_on":
        lines.push("depends_on: []  # or list of ids; emit [] explicitly when none");
        break;
      case "execution_mode":
        lines.push(`execution_mode: tdd  # ${executionModes}`);
        break;
      case "acceptance_tests":
        lines.push("acceptance_tests:");
        lines.push('  - "AC <i> holds: <verifiable behaviour>"');
        break;
      case "ac_mapping":
        lines.push("ac_mapping:");
        lines.push(
          "  - <i>   # AC index (1-based) this batch satisfies; list multiple if merged",
        );
        break;
      case "rationale":
        lines.push(
          `rationale: null  # string only for split/merge, placeholders such as "${INVESTIGATION_RATIONALE}", or change_first exceptions`,
        );
        break;
    }
  }

  return `${lines.join("\n")}\n`;
}

function scaffoldDefinitionToCatalogEntry(
  definition: ScaffoldDefinition,
): ScaffoldCatalogEntry {
  const { scaffold_id, output_kind, source, ordering } = definition;
  return { scaffold_id, output_kind, source, ordering };
}

export function getScaffoldCatalog(): readonly ScaffoldCatalogEntry[] {
  return SCAFFOLD_DEFINITIONS.map(scaffoldDefinitionToCatalogEntry);
}

export function isScaffoldId(value: string): value is ScaffoldId {
  return (SCAFFOLD_IDS as readonly string[]).includes(value);
}

export function renderScaffold(id: ScaffoldId): ScaffoldRenderResult {
  const definition = SCAFFOLD_DEFINITIONS.find((entry) => entry.scaffold_id === id);
  if (!definition) {
    throw new ScaffoldRenderError(
      "unknown-scaffold-id",
      `unknown scaffold id "${id}"`,
    );
  }

  return {
    scaffold_id: definition.scaffold_id,
    output_kind: definition.output_kind,
    source: definition.source,
    ordering: definition.ordering,
    body: definition.renderBody(),
  };
}
