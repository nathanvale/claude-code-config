import { createHash } from "node:crypto";
import bundledReceipt from "./browser-use-monash-smst-corpus-receipt.json";
import bundledCandidates from "./fixtures/browser-use-migration/monash-smst-corpus/candidate-census.json";
import bundledSourceClosure from "./fixtures/browser-use-migration/monash-smst-corpus/source-closure.json";
import { findRedactionViolations } from "./browser-use-schemas";

const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_REVISION = /^[0-9a-f]{40,64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXPECTED_CANDIDATE_IDS = [
	"context7-confluence-create-library",
	"fasttrack-export-timesheet-history",
	"fasttrack-fill-submit-timesheet",
	"fasttrack-inspect-rejected-timesheets",
	"fasttrack-list-available-timesheets",
	"fasttrack-list-incomplete-timesheets",
	"fasttrack-list-submitted-timesheets",
	"monash-ess-audit",
	"monash-identity-audit",
	"monash-mspace-audit",
	"monash-mydevelopment-audit",
	"monash-myservices-audit",
	"monash-staff-portal-audit",
	"monash-zoom-audit",
	"npm-setup-publishing",
	"zoom-extract-transcript",
] as const;
const EXPECTED_CATEGORY_COUNTS = {
	"context7-confluence": 1,
	"fasttrack-timesheet": 6,
	"monash-portal-audit": 7,
	"npm-publishing": 1,
	"zoom-transcript": 1,
} as const;
const RECEIPT_KEYS = [
	"artifacts",
	"contract",
	"receipt_scope",
	"relative_path_digest",
	"schema_version",
	"source_artifact_count",
	"source_closure_digest",
	"source_repository",
	"source_revision",
	"source_worktree_state",
	"tracked_changes_present",
	"untracked_entries_present",
] as const;
const RECEIPT_ARTIFACT_KEYS = [
	"source_content_hash",
	"source_relative_path",
	"tracking_state",
] as const;
const SOURCE_FIXTURE_KEYS = [
	"artifacts",
	"contract",
	"schema_version",
] as const;
const SOURCE_FIXTURE_ARTIFACT_KEYS = [
	"disposition",
	"reason",
	"source_content_hash",
	"source_relative_path",
	"tracking_state",
] as const;
const CANDIDATE_FIXTURE_KEYS = [
	"candidates",
	"contract",
	"schema_version",
	"source_groups",
] as const;
const CANDIDATE_KEYS = [
	"allowed_origins",
	"candidate_id",
	"canonical_target_id",
	"category",
	"disposition",
	"flow_id",
	"human_presence",
	"outcome",
	"reason",
	"service_id",
	"source_group_id",
] as const;
const EXPECTED_SOURCE_GROUP_IDS = Object.keys(EXPECTED_CATEGORY_COUNTS).sort();

/** Reviewed disposition for one source artifact in the selected closure. */
export type BrowserUseMonashSmstSourceDisposition =
	| "candidate-source"
	| "supporting-knowledge"
	| "action-candidate";

/** Mechanical source kinds covered by the U14 discovery fixture. */
export type BrowserUseMonashSmstSourceKind =
	| "skill"
	| "agent"
	| "playbook"
	| "script"
	| "runbook-document"
	| "supporting";

/** Explicit AE16 disposition for one discovered browser-flow candidate. */
export type BrowserUseMonashSmstCandidateDisposition =
	| "import-inactive"
	| "merge-existing-target";

/** One path-and-hash row captured from the current Monash SMST worktree. */
export type BrowserUseMonashSmstReceiptArtifact = {
	source_relative_path: string;
	source_content_hash: string;
	tracking_state: "tracked-clean" | "untracked";
};

/**
 * Stable receipt for the selected browser-workflow closure.
 *
 * The receipt records that the source repository was dirty. It binds the
 * selected current bytes without claiming that the source revision was clean.
 */
export type BrowserUseMonashSmstSourceReceipt = {
	contract: "browser-use.monash-smst-corpus-receipt";
	schema_version: "1";
	source_repository: "monash-smst";
	source_revision: string;
	source_worktree_state: "dirty";
	tracked_changes_present: true;
	untracked_entries_present: true;
	receipt_scope: "selected-browser-workflow-closure";
	source_artifact_count: number;
	relative_path_digest: string;
	source_closure_digest: string;
	artifacts: readonly BrowserUseMonashSmstReceiptArtifact[];
};

/** Redacted fixture row assigning one explicit disposition to each source. */
export type BrowserUseMonashSmstSourceFixtureArtifact =
	BrowserUseMonashSmstReceiptArtifact & {
		disposition: BrowserUseMonashSmstSourceDisposition;
		reason: string;
	};

/** Redacted source fixture used to prove closure and disposition completeness. */
export type BrowserUseMonashSmstSourceFixture = {
	contract: "browser-use.monash-smst-source-fixture";
	schema_version: "1";
	artifacts: BrowserUseMonashSmstSourceFixtureArtifact[];
};

/** One classified Monash SMST candidate with exact source and human gates. */
export type BrowserUseMonashSmstCandidate = {
	candidate_id: string;
	category: keyof typeof EXPECTED_CATEGORY_COUNTS;
	service_id: string;
	flow_id: string;
	disposition: BrowserUseMonashSmstCandidateDisposition;
	canonical_target_id: string;
	source_group_id: string;
	source_relative_paths: readonly string[];
	outcome: string;
	allowed_origins: readonly string[];
	human_presence: readonly string[];
	reason: string;
};

/** Redacted fixture that maps the accepted 16 candidates to source groups. */
export type BrowserUseMonashSmstCandidateFixture = {
	contract: "browser-use.monash-smst-candidate-fixture";
	schema_version: "1";
	source_groups: Readonly<Record<string, readonly string[]>>;
	candidates: readonly Omit<
		BrowserUseMonashSmstCandidate,
		"source_relative_paths"
	>[];
};

/** Complete AE16 census ready for inactive generation composition. */
export type BrowserUseMonashSmstCensus = {
	contract: "browser-use.monash-smst-census";
	schema_version: "1";
	source_repository: "monash-smst";
	source_revision: string;
	source_worktree_state: "dirty";
	source_closure_digest: string;
	source_artifact_count: number;
	source_disposition_count: number;
	source_disposition_counts: Record<
		BrowserUseMonashSmstSourceDisposition,
		number
	>;
	discovery_counts: Record<BrowserUseMonashSmstSourceKind, number>;
	source_dispositions: readonly BrowserUseMonashSmstSourceFixtureArtifact[];
	candidate_count: number;
	category_counts: Record<keyof typeof EXPECTED_CATEGORY_COUNTS, number>;
	candidates: readonly BrowserUseMonashSmstCandidate[];
};

/** Typed census refusal; no source contents or absolute paths are retained. */
export type BrowserUseMonashSmstCensusFailure = {
	ok: false;
	code:
		| "monash_smst_receipt_invalid"
		| "monash_smst_source_drift"
		| "monash_smst_disposition_incomplete"
		| "monash_smst_candidate_drift";
	message: string;
};

/** Successful census plus the redacted bundled evidence used by drift tests. */
export type BrowserUseMonashSmstCensusSuccess = {
	ok: true;
	census: BrowserUseMonashSmstCensus;
	source_receipt: BrowserUseMonashSmstSourceReceipt;
	source_fixture: BrowserUseMonashSmstSourceFixture;
	candidate_fixture: BrowserUseMonashSmstCandidateFixture;
};

/** Total result returned by the Monash SMST census owner. */
export type BrowserUseMonashSmstCensusResult =
	| BrowserUseMonashSmstCensusSuccess
	| BrowserUseMonashSmstCensusFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function isSafeRelativePath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		value.split("/").every((segment) => segment !== "" && segment !== "..")
	);
}

function isExactOrigin(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" && parsed.origin === value;
	} catch {
		return false;
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sortedArtifacts(
	artifacts: readonly BrowserUseMonashSmstReceiptArtifact[],
): BrowserUseMonashSmstReceiptArtifact[] {
	return [...artifacts].sort((left, right) =>
		left.source_relative_path.localeCompare(right.source_relative_path),
	);
}

function relativePathDigest(
	artifacts: readonly BrowserUseMonashSmstReceiptArtifact[],
): string {
	return sha256(
		JSON.stringify(
			sortedArtifacts(artifacts).map((row) => row.source_relative_path),
		),
	);
}

function closureDigest(
	artifacts: readonly BrowserUseMonashSmstReceiptArtifact[],
): string {
	return sha256(
		JSON.stringify(
			sortedArtifacts(artifacts).map(
				({ source_relative_path, source_content_hash }) => ({
					source_relative_path,
					source_content_hash,
				}),
			),
		),
	);
}

function receiptArtifact(value: unknown): value is BrowserUseMonashSmstReceiptArtifact {
	if (!isRecord(value)) return false;
	return (
		isSafeRelativePath(value.source_relative_path) &&
		typeof value.source_content_hash === "string" &&
		SHA256.test(value.source_content_hash) &&
		(value.tracking_state === "tracked-clean" ||
			value.tracking_state === "untracked")
	);
}

function parseReceipt(value: unknown): BrowserUseMonashSmstSourceReceipt | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		!Array.isArray(value.artifacts)
	) {
		return null;
	}
	if (
		value.contract !== "browser-use.monash-smst-corpus-receipt" ||
		value.schema_version !== "1" ||
		value.source_repository !== "monash-smst" ||
		typeof value.source_revision !== "string" ||
		!SOURCE_REVISION.test(value.source_revision) ||
		value.source_worktree_state !== "dirty" ||
		value.tracked_changes_present !== true ||
		value.untracked_entries_present !== true ||
		value.receipt_scope !== "selected-browser-workflow-closure" ||
		typeof value.source_artifact_count !== "number" ||
		typeof value.relative_path_digest !== "string" ||
		!SHA256.test(value.relative_path_digest) ||
		typeof value.source_closure_digest !== "string" ||
		!SHA256.test(value.source_closure_digest) ||
		!value.artifacts.every(
			(row) =>
				isRecord(row) &&
				hasExactKeys(row, RECEIPT_ARTIFACT_KEYS) &&
				receiptArtifact(row),
		)
	) {
		return null;
	}
	const artifacts = sortedArtifacts(
		value.artifacts.map((row) => {
			if (!receiptArtifact(row)) throw new Error("unreachable receipt row");
			return {
				source_relative_path: row.source_relative_path,
				source_content_hash: row.source_content_hash,
				tracking_state: row.tracking_state,
			};
		}),
	);
	if (
		artifacts.length !== value.source_artifact_count ||
		new Set(artifacts.map((row) => row.source_relative_path)).size !==
			artifacts.length ||
		relativePathDigest(artifacts) !== value.relative_path_digest ||
		closureDigest(artifacts) !== value.source_closure_digest
	) {
		return null;
	}
	return {
		contract: "browser-use.monash-smst-corpus-receipt",
		schema_version: "1",
		source_repository: "monash-smst",
		source_revision: value.source_revision,
		source_worktree_state: "dirty",
		tracked_changes_present: true,
		untracked_entries_present: true,
		receipt_scope: "selected-browser-workflow-closure",
		source_artifact_count: value.source_artifact_count,
		relative_path_digest: value.relative_path_digest,
		source_closure_digest: value.source_closure_digest,
		artifacts,
	};
}

function sourceDisposition(
	value: unknown,
): value is BrowserUseMonashSmstSourceDisposition {
	return (
		value === "candidate-source" ||
		value === "supporting-knowledge" ||
		value === "action-candidate"
	);
}

function sourceKindFor(sourceRelativePath: string): BrowserUseMonashSmstSourceKind {
	if (sourceRelativePath.startsWith(".claude/skills/")) return "skill";
	if (sourceRelativePath.startsWith(".claude/agents/")) return "agent";
	if (sourceRelativePath.startsWith("docs/runbooks/")) return "runbook-document";
	if (
		sourceRelativePath.includes("/playbooks/") &&
		/\.(?:js|cjs|mjs|ts|tsx|sh|bash|zsh|py)$/.test(sourceRelativePath)
	) {
		return "script";
	}
	if (sourceRelativePath.includes("/playbooks/")) return "playbook";
	return "supporting";
}

function parseSourceFixture(
	value: unknown,
): BrowserUseMonashSmstSourceFixture | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, SOURCE_FIXTURE_KEYS) ||
		value.contract !== "browser-use.monash-smst-source-fixture" ||
		value.schema_version !== "1" ||
		!Array.isArray(value.artifacts)
	) {
		return null;
	}
	const artifacts: BrowserUseMonashSmstSourceFixtureArtifact[] = [];
	for (const row of value.artifacts) {
		if (
			!isRecord(row) ||
			!hasExactKeys(row, SOURCE_FIXTURE_ARTIFACT_KEYS)
		) {
			return null;
		}
		const disposition = row.disposition;
		const reason = row.reason;
		if (
			!receiptArtifact(row) ||
			!sourceDisposition(disposition) ||
			typeof reason !== "string" ||
			reason.trim() === "" ||
			findRedactionViolations({ reason }).length > 0
		) {
			return null;
		}
		artifacts.push({
			source_relative_path: row.source_relative_path,
			source_content_hash: row.source_content_hash,
			tracking_state: row.tracking_state,
			disposition,
			reason,
		});
	}
	return {
		contract: "browser-use.monash-smst-source-fixture",
		schema_version: "1",
		artifacts: sortedArtifacts(artifacts) as BrowserUseMonashSmstSourceFixtureArtifact[],
	};
}

function candidateDisposition(
	value: unknown,
): value is BrowserUseMonashSmstCandidateDisposition {
	return value === "import-inactive" || value === "merge-existing-target";
}

function candidateCategory(
	value: unknown,
): value is keyof typeof EXPECTED_CATEGORY_COUNTS {
	return (
		typeof value === "string" &&
		Object.hasOwn(EXPECTED_CATEGORY_COUNTS, value)
	);
}

function parseCandidateFixture(
	value: unknown,
): BrowserUseMonashSmstCandidateFixture | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, CANDIDATE_FIXTURE_KEYS) ||
		value.contract !== "browser-use.monash-smst-candidate-fixture" ||
		value.schema_version !== "1" ||
		!isRecord(value.source_groups) ||
		!Array.isArray(value.candidates)
	) {
		return null;
	}
	const sourceGroups: Record<string, readonly string[]> = {};
	for (const [groupId, paths] of Object.entries(value.source_groups)) {
		if (
			!SAFE_ID.test(groupId) ||
			!Array.isArray(paths) ||
			paths.length === 0 ||
			!paths.every(isSafeRelativePath) ||
			new Set(paths).size !== paths.length
		) {
			return null;
		}
		sourceGroups[groupId] = [...paths].sort();
	}
	if (
		JSON.stringify(Object.keys(sourceGroups).sort()) !==
		JSON.stringify(EXPECTED_SOURCE_GROUP_IDS)
	) {
		return null;
	}
	const candidates: Array<
		Omit<BrowserUseMonashSmstCandidate, "source_relative_paths">
	> = [];
	for (const candidate of value.candidates) {
		if (
			!isRecord(candidate) ||
			!hasExactKeys(candidate, CANDIDATE_KEYS) ||
			typeof candidate.candidate_id !== "string" ||
			!SAFE_ID.test(candidate.candidate_id) ||
			!candidateCategory(candidate.category) ||
			typeof candidate.service_id !== "string" ||
			!SAFE_ID.test(candidate.service_id) ||
			typeof candidate.flow_id !== "string" ||
			!SAFE_ID.test(candidate.flow_id) ||
			!candidateDisposition(candidate.disposition) ||
			candidate.canonical_target_id !==
				`${candidate.service_id}/${candidate.flow_id}` ||
			typeof candidate.source_group_id !== "string" ||
			sourceGroups[candidate.source_group_id] === undefined ||
			typeof candidate.outcome !== "string" ||
			candidate.outcome.trim() === "" ||
			!Array.isArray(candidate.allowed_origins) ||
			candidate.allowed_origins.length === 0 ||
			!candidate.allowed_origins.every(isExactOrigin) ||
			!Array.isArray(candidate.human_presence) ||
			!candidate.human_presence.every(
				(gate) => typeof gate === "string" && SAFE_ID.test(gate),
			) ||
			typeof candidate.reason !== "string" ||
			candidate.reason.trim() === "" ||
			findRedactionViolations({
				human_presence: candidate.human_presence,
				outcome: candidate.outcome,
				reason: candidate.reason,
			}).length > 0
		) {
			return null;
		}
		candidates.push({
			candidate_id: candidate.candidate_id,
			category: candidate.category,
			service_id: candidate.service_id,
			flow_id: candidate.flow_id,
			disposition: candidate.disposition,
			canonical_target_id: candidate.canonical_target_id,
			source_group_id: candidate.source_group_id,
			outcome: candidate.outcome,
			allowed_origins: candidate.allowed_origins,
			human_presence: candidate.human_presence,
			reason: candidate.reason,
		});
	}
	return {
		contract: "browser-use.monash-smst-candidate-fixture",
		schema_version: "1",
		source_groups: sourceGroups,
		candidates: candidates.sort((left, right) =>
			left.candidate_id.localeCompare(right.candidate_id),
		),
	};
}

function failure(
	code: BrowserUseMonashSmstCensusFailure["code"],
	message: string,
): BrowserUseMonashSmstCensusFailure {
	return { ok: false, code, message };
}

/**
 * Validate one redacted Monash SMST source closure and produce the AE16 census.
 *
 * The caller supplies no source contents. Exact relative paths and SHA-256
 * identities bind the selected dirty-worktree bytes; any change fails closed.
 *
 * @param receiptValue - Stable reviewed closure receipt
 * @param sourceFixtureValue - Explicit per-source dispositions
 * @param candidateFixtureValue - Explicit 16-candidate classification
 * @returns Complete census or a typed secret-free refusal
 *
 * @example
 * ```typescript
 * const result = censusMonashSmstCorpus(receipt, sources, candidates)
 * if (result.ok) console.log(result.census.candidate_count)
 * ```
 */
export function censusMonashSmstCorpus(
	receiptValue: unknown,
	sourceFixtureValue: unknown,
	candidateFixtureValue: unknown,
): BrowserUseMonashSmstCensusResult {
	const receipt = parseReceipt(receiptValue);
	const sourceFixture = parseSourceFixture(sourceFixtureValue);
	const candidateFixture = parseCandidateFixture(candidateFixtureValue);
	if (receipt === null || sourceFixture === null || candidateFixture === null) {
		return failure(
			"monash_smst_receipt_invalid",
			"Monash SMST receipt or redacted fixture is invalid.",
		);
	}
	const receiptRows = receipt.artifacts.map(
		({ source_relative_path, source_content_hash, tracking_state }) => ({
			source_relative_path,
			source_content_hash,
			tracking_state,
		}),
	);
	const fixtureRows = sourceFixture.artifacts.map(
		({ source_relative_path, source_content_hash, tracking_state }) => ({
			source_relative_path,
			source_content_hash,
			tracking_state,
		}),
	);
	if (JSON.stringify(receiptRows) !== JSON.stringify(fixtureRows)) {
		return failure(
			"monash_smst_source_drift",
			"Monash SMST source closure differs from the captured receipt; recensus before import.",
		);
	}
	if (sourceFixture.artifacts.length !== receipt.source_artifact_count) {
		return failure(
			"monash_smst_disposition_incomplete",
			"Every selected Monash SMST source artifact requires one disposition.",
		);
	}
	const sourcePaths = new Set(
		sourceFixture.artifacts.map((row) => row.source_relative_path),
	);
	const candidates = candidateFixture.candidates.map((candidate) => ({
		...candidate,
		source_relative_paths:
			candidateFixture.source_groups[candidate.source_group_id] ?? [],
	}));
	if (
		candidates.length !== EXPECTED_CANDIDATE_IDS.length ||
		JSON.stringify(candidates.map((candidate) => candidate.candidate_id)) !==
			JSON.stringify(EXPECTED_CANDIDATE_IDS) ||
		new Set(candidates.map((candidate) => candidate.canonical_target_id)).size !==
			candidates.length ||
		candidates.some(
			(candidate) =>
				candidate.source_relative_paths.length === 0 ||
				candidate.source_relative_paths.some((path) => !sourcePaths.has(path)),
		) ||
		candidates.filter(
			(candidate) => candidate.disposition === "merge-existing-target",
		).length !== 1 ||
		candidates.find(
			(candidate) => candidate.disposition === "merge-existing-target",
		)?.canonical_target_id !== "fasttrack/fill-week"
	) {
		return failure(
			"monash_smst_candidate_drift",
			"Monash SMST candidate census differs from the accepted AE16 set.",
		);
	}
	const categoryCounts = Object.fromEntries(
		Object.keys(EXPECTED_CATEGORY_COUNTS).map((category) => [
			category,
			candidates.filter((candidate) => candidate.category === category).length,
		]),
	) as Record<keyof typeof EXPECTED_CATEGORY_COUNTS, number>;
	if (
		JSON.stringify(categoryCounts) !== JSON.stringify(EXPECTED_CATEGORY_COUNTS)
	) {
		return failure(
			"monash_smst_candidate_drift",
			"Monash SMST candidate categories differ from the accepted AE16 counts.",
		);
	}
	const sourceDispositionCounts = {
		"action-candidate": sourceFixture.artifacts.filter(
			(row) => row.disposition === "action-candidate",
		).length,
		"candidate-source": sourceFixture.artifacts.filter(
			(row) => row.disposition === "candidate-source",
		).length,
		"supporting-knowledge": sourceFixture.artifacts.filter(
			(row) => row.disposition === "supporting-knowledge",
		).length,
	};
	const discoveryCounts: Record<BrowserUseMonashSmstSourceKind, number> = {
		skill: 0,
		agent: 0,
		playbook: 0,
		script: 0,
		"runbook-document": 0,
		supporting: 0,
	};
	for (const source of sourceFixture.artifacts) {
		discoveryCounts[sourceKindFor(source.source_relative_path)] += 1;
	}
	return {
		ok: true,
		census: {
			contract: "browser-use.monash-smst-census",
			schema_version: "1",
			source_repository: receipt.source_repository,
			source_revision: receipt.source_revision,
			source_worktree_state: receipt.source_worktree_state,
			source_closure_digest: receipt.source_closure_digest,
			source_artifact_count: receipt.source_artifact_count,
			source_disposition_count: sourceFixture.artifacts.length,
			source_disposition_counts: sourceDispositionCounts,
			discovery_counts: discoveryCounts,
			source_dispositions: sourceFixture.artifacts,
			candidate_count: candidates.length,
			category_counts: categoryCounts,
			candidates,
		},
		source_receipt: receipt,
		source_fixture: sourceFixture,
		candidate_fixture: candidateFixture,
	};
}

/**
 * Read the package-owned redacted receipt and fixtures.
 *
 * No runtime path points at the Monash SMST checkout. Browser Use owns the
 * captured classification after this one-way handoff.
 *
 * @returns Complete bundled census or a typed fixture-integrity refusal
 *
 * @example
 * ```typescript
 * const result = censusBundledMonashSmstCorpus()
 * ```
 */
export function censusBundledMonashSmstCorpus(): BrowserUseMonashSmstCensusResult {
	return censusMonashSmstCorpus(
		bundledReceipt,
		bundledSourceClosure,
		bundledCandidates,
	);
}
