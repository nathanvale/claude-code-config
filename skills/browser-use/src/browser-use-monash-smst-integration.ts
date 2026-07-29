import { createHash } from "node:crypto";
import type { BrowserUseCorpusGenerationBuildInput } from "./browser-use-corpus-generation-builder";
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

const MONASH_SMST_SOURCE_NAMESPACE = "monash-smst";

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
	return [...(state.target_provenance ?? []), ...monash].sort((left, right) =>
		`${left.canonical_target_id}/${left.source_flow_id}`.localeCompare(
			`${right.canonical_target_id}/${right.source_flow_id}`,
		),
	);
}

function mergedState(
	state: BrowserUseMigrationState,
	census: BrowserUseMonashSmstCensus,
): BrowserUseMigrationState {
	if (
		state.phase !== "verified" ||
		state.snapshot_digest === null ||
		state.source_root_identity === null
	) {
		throw new Error("Monash SMST integration requires one verified base corpus.");
	}
	const occupiedPaths = new Set(
		state.dispositions.map((row) => row.source_relative_path),
	);
	if (
		census.source_dispositions.some((row) =>
			occupiedPaths.has(namespacedSourcePath(row.source_relative_path)),
		)
	) {
		throw new Error(
			"Monash SMST integration found a source-path collision in the base corpus.",
		);
	}
	const monashDispositions = census.source_dispositions.map(
		migrationDispositionFor,
	);
	const snapshotDigest = sha256(
		JSON.stringify({
			base_snapshot_digest: state.snapshot_digest,
			monash_source_closure_digest: census.source_closure_digest,
		}),
	);
	const sourceRootIdentity = sha256(
		JSON.stringify({
			base_source_root_identity: state.source_root_identity,
			monash_source_repository: census.source_repository,
			monash_source_closure_digest: census.source_closure_digest,
		}),
	);
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
		snapshot_id: `snapshot-${snapshotDigest.slice(0, 16)}`,
		snapshot_digest: snapshotDigest,
		source_root_identity: sourceRootIdentity,
		source_entry_count:
			state.source_entry_count + census.source_artifact_count,
		disposition_count:
			state.disposition_count + census.source_disposition_count,
		dispositions: [...state.dispositions, ...monashDispositions].sort(
			(left, right) =>
				left.source_relative_path.localeCompare(right.source_relative_path),
		),
		corpus_census: {
			formal_artifacts:
				(state.corpus_census?.formal_artifacts ?? 0) + formalArtifactCount,
			target_flows:
				(state.corpus_census?.target_flows ?? 0) + census.candidate_count,
			scripts: (state.corpus_census?.scripts ?? 0) + scriptCount,
			auth_narratives: state.corpus_census?.auth_narratives ?? 0,
			login_capabilities: state.corpus_census?.login_capabilities ?? 0,
			domain_script_actions:
				state.corpus_census?.domain_script_actions ?? 0,
		},
		canonical_targets: mergedCanonicalTargets(state, census),
		target_provenance: mergedTargetProvenance(state, census),
		activation_state: "unchanged",
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
 * const merged = mergeMonashSmstCensusIntoCorpus(base, census)
 * const generation = await buildBrowserUseCorpusGeneration({ fs }, merged)
 * ```
 */
export function mergeMonashSmstCensusIntoCorpus(
	input: BrowserUseCorpusGenerationBuildInput,
	census: BrowserUseMonashSmstCensus,
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
			candidate?.disposition !== "merge-existing-target" ||
			existing.activation !== "inactive"
		) {
			throw new Error(
				"Monash SMST integration found an unapproved or active target overlap.",
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
		state: mergedState(input.state, census),
		generationId: `${input.generationId}-monash-${census.source_closure_digest.slice(0, 12)}`,
		targets: [...targetsById.values()].sort((left, right) =>
			left.canonicalTargetId.localeCompare(right.canonicalTargetId),
		),
	};
}
