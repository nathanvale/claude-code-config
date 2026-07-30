import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type BrowserUseNativeTargetProofV1,
	nativeTargetProofDigestOf,
} from "./browser-use-agent-browser";
import type { BrowserUseGenerationReviewedActionRef } from "./browser-use-generation-schemas";
import { submitReviewedRunbookAuthAction } from "./browser-use-runbook-auth-submit";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseReviewedActionRecord,
	actionAssetDigest,
	reviewedActionPostconditionDigest,
} from "./browser-use-runbook-actions";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";

const IDP_ORIGIN = "https://idp.test";
const ACTION_BYTES =
	"async () => document.querySelector('form').requestSubmit()";
const ACTION_DIGEST = actionAssetDigest(ACTION_BYTES);
const ACTION_POSTCONDITION = {
	kind: "url-equals",
	url: `${IDP_ORIGIN}/password`,
} as const;
const ACTION_REF: BrowserUseGenerationReviewedActionRef = {
	action_id: "submit-login-username",
	expected_digest: ACTION_DIGEST,
};
const ACTION_RECORD: BrowserUseReviewedActionRecord = {
	action_id: ACTION_REF.action_id,
	asset_id: ACTION_DIGEST,
	expected_digest: ACTION_DIGEST,
	allowed_origin: IDP_ORIGIN,
	effect_class: "mutation",
	purpose: "runbook-auth-submit",
	containment: "none",
	input_schema: { kind: "object", fields: {} },
	result_schema: { kind: "object", fields: {} },
	result_sensitivity: "low",
	required_postcondition: ACTION_POSTCONDITION,
	source_provenance: "fixture/submit-login-username.js",
	promotion_receipt: {
		approved_digest: ACTION_DIGEST,
		disposition: "approved",
		approved_origin: IDP_ORIGIN,
		approved_effect: "mutation",
		approved_purpose: "runbook-auth-submit",
		approved_postcondition_digest:
			reviewedActionPostconditionDigest(ACTION_POSTCONDITION),
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

function actionSeam(
	record: BrowserUseReviewedActionRecord = ACTION_RECORD,
	assetBytes = ACTION_BYTES,
): BrowserUseActionGenerationSeam {
	return {
		async loadActionRecord(actionId) {
			return actionId === record.action_id
				? { ok: true, record }
				: { ok: false, absent: true };
		},
		async loadActionAssetBytes(assetId) {
			return assetId === record.asset_id
				? { ok: true, bytes: assetBytes }
				: { ok: false, reason: "bytes_unavailable" };
		},
	};
}

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

function commandRuntime(input: {
	journal: string[];
	stdinPayloads: string[];
	outputs: string[];
	evalExitCode?: number;
	postconditionUrl?: string;
}) {
	return async (command: {
		command: string;
		args: readonly string[];
		timeoutMs: number;
		stdinText?: string;
	}) => {
		const operation = command.args.slice(4);
		input.journal.push(operation.join(" "));
		if (command.stdinText !== undefined) {
			input.stdinPayloads.push(command.stdinText);
		}
		let data: Record<string, unknown> = {};
		let exitCode = 0;
		if (operation[0] === "tab" && operation[1] === "list") {
			data = {
				tabs: [
					{
						tabId: "t1",
						active: true,
						type: "page",
						url: `${IDP_ORIGIN}/login`,
					},
				],
			};
		} else if (operation[0] === "get" && operation[1] === "url") {
			const priorEval = input.journal.some((entry) =>
				entry.startsWith("eval "),
			);
			data = {
				url: priorEval
					? (input.postconditionUrl ??
						`${IDP_ORIGIN}/password`)
					: `${IDP_ORIGIN}/login`,
			};
		} else if (operation[0] === "eval") {
			exitCode = input.evalExitCode ?? 0;
		} else if (
			operation[0] === "snapshot" ||
			(operation[0] === "get" && operation[1] === "value") ||
			(operation[0] === "is" && operation[1] === "visible")
		) {
			data = {
				captured:
					"username-sentinel password-sentinel otp-sentinel",
			};
		}
		const stdout = JSON.stringify({
			success: exitCode === 0,
			data,
			error:
				exitCode === 0
					? null
					: {
							code: "eval-failed",
							detail: command.stdinText?.includes(
								'throw "reviewed-auth-submit-failed"',
							)
								? "reviewed-auth-submit-failed"
								: "password-sentinel",
						},
		});
		input.outputs.push(stdout);
		return {
			exitCode,
			stdout,
			stderr: "",
		};
	};
}

async function submit(options: {
	record?: BrowserUseReviewedActionRecord;
	actionBytes?: string;
	evalExitCode?: number;
	postconditionUrl?: string;
	markerOk?: boolean;
	proofs?: readonly BrowserUseNativeTargetProofV1[];
	approvedPostSubmitOrigins?: readonly string[];
} = {}) {
	const journal: string[] = [];
	const stdinPayloads: string[] = [];
	const outputs: string[] = [];
	const proofs = [
		...(options.proofs ?? [
			targetProof(),
			targetProof(),
			targetProof(IDP_ORIGIN, {
				document_id: "document-2",
			}),
		]),
	];
	const record = options.record ?? ACTION_RECORD;
	const result = await submitReviewedRunbookAuthAction({
		approvedIdentityProviderOrigins: [IDP_ORIGIN],
		approvedPostSubmitOrigins:
			options.approvedPostSubmitOrigins ?? [IDP_ORIGIN],
		action: {
			action_id: record.action_id,
			expected_digest: record.expected_digest,
		},
		actionSeam: actionSeam(record, options.actionBytes),
		runCommand: commandRuntime({
			journal,
			stdinPayloads,
			outputs,
			evalExitCode: options.evalExitCode,
			postconditionUrl: options.postconditionUrl,
		}),
		targetProof: {
			async proveTarget() {
				const proof = proofs.shift();
				return proof === undefined
					? {
							schema_version: 1,
							ok: false,
							rejection: "target-unproven",
						}
					: { schema_version: 1, ok: true, proof };
			},
		},
		handoff: HANDOFF,
		runId: "run-auth-submit",
		targetId: "t1",
		beforeMutationDispatch: async () => {
			journal.push("persist-write-ahead");
			return { ok: options.markerOk !== false };
		},
	});
	return { result, journal, stdinPayloads, outputs };
}

describe("reviewed login submit adapter", () => {
	test("persists write-ahead truth immediately before one digest-pinned mutation", async () => {
		const { result, journal, stdinPayloads, outputs } = await submit();

		expect(result).toEqual({
			status: "confirmed",
			page_departed: true,
			document_id: "document-2",
			target_proof_digest: targetProof(IDP_ORIGIN, {
				document_id: "document-2",
			}).target_proof_digest,
		});
		expect(journal).toEqual([
			"tab list --json",
			"tab t1 --json",
			"get url --json",
			"get url --json",
			"persist-write-ahead",
			"eval --stdin --json",
			"get url --json",
		]);
		expect(stdinPayloads).toHaveLength(1);
		expect(stdinPayloads[0]?.endsWith("undefined;")).toBe(true);
		for (const sentinel of [
			"username-sentinel",
			"password-sentinel",
			"otp-sentinel",
		]) {
			expect(
				JSON.stringify({ journal, stdinPayloads, outputs }),
			).not.toContain(sentinel);
		}
	});

	test("masks DOM-derived invocation and initialization throws before command output", async () => {
		for (const actionBytes of [
			"async () => { throw document.querySelector('#password').value; }",
			"(() => { throw document.querySelector('#password').value; })()",
		]) {
			const actionDigest = actionAssetDigest(actionBytes);
			const { result, stdinPayloads, outputs } = await submit({
				actionBytes,
				evalExitCode: 1,
				record: {
					...ACTION_RECORD,
					asset_id: actionDigest,
					expected_digest: actionDigest,
					promotion_receipt: {
						...ACTION_RECORD.promotion_receipt,
						approved_digest: actionDigest,
					},
				},
			});

			expect(result).toEqual({ status: "unknown" });
			expect(stdinPayloads[0]).toContain(
				'throw "reviewed-auth-submit-failed"',
			);
			expect(JSON.stringify(outputs)).toContain("reviewed-auth-submit-failed");
			expect(JSON.stringify(outputs)).not.toContain("password-sentinel");
		}
	});

	test("refuses non-mutation authority before browser execution", async () => {
		const { result, journal } = await submit({
			record: {
				...ACTION_RECORD,
				effect_class: "read",
				containment: "read-only-observation",
				required_postcondition: undefined,
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_effect: "read",
				},
			},
		});

		expect(result).toEqual({ status: "blocked" });
		expect(journal).toEqual([]);
	});

	test("refuses relabelling a same-origin business mutation without renewed approval", async () => {
		const { result, journal } = await submit({
			record: {
				...ACTION_RECORD,
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_purpose: undefined,
				},
			},
		});

		expect(result).toEqual({ status: "blocked" });
		expect(journal).toEqual([]);
	});

	test("a failed write-ahead marker blocks before dispatch", async () => {
		const { result, journal } = await submit({ markerOk: false });

		expect(result).toEqual({ status: "blocked" });
		expect(journal).toContain("persist-write-ahead");
		expect(journal.some((entry) => entry.startsWith("eval "))).toBe(false);
	});

	test("target drift at the final pre-dispatch hook blocks before persistence or eval", async () => {
		const { result, journal } = await submit({
			proofs: [
				targetProof(),
				targetProof(IDP_ORIGIN, { frame_id: "frame-replaced" }),
			],
		});

		expect(result).toEqual({ status: "blocked" });
		expect(journal).not.toContain("persist-write-ahead");
		expect(journal.some((entry) => entry.startsWith("eval "))).toBe(false);
	});

	test("admits one reviewed redirect onto an approved service origin", async () => {
		const serviceOrigin = "https://service.test";
		const postcondition = {
			kind: "url-equals",
			url: `${serviceOrigin}/home`,
		} as const;
		const { result } = await submit({
			record: {
				...ACTION_RECORD,
				required_postcondition: postcondition,
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_postcondition_digest:
						reviewedActionPostconditionDigest(postcondition),
				},
			},
			postconditionUrl: `${serviceOrigin}/home`,
			approvedPostSubmitOrigins: [IDP_ORIGIN, serviceOrigin],
			proofs: [
				targetProof(),
				targetProof(),
				targetProof(serviceOrigin, {
					document_id: "document-2",
				}),
			],
		});

		expect(result).toEqual({
			status: "confirmed",
			page_departed: true,
			document_id: "document-2",
			target_proof_digest: targetProof(serviceOrigin, {
				document_id: "document-2",
			}).target_proof_digest,
		});
	});

	test("same-document URL change stays unknown because capture cannot reopen", async () => {
		const { result } = await submit({
			proofs: [
				targetProof(),
				targetProof(),
				targetProof(),
			],
		});

		expect(result).toEqual({ status: "unknown" });
	});

	test("an unapproved post-submit redirect is unknown after dispatch", async () => {
		const { result } = await submit({
			proofs: [
				targetProof(),
				targetProof(),
				targetProof("https://unapproved.test"),
			],
		});

		expect(result).toEqual({ status: "unknown" });
	});

	test("rejects a declared unapproved redirect before persistence or eval", async () => {
		const postcondition = {
			kind: "url-equals",
			url: "https://unapproved.test/home",
		} as const;
		const { result, journal } = await submit({
			record: {
				...ACTION_RECORD,
				required_postcondition: postcondition,
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_postcondition_digest:
						reviewedActionPostconditionDigest(postcondition),
				},
			},
		});

		expect(result).toEqual({ status: "blocked" });
		expect(journal).toEqual([]);
	});

	test("rejects capture-dependent submit postconditions before browser execution", async () => {
		const postcondition = {
			kind: "element-visible",
			selector: "#password",
		} as const;
		const { result, journal } = await submit({
			record: {
				...ACTION_RECORD,
				required_postcondition: postcondition,
				promotion_receipt: {
					...ACTION_RECORD.promotion_receipt,
					approved_postcondition_digest:
						reviewedActionPostconditionDigest(postcondition),
				},
			},
		});

		expect(result).toEqual({ status: "blocked" });
		expect(journal).toEqual([]);
	});

	test("any post-marker failure is unknown and never safe to retry", async () => {
		for (const options of [
			{ evalExitCode: 1 },
			{ postconditionUrl: `${IDP_ORIGIN}/unexpected` },
		]) {
			const { result, journal } = await submit(options);
			expect(result).toEqual({ status: "unknown" });
			expect(journal).toContain("persist-write-ahead");
			expect(journal.some((entry) => entry.startsWith("eval "))).toBe(
				true,
			);
		}
	});
});
