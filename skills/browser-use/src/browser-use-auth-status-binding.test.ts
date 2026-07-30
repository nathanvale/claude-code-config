import { describe, expect, test } from "bun:test";
import type {
	BrowserUseAuthLaneAdmission,
	BrowserUseResolvedAuthCandidate,
} from "./browser-use-auth-bindings";
import { authStatusProofCoordinatesForBinding } from "./browser-use-auth-provider";
import { createBrowserUseAuthBindingStore } from "./browser-use-auth-binding-store";
import {
	type BrowserUseAuthStatusGenerationCapture,
	inspectBrowserUseAuthStatusBinding,
} from "./browser-use-auth-status-binding";
import type { BrowserUseGenerationRuntime } from "./browser-use-generation-runtime";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

const RESOLUTION: BrowserUseResolvedAuthCandidate = {
	generation_id: "generation-a",
	activation_epoch: 4,
	auth_context_ref: "oncore-session",
	route_digest: "a".repeat(64),
	candidate_digest: "b".repeat(64),
	route: {
		auth_context_ref: "oncore-session",
		candidate_id: "candidate-oncore",
		status: "active",
		session_policy: {
			schema_version: "1",
			approved_service_origins: ["https://portal.example.com"],
			approved_identity_provider_origins: ["https://id.example.com"],
			auth_flow: {
				schema_version: "1",
				fields: {},
				identify_state: {
					action_id: "identify",
					expected_digest: "c".repeat(64),
				},
			},
			identity_verifier: {
				schema_version: "1",
				action: {
					action_id: "verify-identity",
					expected_digest: "d".repeat(64),
				},
				expected: {
					subject_reference: "subject",
					account_reference: "account",
					tenant_reference: "tenant",
				},
				freshness_ms: 60_000,
			},
		},
	},
	candidate: {
		candidate_id: "candidate-oncore",
		service_id: "oncore",
		auth_context: "interactive-login",
		legacy_context_prose: null,
		hint_item_id: null,
		proposed_origins: ["https://portal.example.com"],
		legacy_vault_name: null,
		provenance: "legacy-auth-pointer",
	},
};

function resolutionFor(index: number): BrowserUseResolvedAuthCandidate {
	if (index === 0) return RESOLUTION;
	return {
		...RESOLUTION,
		auth_context_ref: `context-${index}`,
		route_digest: String(index + 1).repeat(64),
		candidate_digest: String(index + 2).repeat(64),
		route: {
			...RESOLUTION.route,
			auth_context_ref: `context-${index}`,
			candidate_id: `candidate-${index}`,
			session_policy: {
				...(RESOLUTION.route !== undefined &&
				"session_policy" in RESOLUTION.route
					? RESOLUTION.route.session_policy
					: {}),
				schema_version: "1",
				approved_service_origins: [
					`https://portal-${index}.example.com`,
				],
				approved_identity_provider_origins: [
					`https://id-${index}.example.com`,
				],
			},
		} as BrowserUseResolvedAuthCandidate["route"],
		candidate: {
			...RESOLUTION.candidate,
			candidate_id: `candidate-${index}`,
			service_id: `service-${index}`,
			proposed_origins: [`https://portal-${index}.example.com`],
		},
	};
}

function captureWithCandidateCount(
	count: number,
): BrowserUseAuthStatusGenerationCapture {
	const candidateRefs = Array.from({ length: count }, (_, index) => ({
		candidate_id: index === 0 ? "candidate-oncore" : `candidate-${index}`,
		path: `auth/candidates/${index}.json`,
		digest: String(index + 1).repeat(64),
	}));
	const routeRefs = Array.from({ length: count }, (_, index) => ({
		auth_context_ref: index === 0 ? "oncore-session" : `context-${index}`,
		candidate_id: candidateRefs[index]?.candidate_id ?? "missing",
		path: `auth/routes/${index}.json`,
		digest: String(index + 1).repeat(64),
	}));
	return {
		status: "present",
		runtime: {
			manifest: {
				auth: {
					candidates: candidateRefs,
					routes: routeRefs,
				},
			},
			authGenerationSeam: {
				loadAuthCandidate: async (authContextRef: string) => ({
					ok: true,
					resolution: resolutionFor(
						routeRefs.findIndex(
							(route) =>
								route.auth_context_ref === authContextRef,
						),
					),
				}),
			},
		} as unknown as BrowserUseGenerationRuntime,
	};
}

function admittedPort(
	options: { ambiguous?: boolean; empty?: boolean } = {},
): {
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>;
	calls: { evidence: number; field: number };
} {
	const calls = { evidence: 0, field: 0 };
	const port: BrowserUseTokenRetrievalPort = {
		getBindingEvidence: async () => {
			calls.evidence += 1;
			return {
				ok: true,
				evidence: {
					identity: {
						service_account_id: "service-account-1",
						state: "ACTIVE",
						type: "SERVICE_ACCOUNT",
					},
					vaults: [{ vault_id: "vault-1" }],
					item_evidence: {
						kind: "list",
						items: options.empty
							? []
							: [
							{
								item_id: "item-1",
								vault_id: "vault-1",
								item_revision: 7,
								origins: ["https://portal.example.com"],
								login_paths: [],
								supported_methods: ["password"],
								state: "active",
							},
							{
								item_id: "item-2",
								vault_id: "vault-1",
								item_revision: 3,
								origins: ["https://portal-1.example.com"],
								login_paths: [],
								supported_methods: ["password"],
								state: "active",
							},
							...(options.ambiguous
								? [
										{
											item_id: "item-ambiguous",
											vault_id: "vault-1",
											item_revision: 1,
											origins: [
												"https://portal.example.com",
											],
											login_paths: [],
											supported_methods: [
												"password" as const,
											],
											state: "active" as const,
										},
									]
								: []),
							],
					},
				},
			};
		},
		getServiceAccountIdentity: async () => {
			throw new Error("principal-bound evidence must own identity");
		},
		listVaults: async () => {
			throw new Error("principal-bound evidence must own vaults");
		},
		listLoginItems: async () => {
			throw new Error("principal-bound evidence must own items");
		},
		getLoginItem: async () => {
			throw new Error("principal-bound evidence must own exact item reads");
		},
		fetchCredentialField: async () => {
			calls.field += 1;
			throw new Error("status must not retrieve credential fields");
		},
	};
	return {
		calls,
		admission: {
			kind: "environment-admitted",
			evidence: {
				lane: "environment-injected-op",
				assurance: "lower-assurance",
				native: { verdict: "native-capability-absent" },
				environment: {
					state: "ready",
					next_action: "validate-service-account",
				},
			},
			tokenRetrieval: port,
		},
	};
}

function proofCoordinates(
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>,
) {
	return authStatusProofCoordinatesForBinding(admission, {
		service_account_id: "service-account-1",
		vault_id: "vault-1",
	});
}

describe("secret-free auth status binding", () => {
	test("one active candidate earns one digest without field retrieval", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error("paths refused");
			const fixture = admittedPort();

			const result = await inspectBrowserUseAuthStatusBinding(
				{
					fs,
					paths: opened.paths,
					clock: () => 1_000,
				},
				fixture.admission,
				{
					proofCoordinates: proofCoordinates(fixture.admission),
					captureGeneration: async () => captureWithCandidateCount(1),
				},
			);

			expect(result).toEqual({
				state: "ready",
				binding_receipt_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
			});
			expect(fixture.calls).toEqual({ evidence: 1, field: 0 });
		} finally {
			xdg.dispose();
		}
	});

	test("zero routes are missing; multiple exact routes aggregate without selection", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error("paths refused");
			for (const count of [0, 2]) {
				const fixture = admittedPort();
				const result = await inspectBrowserUseAuthStatusBinding(
					{
						fs,
						paths: opened.paths,
						clock: () => 1_000,
					},
					fixture.admission,
					{
						proofCoordinates: proofCoordinates(
							fixture.admission,
						),
						captureGeneration: async () =>
							captureWithCandidateCount(count),
					},
				);
				expect(result.state).toBe(count === 0 ? "missing" : "ready");
				expect(fixture.calls).toEqual({
					evidence: count,
					field: 0,
				});
			}
		} finally {
			xdg.dispose();
		}
	});

	test("multiple live matches for one route block without field retrieval", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error("paths refused");
			const fixture = admittedPort({ ambiguous: true });
			const result = await inspectBrowserUseAuthStatusBinding(
				{ fs, paths: opened.paths, clock: () => 1_000 },
				fixture.admission,
				{
					proofCoordinates: proofCoordinates(fixture.admission),
					captureGeneration: async () =>
						captureWithCandidateCount(1),
				},
			);
			expect(result.state).toBe("invalid");
			expect(fixture.calls).toEqual({ evidence: 1, field: 0 });
		} finally {
			xdg.dispose();
		}
	});

	test("missing live item, stale cache, and principal drift stay distinct", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error("paths refused");
			const missing = admittedPort({ empty: true });
			expect(
				await inspectBrowserUseAuthStatusBinding(
					{ fs, paths: opened.paths, clock: () => 1_000 },
					missing.admission,
					{
						proofCoordinates: proofCoordinates(missing.admission),
						captureGeneration: async () =>
							captureWithCandidateCount(1),
					},
				),
			).toEqual({ state: "missing" });
			expect(missing.calls).toEqual({ evidence: 1, field: 0 });

			const store = createBrowserUseAuthBindingStore({
				paths: opened.paths,
			});
			expect(
				await store.save({
					resolution: {
						...RESOLUTION,
						route_digest: "f".repeat(64),
					},
					binding: {
						service_id: "oncore",
						service_account_id: "service-account-1",
						auth_context: "interactive-login",
						allowed_origins: [
							"https://portal.example.com",
						],
						allowed_login_paths: [],
						vault_id: "vault-1",
						item_id: "item-1",
						item_revision: 7,
						allowed_auth_methods: ["password"],
						binding_revision: 1,
					},
				}),
			).toEqual({ ok: true });
			const stale = admittedPort();
			expect(
				await inspectBrowserUseAuthStatusBinding(
					{ fs, paths: opened.paths, clock: () => 1_000 },
					stale.admission,
					{
						proofCoordinates: proofCoordinates(stale.admission),
						captureGeneration: async () =>
							captureWithCandidateCount(1),
					},
				),
			).toEqual({ state: "stale" });
			expect(stale.calls).toEqual({ evidence: 0, field: 0 });

			const wrongCoordinates = proofCoordinates(stale.admission);
			wrongCoordinates.principal_digest = "0".repeat(64);
			await store.invalidate(RESOLUTION);
			expect(
				await inspectBrowserUseAuthStatusBinding(
					{ fs, paths: opened.paths, clock: () => 1_000 },
					stale.admission,
					{
						proofCoordinates: wrongCoordinates,
						captureGeneration: async () =>
							captureWithCandidateCount(1),
					},
				),
			).toEqual({ state: "invalid" });
			expect(stale.calls.field).toBe(0);
		} finally {
			xdg.dispose();
		}
	});
});
