import { describe, expect, test } from "bun:test";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseItemBatchState,
	type BrowserUseReviewedActionRecord,
	type BrowserUseRetainedGenerationSeam,
	type BrowserUseRunExecutionBinding,
	ACTION_ASSET_MAX_BYTES,
	actionAssetDigest,
	auditActionEffectClass,
	captureStructuredResult,
	itemKeysAreValid,
	itemKeySequenceDigest,
	normalizedInputDigest,
	recordItemCheckpoint,
	resolveNextBatchItem,
	resolveResumeAgainstBinding,
	resolveReviewedAction,
} from "./browser-use-runbook-actions";

// --- Fixtures (hermetic, synthetic; no real domains or secrets) --------------

const ORIGIN = "https://portal.example";
// A genuinely observational read asset: reads DOM text, no mutation fingerprint.
const READ_ASSET_BYTES = "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })";
const READ_DIGEST = actionAssetDigest(READ_ASSET_BYTES);
// A mutation asset: clicks + fills.
const MUTATION_ASSET_BYTES = "async ({ inputs }) => { document.querySelector('#save').click(); return { saved: true } }";
const MUTATION_DIGEST = actionAssetDigest(MUTATION_ASSET_BYTES);

function readRecord(
	overrides: Partial<BrowserUseReviewedActionRecord> = {},
): BrowserUseReviewedActionRecord {
	return {
		action_id: "diagnose-grid",
		asset_id: READ_DIGEST,
		expected_digest: READ_DIGEST,
		allowed_origin: ORIGIN,
		effect_class: "read",
		containment: "read-only-observation",
		input_schema: { kind: "object", fields: {} },
		result_schema: {
			kind: "object",
			fields: { rows: { schema: { kind: "number" }, required: true } },
		},
		result_sensitivity: "low",
		source_provenance: "oncore/diagnose-grid-state.js",
		promotion_receipt: {
			approved_digest: READ_DIGEST,
			disposition: "approved",
			approved_origin: ORIGIN,
			approved_effect: "read",
			approver_ref: "operator-1",
		},
		...overrides,
	};
}

function mutationRecord(
	overrides: Partial<BrowserUseReviewedActionRecord> = {},
): BrowserUseReviewedActionRecord {
	return {
		action_id: "save-draft",
		asset_id: MUTATION_DIGEST,
		expected_digest: MUTATION_DIGEST,
		allowed_origin: ORIGIN,
		effect_class: "mutation",
		containment: "none",
		input_schema: { kind: "object", fields: {} },
		result_schema: { kind: "object", fields: {} },
		result_sensitivity: "low",
		required_postcondition: { kind: "element-visible", selector: "#saved-banner" },
		source_provenance: "oncore/save-draft.js",
		promotion_receipt: {
			approved_digest: MUTATION_DIGEST,
			disposition: "approved",
			approved_origin: ORIGIN,
			approved_effect: "mutation",
			approver_ref: "operator-1",
		},
		...overrides,
	};
}

function seamFor(
	record: BrowserUseReviewedActionRecord,
	bytesById: Readonly<Record<string, string>>,
): BrowserUseActionGenerationSeam {
	return {
		async loadActionRecord(actionId) {
			return actionId === record.action_id
				? { ok: true, record }
				: { ok: false, absent: true };
		},
		async loadActionAssetBytes(assetId) {
			const bytes = bytesById[assetId];
			return bytes === undefined
				? { ok: false, reason: "bytes_unavailable" }
				: { ok: true, bytes };
		},
	};
}

const READ_BYTES_STORE = { [READ_DIGEST]: READ_ASSET_BYTES };

// --- Happy paths -------------------------------------------------------------

describe("resolveReviewedAction — approved happy paths", () => {
	test("an approved exact read action resolves to an approved evaluate step", async () => {
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(readRecord(), READ_BYTES_STORE),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.resolved.step.review_status).toBe("approved");
			expect(result.resolved.step.effect).toBe("read");
			expect(result.resolved.step.allowed_origin).toBe(ORIGIN);
			expect(result.resolved.step.script_sha256).toBe(READ_DIGEST);
		}
	});

	test("an approved mutation action with a postcondition resolves", async () => {
		const result = await resolveReviewedAction({
			actionId: "save-draft",
			expectedDigest: MUTATION_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(mutationRecord(), { [MUTATION_DIGEST]: MUTATION_ASSET_BYTES }),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.resolved.step.effect).toBe("mutation");
			expect(result.resolved.step.postcondition).toBeDefined();
		}
	});
});

// --- Refusal paths (RED FIRST; each proves fail-closed before dispatch) ------

describe("resolveReviewedAction — every refusal fails closed before dispatch", () => {
	test("candidate/non-approved receipt refuses (rejected)", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: READ_DIGEST,
				disposition: "rejected",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_not_approved");
	});

	test("withdrawn receipt refuses", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: READ_DIGEST,
				disposition: "withdrawn",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_not_approved");
	});

	test("invalidated receipt refuses", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: READ_DIGEST,
				disposition: "invalidated",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_not_approved");
	});

	test("missing registry record refuses", async () => {
		const result = await resolveReviewedAction({
			actionId: "nonexistent",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(readRecord(), READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_registry_record_missing");
	});

	test("changed digest (bytes drift from expected) refuses", async () => {
		// The record's expected digest is READ_DIGEST but the stored bytes differ.
		const drifted = "async ({ inputs }) => ({ rows: 0 /* tampered */ })";
		const record = readRecord();
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, { [READ_DIGEST]: drifted }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_digest_mismatch");
	});

	test("runbook digest mismatch refuses before loading asset bytes", async () => {
		let assetLoadAttempted = false;
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: MUTATION_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: {
				async loadActionRecord() {
					return { ok: true, record: readRecord() };
				},
				async loadActionAssetBytes() {
					assetLoadAttempted = true;
					return { ok: true, bytes: READ_ASSET_BYTES };
				},
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_digest_mismatch");
		expect(assetLoadAttempted).toBe(false);
	});

	test("unavailable asset bytes refuses", async () => {
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(readRecord(), {}),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_asset_bytes_unavailable");
	});

	test("a multibyte asset over the UTF-8 byte ceiling refuses", async () => {
		const oversizedBytes = `${"a".repeat(ACTION_ASSET_MAX_BYTES - 1)}é`;
		expect(oversizedBytes.length).toBe(ACTION_ASSET_MAX_BYTES);
		expect(Buffer.byteLength(oversizedBytes, "utf-8")).toBe(ACTION_ASSET_MAX_BYTES + 1);
		const oversizedDigest = actionAssetDigest(oversizedBytes);
		const record = readRecord({
			asset_id: oversizedDigest,
			expected_digest: oversizedDigest,
			promotion_receipt: {
				approved_digest: oversizedDigest,
				disposition: "approved",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: oversizedDigest,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, { [oversizedDigest]: oversizedBytes }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_digest_mismatch");
	});

	test("wrong requested origin refuses", async () => {
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: "https://evil.example",
			inputs: {},
			seam: seamFor(readRecord(), READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_origin_mismatch");
	});

	test("undeclared/mislabelled effect (a read that mutates) refuses", async () => {
		// A record declares "read" but the bytes navigate — the audit is authority.
		const navBytes = "async ({ inputs }) => { location.href = '/next'; return {} }";
		const navDigest = actionAssetDigest(navBytes);
		const record = readRecord({
			asset_id: navDigest,
			expected_digest: navDigest,
			promotion_receipt: {
				approved_digest: navDigest,
				disposition: "approved",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: navDigest,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, { [navDigest]: navBytes }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_effect_undeclared");
	});

	test("unsupported containment claim refuses", async () => {
		const record = readRecord({
			containment: "detect-only" as never,
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_containment_unsupported");
	});

	test("invalid input against the typed input schema refuses", async () => {
		const record = readRecord({
			input_schema: {
				kind: "object",
				fields: { week: { schema: { kind: "number", integer: true }, required: true } },
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: { week: "not-a-number" },
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_input_rejected");
	});

	test.each([
		[
			"negative string max_length",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "string", max_length: -1 },
						required: false,
					},
				},
			},
		],
		[
			"invalid string pattern",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "string", pattern: "[" },
						required: false,
					},
				},
			},
		],
		[
			"reversed numeric bounds",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "number", minimum: 2, maximum: 1 },
						required: false,
					},
				},
			},
		],
		[
			"non-boolean integer flag",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "number", integer: "yes" },
						required: false,
					},
				},
			},
		],
		[
			"non-string enum value",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "enum", values: ["ok", 2] },
						required: false,
					},
				},
			},
		],
		[
			"malformed array items",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "array", items: { kind: "unknown" } },
						required: false,
					},
				},
			},
		],
		[
			"array max above runtime bound",
			{
				kind: "object",
				fields: {
					value: {
						schema: {
							kind: "array",
							items: { kind: "boolean" },
							max_items: 513,
						},
						required: false,
					},
				},
			},
		],
		[
			"malformed object field descriptor",
			{
				kind: "object",
				fields: { value: { required: false } },
			},
		],
		[
			"non-boolean object required flag",
			{
				kind: "object",
				fields: {
					value: {
						schema: { kind: "boolean" },
						required: "yes",
					},
				},
			},
		],
	])("malformed nested input schema refuses: %s", async (_label, schema) => {
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(readRecord({ input_schema: schema as never }), READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_input_schema_invalid");
	});

	test("malformed nested result schema refuses without throwing", async () => {
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(
				readRecord({
					result_schema: {
						kind: "object",
						fields: {
							rows: {
								schema: {
									kind: "array",
									items: { kind: "enum", values: ["ok", 1] },
								},
								required: true,
							},
						},
					} as never,
				}),
				READ_BYTES_STORE,
			),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_result_schema_invalid");
	});

	test("cyclic schema refuses without unbounded recursion or throwing", async () => {
		const cyclicSchema: {
			kind: string;
			fields: Record<string, unknown>;
		} = { kind: "object", fields: {} };
		cyclicSchema.fields.self = { schema: cyclicSchema, required: false };
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(
				readRecord({ input_schema: cyclicSchema as never }),
				READ_BYTES_STORE,
			),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_input_schema_invalid");
	});

	test("missing mutation postcondition refuses", async () => {
		const record = mutationRecord({ required_postcondition: undefined });
		const result = await resolveReviewedAction({
			actionId: "save-draft",
			expectedDigest: MUTATION_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, { [MUTATION_DIGEST]: MUTATION_ASSET_BYTES }),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_postcondition_missing");
	});

	test("receipt approving a DIFFERENT digest refuses (a runbook cannot grant its own approval)", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: MUTATION_DIGEST, // approves other bytes
				disposition: "approved",
				approved_origin: ORIGIN,
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_digest_mismatch");
	});

	test("receipt approving a DIFFERENT origin refuses", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: READ_DIGEST,
				disposition: "approved",
				approved_origin: "https://other.example",
				approved_effect: "read",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_origin_mismatch");
	});

	test("receipt approving a DIFFERENT effect refuses", async () => {
		const record = readRecord({
			promotion_receipt: {
				approved_digest: READ_DIGEST,
				disposition: "approved",
				approved_origin: ORIGIN,
				approved_effect: "mutation",
				approver_ref: "operator-1",
			},
		});
		const result = await resolveReviewedAction({
			actionId: "diagnose-grid",
			expectedDigest: READ_DIGEST,
			requestedOrigin: ORIGIN,
			inputs: {},
			seam: seamFor(record, READ_BYTES_STORE),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe("action_receipt_effect_mismatch");
	});
});

// --- Effect-class audit (R19) ------------------------------------------------

describe("auditActionEffectClass — audited behavior is the authority (R19)", () => {
	test("a pure observation is read", () => {
		expect(auditActionEffectClass(READ_ASSET_BYTES)).toBe("read");
	});
	test.each([
		["arbitrary expression", "async () => Math.random()"],
		["unrecognized call", "async () => console.log('observing')"],
		["empty function", "async () => ({})"],
		[
			"observation mixed with unrecognized code",
			"async () => { customApi(); return document.querySelectorAll('.row').length }",
		],
	])("unrecognized source fails closed as mutation: %s", (_label, bytes) => {
		expect(auditActionEffectClass(bytes)).toBe("mutation");
	});
	test.each([
		["location.href", "location.href = '/x'"],
		["click", "el.click()"],
		["submit", "form.submit()"],
		["localStorage", "localStorage.setItem('k','v')"],
		["fetch", "await fetch('/x')"],
		["cookie", "document.cookie = 'k=v'"],
		["field write", "el.value = 'x'"],
	])("%s is a mutation", (_label, bytes) => {
		expect(auditActionEffectClass(bytes)).toBe("mutation");
	});
});

// --- Structured results (R21) ------------------------------------------------

describe("captureStructuredResult — bounded, redacted, spillover (R21)", () => {
	const schema = {
		kind: "object" as const,
		fields: { rows: { schema: { kind: "number" as const }, required: true } },
	};

	test("a bounded low-sensitivity read stays inline with a bounded summary and digest", () => {
		const capture = captureStructuredResult({
			value: { rows: 3 },
			schema,
			sensitivity: "low",
			spillToGovernedArtifact: () => "should-not-spill",
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.inline).toBe(true);
			expect(capture.outcome.governed_artifact_ref).toBeUndefined();
			expect(capture.outcome.summary.length).toBeLessThanOrEqual(512);
			expect(capture.outcome.result_digest).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	test("a result violating the schema refuses (records no partial outcome)", () => {
		const capture = captureStructuredResult({
			value: { rows: "three" },
			schema,
			sensitivity: "low",
			spillToGovernedArtifact: () => "x",
		});
		expect(capture.ok).toBe(false);
		if (!capture.ok) expect(capture.refusal.code).toBe("structured_result_schema_mismatch");
	});

	test("a secret-shaped value refuses (never enters durable state)", () => {
		const capture = captureStructuredResult({
			value: { rows: 1, note: "op://vault/item" } as unknown,
			schema: {
				kind: "object",
				fields: {
					rows: { schema: { kind: "number" }, required: true },
					note: { schema: { kind: "string" }, required: false },
				},
			},
			sensitivity: "low",
			spillToGovernedArtifact: () => "x",
		});
		expect(capture.ok).toBe(false);
		if (!capture.ok) expect(capture.refusal.code).toBe("structured_result_unredactable");
	});

	test("a large payload spills to a governed artifact, not inline", () => {
		// >4096 canonical bytes: 500 rows each carrying a padded label string.
		const bigRows = Array.from({ length: 500 }, (_, i) => ({
			n: i,
			label: `row-${i}-xxxxxxxxxx`,
		}));
		let spilled: string | undefined;
		const capture = captureStructuredResult({
			value: { rows: bigRows },
			schema: {
				kind: "object",
				fields: {
					rows: {
						schema: {
							kind: "array",
							items: {
								kind: "object",
								fields: {
									n: { schema: { kind: "number" }, required: true },
									label: { schema: { kind: "string" }, required: true },
								},
							},
						},
						required: true,
					},
				},
			},
			sensitivity: "low",
			summaryHint: "400 rows",
			spillToGovernedArtifact: (payload) => {
				spilled = payload;
				return "artifact://run/big-grid";
			},
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.inline).toBe(false);
			expect(capture.outcome.governed_artifact_ref).toBe("artifact://run/big-grid");
			expect(spilled).toBeDefined();
			expect(capture.outcome.summary).toBe("400 rows");
		}
	});

	test("a high-sensitivity payload always spills, even when bounded", () => {
		const capture = captureStructuredResult({
			value: { rows: 1 },
			schema,
			sensitivity: "high",
			spillToGovernedArtifact: () => "artifact://run/sensitive",
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.inline).toBe(false);
			expect(capture.outcome.governed_artifact_ref).toBe("artifact://run/sensitive");
		}
	});

	test("a high-sensitivity summary cannot leak payload data or an untrusted hint", () => {
		const capture = captureStructuredResult({
			value: { note: "private-account-123" },
			schema: {
				kind: "object",
				fields: {
					note: { schema: { kind: "string" }, required: true },
				},
			},
			sensitivity: "high",
			summaryHint: "hint-private-account-123",
			spillToGovernedArtifact: () => "artifact://run/sensitive",
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.summary).toBe(
				"High-sensitivity structured result stored in a governed artifact.",
			);
			expect(capture.outcome.summary).not.toContain("private-account-123");
			expect(capture.outcome.summary).not.toContain("hint-");
		}
	});
});

// --- Item checkpoints + bounded iteration (R12) ------------------------------

describe("itemKeysAreValid — bounded stable-key contract", () => {
	test("accepts a non-empty unique safe-key sequence", () => {
		expect(itemKeysAreValid(["mon", "week.2", "item_3"])).toBe(true);
	});

	test.each([
		["non-array", { key: "mon" }],
		["empty", []],
		["non-string member", ["mon", 2]],
		["unsafe key", ["UPPER"]],
		["duplicate", ["mon", "mon"]],
		["above 512 keys", Array.from({ length: 513 }, (_, index) => `key-${index}`)],
	])("rejects %s", (_label, keys) => {
		expect(itemKeysAreValid(keys)).toBe(false);
	});
});

function batch(
	keys: readonly string[],
	checkpoints: BrowserUseItemBatchState["checkpoints"] = [],
): BrowserUseItemBatchState {
	return { schema_version: "1", item_keys: keys, checkpoints };
}

describe("resolveNextBatchItem — first unproven, unknown blocks (R12)", () => {
	test("a fresh batch dispatches the first key", () => {
		const r = resolveNextBatchItem(batch(["mon", "tue", "wed"]));
		expect(r).toEqual({ kind: "next", item_key: "mon", item_index: 0 });
	});

	test("a confirmed first item advances to the next unproven key", () => {
		const r = resolveNextBatchItem(
			batch(["mon", "tue"], [{ item_key: "mon", outcome: "confirmed" }]),
		);
		expect(r).toEqual({ kind: "next", item_key: "tue", item_index: 1 });
	});

	test("an unknown middle item BLOCKS the batch (no later item runs)", () => {
		const r = resolveNextBatchItem(
			batch(
				["mon", "tue", "wed"],
				[
					{ item_key: "mon", outcome: "confirmed" },
					{ item_key: "tue", outcome: "unknown" },
				],
			),
		);
		expect(r.kind).toBe("blocked");
		if (r.kind === "blocked") {
			expect(r.item_key).toBe("tue");
			expect(r.reason).toBe("unknown");
		}
	});

	test("all confirmed is complete", () => {
		const r = resolveNextBatchItem(
			batch(
				["mon", "tue"],
				[
					{ item_key: "mon", outcome: "confirmed" },
					{ item_key: "tue", outcome: "confirmed" },
				],
			),
		);
		expect(r.kind).toBe("complete");
	});
});

describe("recordItemCheckpoint — confirmed advances, unknown blocks (R12)", () => {
	test("only a confirmed checkpoint advances to the next stable key", () => {
		const first = recordItemCheckpoint(batch(["mon", "tue"]), {
			itemKey: "mon",
			outcome: "confirmed",
		});
		expect(first.ok).toBe(true);
		if (first.ok) {
			const next = resolveNextBatchItem(first.state);
			expect(next).toEqual({ kind: "next", item_key: "tue", item_index: 1 });
		}
	});

	test("a crash-after-dispatch unknown middle item is never redispatched", () => {
		const withUnknown = recordItemCheckpoint(
			batch(["mon", "tue", "wed"], [{ item_key: "mon", outcome: "confirmed" }]),
			{ itemKey: "tue", outcome: "unknown" },
		);
		expect(withUnknown.ok).toBe(true);
		if (withUnknown.ok) {
			// The batch is blocked at tue; wed cannot run.
			const next = resolveNextBatchItem(withUnknown.state);
			expect(next.kind).toBe("blocked");
			// Recording wed while tue is unknown refuses.
			const later = recordItemCheckpoint(withUnknown.state, {
				itemKey: "wed",
				outcome: "confirmed",
			});
			expect(later.ok).toBe(false);
			if (!later.ok) expect(later.code).toBe("item_batch_blocked");
		}
	});

	test("a confirmed checkpoint is immutable", () => {
		const r = recordItemCheckpoint(
			batch(["mon"], [{ item_key: "mon", outcome: "confirmed" }]),
			{ itemKey: "mon", outcome: "not-achieved" },
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("item_checkpoint_immutable");
	});
});

// --- Immutable run binding + resume (R38, KTD13) -----------------------------

const ITEM_KEYS = ["mon", "tue"] as const;
const INPUTS = { week: 30 };

describe("normalizedInputDigest — canonical own-key encoding", () => {
	test("ignores object key order", () => {
		expect(normalizedInputDigest({ alpha: 1, beta: 2 })).toBe(
			normalizedInputDigest({ beta: 2, alpha: 1 }),
		);
	});

	test("preserves distinct own __proto__ values", () => {
		const first = JSON.parse('{"__proto__":{"marker":"first"}}') as Record<string, unknown>;
		const second = JSON.parse('{"__proto__":{"marker":"second"}}') as Record<string, unknown>;
		expect(normalizedInputDigest(first)).not.toBe(normalizedInputDigest(second));
		expect(normalizedInputDigest(first)).not.toBe(normalizedInputDigest({}));
	});
});

function binding(
	overrides: Partial<BrowserUseRunExecutionBinding> = {},
): BrowserUseRunExecutionBinding {
	return {
		schema_version: "1",
		generation_id: "gen-a",
		activation_epoch: 3,
		service_id: "oncore",
		flow_id: "fill-timesheet",
		runbook_version: "1.0.0",
		runbook_digest: "a".repeat(64),
		action_registry_digest: "b".repeat(64),
		normalized_input_digest: normalizedInputDigest(INPUTS),
		item_key_digest: itemKeySequenceDigest(ITEM_KEYS),
		target_scope: ORIGIN,
		postcondition: { id: "saved", summary: "draft saved" },
		...overrides,
	};
}

function retainedSeam(
	overrides: Partial<{
		reason: "unavailable" | "epoch_stale" | "drift";
		registryDigest: string;
	}> = {},
): BrowserUseRetainedGenerationSeam {
	return {
		async resolvePinnedGeneration() {
			if (overrides.reason !== undefined) {
				return { ok: false, reason: overrides.reason };
			}
			return {
				ok: true,
				action_registry_digest: overrides.registryDigest ?? "b".repeat(64),
				current_epoch: 3,
			};
		},
	};
}

describe("resolveResumeAgainstBinding — pinned generation only (R38/KTD13)", () => {
	test("a faithful resume resolves the pinned registry digest", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: INPUTS,
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(true);
	});

	test("altered resume flags (different flow) refuse without fallback", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "some-other-flow",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: INPUTS,
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_flags_altered");
	});

	test("a stale activation epoch refuses", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 2, // stale
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: INPUTS,
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_epoch_stale");
	});

	test("an unavailable pinned generation refuses without current-catalog fallback", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: INPUTS,
			},
			seam: retainedSeam({ reason: "unavailable" }),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_generation_unavailable");
	});

	test("generation drift (registry digest changed) refuses", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: INPUTS,
			},
			seam: retainedSeam({ registryDigest: "c".repeat(64) }),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_generation_drift");
	});

	test("a mismatched re-supplied input refuses (pinned digest wins)", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				inputs: { week: 31 }, // different
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_input_mismatch");
	});

	test("an altered item-key sequence refuses", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding(),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ["tue", "mon"], // reordered
				inputs: INPUTS,
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_item_keys_altered");
	});

	test("a governed-input binding requires the exact governed artifact ref", async () => {
		const r = await resolveResumeAgainstBinding({
			binding: binding({
				normalized_input_digest: undefined,
				governed_input_artifact_ref: "artifact://sensitive/input",
			}),
			resupply: {
				generation_id: "gen-a",
				activation_epoch: 3,
				service_id: "oncore",
				flow_id: "fill-timesheet",
				runbook_version: "1.0.0",
				item_keys: ITEM_KEYS,
				governed_input_artifact_ref: "artifact://WRONG/input",
			},
			seam: retainedSeam(),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.refusal.code).toBe("resume_input_mismatch");
	});
});
