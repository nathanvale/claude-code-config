import type { BrowserUseCorpusGenerationTargetInput } from "./browser-use-corpus-generation-builder";
import type { BrowserUseMonashSmstCensus } from "./browser-use-monash-smst-census";

const MONASH_SMST_SOURCE_NAMESPACE = "monash-smst";

/**
 * Compose the accepted Monash SMST candidates as inactive Browser Use targets.
 *
 * The resulting definitions preserve the user-visible outcome and source
 * hashes but cannot dispatch. Activation remains a later per-runbook proof.
 *
 * @param census - Verified AE16 census bound to the captured source closure
 * @returns One distinct inactive definition per accepted canonical target
 *
 * @example
 * ```typescript
 * const targets = composeMonashSmstInactiveTargets(census)
 * ```
 */
export function composeMonashSmstInactiveTargets(
	census: BrowserUseMonashSmstCensus,
): readonly BrowserUseCorpusGenerationTargetInput[] {
	const sourceHashes = new Map(
		census.source_dispositions.map((row) => [
			row.source_relative_path,
			row.source_content_hash,
		]),
	);
	return census.candidates
		.map((candidate): BrowserUseCorpusGenerationTargetInput => {
			const source_provenance = candidate.source_relative_paths.map(
				(source_relative_path) => {
					const sourceContentHash = sourceHashes.get(source_relative_path);
					if (sourceContentHash === undefined) {
						throw new Error(
							`Monash SMST candidate lacks captured source identity: ${source_relative_path}.`,
						);
					}
					return {
						source_namespace: MONASH_SMST_SOURCE_NAMESPACE,
						source_relative_path,
						source_content_hash: sourceContentHash,
					};
				},
			);
			return {
				canonicalTargetId: candidate.canonical_target_id,
				runbook: {
					contract: "browser-use.runbook",
					schema_version: "2",
					service_id: candidate.service_id,
					flow_id: candidate.flow_id,
					flow_name: candidate.flow_id,
					version: "1",
					summary: candidate.outcome,
					allowed_origins: candidate.allowed_origins,
					inputs: [],
					steps: [{ kind: "snapshot", interactive: false }],
				},
				activation: "inactive",
				inactiveReason:
					"Imported from the Monash SMST census; review, authentication, and public-CLI postcondition proof remain required.",
				proofs: [
					{
						proofRef: `monash-smst-${candidate.candidate_id}`,
						payload: {
							contract: "browser-use.monash-smst-import-proof",
							schema_version: "1",
							candidate_id: candidate.candidate_id,
							canonical_target_id: candidate.canonical_target_id,
							disposition: candidate.disposition,
							expected_outcome: candidate.outcome,
							human_presence: candidate.human_presence,
							source_namespace: MONASH_SMST_SOURCE_NAMESPACE,
							source_revision: census.source_revision,
							source_worktree_state: census.source_worktree_state,
							source_provenance,
							status: "inactive-unproven",
						},
					},
				],
			};
		})
		.sort((left, right) =>
			left.canonicalTargetId.localeCompare(right.canonicalTargetId),
		);
}
