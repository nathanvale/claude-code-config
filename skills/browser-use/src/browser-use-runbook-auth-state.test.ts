import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type BrowserUseNativeTargetProofV1,
	nativeTargetProofDigestOf,
} from "./browser-use-agent-browser";
import type { BrowserUseGenerationReviewedActionRef } from "./browser-use-generation-schemas";
import { identifyRunbookAuthState } from "./browser-use-runbook-auth-state";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseReviewedActionRecord,
	actionAssetDigest,
} from "./browser-use-runbook-actions";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

const IDP_ORIGIN = "https://idp.test";
const ACTION_BYTES =
	"async ({ inputs }) => JSON.parse(document.querySelector('#auth-state').textContent)";
const ACTION_DIGEST = actionAssetDigest(ACTION_BYTES);
const ACTION_REF: BrowserUseGenerationReviewedActionRef = {
	action_id: "identify-login-state",
	expected_digest: ACTION_DIGEST,
};
const ACTION_RECORD: BrowserUseReviewedActionRecord = {
	action_id: ACTION_REF.action_id,
	asset_id: ACTION_DIGEST,
	expected_digest: ACTION_DIGEST,
	allowed_origin: IDP_ORIGIN,
	effect_class: "read",
	containment: "read-only-observation",
	input_schema: { kind: "object", fields: {} },
	result_schema: {
		kind: "object",
		fields: {
			schema_version: {
				required: true,
				schema: { kind: "enum", values: ["1"] },
			},
			status: {
				required: true,
				schema: {
					kind: "enum",
					values: ["fields-required", "human-presence-required"],
				},
			},
			fields: {
				required: false,
				schema: {
					kind: "array",
					items: {
						kind: "enum",
						values: ["username", "password", "otp"],
					},
					max_items: 3,
				},
			},
			challenge: {
				required: false,
				schema: {
					kind: "enum",
					values: ["mfa", "captcha", "passkey"],
				},
			},
		},
	},
	result_sensitivity: "low",
	source_provenance: "fixture/identify-login-state.js",
	promotion_receipt: {
		approved_digest: ACTION_DIGEST,
		disposition: "approved",
		approved_origin: IDP_ORIGIN,
		approved_effect: "read",
		approver_ref: "fixture-review",
	},
};
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

function targetProof(
	origin = IDP_ORIGIN,
	overrides: Partial<BrowserUseNativeTargetProofV1> = {},
): BrowserUseNativeTargetProofV1 {
	const withoutDigest = {
		lane_id: "agent-browser",
		target_id: "t1",
		page_id: "t1",
		frame_id: "frame-1",
		document_id: "document-1",
		top_level_origin: origin,
		frame_origin: origin,
		...overrides,
	} as const;
	return {
		...withoutDigest,
		target_proof_digest: nativeTargetProofDigestOf(withoutDigest),
		...overrides,
	};
}

function actionSeam(
	record: BrowserUseReviewedActionRecord = ACTION_RECORD,
): BrowserUseActionGenerationSeam {
	return {
		async loadActionRecord(actionId) {
			return actionId === record.action_id
				? { ok: true, record }
				: { ok: false, absent: true };
		},
		async loadActionAssetBytes(assetId) {
			return assetId === record.asset_id
				? { ok: true, bytes: ACTION_BYTES }
				: { ok: false, reason: "bytes_unavailable" };
		},
	};
}

function commandRuntime(result: unknown, calls: string[][]) {
	const responses = [
		{
			tabs: [
				{
					tabId: "t1",
					active: true,
					type: "page",
					url: `${IDP_ORIGIN}/login`,
				},
			],
		},
		{},
		{ url: `${IDP_ORIGIN}/login` },
		{ snapshot: "login form", refs: {} },
		{ url: `${IDP_ORIGIN}/login` },
		{ result },
	];
	return async (input: {
		command: string;
		args: readonly string[];
		timeoutMs: number;
		stdinText?: string;
	}) => {
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
	};
}

async function identify(
	result: unknown,
	options: {
		proofs?: readonly BrowserUseNativeTargetProofV1[];
		record?: BrowserUseReviewedActionRecord;
		expectedTargetProofDigest?: string;
	} = {},
) {
	const calls: string[][] = [];
	const proofs = [...(options.proofs ?? [targetProof(), targetProof()])];
	let proofCalls = 0;
	const outcome = await identifyRunbookAuthState({
		approvedOrigins: [IDP_ORIGIN],
		action: ACTION_REF,
		actionSeam: actionSeam(options.record),
		runCommand: commandRuntime(result, calls),
		targetProof: {
			async proveTarget() {
				proofCalls += 1;
				const proof = proofs.shift();
				return proof === undefined
					? { schema_version: 1, ok: false, rejection: "target-unproven" }
					: { schema_version: 1, ok: true, proof };
			},
		},
		handoff: HANDOFF,
		runId: "run-auth-state",
		targetId: "t1",
		expectedTargetProofDigest:
			options.expectedTargetProofDigest,
	});
	return { outcome, calls, proofCalls };
}

describe("reviewed login-state adapter", () => {
	test("returns one canonical ordered field plan after exact before/after target proof", async () => {
		const { outcome, calls, proofCalls } = await identify({
			schema_version: "1",
			status: "fields-required",
			fields: ["username", "password"],
		});
		expect(outcome).toEqual({
			status: "fields-required",
			fields: ["username", "password"],
		});
		expect(proofCalls).toBe(2);
		expect(calls).toHaveLength(6);
	});

	test("returns only the closed human challenge vocabulary", async () => {
		for (const challenge of ["mfa", "captcha", "passkey"] as const) {
			const { outcome } = await identify({
				schema_version: "1",
				status: "human-presence-required",
				challenge,
			});
			expect(outcome).toEqual({
				status: "human-presence-required",
				challenge,
			});
		}
	});

	test("malformed, extended, duplicate, and out-of-order observations fail closed", async () => {
		for (const result of [
			{ status: "fields-required", fields: ["password"] },
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password", "username"],
			},
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password", "password"],
			},
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password"],
				raw: "extension",
			},
			{
				schema_version: "1",
				status: "human-presence-required",
				challenge: "sms",
			},
		]) {
			expect((await identify(result)).outcome).toEqual({
				status: "unproven",
			});
		}
	});

	test("target or origin drift after the reviewed read discards its result", async () => {
		const drifted = targetProof("https://other.test");
		const { outcome, proofCalls } = await identify(
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password"],
			},
			{ proofs: [targetProof(), drifted] },
		);
		expect(outcome).toEqual({ status: "unproven" });
		expect(proofCalls).toBe(2);
	});

	test("a restored confidential document is refused before capture", async () => {
		const allowed = targetProof(IDP_ORIGIN, {
			document_id: "document-2",
		});
		const restored = targetProof(IDP_ORIGIN, {
			document_id: "document-1",
		});
		const { outcome, calls, proofCalls } = await identify(
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password"],
			},
			{
				proofs: [restored],
				expectedTargetProofDigest:
					allowed.target_proof_digest,
			},
		);

		expect(outcome).toEqual({ status: "unproven" });
		expect(calls).toEqual([]);
		expect(proofCalls).toBe(1);
	});

	test("uses one native exact-document read after confidential delivery", async () => {
		const expected = targetProof(IDP_ORIGIN, {
			document_id: "document-after-submit",
		});
		let adapterCalls = 0;
		let proofCalls = 0;
		const requests: unknown[] = [];
		const outcome = await identifyRunbookAuthState({
			approvedOrigins: [IDP_ORIGIN],
			action: ACTION_REF,
			actionSeam: actionSeam(),
			runCommand: async () => {
				adapterCalls += 1;
				throw new Error("generic capture must remain quarantined");
			},
			targetProof: {
				async proveTarget() {
					proofCalls += 1;
					throw new Error("separate proof would reopen the race");
				},
			},
			documentRead: {
				async readDocument(request) {
					requests.push(request);
					return {
						schema_version: 1,
						ok: true,
						proof: expected,
						navigation_history_sealed: false,
						result: {
							schema_version: "1",
							status: "fields-required",
							fields: ["otp"],
						},
					};
				},
			},
			expectedDocumentProof: expected,
			handoff: HANDOFF,
			runId: "run-native-auth-state",
			targetId: "t1",
		});

		expect(outcome).toEqual({
			status: "fields-required",
			fields: ["otp"],
		});
		expect(adapterCalls).toBe(0);
		expect(proofCalls).toBe(0);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			target_id: expected.target_id,
			document_id: expected.document_id,
			target_proof_digest: expected.target_proof_digest,
			script: ACTION_BYTES,
			script_sha256: ACTION_DIGEST,
		});
	});

	test("discards a native reviewed read returned from another document", async () => {
		const expected = targetProof(IDP_ORIGIN, {
			document_id: "document-after-submit",
		});
		const restored = targetProof(IDP_ORIGIN, {
			document_id: "document-before-submit",
		});
		const outcome = await identifyRunbookAuthState({
			approvedOrigins: [IDP_ORIGIN],
			action: ACTION_REF,
			actionSeam: actionSeam(),
			runCommand: async () => {
				throw new Error("generic capture must remain quarantined");
			},
			targetProof: {
				async proveTarget() {
					throw new Error("separate proof must not run");
				},
			},
			documentRead: {
				async readDocument() {
					return {
						schema_version: 1,
						ok: true,
						proof: restored,
						navigation_history_sealed: false,
						result: {
							schema_version: "1",
							status: "fields-required",
							fields: ["otp"],
						},
					};
				},
			},
			expectedDocumentProof: expected,
			handoff: HANDOFF,
			runId: "run-native-auth-state-race",
			targetId: "t1",
		});

		expect(outcome).toEqual({ status: "unproven" });
	});

	test("refuses a reviewed action whose result is not low sensitivity before browser execution", async () => {
		const { outcome, calls, proofCalls } = await identify(
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password"],
			},
			{
				record: {
					...ACTION_RECORD,
					result_sensitivity: "high",
				},
			},
		);

		expect(outcome).toEqual({ status: "unproven" });
		expect(proofCalls).toBe(1);
		expect(calls).toEqual([]);
	});

	test("validates the observation against the reviewed result schema", async () => {
		const { outcome } = await identify(
			{
				schema_version: "1",
				status: "fields-required",
				fields: ["password"],
			},
			{
				record: {
					...ACTION_RECORD,
					result_schema: {
						kind: "object",
						fields: {
							schema_version: {
								required: true,
								schema: { kind: "enum", values: ["1"] },
							},
							status: {
								required: true,
								schema: {
									kind: "enum",
									values: ["human-presence-required"],
								},
							},
							challenge: {
								required: true,
								schema: {
									kind: "enum",
									values: ["mfa", "captcha", "passkey"],
								},
							},
						},
					},
				},
			},
		);

		expect(outcome).toEqual({ status: "unproven" });
	});

	test("rejects absent, unapproved, and framed pre-read target proof without browser calls", async () => {
		for (const proofs of [
			[],
			[targetProof("https://other.test")],
			[
				targetProof(IDP_ORIGIN, {
					frame_origin: "https://framed.test",
				}),
			],
		]) {
			const { outcome, calls, proofCalls } = await identify(
				{
					schema_version: "1",
					status: "fields-required",
					fields: ["password"],
				},
				{ proofs },
			);
			expect(outcome).toEqual({ status: "unproven" });
			expect(calls).toEqual([]);
			expect(proofCalls).toBe(1);
		}
	});

	test("rejects digest or effect tampering without browser execution", async () => {
		const records: BrowserUseReviewedActionRecord[] = [
			{
				...ACTION_RECORD,
				expected_digest: "f".repeat(64),
			},
			{
				...ACTION_RECORD,
				effect_class: "mutation",
				containment: "none",
				required_postcondition: {
					kind: "element-visible",
					selector: "#submitted",
				},
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_effect: "mutation",
				},
			},
		];

		for (const record of records) {
			const { outcome, calls, proofCalls } = await identify(
				{
					schema_version: "1",
					status: "fields-required",
					fields: ["password"],
				},
				{ record },
			);
			expect(outcome).toEqual({ status: "unproven" });
			expect(calls).toEqual([]);
			expect(proofCalls).toBe(1);
		}
	});
});
