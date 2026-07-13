import type { SetupActionId, SetupFinding, SetupFindingId } from "./model.ts";

/** Doctor classification and one safe continuation derived from findings. */
export interface SetupDiagnosis {
	findings: readonly SetupFinding[];
	station: string;
	next_action: SetupActionId;
}

const BLOCKERS = new Set<SetupFindingId>([
	"source_missing", "real_entry", "foreign_symlink", "invalid_skill",
	"catalog_escape", "canonical_id_collision", "malformed_provider_lock", "unsafe_root", "external_entry",
]);
const REPAIRABLE = new Set<SetupFindingId>([
	"missing_link", "wrong_link", "broken_managed_link",
]);
const DEPENDENCY = new Set<SetupFindingId>([
	"dependency_unhealthy", "hook_unhealthy", "instruction_unhealthy", "runbook_artifact_unhealthy",
]);

/** Enrich inspection findings with package-owned impact and repair semantics. */
export function diagnoseFindings(findings: readonly SetupFinding[]): SetupDiagnosis {
	const explained = findings.map(explainFinding).sort((left, right) =>
		`${left.id}\0${left.path ?? ""}`.localeCompare(`${right.id}\0${right.path ?? ""}`)
	);
	if (explained.some((finding) => finding.id === "duplicate_scope")) {
		return { findings: explained, station: "doctor.duplicate_scope", next_action: "human_repair" };
	}
	if (explained.some((finding) => finding.id === "stale_operation_lock")) {
		return { findings: explained, station: "doctor.stale_operation_lock", next_action: "inspect_lock" };
	}
	if (explained.some((finding) => BLOCKERS.has(finding.id))) {
		return { findings: explained, station: "doctor.blocked", next_action: "human_repair" };
	}
	if (explained.some((finding) => DEPENDENCY.has(finding.id))) {
		return { findings: explained, station: "doctor.setup_dependency_unhealthy", next_action: "repair_dependency" };
	}
	if (explained.some((finding) => REPAIRABLE.has(finding.id))) {
		return { findings: explained, station: "doctor.repairable", next_action: "run_sync" };
	}
	return { findings: explained, station: "doctor.healthy", next_action: "setup_healthy" };
}

function explainFinding(finding: SetupFinding): SetupFinding {
	return {
		...finding,
		owner: ownerFor(finding.id, finding.owner),
		why: finding.why ?? whyFor(finding.id),
		repair: repairFor(finding.id, finding.repair),
	};
}

function repairFor(id: SetupFindingId, fallback: SetupActionId): SetupActionId {
	switch (id) {
		case "missing_link": case "wrong_link": case "broken_managed_link": return "run_sync";
		case "dependency_unhealthy": return "repair_dependency";
		case "hook_unhealthy": return "repair_hooks";
		case "instruction_unhealthy": return "repair_instructions";
		case "runbook_artifact_unhealthy": return "repair_runbook";
		case "stale_operation_lock": return "inspect_lock";
		case "operation_busy": return "retry";
		case "external_entry": return fallback;
		default: return BLOCKERS.has(id) || id === "duplicate_scope" ? "human_repair" : fallback;
	}
}

function ownerFor(id: SetupFindingId, fallback: string): string {
	if (id === "external_entry") return "bunx skills";
	if (DEPENDENCY.has(id)) return `setup.${id.replace("_unhealthy", "")}`;
	return fallback || "setup";
}

function whyFor(id: SetupFindingId): string {
	if (REPAIRABLE.has(id)) return "The selected runtime cannot resolve the intended first-party source consistently.";
	if (id === "duplicate_scope") return "Two discovery levels expose one canonical skill id and make precedence ambiguous.";
	if (id === "external_entry") return "A separate package owner occupies this destination and Setup preserves it.";
	if (id === "legacy_codex_root") return "The entry uses a retired discovery root and is preserved for explicit migration.";
	if (DEPENDENCY.has(id)) return "A selected setup domain cannot prove healthy runtime delivery.";
	return "Ownership or containment is not proven, so automatic mutation would risk foreign state.";
}
