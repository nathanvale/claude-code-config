import { describe, expect, test } from "bun:test";
import {
	activationPendingProblem,
	corpusGenerationCandidateProblem,
	corpusGenerationManifestProblem,
	generationEffectFenceProblem,
	generationProblem,
} from "./browser-use-generation-schemas";

const CANDIDATE = {
	contract: "browser-use.corpus-generation-candidate",
	schema_version: "1",
	generation_id: "generation-1",
	source_snapshot: {
		snapshot_id: "snapshot-1",
		snapshot_digest: "1".repeat(64),
	},
	canonical_targets: [
		{
			canonical_target_id: "example/read",
			activation: "active",
			runbook_path: "runbooks/example/read/runbook.json",
			runbook_digest: "2".repeat(64),
			source_relative_paths: ["example/read.json"],
			proof_refs: ["proof-read"],
			inactive_reason: null,
		},
	],
	action_registry: {
		registry_path: "actions/registry.json",
		registry_digest: "3".repeat(64),
		actions: [],
	},
	auth: { candidates: [], routes: [] },
	proofs: [
		{
			proof_ref: "proof-read",
			path: "proofs/read.json",
			digest: "4".repeat(64),
		},
	],
	shipped_catalog_digest: "5".repeat(64),
} as const;

describe("Corpus Generation schema owner", () => {
	test("accepts one complete valid schema family", () => {
		expect(
			generationProblem({
				generation_id: "generation-1",
				content_hash: "content-hash",
				status: "staged",
				staged_at_epoch_ms: 1,
			}),
		).toBeUndefined();
		expect(corpusGenerationCandidateProblem(CANDIDATE)).toBeUndefined();
		expect(
			corpusGenerationManifestProblem({
				...CANDIDATE,
				contract: "browser-use.corpus-generation-manifest",
				generation_content_hash: "6".repeat(64),
				candidate_manifest_digest: "7".repeat(64),
				activation_epoch: 2,
				activated_at_epoch_ms: 2,
				prior_generation: null,
				retained_generations: [],
			}),
		).toBeUndefined();
		expect(
			generationEffectFenceProblem({
				generation_id: "generation-1",
				activation_epoch: 2,
				state: "untripped",
				tripped_at_epoch_ms: null,
				first_effect: null,
			}),
		).toBeUndefined();
		expect(
			activationPendingProblem({
				expected_epoch: 1,
				target_generation_id: "generation-1",
				generation_content_hash: "6".repeat(64),
				candidate_manifest_digest: "7".repeat(64),
			}),
		).toBeUndefined();
	});

	test("retains cross-field invariant refusals", () => {
		expect(
			corpusGenerationCandidateProblem({
				...CANDIDATE,
				canonical_targets: [
					{
						...CANDIDATE.canonical_targets[0],
						inactive_reason: "reason on active target",
					},
				],
			}),
		).toBe("payload.canonical_targets.0.inactive_reason must be null for an active target.");
		expect(
			corpusGenerationManifestProblem({
				...CANDIDATE,
				contract: "browser-use.corpus-generation-manifest",
				generation_content_hash: "6".repeat(64),
				candidate_manifest_digest: "7".repeat(64),
				activation_epoch: 2,
				activated_at_epoch_ms: 2,
				prior_generation: {
					generation_id: "generation-0",
					generation_content_hash: "8".repeat(64),
					candidate_manifest_digest: "9".repeat(64),
					activation_epoch: 1,
				},
				retained_generations: [],
			}),
		).toBe("payload.prior_generation must match one retained activation identity.");
		expect(
			generationEffectFenceProblem({
				generation_id: "generation-1",
				activation_epoch: 2,
				state: "untripped",
				tripped_at_epoch_ms: 2,
				first_effect: null,
			}),
		).toBe("an untripped fence must not carry trip metadata.");
		expect(
			activationPendingProblem({
				expected_epoch: 1,
				target_generation_id: "generation-1",
				generation_content_hash: "not-a-digest",
				candidate_manifest_digest: "7".repeat(64),
			}),
		).toBe("payload.generation_content_hash must be a lowercase 64-hex sha256 digest.");
	});
});
