import { createHash } from "node:crypto";
import type { BrowserUseCorpusGenerationBuildInput } from "./browser-use-corpus-generation-builder";
import {
	composeBrowserUseCorpusMigration,
	type BrowserUseCorpusMigrationCompositionDeps,
	type BrowserUseCorpusMigrationCompositionInput,
} from "./browser-use-corpus-migration-composition";
import type {
	BrowserUseArtifactClass,
	BrowserUseCanonicalTarget,
	BrowserUseMigrationDisposition,
	BrowserUseMigrationState,
	BrowserUseTargetProvenance,
} from "./browser-use-migration-model";
import type {
	BrowserUseMonashSmstCensus,
	BrowserUseMonashSmstSourceFixtureArtifact,
} from "./browser-use-monash-smst-census";
import { composeMonashSmstInactiveTargets } from "./browser-use-monash-smst-composition";
import type { BrowserUseSourceSnapshotPayload } from "./browser-use-schemas";

const MONASH_SMST_SOURCE_NAMESPACE = "monash-smst";
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function namespacedSourcePath(sourceRelativePath: string): string {
	return `${MONASH_SMST_SOURCE_NAMESPACE}/${sourceRelativePath}`;
}

function artifactClassFor(
	source: BrowserUseMonashSmstSourceFixtureArtifact,
): BrowserUseArtifactClass {
	if (source.disposition === "action-candidate") return "script";
	if (
		source.source_relative_path.includes("/playbooks/") &&
		!source.source_relative_path.includes("/scripts/")
	) {
		return "formal-playbook";
	}
	if (source.disposition === "candidate-source") return "formal-runbook";
	return "supporting";
}

function migrationDispositionFor(
	source: BrowserUseMonashSmstSourceFixtureArtifact,
): BrowserUseMigrationDisposition {
	const actionCandidate = source.disposition === "action-candidate";
	return {
		source_relative_path: namespacedSourcePath(source.source_relative_path),
		source_content_hash: source.source_content_hash,
		artifact_class: artifactClassFor(source),
		formal_flow_id: null,
		canonical_target_id: null,
		disposition: actionCandidate
			? "quarantine-executable"
			: "provenance-only",
		reason: source.reason,
		transform_version: "monash-smst-census-v1",
		logical_destination_id: null,
		expected_hash: null,
	};
}

function hasExactMonashDispositionExtension(
	state: BrowserUseMigrationState,
	census: BrowserUseMonashSmstCensus,
): boolean {
	const expected = census.source_dispositions.map(migrationDispositionFor);
	const byPath = new Map(
		state.dispositions.map((row) => [row.source_relative_path, row]),
	);
	const present = expected.filter((row) =>
		byPath.has(row.source_relative_path),
	);
	if (present.length === 0) return false;
	if (
		present.length !== expected.length ||
		expected.some(
			(row) =>
				JSON.stringify(byPath.get(row.source_relative_path)) !==
				JSON.stringify(row),
		)
	) {
		throw new Error(
			"Monash SMST integration found a partial or changed standing extension.",
		);
	}
	return true;
}

function mergedCanonicalTargets(
	state: BrowserUseMigrationState,
	census: BrowserUseMonashSmstCensus,
): BrowserUseCanonicalTarget[] {
	const sourcesByTarget = new Map(
		state.canonical_targets.map((target) => [
			target.canonical_target_id,
			new Set(target.source_relative_paths),
		]),
	);
	for (const candidate of census.candidates) {
		const sources =
			sourcesByTarget.get(candidate.canonical_target_id) ?? new Set<string>();
		for (const source of candidate.source_relative_paths) {
			sources.add(namespacedSourcePath(source));
		}
		sourcesByTarget.set(candidate.canonical_target_id, sources);
	}
	return [...sourcesByTarget.entries()]
		.map(([canonical_target_id, sources]) => ({
			canonical_target_id,
			source_relative_paths: [...sources].sort(),
		}))
		.sort((left, right) =>
			left.canonical_target_id.localeCompare(right.canonical_target_id),
		);
}

function mergedTargetProvenance(
	state: BrowserUseMigrationState,
	census: BrowserUseMonashSmstCensus,
): BrowserUseTargetProvenance[] {
	const candidateSourcePaths = new Set(
		census.source_dispositions
			.filter((source) => source.disposition === "candidate-source")
			.map((source) => source.source_relative_path),
	);
	const monash = census.candidates.map((candidate) => {
		const sourceRelativePath =
			candidate.source_relative_paths.find((path) =>
				candidateSourcePaths.has(path),
			) ?? candidate.source_relative_paths[0];
		if (sourceRelativePath === undefined) {
			throw new Error(
				`Monash SMST candidate lacks source provenance: ${candidate.candidate_id}.`,
			);
		}
		return {
			source_relative_path: namespacedSourcePath(sourceRelativePath),
			source_flow_id: candidate.candidate_id,
			canonical_target_id: candidate.canonical_target_id,
			activation: "canonical" as const,
			reason: candidate.reason,
		};
	});
	const rows = new Map(
		(state.target_provenance ?? []).map((row) => [
			`${row.source_relative_path}\0${row.source_flow_id}`,
			row,
		]),
	);
	for (const row of monash) {
		const key = `${row.source_relative_path}\0${row.source_flow_id}`;
		const standing = rows.get(key);
		if (
			standing !== undefined &&
			JSON.stringify(standing) !== JSON.stringify(row)
		) {
			throw new Error(
				"Monash SMST integration found changed standing target provenance.",
			);
		}
		rows.set(key, row);
	}
	return [...rows.values()].sort((left, right) =>
		`${left.canonical_target_id}/${left.source_flow_id}`.localeCompare(
			`${right.canonical_target_id}/${right.source_flow_id}`,
		),
	);
}

/** Build one standard entry-digested snapshot for the base plus Monash closure. */
export function composeMonashSmstSourceSnapshot(
	state: BrowserUseMigrationState,
	baseSnapshot: BrowserUseSourceSnapshotPayload,
	census: BrowserUseMonashSmstCensus,
): BrowserUseSourceSnapshotPayload {
	if (
		state.phase !== "verified" ||
		state.snapshot_id === null ||
		state.snapshot_digest === null ||
		state.source_root_identity === null ||
		baseSnapshot.snapshot_id !== state.snapshot_id ||
		baseSnapshot.snapshot_digest !== state.snapshot_digest ||
		baseSnapshot.root_identity !== state.source_root_identity ||
		baseSnapshot.entries.length !== state.source_entry_count ||
		sha256(JSON.stringify(baseSnapshot.entries)) !== state.snapshot_digest
	) {
		throw new Error(
			"Monash SMST integration requires the exact verified base snapshot.",
		);
	}
	const baseEntriesByPath = new Map(
		baseSnapshot.entries.map((entry) => [entry.relative_path, entry]),
	);
	if (
		baseEntriesByPath.size !== baseSnapshot.entries.length ||
		state.dispositions.some(
			(row) =>
				baseEntriesByPath.get(row.source_relative_path)?.content_hash !==
				row.source_content_hash,
		)
	) {
		throw new Error(
			"Monash SMST integration found incomplete base snapshot evidence.",
		);
	}
	const monashEntries: BrowserUseSourceSnapshotPayload["entries"] =
		census.source_dispositions.map((source) => ({
			relative_path: namespacedSourcePath(source.source_relative_path),
			type: "file",
			// The accepted receipt retains hashes, not raw filesystem metadata.
			size: 0,
			mode: 0,
			content_hash: source.source_content_hash,
		}));
	const entries = [...baseSnapshot.entries, ...monashEntries].sort(
		(left, right) => left.relative_path.localeCompare(right.relative_path),
	);
	if (
		new Set(entries.map((entry) => entry.relative_path)).size !== entries.length
	) {
		throw new Error(
			"Monash SMST integration found a composite source-path collision.",
		);
	}
	const snapshotDigest = sha256(JSON.stringify(entries));
	return {
		snapshot_id: `snapshot-${snapshotDigest.slice(0, 16)}`,
		root_identity: sha256(
			JSON.stringify({
				base_source_root_identity: state.source_root_identity,
				monash_source_repository: census.source_repository,
				monash_source_closure_digest: census.source_closure_digest,
			}),
		),
		entries,
		snapshot_digest: snapshotDigest,
	};
}

function mergedState(
	state: BrowserUseMigrationState,
	census: BrowserUseMonashSmstCensus,
	compositeSnapshot: BrowserUseSourceSnapshotPayload,
): BrowserUseMigrationState {
	if (
		state.phase !== "verified" ||
		state.snapshot_digest === null ||
		state.source_root_identity === null
	) {
		throw new Error("Monash SMST integration requires one verified base corpus.");
	}
	const monashDispositions = census.source_dispositions.map(
		migrationDispositionFor,
	);
	const alreadyExtended = hasExactMonashDispositionExtension(
		state,
		census,
	);
	const allDispositions = [
		...state.dispositions,
		...(alreadyExtended ? [] : monashDispositions),
	].sort(
		(left, right) =>
			left.source_relative_path.localeCompare(right.source_relative_path),
	);
	const snapshotEntriesByPath = new Map(
		compositeSnapshot.entries.map((entry) => [entry.relative_path, entry]),
	);
	if (
		!SHA256.test(compositeSnapshot.snapshot_digest) ||
		!SHA256.test(compositeSnapshot.root_identity) ||
		compositeSnapshot.snapshot_id !==
			`snapshot-${compositeSnapshot.snapshot_digest.slice(0, 16)}` ||
		sha256(JSON.stringify(compositeSnapshot.entries)) !==
			compositeSnapshot.snapshot_digest ||
		compositeSnapshot.entries.length !== allDispositions.length ||
		snapshotEntriesByPath.size !== compositeSnapshot.entries.length ||
		allDispositions.some(
			(row) =>
				snapshotEntriesByPath.get(row.source_relative_path)?.content_hash !==
				row.source_content_hash,
		)
	) {
		throw new Error(
			"Monash SMST integration requires one exact composite source snapshot.",
		);
	}
	const formalArtifactCount = monashDispositions.filter(
		(row) =>
			row.artifact_class === "formal-runbook" ||
			row.artifact_class === "formal-playbook",
	).length;
	const scriptCount = monashDispositions.filter(
		(row) => row.artifact_class === "script",
	).length;
	return {
		...state,
		snapshot_id: compositeSnapshot.snapshot_id,
		snapshot_digest: compositeSnapshot.snapshot_digest,
		source_root_identity: compositeSnapshot.root_identity,
		source_entry_count: allDispositions.length,
		disposition_count: allDispositions.length,
		dispositions: allDispositions,
		corpus_census:
			alreadyExtended
				? state.corpus_census
				: {
						formal_artifacts:
							(state.corpus_census?.formal_artifacts ?? 0) +
							formalArtifactCount,
						target_flows:
							(state.corpus_census?.target_flows ?? 0) +
							census.candidate_count,
						scripts:
							(state.corpus_census?.scripts ?? 0) + scriptCount,
						auth_narratives:
							state.corpus_census?.auth_narratives ?? 0,
						login_capabilities:
							state.corpus_census?.login_capabilities ?? 0,
						domain_script_actions:
							state.corpus_census?.domain_script_actions ?? 0,
					},
		canonical_targets: mergedCanonicalTargets(state, census),
		target_provenance: mergedTargetProvenance(state, census),
		activation_state: state.activation_state,
	};
}

/**
 * Merge the package-owned Monash SMST census into one verified corpus input.
 *
 * Existing `fasttrack/fill-week` definition authority wins and receives one
 * extra Monash proof. Every other accepted candidate enters inactive. Source
 * paths and hashes become provenance only, so the builder never reads the
 * external Monash checkout.
 *
 * @param input - Existing verified corpus generation input
 * @param census - Exact bundled AE16 census
 * @returns Combined deterministic generation input with no duplicate target
 * @throws {Error} When base state, overlap, or source paths are inconsistent
 *
 * @example
 * ```typescript
 * const merged = mergeMonashSmstCensusIntoCorpus(base, census, snapshot)
 * const generation = await buildBrowserUseCorpusGeneration({ fs }, merged)
 * ```
 */
export function mergeMonashSmstCensusIntoCorpus(
	input: BrowserUseCorpusGenerationBuildInput,
	census: BrowserUseMonashSmstCensus,
	compositeSnapshot: BrowserUseSourceSnapshotPayload,
): BrowserUseCorpusGenerationBuildInput {
	const monashTargets = composeMonashSmstInactiveTargets(census);
	const candidatesByTarget = new Map(
		census.candidates.map((candidate) => [
			candidate.canonical_target_id,
			candidate,
		]),
	);
	const targetsById = new Map(
		input.targets.map((target) => [target.canonicalTargetId, target]),
	);
	for (const target of monashTargets) {
		const existing = targetsById.get(target.canonicalTargetId);
		if (existing === undefined) {
			targetsById.set(target.canonicalTargetId, target);
			continue;
		}
		const candidate = candidatesByTarget.get(target.canonicalTargetId);
		if (
			candidate?.disposition !== "merge-existing-target"
		) {
			throw new Error(
				"Monash SMST integration found an unapproved target overlap.",
			);
		}
		const proof = target.proofs[0];
		if (
			proof === undefined ||
			existing.proofs.some((row) => row.proofRef === proof.proofRef)
		) {
			throw new Error(
				"Monash SMST integration found a duplicate or missing overlap proof.",
			);
		}
		targetsById.set(target.canonicalTargetId, {
			...existing,
			proofs: [...existing.proofs, proof].sort((left, right) =>
				left.proofRef.localeCompare(right.proofRef),
			),
		});
	}
	return {
		...input,
		state: mergedState(input.state, census, compositeSnapshot),
		generationId: `${input.generationId}-monash-${census.source_closure_digest.slice(0, 12)}`,
		targets: [...targetsById.values()].sort((left, right) =>
			left.canonicalTargetId.localeCompare(right.canonicalTargetId),
		),
	};
}

/**
 * Recompose a previously imported combined corpus while preserving Monash.
 *
 * The base domain owners see only their original target provenance. The
 * package-owned Monash extension is then deterministically re-applied against
 * the standing composite snapshot, so one reviewed base target can graduate
 * without dropping the other inactive targets.
 */
export async function composeImportedMonashSmstCorpusMigration(
	deps: BrowserUseCorpusMigrationCompositionDeps,
	input: BrowserUseCorpusMigrationCompositionInput,
	census: BrowserUseMonashSmstCensus,
	compositeSnapshot: BrowserUseSourceSnapshotPayload,
): Promise<BrowserUseCorpusGenerationBuildInput> {
	if (!hasExactMonashDispositionExtension(input.state, census)) {
		throw new Error(
			"Monash SMST recomposition requires the exact imported extension.",
		);
	}
	const canonicalTargets = input.state.canonical_targets
		.map((target) => ({
			...target,
			source_relative_paths: target.source_relative_paths.filter(
				(path) => !path.startsWith(`${MONASH_SMST_SOURCE_NAMESPACE}/`),
			),
		}))
		.filter((target) => target.source_relative_paths.length > 0);
	if (canonicalTargets.length === input.state.canonical_targets.length) {
		throw new Error(
			"Monash SMST recomposition requires at least one imported target.",
		);
	}
	const base = await composeBrowserUseCorpusMigration(deps, {
		...input,
		state: {
			...input.state,
			canonical_targets: canonicalTargets,
		},
	});
	return mergeMonashSmstCensusIntoCorpus(
		base,
		census,
		compositeSnapshot,
	);
}
