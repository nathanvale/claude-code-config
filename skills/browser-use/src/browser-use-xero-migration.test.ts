import { describe, expect, test } from "bun:test";
import { validateRunbook } from "./browser-use-runbook-model";
import {
	BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS,
	type BrowserUseXeroMigrationInput,
	buildXeroActionCandidates,
	buildXeroMigration,
	captureXeroStatementsResult,
	preflightXeroExtract,
	refuseInactiveXeroRun,
	simulateXeroReconcileBatch,
} from "./browser-use-xero-migration";
import {
	actionAssetDigest,
	XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES,
	XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES,
} from "./browser-use-runbook-actions";

const DIGESTS = {
	requestBankStatements: "1".repeat(64),
	captureBankStatements: "4".repeat(64),
	postBankTransaction: "2".repeat(64),
	reconcileBatch: "3".repeat(64),
};

function migrationInput(
	overrides: Partial<BrowserUseXeroMigrationInput> = {},
): BrowserUseXeroMigrationInput {
	return {
		apiExplorerOrigin: "https://api-explorer.xero.com",
		goXeroOrigin: "https://go.xero.com",
		actionDigests: DIGESTS,
		sourceRelativePaths: [
			"api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
			"api-explorer-xero/playbooks/post-banktransaction.yaml",
			"go-xero/playbooks/reconcile-batch.yaml",
			"go-xero/playbooks/reconcile-fill.yaml",
			"go-xero/playbooks/reconcile-clear-and-fill.yaml",
		],
		...overrides,
	};
}

describe("Xero migration — staged extraction + staged financial writes (U6, R27/R28/R33/AE9)", () => {
	test("builds one valid staged extraction with separate request and capture effects", () => {
		const migrated = buildXeroMigration(migrationInput());

		expect(validateRunbook(migrated.extract.runbook)).toEqual([]);
		expect(migrated.extract.activation_state).toBe("staged-inactive");
		expect(migrated.extract.runbook).toMatchObject({
			service_id: "xero-api-explorer",
			flow_id: "extract-bankstatementsplus",
			auth_context_ref: "xero-session",
			allowed_origins: ["https://api-explorer.xero.com"],
		});
		expect(migrated.extract.runbook.inputs.map((i) => [i.id, i.schema.kind])).toEqual([
			["bank_account_id", "uuid"],
			["from_date", "date"],
			["to_date", "date"],
		]);
		expect(migrated.extract.runbook.inputs.map((input) => [input.id, input.custody])).toEqual([
			["bank_account_id", "sensitive"],
			["from_date", "ordinary"],
			["to_date", "ordinary"],
		]);
		expect(
			migrated.extract.runbook.steps
				.filter((step) => step.kind === "action")
				.map((step) => step.action_id),
		).toEqual([
			"xero-request-bankstatements",
			"xero-capture-bankstatements",
		]);
	});

	test("stages exact request and capture assets with non-authorizing receipts", () => {
		const candidates = buildXeroActionCandidates({
			sourceProvenance:
				"api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
		});

		expect(candidates).toHaveLength(2);
		expect(candidates.map((candidate) => candidate.record.action_id)).toEqual([
			"xero-capture-bankstatements",
			"xero-request-bankstatements",
		]);
		expect(candidates.map((candidate) => candidate.record.effect_class)).toEqual([
			"read",
			"mutation",
		]);
		expect(
			candidates.every(
				(candidate) =>
					candidate.record.promotion_receipt.disposition === "invalidated",
			),
		).toBe(true);
		expect(candidates[0]?.record.expected_digest).toBe(
			actionAssetDigest(XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES),
		);
		expect(candidates[1]?.record.expected_digest).toBe(
			actionAssetDigest(XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES),
		);
	});

	test("marks post-banktransaction and reconcile-batch staged-inactive", () => {
		const migrated = buildXeroMigration(migrationInput());

		expect(migrated.stagedInactive.map((flow) => flow.runbook.flow_id)).toEqual([
			"post-banktransaction",
			"reconcile-batch",
		]);
		for (const flow of migrated.stagedInactive) {
			expect(flow.activation_state).toBe("staged-inactive");
			expect(validateRunbook(flow.runbook)).toEqual([]);
		}
	});

	test("records provenance edges with each source's activation disposition", () => {
		const migrated = buildXeroMigration(migrationInput());

		expect(migrated.provenance).toEqual([
			{
				source_relative_path:
					"api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
				disposition: "migrated",
				flow_id: "extract-bankstatementsplus",
				activation_state: "staged-inactive",
			},
			{
				source_relative_path:
					"api-explorer-xero/playbooks/post-banktransaction.yaml",
				disposition: "migrated",
				flow_id: "post-banktransaction",
				activation_state: "staged-inactive",
			},
			{
				source_relative_path: "go-xero/playbooks/reconcile-batch.yaml",
				disposition: "migrated",
				flow_id: "reconcile-batch",
				activation_state: "staged-inactive",
			},
			{
				source_relative_path: "go-xero/playbooks/reconcile-fill.yaml",
				disposition: "migrated",
				flow_id: "reconcile-batch",
				activation_state: "staged-inactive",
			},
			{
				source_relative_path: "go-xero/playbooks/reconcile-clear-and-fill.yaml",
				disposition: "migrated",
				flow_id: "reconcile-batch",
				activation_state: "staged-inactive",
			},
		]);
		expect(
			migrated.provenance.every(
				(edge) => edge.activation_state === "staged-inactive",
			),
		).toBe(true);
	});

	test.each([
		[
			"non-exact api-explorer origin",
			{ apiExplorerOrigin: "https://api-explorer.xero.com/path" },
			"api-explorer allowed origin",
		],
		[
			"malformed api-explorer origin",
			{ apiExplorerOrigin: "not-a-url" },
			"api-explorer allowed origin",
		],
		[
			"non-exact go-xero origin",
			{ goXeroOrigin: "https://go.xero.com/BankRec" },
			"go-xero allowed origin",
		],
		[
			"cross-origin go-xero URL",
			{ goXeroOrigin: "ftp://go.xero.com" },
			"go-xero allowed origin",
		],
		[
			"unsafe source path",
			{ sourceRelativePaths: ["../extract.yaml"] },
			"safe relative source",
		],
		[
			"duplicate source path",
			{
				sourceRelativePaths: [
					"api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
					"api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
				],
			},
			"distinct safe relative source",
		],
		[
			"empty source lineage",
			{ sourceRelativePaths: [] },
			"distinct safe relative source",
		],
		[
			"invalid action digest",
			{ actionDigests: { ...DIGESTS, reconcileBatch: "not-a-digest" } },
			"exact content digest",
		],
	] as const)("rejects %s", (_label, overrides, message) => {
		expect(() => buildXeroMigration(migrationInput(overrides))).toThrow(message);
	});
});

describe("Xero extraction preflight (R27)", () => {
	const okInput = {
		bankAccountId: "01234567-89ab-cdef-0123-456789abcdef",
		fromDate: "2026-01-01",
		toDate: "2026-06-30",
	};

	test("a valid uuid + ordered dates within bound pass", () => {
		const result = preflightXeroExtract(okInput);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.range_days).toBe(180);
	});

	test("a full 366-day inclusive range is admitted at the bound", () => {
		const result = preflightXeroExtract({
			...okInput,
			fromDate: "2024-01-01",
			toDate: "2025-01-01",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.range_days).toBe(BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS);
		}
	});

	test.each([
		[
			"a bad UUID",
			{ ...okInput, bankAccountId: "not-a-uuid" },
			"extract_bank_account_invalid",
		],
		[
			"an uppercase UUID",
			{ ...okInput, bankAccountId: "01234567-89AB-CDEF-0123-456789ABCDEF" },
			"extract_bank_account_invalid",
		],
		[
			"a bad date format",
			{ ...okInput, fromDate: "01/01/2026" },
			"extract_date_invalid",
		],
		[
			"a non-calendar date",
			{ ...okInput, toDate: "2026-02-30" },
			"extract_date_invalid",
		],
		[
			"reversed date order",
			{ ...okInput, fromDate: "2026-06-30", toDate: "2026-01-01" },
			"extract_date_order_invalid",
		],
		[
			"a range over 366 days",
			{ ...okInput, fromDate: "2024-01-01", toDate: "2025-01-02" },
			"extract_range_too_large",
		],
	] as const)("rejects %s", (_label, input, code) => {
		const result = preflightXeroExtract(input);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe(code);
	});
});

describe("Xero statements structured result (R21)", () => {
	function envelope(lineCount: number) {
		return {
			bankAccountId: "01234567-89ab-cdef-0123-456789abcdef",
			bankAccountName: "Business Cheque",
			bankAccountCurrencyCode: "AUD",
			statements: [
				{
					statementLines: Array.from({ length: lineCount }, (_, i) => ({
						description: `line-${i}-xxxxxxxxxxxxxxxxxxxx`,
						amount: i,
					})),
				},
			],
		};
	}

	test("a bounded low-sensitivity envelope stays inline", () => {
		const capture = captureXeroStatementsResult({
			envelope: envelope(2),
			sensitivity: "low",
			spillToGovernedArtifact: () => "should-not-spill",
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.inline).toBe(true);
			expect(capture.outcome.governed_artifact_ref).toBeUndefined();
			expect(capture.outcome.result_digest).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	test("a large envelope spills to a governed artifact, never inline", () => {
		let spilled: string | undefined;
		const capture = captureXeroStatementsResult({
			envelope: envelope(400),
			sensitivity: "low",
			spillToGovernedArtifact: (payload) => {
				spilled = payload;
				return "artifact://run/xero-statements";
			},
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			expect(capture.outcome.inline).toBe(false);
			expect(capture.outcome.governed_artifact_ref).toBe(
				"artifact://run/xero-statements",
			);
			expect(spilled).toBeDefined();
			// The full envelope rode the spill payload, not the inline outcome.
			expect(JSON.stringify(capture.outcome)).not.toContain("line-0");
		}
	});

	test("a high-sensitivity envelope spills even when small enough to inline", () => {
		let spilled: string | undefined;
		const capture = captureXeroStatementsResult({
			envelope: envelope(2),
			sensitivity: "high",
			spillToGovernedArtifact: (payload) => {
				spilled = payload;
				return "artifact://run/xero-statements-high";
			},
		});
		expect(capture.ok).toBe(true);
		if (capture.ok) {
			// A tiny low-sensitivity envelope inlines; the same size at high
			// sensitivity must spill so the full financial payload never rides
			// shared-run state inline.
			expect(capture.outcome.inline).toBe(false);
			expect(capture.outcome.governed_artifact_ref).toBe(
				"artifact://run/xero-statements-high",
			);
			expect(spilled).toBeDefined();
			expect(JSON.stringify(capture.outcome)).not.toContain("line-0");
		}
	});

	test("a malformed envelope (missing statements) refuses", () => {
		const capture = captureXeroStatementsResult({
			envelope: {
				bankAccountId: "01234567-89ab-cdef-0123-456789abcdef",
				bankAccountName: "Business Cheque",
				bankAccountCurrencyCode: "AUD",
			},
			sensitivity: "low",
			spillToGovernedArtifact: () => "x",
		});
		expect(capture.ok).toBe(false);
		if (!capture.ok) {
			expect(capture.refusal.code).toBe("structured_result_schema_mismatch");
		}
	});
});

describe("Xero staged-inactive dispatch refusal (R33/AE9)", () => {
	test("extraction refuses until request and capture actions are separately approved", () => {
		const migrated = buildXeroMigration(migrationInput());
		expect(refuseInactiveXeroRun(migrated.extract)).toEqual({
			ok: false,
			refusal: expect.objectContaining({
				code: "runbook_inactive",
				flow_id: "extract-bankstatementsplus",
			}),
		});
	});

	test.each([
		["post-banktransaction", 0],
		["reconcile-batch", 1],
	] as const)(
		"a direct run of %s refuses with runbook_inactive before handoff",
		(flowId, index) => {
			const migrated = buildXeroMigration(migrationInput());
			const flow = migrated.stagedInactive[index];
			if (flow === undefined) throw new Error(`missing staged flow ${flowId}`);
			const result = refuseInactiveXeroRun(flow);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.refusal.code).toBe("runbook_inactive");
				expect(result.refusal.flow_id).toBe(flowId);
			}
		},
	);
});

describe("Xero reconciliation simulation (R28)", () => {
	const batch = [
		{ kind: "CLICK_OK", line_index: 0 },
		{ kind: "FILL", line_index: 1, who: "Acme Pty", what: "Sales" },
		{ kind: "CLEAR_AND_FILL", line_index: 2, what: "Refund" },
	];
	const itemKeys = ["line-0", "line-1", "line-2"];

	test("discriminated variants validate and checkpoint without dispatch", () => {
		const result = simulateXeroReconcileBatch({ itemKeys, batch });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.checkpoints).toEqual([
				{ item_key: "line-0", kind: "CLICK_OK", outcome: "simulated-confirmed" },
				{ item_key: "line-1", kind: "FILL", outcome: "simulated-confirmed" },
				{
					item_key: "line-2",
					kind: "CLEAR_AND_FILL",
					outcome: "simulated-confirmed",
				},
			]);
		}
	});

	test.each([
		[
			"an unknown variant kind",
			[{ kind: "SUBMIT", line_index: 0 }],
			["k0"],
			"reconcile_variant_invalid",
		],
		[
			"a FILL missing who",
			[{ kind: "FILL", line_index: 0, what: "Sales" }],
			["k0"],
			"reconcile_variant_invalid",
		],
		[
			"an extra field on a variant",
			[{ kind: "CLICK_OK", line_index: 0, extra: 1 }],
			["k0"],
			"reconcile_variant_invalid",
		],
		[
			"a mismatched key/batch length",
			[{ kind: "CLICK_OK", line_index: 0 }],
			["k0", "k1"],
			"reconcile_batch_shape_invalid",
		],
		[
			"a duplicate item key",
			[
				{ kind: "CLICK_OK", line_index: 0 },
				{ kind: "CLICK_OK", line_index: 1 },
			],
			["k0", "k0"],
			"reconcile_batch_shape_invalid",
		],
	] as const)("refuses %s", (_label, badBatch, keys, code) => {
		const result = simulateXeroReconcileBatch({
			itemKeys: keys,
			batch: badBatch,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusal.code).toBe(code);
	});
});
