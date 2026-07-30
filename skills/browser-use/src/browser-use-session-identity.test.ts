import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type BrowserUseSessionIdentityObservationV1,
	BROWSER_USE_SESSION_IDENTITY_OBSERVATION_SCHEMA_VERSION,
	authAttestationDigestOf,
	sessionIdentityObservationDigestOf,
} from "./browser-use-auth-model";
import {
	type BrowserUseSessionIdentityExpectation,
	verifyBrowserUseSessionIdentityObservation,
} from "./browser-use-auth";
import {
	type AgentBrowserExecutionRuntime,
	type AgentBrowserTaskStep,
	type BrowserUseNativeTargetProofPort,
	type BrowserUseNativeTargetProofV1,
	agentBrowserHandoffEvidenceIdOf,
	nativeTargetProofDigestOf,
	observeAgentBrowserSessionIdentity,
} from "./browser-use-agent-browser";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";
import {
	buildBrowserUseNativeTargetProofInvocation,
	browserUseNativeTargetProofOutputIsSafe,
} from "./browser-use-runtime";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

const VERIFIER_DIGEST =
	"5050272cfeb068f5896117cf71bc8cb72b748327a1aac45cfeac669960bd359e";
const HANDOFF = {
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

function observation(
	overrides: Partial<BrowserUseSessionIdentityObservationV1> = {},
): BrowserUseSessionIdentityObservationV1 {
	return {
		schema_version: BROWSER_USE_SESSION_IDENTITY_OBSERVATION_SCHEMA_VERSION,
		verifier_action_id: "oncore-session-identity",
		verifier_action_digest: VERIFIER_DIGEST,
		lane_id: "agent-browser",
		run_id: "run-1",
		handoff_evidence_id: "handoff-1",
		environment: "agent-chrome",
		profile: "default",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		top_level_origin: "https://portal.example.test",
		frame_origin: "https://portal.example.test",
		target_proof_digest: "b".repeat(64),
		subject_reference: "subject-1",
		account_reference: "account-1",
		tenant_reference: "tenant-1",
		observed_at_epoch_ms: 1_000,
		fresh_until_epoch_ms: 2_000,
		...overrides,
	};
}

function nativeProof(
	overrides: Partial<
		Omit<BrowserUseNativeTargetProofV1, "target_proof_digest">
	> = {},
): BrowserUseNativeTargetProofV1 {
	const proof: Omit<
		BrowserUseNativeTargetProofV1,
		"target_proof_digest"
	> = {
		lane_id: "agent-browser",
		target_id: "target-1",
		page_id: "target-1",
		frame_id: "frame-1",
		top_level_origin: "https://portal.example.test",
		frame_origin: "https://portal.example.test",
		...overrides,
	};
	return {
		...proof,
		target_proof_digest: nativeTargetProofDigestOf(proof),
	};
}

function verifierStep(): Extract<AgentBrowserTaskStep, { kind: "evaluate" }> {
	return {
		kind: "evaluate",
		action_id: "oncore-session-identity",
		script: "async () => ({})",
		script_sha256: VERIFIER_DIGEST,
		review_status: "approved",
		allowed_origin: "https://portal.example.test",
		effect: "read",
		inputs: {},
	};
}

function json(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

function reviewedReadRuntime(
	identityResult: unknown = {
		subject_reference: "subject-1",
		account_reference: "account-1",
		tenant_reference: "tenant-1",
	},
): AgentBrowserExecutionRuntime {
	const responses = [
		json({
			tabs: [
				{
					tabId: "target-1",
					active: true,
					type: "page",
					url: "https://portal.example.test/home",
				},
			],
		}),
		json({}),
		json({ url: "https://portal.example.test/home" }),
		json({ snapshot: "account", refs: {} }),
		json({ url: "https://portal.example.test/home" }),
		json({
			result: identityResult,
		}),
	];
	return {
		async runCommand(
			_input: McporterCommandInput,
		): Promise<McporterCommandResult> {
			return {
				exitCode: 0,
				stdout: responses.shift() ?? "",
				stderr: "",
			};
		},
	};
}

describe("Session Identity Proof model", () => {
	test("binds the exact observation to one deterministic digest", () => {
		expect(sessionIdentityObservationDigestOf(observation())).toBe(
			"b697244110c558f1f0b3dc23dbf7d51cad8d00d465f5446dac89e8cb23a535f6",
		);
		expect(
			sessionIdentityObservationDigestOf(
				observation({ page_id: "page-after-navigation" }),
			),
		).not.toBe(sessionIdentityObservationDigestOf(observation()));
	});
});

function identityExpectation(
	overrides: Partial<BrowserUseSessionIdentityExpectation> = {},
): BrowserUseSessionIdentityExpectation {
	const value = observation();
	return {
		verifier_action_id: value.verifier_action_id,
		verifier_action_digest: value.verifier_action_digest,
		lane_id: value.lane_id,
		run_id: value.run_id,
		handoff_evidence_id: value.handoff_evidence_id,
		environment: value.environment,
		profile: value.profile,
		target_id: value.target_id,
		page_id: value.page_id,
		frame_id: value.frame_id,
		top_level_origin: value.top_level_origin,
		frame_origin: value.frame_origin,
		target_proof_digest: value.target_proof_digest,
		subject_reference: value.subject_reference,
		account_reference: value.account_reference,
		tenant_reference: value.tenant_reference,
		observed_at_epoch_ms: value.observed_at_epoch_ms,
		fresh_until_epoch_ms: value.fresh_until_epoch_ms,
		implementation_integrity_key: "agent-browser@1.0.0",
		service_id: "oncore",
		auth_context: "oncore-password",
		at_epoch_ms: 1_500,
		...overrides,
	};
}

describe("Session Identity Proof verifier", () => {
	test("binds the exact proof digest into one auth attestation", () => {
		const value = observation();
		const result = verifyBrowserUseSessionIdentityObservation(
			value,
			identityExpectation(),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.cause);
		expect(result.identity_basis_digest).toBe(
			sessionIdentityObservationDigestOf(value),
		);
		expect(result.attestation).toEqual({
			run_id: value.run_id,
			handoff_evidence_id: value.handoff_evidence_id,
			lane_id: value.lane_id,
			implementation_integrity_key: "agent-browser@1.0.0",
			environment: value.environment,
			profile: value.profile,
			target_id: value.target_id,
			page_id: value.page_id,
			frame_id: value.frame_id,
			service_id: "oncore",
			auth_context: "oncore-password",
			subject_reference: value.subject_reference,
			account_reference: value.account_reference,
			tenant_reference: value.tenant_reference,
			identity_basis: "session-identity-proof",
			identity_basis_digest: sessionIdentityObservationDigestOf(value),
			observed_at_epoch_ms: value.observed_at_epoch_ms,
			fresh_until_epoch_ms: value.fresh_until_epoch_ms,
		});
		expect(result.attestation_digest).toBe(
			authAttestationDigestOf(result.attestation),
		);
	});

	test.each([
		[
			"unknown observation key",
			{ ...observation(), session_identity: "forged" },
			identityExpectation(),
			"observation-invalid",
		],
		[
			"stale observation",
			observation(),
			identityExpectation({ at_epoch_ms: 2_001 }),
			"observation-stale",
		],
		[
			"reviewed verifier mismatch",
			observation(),
			identityExpectation({ verifier_action_digest: "c".repeat(64) }),
			"verifier-mismatch",
		],
		[
			"target proof mismatch",
			observation(),
			identityExpectation({ frame_id: "frame-after-navigation" }),
			"binding-mismatch",
		],
		[
			"observation time mismatch",
			observation(),
			identityExpectation({ observed_at_epoch_ms: 999 }),
			"binding-mismatch",
		],
		[
			"identity mismatch",
			observation(),
			identityExpectation({ account_reference: "account-2" }),
			"identity-mismatch",
		],
	] as const)(
		"rejects %s",
		(_name, value, expected, cause) => {
			expect(
				verifyBrowserUseSessionIdentityObservation(value, expected),
			).toEqual({ ok: false, cause });
		},
	);
});

describe("Agent Browser Session Identity Proof producer", () => {
	test("keeps the browser endpoint and PID in bounded native stdin only", () => {
		const invocation = buildBrowserUseNativeTargetProofInvocation({
			native_bin_root: "/opt/browser-use/bin",
			request: {
				browser_ws_endpoint: HANDOFF.endpoint.ws,
				browser_pid:
					HANDOFF.proof.profile_posture.effective.observer.browser_pid,
				target_id: "target-1",
			},
		});
		expect(invocation).toEqual({
			executable_path:
				"/opt/browser-use/bin/browser-use-confidential-delivery",
			argv: ["prove-target"],
			env: { PATH: "/usr/bin:/bin", LANG: "C" },
			stdin_text: JSON.stringify({
				schema_version: 1,
				browser_ws_endpoint: HANDOFF.endpoint.ws,
				browser_pid:
					HANDOFF.proof.profile_posture.effective.observer.browser_pid,
				target_id: "target-1",
			}),
			timeout_ms: 15_000,
		});
		expect(invocation.argv.join(" ")).not.toContain(HANDOFF.endpoint.ws);
		expect(
			browserUseNativeTargetProofOutputIsSafe({
				stdout: "{}",
				stderr: `unsafe ${HANDOFF.endpoint.ws}`,
				browser_ws_endpoint: HANDOFF.endpoint.ws,
			}),
		).toBe(false);
	});

	test("derives every browser binding from stable native pre/post proof", async () => {
		const proofs = [nativeProof(), nativeProof()];
		const requests: unknown[] = [];
		const targetProof: BrowserUseNativeTargetProofPort = {
			proveTarget: async (request) => {
				requests.push(request);
				return {
					schema_version: 1,
					ok: true,
					proof: proofs.shift(),
				};
			},
		};
		const projected = await observeAgentBrowserSessionIdentity({
			runtime: reviewedReadRuntime(),
			targetProof,
			handoff: HANDOFF,
			run_id: "run-1",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(projected).toEqual({
			ok: true,
			observation: {
				...observation({
					handoff_evidence_id: agentBrowserHandoffEvidenceIdOf(HANDOFF),
					page_id: "target-1",
					target_proof_digest: nativeProof().target_proof_digest,
					fresh_until_epoch_ms: 16_000,
				}),
			},
		});
		expect(requests).toEqual([
			{
				browser_ws_endpoint: HANDOFF.endpoint.ws,
				browser_pid:
					HANDOFF.proof.profile_posture.effective.observer.browser_pid,
				target_id: "target-1",
			},
			{
				browser_ws_endpoint: HANDOFF.endpoint.ws,
				browser_pid:
					HANDOFF.proof.profile_posture.effective.observer.browser_pid,
				target_id: "target-1",
			},
		]);
	});

	test("blocks a navigation race between native pre/post proofs", async () => {
		const proofs = [
			nativeProof(),
			nativeProof({
				frame_id: "frame-after-navigation",
				frame_origin: "https://portal.example.test",
			}),
		];
		const result = await observeAgentBrowserSessionIdentity({
			runtime: reviewedReadRuntime(),
			targetProof: {
				proveTarget: async () => ({
					schema_version: 1,
					ok: true,
					proof: proofs.shift(),
				}),
			},
			handoff: HANDOFF,
			run_id: "run-race",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(result).toEqual({
			ok: false,
			cause: "target-navigation-raced",
		});
	});

	test("rejects malformed native proof before reviewed browser execution", async () => {
		let browserCommands = 0;
		const result = await observeAgentBrowserSessionIdentity({
			runtime: {
				async runCommand() {
					browserCommands += 1;
					throw new Error("must not execute");
				},
			},
			targetProof: {
				proveTarget: async () => ({
					schema_version: 1,
					ok: true,
					proof: { ...nativeProof(), session_identity: "forged" },
				}),
			},
			handoff: HANDOFF,
			run_id: "run-malformed-proof",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(result).toEqual({ ok: false, cause: "target-proof-invalid" });
		expect(browserCommands).toBe(0);
	});

	test("rejects generic tab metadata as session identity", async () => {
		const proof = nativeProof();
		const result = await observeAgentBrowserSessionIdentity({
			runtime: reviewedReadRuntime({
				session_identity: {
					title: "Nathan",
					url: "https://portal.example.test/home",
				},
			}),
			targetProof: {
				proveTarget: async () => ({
					schema_version: 1,
					ok: true,
					proof,
				}),
			},
			handoff: HANDOFF,
			run_id: "run-generic-tab-identity",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(result).toEqual({
			ok: false,
			cause: "identity-observation-invalid",
		});
	});

	test("classifies native target-unproven before and after the reviewed read", async () => {
		const rejection = {
			schema_version: 1,
			ok: false,
			rejection: {
				code: "target-unproven",
				message: "target proof blocked; inspect the typed code.",
			},
		};
		const before = await observeAgentBrowserSessionIdentity({
			runtime: reviewedReadRuntime(),
			targetProof: { proveTarget: async () => rejection },
			handoff: HANDOFF,
			run_id: "run-target-unproven-before",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(before).toEqual({ ok: false, cause: "target-proof-invalid" });

		const responses = [
			{ schema_version: 1, ok: true, proof: nativeProof() },
			rejection,
		];
		const after = await observeAgentBrowserSessionIdentity({
			runtime: reviewedReadRuntime(),
			targetProof: {
				proveTarget: async () => responses.shift(),
			},
			handoff: HANDOFF,
			run_id: "run-target-unproven-after",
			target_id: "target-1",
			verifier: verifierStep(),
			freshness_ms: 15_000,
			now: () => 1_000,
		});
		expect(after).toEqual({
			ok: false,
			cause: "target-navigation-raced",
		});
	});
});
