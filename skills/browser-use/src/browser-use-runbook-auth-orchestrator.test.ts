import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type BrowserUseNativeTargetProofV1,
	nativeTargetProofDigestOf,
} from "./browser-use-agent-browser";
import type { BrowserUseGenerationSessionPolicy } from "./browser-use-generation-schemas";
import {
	type BrowserUseRunbookAuthOrchestratorPorts,
	inspectRunbookAuthenticatedSession,
	orchestrateRunbookAuthentication,
	runbookPreEffectClaimRecoveryFailure,
} from "./browser-use-runbook-command";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseReviewedActionRecord,
	actionAssetDigest,
} from "./browser-use-runbook-actions";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

const DIGEST = "a".repeat(64);

const POLICY: BrowserUseGenerationSessionPolicy = {
	schema_version: "1",
	approved_service_origins: ["https://service.test"],
	approved_identity_provider_origins: ["https://idp.test"],
	auth_flow: {
		schema_version: "1",
		fields: {
			username: { role: "textbox", name: "Username" },
			password: { role: "textbox", name: "Password" },
			otp: { role: "textbox", name: "Verification code" },
		},
		identify_state: {
			action_id: "identify-login-state",
			expected_digest: DIGEST,
		},
		username_submit: {
			action_id: "submit-username",
			expected_digest: DIGEST,
		},
		password_submit: {
			action_id: "submit-password",
			expected_digest: DIGEST,
		},
		otp_submit: {
			action_id: "submit-otp",
			expected_digest: DIGEST,
		},
	},
	identity_verifier: {
		schema_version: "1",
		action: {
			action_id: "verify-session",
			expected_digest: DIGEST,
		},
		expected: {
			subject_reference: "subject-primary",
			account_reference: "account-primary",
			tenant_reference: "tenant-primary",
		},
		freshness_ms: 30_000,
	},
};

type Event = string;

function ports(
	events: Event[],
	overrides: Partial<BrowserUseRunbookAuthOrchestratorPorts> = {},
): BrowserUseRunbookAuthOrchestratorPorts {
	return {
		claimContinuation: async () => {
			events.push("claim");
			return { status: "claimed" };
		},
		inspectSession: async () => {
			events.push("inspect");
			return { status: "authenticated" };
		},
		identifyAuthState: async () => {
			events.push("identify");
			return { status: "fields-required", fields: ["username", "password"] };
		},
		prepareBinding: async () => {
			events.push("prepare-binding");
			return { ok: true };
		},
		persistCheckpoint: async (checkpoint) => {
			events.push(`persist:${checkpoint}`);
			return true;
		},
		deliverField: async ({ field }) => {
			events.push(`deliver:${field}`);
			return { status: "delivered" };
		},
		submitAuthAction: async ({ action }) => {
			events.push(`submit:${action.action_id}`);
			return { status: "confirmed" };
		},
		...overrides,
	};
}

describe("runbook auth orchestrator U8", () => {
	test("claims a resumed continuation immediately before session inspection", async () => {
		const events: Event[] = [];
		const result = await orchestrateRunbookAuthentication({
			policy: POLICY,
			resumeContinuation: true,
			ports: ports(events),
		});

		expect(result).toEqual({ ok: true, status: "authenticated" });
		expect(events).toEqual(["claim", "inspect"]);
	});

	test("a claim loser makes zero browser, OP, delivery, or submit calls", async () => {
		const events: Event[] = [];
		const result = await orchestrateRunbookAuthentication({
			policy: POLICY,
			resumeContinuation: true,
			ports: ports(events, {
				claimContinuation: async () => {
					events.push("claim-lost");
					return { status: "already-claimed" };
				},
			}),
		});

		expect(result).toEqual({
			ok: false,
			code: "auth-continuation-already-claimed",
			safe_to_retry: false,
		});
		expect(events).toEqual(["claim-lost"]);
	});

	test("an authenticated service session performs no OP, delivery, or auth submit work", async () => {
		const events: Event[] = [];
		const result = await orchestrateRunbookAuthentication({
			policy: POLICY,
			resumeContinuation: false,
			ports: ports(events),
		});

		expect(result).toEqual({ ok: true, status: "authenticated" });
		expect(events).toEqual(["inspect"]);
	});

	test("approved IdP login is phase-scoped and write-ahead precedes every field and submit", async () => {
		const events: Event[] = [];
		let inspections = 0;
		const result = await orchestrateRunbookAuthentication({
			policy: POLICY,
			resumeContinuation: false,
			ports: ports(events, {
				inspectSession: async ({ approvedOrigins }) => {
					events.push(`inspect:${approvedOrigins.join(",")}`);
					inspections += 1;
					return inspections === 1
						? {
								status: "login-required",
								observed_origin: "https://idp.test",
							}
						: { status: "authenticated" };
				},
				identifyAuthState: async ({ approvedOrigins }) => {
					events.push(`identify:${approvedOrigins.join(",")}`);
					return {
						status: "fields-required",
						fields: ["username", "password"],
					};
				},
			}),
		});

		expect(result).toEqual({ ok: true, status: "authenticated" });
		expect(events).toEqual([
			"inspect:https://service.test",
			"identify:https://idp.test",
			"prepare-binding",
			"persist:before-username-delivery",
			"deliver:username",
			"persist:before-username-submit",
			"submit:submit-username",
			"persist:before-password-delivery",
			"deliver:password",
			"persist:before-password-submit",
			"submit:submit-password",
			"inspect:https://service.test",
		]);
	});

	test("MFA, CAPTCHA, and passkey states persist a human continuation without secret work", async () => {
		for (const challenge of ["mfa", "captcha", "passkey"] as const) {
			const events: Event[] = [];
			const result = await orchestrateRunbookAuthentication({
				policy: POLICY,
				resumeContinuation: false,
				ports: ports(events, {
					inspectSession: async () => {
						events.push("inspect");
						return {
							status: "login-required",
							observed_origin: "https://idp.test",
						};
					},
					identifyAuthState: async () => {
						events.push(`challenge:${challenge}`);
						return { status: "human-presence-required", challenge };
					},
				}),
			});

			expect(result).toEqual({
				ok: false,
				code: "auth-human-presence-required",
				safe_to_retry: false,
			});
			expect(events).toEqual([
				"inspect",
				`challenge:${challenge}`,
				"persist:human-presence-required",
			]);
		}
	});

	test("unknown delivery outcome persists unsafe retry truth and never submits", async () => {
		const events: Event[] = [];
		const result = await orchestrateRunbookAuthentication({
			policy: POLICY,
			resumeContinuation: false,
			ports: ports(events, {
				inspectSession: async () => ({
					status: "login-required",
					observed_origin: "https://idp.test",
				}),
				identifyAuthState: async () => ({
					status: "fields-required",
					fields: ["password"],
				}),
				deliverField: async ({ field }) => {
					events.push(`deliver-unknown:${field}`);
					return { status: "unknown" };
				},
			}),
		});

		expect(result).toEqual({
			ok: false,
			code: "auth-delivery-outcome-unknown",
			safe_to_retry: false,
		});
		expect(events).toEqual([
			"prepare-binding",
			"persist:before-password-delivery",
			"deliver-unknown:password",
			"persist:delivery-outcome-unknown",
		]);
	});

	test("an undeclared field is refused before binding preparation", async () => {
		const events: Event[] = [];
		const policyWithoutOtp: BrowserUseGenerationSessionPolicy = {
			...POLICY,
			auth_flow: {
				...POLICY.auth_flow,
				fields: {
					username: POLICY.auth_flow.fields.username,
					password: POLICY.auth_flow.fields.password,
				},
			},
		};
		const result = await orchestrateRunbookAuthentication({
			policy: policyWithoutOtp,
			resumeContinuation: false,
			ports: ports(events, {
				inspectSession: async () => ({
					status: "login-required",
					observed_origin: "https://idp.test",
				}),
				identifyAuthState: async () => ({
					status: "fields-required",
					fields: ["otp"],
				}),
			}),
		});

		expect(result).toEqual({
			ok: false,
			code: "auth-field-policy-unproven",
			safe_to_retry: false,
		});
		expect(events).toEqual([]);
	});

	test("a resumed unknown field or submit outcome inspects session but never repeats the effect", async () => {
		for (const checkpoint of [
			"delivery-outcome-unknown",
			"submission-outcome-unknown",
		] as const) {
			const events: Event[] = [];
			const result = await orchestrateRunbookAuthentication({
				policy: POLICY,
				resumeContinuation: false,
				resumeCheckpoint: checkpoint,
				ports: ports(events, {
					inspectSession: async () => {
						events.push("inspect");
						return {
							status: "login-required",
							observed_origin: "https://idp.test",
						};
					},
				}),
			});

			expect(result).toEqual({
				ok: false,
				code:
					checkpoint === "delivery-outcome-unknown"
						? "auth-delivery-outcome-unknown"
						: "auth-submission-outcome-unknown",
				safe_to_retry: false,
			});
			expect(events).toEqual(["inspect"]);
		}
	});

	test("failed human or unknown checkpoint persistence fails closed", async () => {
		for (const failure of ["human", "delivery"] as const) {
			const events: Event[] = [];
			const result = await orchestrateRunbookAuthentication({
				policy: POLICY,
				resumeContinuation: false,
				ports: ports(events, {
					inspectSession: async () => ({
						status: "login-required",
						observed_origin: "https://idp.test",
					}),
					identifyAuthState: async () =>
						failure === "human"
							? {
									status: "human-presence-required",
									challenge: "mfa",
								}
							: {
									status: "fields-required",
									fields: ["password"],
								},
					deliverField: async () => ({ status: "unknown" }),
					persistCheckpoint: async (checkpoint) => {
						events.push(`persist-failed:${checkpoint}`);
						return ![
							"human-presence-required",
							"delivery-outcome-unknown",
						].includes(checkpoint);
					},
				}),
			});

			expect(result).toEqual({
				ok: false,
				code: "auth-continuation-unavailable",
				safe_to_retry: false,
			});
		}
	});

	test("legacy route blocks before every browser or auth effect", async () => {
		const events: Event[] = [];
		const result = await orchestrateRunbookAuthentication({
			policy: undefined,
			resumeContinuation: false,
			ports: ports(events),
		});

		expect(result).toEqual({
			ok: false,
			code: "auth-session-policy-unproven",
			safe_to_retry: false,
		});
		expect(events).toEqual([]);
	});
});

describe("pre-effect claim recovery handoff failure", () => {
	test("preserves the original handoff failure only after exact recovery", () => {
		expect(
			runbookPreEffectClaimRecoveryFailure({
				runId: "run-auth",
				continuationId: "continuation-auth",
				recovery: {
					status: "recovered",
					run: {} as never,
					continuation: {} as never,
				},
			}),
		).toBeUndefined();
	});

	test.each([
		{
			recovery: {
				status: "mismatch" as const,
				kind: "revision" as const,
				run: {} as never,
			},
			detail: "revision",
		},
		{
			recovery: {
				status: "not-recoverable" as const,
				kind: "state" as const,
			},
			detail: "state",
		},
		{
			recovery: {
				status: "unavailable" as const,
				code: "run_store_unavailable",
				message: "fixture store failure",
			},
			detail: "run_store_unavailable",
		},
	])(
		"surfaces $recovery.status instead of an ordinary handoff retry",
		({ recovery, detail }) => {
			expect(
				runbookPreEffectClaimRecoveryFailure({
					runId: "run-auth",
					continuationId: "continuation-auth",
					recovery,
				}),
			).toMatchObject({
				code: "run_continuation_claim_recovery_failed",
				actionId: "inspect_task_run_result",
				recoverability: "repair_state",
				dataExtra: {
					claim_recovery_status: recovery.status,
					claim_recovery_detail: detail,
					stranded_continuation_id:
						"continuation-auth",
					external_effect: "none",
				},
			});
		},
	);
});

describe("runbook command session proof adapter", () => {
	test("resolves the reviewed verifier and proves the exact warm-browser identity", async () => {
		const assetBytes =
			"async ({ inputs }) => JSON.parse(document.querySelector('#session-identity').textContent)";
		const digest = actionAssetDigest(assetBytes);
		const record: BrowserUseReviewedActionRecord = {
			action_id: "verify-session",
			asset_id: digest,
			expected_digest: digest,
			allowed_origin: "https://service.test",
			effect_class: "read",
			containment: "read-only-observation",
			input_schema: { kind: "object", fields: {} },
			result_schema: {
				kind: "object",
				fields: {
					subject_reference: {
						required: true,
						schema: { kind: "string" },
					},
					account_reference: {
						required: true,
						schema: { kind: "string" },
					},
					tenant_reference: {
						required: true,
						schema: { kind: "string" },
					},
				},
			},
			result_sensitivity: "low",
			source_provenance: "fixture/verify-session.js",
			promotion_receipt: {
				approved_digest: digest,
				disposition: "approved",
				approved_origin: "https://service.test",
				approved_effect: "read",
				approver_ref: "fixture-review",
			},
		};
		const actionSeam: BrowserUseActionGenerationSeam = {
			async loadActionRecord(actionId) {
				return actionId === record.action_id
					? { ok: true, record }
					: { ok: false, absent: true };
			},
			async loadActionAssetBytes(assetId) {
				return assetId === digest
					? { ok: true, bytes: assetBytes }
					: { ok: false, reason: "bytes_unavailable" };
			},
		};
		const handoff = {
			outcome: "verified",
			environment: { name: "agent-chrome", profile: "default" },
			browser_entry_mode: "explicit-cdp",
			attachment: {
				adapter_id: "agent-browser",
				route: "explicit-cdp",
				probe_executable: "/opt/browser-connect/agent-browser",
			},
			endpoint: {
				http: "http://127.0.0.1:9222",
				ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
			},
			launch: { launched: false },
			proof: {
				environment_contract_id: "warm-chrome.browser-entry",
				environment_schema_version: "2",
				route_evidence: "verified-live",
				profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
			},
			contract_id: "browser-connect.verified-handoff",
			schema_version: "3",
		} as const satisfies BrowserConnectHandoffPayload & {
			contract_id: string;
			schema_version: string;
		};
		const proofWithoutDigest: Omit<
			BrowserUseNativeTargetProofV1,
			"target_proof_digest"
		> = {
			lane_id: "agent-browser",
			target_id: "t1",
			page_id: "t1",
			frame_id: "frame-1",
			top_level_origin: "https://service.test",
			frame_origin: "https://service.test",
		};
		const proof: BrowserUseNativeTargetProofV1 = {
			...proofWithoutDigest,
			target_proof_digest:
				nativeTargetProofDigestOf(proofWithoutDigest),
		};
		const responses = [
			{
				tabs: [
					{
						tabId: "t1",
						active: true,
						type: "page",
						url: "https://service.test/home",
					},
				],
			},
			{},
			{ url: "https://service.test/home" },
			{ snapshot: "session identity", refs: {} },
			{ url: "https://service.test/home" },
			{
				result: {
					subject_reference: "subject-primary",
					account_reference: "account-primary",
					tenant_reference: "tenant-primary",
				},
			},
		];
		const calls: string[][] = [];
		let proofCalls = 0;
		const result = await inspectRunbookAuthenticatedSession({
			policy: {
				...POLICY,
				identity_verifier: {
					...POLICY.identity_verifier,
					action: {
						action_id: record.action_id,
						expected_digest: digest,
					},
				},
			},
			actionSeam,
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				return {
					exitCode: 0,
					stdout: JSON.stringify({
						success: true,
						data: responses.shift() ?? {},
						error: null,
					}),
					stderr: "",
				};
			},
			targetProof: {
				async proveTarget() {
					proofCalls += 1;
					return {
						schema_version: 1,
						ok: true,
						proof,
					};
				},
			},
			handoff,
			runId: "run-session-proof",
			targetId: "t1",
			serviceId: "oncore",
			authContext: "interactive-login",
			environment: "agent-chrome",
			profile: "default",
			clock: () => 1_000,
		});

		expect(result.status).toBe("authenticated");
		if (result.status !== "authenticated") {
			throw new Error("authenticated session proof expected");
		}
		expect(result.verification.ok).toBe(true);
		expect(result.observation.target_id).toBe("t1");
		expect(proofCalls).toBe(2);
		expect(calls).toHaveLength(6);

		const refused = await inspectRunbookAuthenticatedSession({
			policy: {
				...POLICY,
				identity_verifier: {
					...POLICY.identity_verifier,
					action: {
						action_id: record.action_id,
						expected_digest: digest,
					},
				},
			},
			actionSeam,
			runCommand: async () => {
				throw new Error(
					"browser action must not run before native proof",
				);
			},
			targetProof: {
				async proveTarget() {
					throw new Error("native proof unavailable");
				},
			},
			handoff,
			runId: "run-idp-proof-refused",
			targetId: "t1",
			serviceId: "oncore",
			authContext: "interactive-login",
			environment: "agent-chrome",
			profile: "default",
			clock: () => 1_000,
		});
		expect(refused).toEqual({ status: "unproven" });
	});
});
