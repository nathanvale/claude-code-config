import { inspectCatalog, type CatalogInspection } from "./catalog.ts";
import { deepFreeze } from "./immutable.ts";
import type { SetupFinding, SetupScope } from "./model.ts";
import {
	inspectProjectionRoots,
	type OwnershipInspection,
} from "./ownership.ts";
import {
	readProviderEvidence,
	type ProviderEvidence,
} from "./provider-evidence.ts";
import {
	resolveSetupScope,
	type SetupScopeInspection,
} from "./scope.ts";

export interface SetupInspectionInput {
	readonly scope: SetupScope;
	readonly sourceRepoRoot: string;
	readonly projectRepoRoot?: string;
	readonly homeDir?: string;
}

export interface SetupInspection {
	readonly scope: SetupScopeInspection;
	readonly catalog: CatalogInspection;
	readonly provider_evidence: ProviderEvidence;
	readonly ownership: OwnershipInspection;
	readonly duplicate_scope_ids: readonly string[];
	readonly findings: readonly SetupFinding[];
	readonly blocked: boolean;
}

/** Finding ids that block every projection plan; shared with the planner so the two gates cannot drift. */
export const BLOCKING_FINDINGS = new Set<SetupFinding["id"]>([
	"source_missing",
	"invalid_skill",
	"catalog_escape",
	"canonical_id_collision",
	"duplicate_scope",
	"malformed_provider_lock",
	"unsafe_root",
]);

/** Build one immutable, read-only source and destination evidence snapshot. */
export async function inspectSetup(
	input: SetupInspectionInput,
): Promise<SetupInspection> {
	const scope = await resolveSetupScope(input);
	const [catalog, providerEvidence] = await Promise.all([
		inspectCatalog(scope.catalog_root, scope.source_anchor),
		readProviderEvidence(scope.provider_evidence_root),
	]);
	const ownership = await inspectProjectionRoots({
		catalogRoot: scope.catalog_root,
		roots: [...scope.projection_roots, ...scope.legacy_roots],
		providerEvidence,
	});
	const duplicateScopeIds =
		input.scope === "project"
			? await findProjectDuplicates(input, catalog)
			: [];
	const findings = [
		...catalog.findings,
		...(providerEvidence.finding ? [providerEvidence.finding] : []),
		...ownership.findings,
		...duplicateScopeIds.map(
			(id): SetupFinding => ({
				id: "duplicate_scope",
				owner: "setup.scope",
				summary: `Skill '${id}' is visible in user scope and the selected project catalog.`,
				repair: "human_repair",
			}),
		),
	];
	return deepFreeze({
		scope,
		catalog,
		provider_evidence: providerEvidence,
		ownership,
		duplicate_scope_ids: duplicateScopeIds,
		findings,
		blocked: findings.some((finding) => BLOCKING_FINDINGS.has(finding.id)),
	});
}

async function findProjectDuplicates(
	input: SetupInspectionInput,
	projectCatalog: CatalogInspection,
): Promise<string[]> {
	const userScope = await resolveSetupScope({
		scope: "user",
		sourceRepoRoot: input.sourceRepoRoot,
		homeDir: input.homeDir,
	});
	const providerEvidence = await readProviderEvidence(
		userScope.provider_evidence_root,
	);
	const userOwnership = await inspectProjectionRoots({
		catalogRoot: userScope.catalog_root,
		roots: userScope.projection_roots,
		providerEvidence,
	});
	const userIds = new Set(userOwnership.entries.map((entry) => entry.canonical_id));
	return projectCatalog.entries
		.filter((entry) => entry.state === "valid" && userIds.has(entry.canonical_id))
		.map((entry) => entry.id)
		.sort((a, b) => a.localeCompare(b));
}
