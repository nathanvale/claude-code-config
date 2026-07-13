import { createHash } from "node:crypto";
import { basename } from "node:path";

import { canonicalSkillId } from "./catalog.ts";
import type { SetupInspection } from "./inspection.ts";
import type {
	SetupCommand,
	SetupDomainResult,
	SetupFinding,
	SetupOperation,
	SetupProjectionTargetPlan,
	SetupResult,
} from "./model.ts";

const GLOBAL_BLOCKING_FINDINGS = new Set<SetupFinding["id"]>([
	"source_missing", "invalid_skill", "catalog_escape",
	"canonical_id_collision", "duplicate_scope", "malformed_provider_lock",
	"unsafe_root",
]);

/** Convert one immutable inspection snapshot into a deterministic read-only plan. */
export function planSetup(
	inspection: SetupInspection,
	command: Extract<SetupCommand, "status" | "doctor" | "sync" | "catalog">,
): SetupResult {
	const candidates = projectionCandidates(inspection);
	const relevantInspectionFindings = inspection.findings.filter(
		(finding) => finding.id !== "legacy_codex_root",
	);
	const findings = mergeFindings(relevantInspectionFindings, candidates.findings);
	const blockers = mergeFindings(
		relevantInspectionFindings.filter((finding) => GLOBAL_BLOCKING_FINDINGS.has(finding.id)),
		candidates.blockers,
	);
	const blocked = blockers.length > 0;
	const operations = blocked ? [] : candidates.operations;
	const deferred = blocked
		? candidates.operations.map((operation) => operation.destination).sort(compareText)
		: [];
	const managed = inspection.ownership.entries.filter(
		(entry) => entry.ownership === "managed_link",
	).length;
	const external = inspection.ownership.entries.filter(
		(entry) => entry.ownership === "external_entry",
	).length;
	const cleanSlate = operations.length > 0 && inspection.ownership.entries.every(
		(entry) => entry.ownership !== "managed_link" && entry.ownership !== "broken_managed_link",
	);
	const state = blocked ? "blocked" : operations.length === 0
		? "healthy" : cleanSlate ? "clean_slate" : "drift";
	const nextAction = blocked ? "run_doctor" : operations.length === 0
		? "setup_healthy" : command === "sync" ? "run_sync"
			: cleanSlate ? "preview_sync" : "run_sync";
	const preserved = inspection.ownership.entries
		.filter((entry) => entry.ownership !== "managed_link" && entry.ownership !== "broken_managed_link")
		.map((entry) => entry.path)
		.sort(compareText);
	const domain: SetupDomainResult = {
		domain: "skill_projection",
		planned: operations.map((operation) => operation.destination),
		applied: [], deferred, preserved, failed: [],
	};
	const projectionTargets: SetupProjectionTargetPlan[] = inspection.scope.projection_roots.map((root) => ({
		root_id: root.id as "claude" | "codex",
		root_path: root.path,
		blocked,
		blockers: blockers.filter((finding) =>
				!finding.path || finding.path.startsWith(root.path)
		),
		operations: operations.filter((operation) => operation.root_id === root.id),
		preserved: preserved.filter((path) => path.startsWith(root.path)),
	}));
	const fingerprint = evidenceFingerprint(inspection);

	return {
		command,
		scope: inspection.scope.scope,
		state,
		findings,
		domains: [domain],
		operations,
		projection_targets: projectionTargets,
		counts: {
			catalog: inspection.catalog.entries.filter((entry) => entry.state === "valid").length,
			managed, external, planned: operations.length,
			blockers: blockers.length,
		},
		catalog_root: inspection.catalog.root,
		destination_roots: inspection.scope.projection_roots.map((root) => root.path).sort(compareText),
		station: stationFor(command, state),
		next_action: nextAction,
		evidence_fingerprint: fingerprint,
	};
}

function projectionCandidates(inspection: SetupInspection): {
	operations: SetupOperation[];
	findings: SetupFinding[];
	blockers: SetupFinding[];
} {
	const operations: SetupOperation[] = [];
	const findings: SetupFinding[] = [];
	const blockers: SetupFinding[] = [];
	const validEntries = inspection.catalog.entries.filter((entry) => entry.state === "valid");
	const validCanonicalIds = new Set(validEntries.map((entry) => entry.canonical_id));
	const ownershipByRoot = new Map<string, Map<string, (typeof inspection.ownership.entries)[number]>>();
	for (const entry of inspection.ownership.entries) {
		let entries = ownershipByRoot.get(entry.root_id);
		if (!entries) {
			entries = new Map();
			ownershipByRoot.set(entry.root_id, entries);
		}
		if (!entries.has(entry.canonical_id)) entries.set(entry.canonical_id, entry);
	}
	for (const root of inspection.scope.projection_roots) {
		for (const catalogEntry of validEntries) {
			const existing = ownershipByRoot.get(root.id)?.get(catalogEntry.canonical_id);
			const destination = `${root.path}/${catalogEntry.id}`;
			const common = {
				domain: "skill_projection",
				root_id: root.id as "claude" | "codex",
				root_path: root.path,
				id: catalogEntry.id,
				canonical_id: catalogEntry.canonical_id,
				destination,
				desired_source: catalogEntry.path,
				link_form: inspection.scope.scope === "user" ? "absolute" as const : "relative" as const,
			};
			if (!existing) {
				operations.push({ ...common, action: "create_link", expected_ownership: "missing" });
				findings.push({ id: "missing_link", owner: "setup.projection", path: destination,
					summary: `Projection link '${catalogEntry.id}' is missing.`, repair: "run_sync" });
				continue;
			}
			if (existing.ownership === "broken_managed_link") {
				operations.push({ ...common, action: "relink", expected_ownership: "broken_managed_link" });
			} else if (
				existing.ownership === "managed_link" &&
				(!existing.target || canonicalSkillIdFromPath(existing.target) !== catalogEntry.canonical_id)
			) {
				operations.push({ ...common, action: "relink", expected_ownership: "managed_link" });
				findings.push({ id: "wrong_link", owner: "setup.projection", path: existing.path,
					summary: `Projection link '${catalogEntry.id}' points to the wrong source.`, repair: "run_sync" });
			} else if (["external_entry", "real_entry", "foreign_symlink", "unknown_entry"].includes(existing.ownership)) {
				const blocker = occupancyBlocker(existing, catalogEntry.id);
				findings.push(blocker);
				blockers.push(blocker);
			}
		}
	}
	const projectionRootIds = new Set(inspection.scope.projection_roots.map((root) => root.id));
	for (const entry of inspection.ownership.entries) {
		if (
			entry.ownership !== "broken_managed_link" ||
			!projectionRootIds.has(entry.root_id) ||
			validCanonicalIds.has(entry.canonical_id)
		) continue;
		const blocker: SetupFinding = {
			id: "source_missing",
			owner: "setup.catalog",
			path: entry.path,
			summary: `Managed projection '${entry.id}' has no valid source skill.`,
			repair: "human_repair",
		};
		findings.push(blocker);
		blockers.push(blocker);
	}
	operations.sort((left, right) => compareText(left.destination, right.destination));
	return { operations, findings, blockers };
}

function occupancyBlocker(
	entry: SetupInspection["ownership"]["entries"][number],
	desiredId: string,
): SetupFinding {
	return {
		id: entry.finding_id ?? "real_entry",
		owner: entry.ownership === "external_entry" ? "bunx skills" : "setup.ownership",
		path: entry.path,
		summary: `Preserved ${entry.ownership.replaceAll("_", " ")} occupies desired skill '${desiredId}'.`,
		repair: "human_repair",
	};
}

function mergeFindings(...groups: readonly (readonly SetupFinding[])[]): SetupFinding[] {
	const unique = new Map<string, SetupFinding>();
	for (const finding of groups.flat()) {
		const key = `${finding.id}\0${finding.path ?? ""}`;
		if (!unique.has(key)) unique.set(key, finding);
	}
	return [...unique.values()].sort(compareFinding);
}

function canonicalSkillIdFromPath(path: string): string {
	return canonicalSkillId(basename(path));
}

function stationFor(command: string, state: SetupResult["state"]): string {
	if (command === "sync") {
		if (state === "blocked") return "sync.check_blocked";
		return state === "healthy" ? "sync.check_clean" : "sync.check_changes";
	}
	if (command === "doctor") return "doctor.healthy";
	if (command === "catalog") return "catalog.listed";
	return `status.${state}`;
}

function evidenceFingerprint(inspection: SetupInspection): string {
	return createHash("sha256").update(stableJson({
		scope: inspection.scope,
		catalog: inspection.catalog,
		provider_evidence: inspection.provider_evidence,
		ownership: inspection.ownership,
		duplicate_scope_ids: inspection.duplicate_scope_ids,
		findings: inspection.findings,
		blocked: inspection.blocked,
	})).digest("hex");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value).sort(([a], [b]) => compareText(a, b))
			.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function compareFinding(left: SetupFinding, right: SetupFinding): number {
	return compareText(`${left.id}\0${left.path ?? ""}\0${left.summary}`, `${right.id}\0${right.path ?? ""}\0${right.summary}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
