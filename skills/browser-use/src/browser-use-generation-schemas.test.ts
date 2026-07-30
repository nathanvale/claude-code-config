import { describe, expect, test } from "bun:test";
import {
	activationPendingProblem,
	corpusGenerationCandidateProblem,
	corpusGenerationManifestProblem,
	generationEffectFenceProblem,
	generationProblem,
	parseGenerationAuthRouteRecord,
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
	test("accepts legacy and complete session-bound auth routes", () => {
		const legacyRoute = {
			auth_context_ref: "oncore-session",
			candidate_id: "candidate-oncore",
			status: "active",
		} as const;
		const sessionRoute = {
			...legacyRoute,
			session_policy: {
				schema_version: "1",
				approved_service_origins: ["https://example.test"],
				approved_identity_provider_origins: ["https://login.example.test"],
				auth_flow: {
					schema_version: "1",
					fields: {
						username: { role: "textbox", name: "Email address" },
						password: { role: "textbox", name: "Password" },
						otp: { role: "textbox", name: "Verification code" },
					},
					identify_state: {
						action_id: "oncore-identify-auth-state",
						expected_digest: "1".repeat(64),
					},
					username_submit: {
						action_id: "oncore-submit-username",
						expected_digest: "2".repeat(64),
					},
					password_submit: {
						action_id: "oncore-submit-password",
						expected_digest: "3".repeat(64),
					},
					otp_submit: {
						action_id: "oncore-submit-otp",
						expected_digest: "4".repeat(64),
					},
				},
				identity_verifier: {
					schema_version: "1",
					action: {
						action_id: "oncore-verify-session",
						expected_digest: "5".repeat(64),
					},
					expected: {
						subject_reference: "oncore-subject-expected",
						account_reference: "oncore-account-expected",
						tenant_reference: "oncore-tenant-expected",
					},
					freshness_ms: 60_000,
				},
			},
		} as const;

		expect(parseGenerationAuthRouteRecord(legacyRoute)).toEqual(legacyRoute);
		expect(parseGenerationAuthRouteRecord(sessionRoute)).toEqual(sessionRoute);
	});

	test("rejects partial, malformed, unknown, duplicate, or hostile session policies", () => {
		const route = {
			auth_context_ref: "oncore-session",
			candidate_id: "candidate-oncore",
			status: "active",
			session_policy: {
				schema_version: "1",
				approved_service_origins: ["https://example.test"],
				approved_identity_provider_origins: ["https://login.example.test"],
				auth_flow: {
					schema_version: "1",
					fields: {
						username: { role: "textbox", name: "Email address" },
						password: { role: "textbox", name: "Password" },
					},
					identify_state: {
						action_id: "oncore-identify-auth-state",
						expected_digest: "1".repeat(64),
					},
					password_submit: {
						action_id: "oncore-submit-password",
						expected_digest: "3".repeat(64),
					},
				},
				identity_verifier: {
					schema_version: "1",
					action: {
						action_id: "oncore-verify-session",
						expected_digest: "2".repeat(64),
					},
					expected: {
						subject_reference: "oncore-subject-expected",
						account_reference: "oncore-account-expected",
						tenant_reference: "oncore-tenant-expected",
					},
					freshness_ms: 60_000,
				},
			},
		} as const;

		expect(
			parseGenerationAuthRouteRecord({
				...route,
				auth_context_ref: "op://vault/item",
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				candidate_id: "../candidate-oncore",
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					identity_verifier: undefined,
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					approved_service_origins: ["https://example.test/account"],
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					approved_service_origins: [
						"https://example.test",
						"https://example.test",
					],
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					schema_version: "2",
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					auth_flow: {
						...route.session_policy.auth_flow,
						fields: {
							...route.session_policy.auth_flow.fields,
							password: {
								role: "textbox",
								name: "op://vault/item/password",
							},
						},
					},
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					identity_verifier: {
						...route.session_policy.identity_verifier,
						expected: {
							...route.session_policy.identity_verifier.expected,
							password: "sentinel-secret",
						},
					},
				},
			}),
		).toBeUndefined();
		for (const origin of [
			"https://user@example.test",
			"https://example.test?tenant=one",
			"https://example.test#session",
			"http://example.test",
		]) {
			expect(
				parseGenerationAuthRouteRecord({
					...route,
					session_policy: {
						...route.session_policy,
						approved_service_origins: [origin],
					},
				}),
			).toBeUndefined();
		}
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					auth_flow: {
						...route.session_policy.auth_flow,
						fields: {
							...route.session_policy.auth_flow.fields,
							username: { role: "button", name: "Email address" },
						},
					},
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					auth_flow: {
						...route.session_policy.auth_flow,
						password_submit: undefined,
					},
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					auth_flow: {
						...route.session_policy.auth_flow,
						fields: {
							username: { role: "textbox", name: "Email address" },
						},
						password_submit: undefined,
					},
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					identity_verifier: {
						...route.session_policy.identity_verifier,
						action: {
							action_id: "oncore-verify-session",
							expected_digest: "not-a-digest",
						},
					},
				},
			}),
		).toBeUndefined();
		expect(
			parseGenerationAuthRouteRecord({
				...route,
				session_policy: {
					...route.session_policy,
					identity_verifier: {
						...route.session_policy.identity_verifier,
						freshness_ms: 300_001,
					},
				},
			}),
		).toBeUndefined();
	});

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
