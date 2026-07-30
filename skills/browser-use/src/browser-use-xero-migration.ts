// ---------------------------------------------------------------------------
// Xero migration transform (runbook catalog migration plan 2026-07-28-001 U6,
// R21/R27-R28/R31-R36/R38-R41; AE9).
//
// A pure migration transform: it produces v2 runbooks + reconciled source
// provenance + a per-flow ACTIVATION STATE for the Xero domain. It embeds NO
// script bytes — the reviewed-action registry (browser-use-runbook-actions.ts)
// owns exact bytes, promotion, and postconditions; a runbook here only names an
// action id plus an expected content digest.
//
// Every migrated Xero flow starts `staged-inactive` (R27/R28/R33):
//   - BankStatementsPlus extraction is not one read-only effect. It mutates the
//     API Explorer form, dispatches a request, then observes the response. Those
//     effects have separate exact candidate assets and require separate review.
//   - `post-banktransaction` and the reconciliation batch (+ its FILL /
//     CLEAR_AND_FILL / CLICK_OK variants) are financial writes. They retain full
//     provenance but remain non-dispatchable without exact action approval,
//     auth, and separate caller confirmation.
// All inactive definitions refuse before handoff. Reconciliation variants are
// validated/checkpointed in simulation only; this module never dispatches a
// live financial mutation.
//
// Pure model + guards only. No Date.now, no Math.random, no fs, no browser, and
// ZERO live financial write. Structured-result capture, effect audit, promotion
// receipts, and postconditions remain owned by the modules named above.
// ---------------------------------------------------------------------------

import { isAbsolute } from "node:path";
import {
	type BrowserUseActionValueSchema,
	type BrowserUseReviewedActionRecord,
	actionAssetDigest,
	actionDigestIsValid,
	auditActionEffectClass,
	captureStructuredResult,
	STRUCTURED_RESULT_MAX_INLINE_BYTES,
	XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES,
	XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES,
} from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	type BrowserUseRunbookValueSchema,
	runbookExactOriginIsValid,
} from "./browser-use-runbook-model";

/** The two per-flow activation states this transform assigns (R27/R28/R33). */
export const BROWSER_USE_XERO_ACTIVATION_STATES = [
	"active",
	"staged-inactive",
] as const;

/**
 * Per-flow activation state (R27/R28/R33). `active` — a dispatchable read-only
 * flow in the active catalog; `staged-inactive` — migrated with provenance but
 * excluded from active list/show/run and refused before handoff. Distinct from
 * the generation-level `activation_state` on {@link BrowserUseMigrationState}
 * (that field describes the whole staged generation, not one flow).
 */
export type BrowserUseXeroActivationState =
	(typeof BROWSER_USE_XERO_ACTIVATION_STATES)[number];

/** The maximum inclusive statement date range the extraction preflight admits (R27). */
export const BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS = 366;

/** Exact reviewed action digests supplied by one staged Xero generation. */
export type BrowserUseXeroActionDigests = {
	/** API Explorer form mutation and request dispatch. */
	requestBankStatements: string;
	/** Read-only response observation after the request finishes. */
	captureBankStatements: string;
	/** Staged-inactive bank-transaction post (financial mutation). */
	postBankTransaction: string;
	/** Staged-inactive reconciliation batch action (financial mutation). */
	reconcileBatch: string;
};

/** One exact Xero candidate asset plus its non-authorizing reviewed record. */
export type BrowserUseXeroActionCandidate = {
	assetBytes: string;
	record: BrowserUseReviewedActionRecord;
};

/** Inputs required to build the Xero migration output. */
export type BrowserUseXeroMigrationInput = {
	/** Exact api-explorer origin admitted by the read + post flows. */
	apiExplorerOrigin: string;
	/** Exact go-xero origin admitted by the reconciliation flow. */
	goXeroOrigin: string;
	/** Content identities resolved later through the generation action seam. */
	actionDigests: BrowserUseXeroActionDigests;
	/** Source relative paths retained as migrated provenance (>= 1, distinct, safe). */
	sourceRelativePaths: readonly string[];
};

/** One inspectable source edge for a migrated Xero flow. */
export type BrowserUseXeroProvenance = {
	source_relative_path: string;
	disposition: "migrated";
	/** The flow this source feeds and its activation disposition. */
	flow_id: string;
	activation_state: BrowserUseXeroActivationState;
};

/** One migrated Xero flow: a v2 runbook plus its activation disposition. */
export type BrowserUseXeroMigratedFlow = {
	/** The canonical v2 runbook definition. Never embeds script bytes. */
	runbook: BrowserUseRunbook;
	/** Whether this flow is dispatchable (`active`) or non-dispatchable. */
	activation_state: BrowserUseXeroActivationState;
};

/** The whole Xero migration output: every flow plus reconciled provenance. */
export type BrowserUseXeroMigration = {
	/** The single active read-only extraction flow. */
	extract: BrowserUseXeroMigratedFlow;
	/** The staged-inactive financial-mutation flows (non-dispatchable). */
	stagedInactive: readonly BrowserUseXeroMigratedFlow[];
	/** Every source edge with its flow and activation disposition. */
	provenance: readonly BrowserUseXeroProvenance[];
};

// --- Reconciliation discriminated variants (R28 simulation) ------------------

/** The reconciliation batch entry kinds (a discriminated union on `kind`). */
export const BROWSER_USE_XERO_RECONCILE_VARIANT_KINDS = [
	"CLICK_OK",
	"FILL",
	"CLEAR_AND_FILL",
] as const;

/** Reconciliation variant-kind union. */
export type BrowserUseXeroReconcileVariantKind =
	(typeof BROWSER_USE_XERO_RECONCILE_VARIANT_KINDS)[number];

/**
 * One reconciliation batch entry (R28), discriminated on `kind`. A caller-owned
 * value validated + checkpointed in SIMULATION only; this transform never
 * dispatches it. `CLICK_OK` confirms a matched line; `FILL` writes who/what into
 * an empty line; `CLEAR_AND_FILL` clears an existing what before writing.
 */
export type BrowserUseXeroReconcileVariant =
	| { kind: "CLICK_OK"; line_index: number }
	| { kind: "FILL"; line_index: number; who: string; what: string }
	| { kind: "CLEAR_AND_FILL"; line_index: number; what: string };

/** The declarative discriminated-union schema for one reconciliation entry. */
const RECONCILE_VARIANT_SCHEMA: BrowserUseRunbookValueSchema = {
	kind: "discriminated-union",
	discriminant: "kind",
	variants: {
		CLICK_OK: {
			line_index: { required: true, schema: { kind: "number", minimum: 0, integer: true } },
		},
		FILL: {
			line_index: { required: true, schema: { kind: "number", minimum: 0, integer: true } },
			who: { required: true, schema: { kind: "string", min_length: 1, max_length: 256 } },
			what: { required: true, schema: { kind: "string", min_length: 1, max_length: 256 } },
		},
		CLEAR_AND_FILL: {
			line_index: { required: true, schema: { kind: "number", minimum: 0, integer: true } },
			what: { required: true, schema: { kind: "string", min_length: 1, max_length: 256 } },
		},
	},
};

// --- Guards -------------------------------------------------------------------

function exactOrigin(value: string): string | undefined {
	return runbookExactOriginIsValid(value) ? value : undefined;
}

function sourceRelativePathValid(value: string): boolean {
	return (
		value.length > 0 &&
		// `isAbsolute` is platform-specific: on POSIX it ignores a Windows drive
		// path (`C:\foo`) or a backslash escape (`..\secret`), which then survive
		// the `/`-split `..` check as a single segment. Reject any backslash so the
		// safe-relative invariant holds on non-Windows CI/dev hosts too.
		!value.includes("\\") &&
		!isAbsolute(value) &&
		!value.split("/").some((segment) => segment === "" || segment === "..")
	);
}

// A calendar-valid ISO yyyy-mm-dd (mirrors the runbook model's date rule).
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarValidIsoDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false;
	const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
	if (y === undefined || m === undefined || d === undefined) return false;
	if (m < 1 || m > 12 || d < 1 || d > 31) return false;
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

function assertMigrationInput(input: BrowserUseXeroMigrationInput): void {
	if (exactOrigin(input.apiExplorerOrigin) === undefined) {
		throw new Error(
			"Xero migration requires an exact HTTP(S) api-explorer allowed origin.",
		);
	}
	if (exactOrigin(input.goXeroOrigin) === undefined) {
		throw new Error(
			"Xero migration requires an exact HTTP(S) go-xero allowed origin.",
		);
	}
	if (
		input.sourceRelativePaths.length === 0 ||
		input.sourceRelativePaths.some((source) => !sourceRelativePathValid(source)) ||
		new Set(input.sourceRelativePaths).size !== input.sourceRelativePaths.length
	) {
		throw new Error(
			"Xero migration requires distinct safe relative source provenance paths.",
		);
	}
	if (
		Object.values(input.actionDigests).some(
			(digest) => !actionDigestIsValid(digest),
		)
	) {
		throw new Error(
			"Xero migration requires one exact content digest for every reviewed action.",
		);
	}
}

// --- Runbook builders ---------------------------------------------------------

function buildExtractRunbook(
	origin: string,
	requestDigest: string,
	captureDigest: string,
): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "xero-api-explorer",
		flow_id: "extract-bankstatementsplus",
		flow_name: "extract-bankstatementsplus",
		version: "2",
		summary:
			"Extract a bounded BankStatementsPlus response envelope over a validated date range.",
		allowed_origins: [origin],
		auth_context_ref: "xero-session",
		inputs: [
			{
				id: "bank_account_id",
				summary: "The bank account UUID the statement extraction targets.",
				required: true,
				custody: "sensitive",
				schema: { kind: "uuid" },
			},
			{
				id: "from_date",
				summary: "Inclusive statement range start (calendar-valid ISO date).",
				required: true,
				custody: "ordinary",
				schema: { kind: "date" },
			},
			{
				id: "to_date",
				summary: "Inclusive statement range end (calendar-valid ISO date).",
				required: true,
				custody: "ordinary",
				schema: { kind: "date" },
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "xero-request-bankstatements",
				expected_digest: requestDigest,
				inputs: {
					bank_account_id: "{{bank_account_id}}",
					from_date: "{{from_date}}",
					to_date: "{{to_date}}",
				},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "xero-capture-bankstatements",
				expected_digest: captureDigest,
				inputs: {},
			},
			{ kind: "snapshot", interactive: false },
		],
	};
}

/**
 * Build exact candidate assets for the two BankStatementsPlus effect classes.
 *
 * The legacy flow proves that request driving mutates the page and response
 * capture observes it. It does not prove the candidate selectors against
 * current Warm Chrome, so both receipts stay `invalidated` and cannot authorize
 * activation. A later operator review must replace the record with an approval
 * bound to the same bytes, origin, and audited effect.
 *
 * @param input - Exact origin and migrated source lineage for both candidates
 * @returns Deterministically ordered candidate assets and reviewed records
 *
 * @example
 * ```typescript
 * const candidates = buildXeroActionCandidates({
 *   allowedOrigin: "https://api-explorer.xero.com",
 *   sourceProvenance: "api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
 * })
 * ```
 */
export function buildXeroActionCandidates(input: {
	allowedOrigin?: string;
	sourceProvenance: string;
}): readonly BrowserUseXeroActionCandidate[] {
	const allowedOrigin = input.allowedOrigin ?? "https://api-explorer.xero.com";
	if (
		exactOrigin(allowedOrigin) === undefined ||
		!sourceRelativePathValid(input.sourceProvenance)
	) {
		throw new Error(
			"Xero action candidates require an exact origin and safe source provenance.",
		);
	}
	const candidate = (
		actionId: string,
		assetBytes: string,
		effectClass: "read" | "mutation",
		inputSchema: BrowserUseActionValueSchema,
		resultSchema: BrowserUseActionValueSchema,
	): BrowserUseXeroActionCandidate => {
		const digest = actionAssetDigest(assetBytes);
		return {
			assetBytes,
			record: {
				action_id: actionId,
				asset_id: digest,
				expected_digest: digest,
				allowed_origin: allowedOrigin,
				effect_class: effectClass,
				containment:
					effectClass === "read" ? "read-only-observation" : "none",
				input_schema: inputSchema,
				result_schema: resultSchema,
				result_sensitivity: effectClass === "read" ? "high" : "low",
				...(effectClass === "mutation"
					? {
							required_postcondition: {
								kind: "element-visible" as const,
								selector: "pre, code, textarea[readonly]",
							},
						}
					: {}),
				source_provenance: input.sourceProvenance,
				promotion_receipt: {
					approved_digest: digest,
					disposition: "invalidated",
					approved_origin: allowedOrigin,
					approved_effect: effectClass,
					approver_ref: "migration-evidence-insufficient",
				},
			},
		};
	};
	return [
		candidate(
			"xero-capture-bankstatements",
			XERO_BANKSTATEMENTS_CAPTURE_ACTION_BYTES,
			"read",
			{ kind: "object", fields: {} },
			{
				kind: "object",
				fields: {
					response_text: {
						required: true,
						schema: { kind: "string", max_length: 100_000 },
					},
					response_bytes: {
						required: true,
						schema: {
							kind: "number",
							integer: true,
							minimum: 1,
							maximum: 100_000,
						},
					},
				},
			},
		),
		candidate(
			"xero-request-bankstatements",
			XERO_BANKSTATEMENTS_REQUEST_ACTION_BYTES,
			"mutation",
			{
				kind: "object",
				fields: {
					bank_account_id: {
						required: true,
						schema: {
							kind: "string",
							max_length: 36,
							pattern:
								"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
						},
					},
					from_date: {
						required: true,
						schema: {
							kind: "string",
							max_length: 10,
							pattern: "^\\d{4}-\\d{2}-\\d{2}$",
						},
					},
					to_date: {
						required: true,
						schema: {
							kind: "string",
							max_length: 10,
							pattern: "^\\d{4}-\\d{2}-\\d{2}$",
						},
					},
				},
			},
			{
				kind: "object",
				fields: {
					request_dispatched: {
						required: true,
						schema: { kind: "boolean" },
					},
				},
			},
		),
	];
}

function buildPostBankTransactionRunbook(
	origin: string,
	digest: string,
): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "xero-api-explorer",
		flow_id: "post-banktransaction",
		flow_name: "post-banktransaction",
		version: "2",
		summary:
			"Staged-inactive: submit a caller-owned bank-transaction body (financial write).",
		allowed_origins: [origin],
		auth_context_ref: "xero-session",
		inputs: [
			{
				id: "body",
				summary: "Caller-validated bank-transaction request body (JSON string).",
				required: true,
				custody: "sensitive",
				schema: { kind: "string", min_length: 1, max_length: 100_000 },
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "xero-post-banktransaction",
				expected_digest: digest,
				inputs: { body: "{{body}}" },
			},
			{ kind: "snapshot", interactive: false },
		],
	};
}

function buildReconcileBatchRunbook(
	origin: string,
	digest: string,
): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "xero-go",
		flow_id: "reconcile-batch",
		flow_name: "reconcile-batch",
		version: "2",
		summary:
			"Staged-inactive: reconcile a bounded batch of discriminated line entries (financial write).",
		allowed_origins: [origin],
		auth_context_ref: "xero-session",
		inputs: [
			{
				id: "item_keys",
				summary: "Ordered stable keys for the reconciliation lines to checkpoint.",
				required: true,
				custody: "sensitive",
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 256,
					items: {
						kind: "string",
						min_length: 1,
						max_length: 128,
						pattern: "^[A-Za-z0-9._:-]+$",
					},
				},
			},
			{
				id: "batch",
				summary: "Discriminated reconciliation entries, one per stable key.",
				required: true,
				custody: "sensitive",
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 256,
					items: RECONCILE_VARIANT_SCHEMA,
				},
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "iterate",
				over_input: "item_keys",
				step: {
					kind: "action",
					action_id: "xero-reconcile-batch",
					expected_digest: digest,
					inputs: { batch: "{{batch}}" },
				},
			},
			{ kind: "snapshot", interactive: false },
		],
	};
}

/**
 * Build the Xero migration: one staged split-effect extraction flow plus the
 * staged financial-mutation flows, each with reconciled source
 * provenance and a per-flow activation state (R27/R28/R33). Pure and total: no
 * script bytes, no dispatch, and ZERO live financial write. The reviewed-action
 * registry owns exact bytes, effect audit, promotion, and postconditions.
 *
 * @param input - Exact origins, reviewed-action digests, and source lineage
 * @returns The active + staged-inactive flows plus provenance edges
 * @throws {Error} When origin, digest, or source-lineage invariants are invalid
 *
 * @example
 * ```typescript
 * const migrated = buildXeroMigration({
 *   apiExplorerOrigin: "https://api-explorer.xero.com",
 *   goXeroOrigin: "https://go.xero.com",
 *   actionDigests: {
 *     requestBankStatements: "1".repeat(64),
 *     captureBankStatements: "4".repeat(64),
 *     postBankTransaction: "2".repeat(64),
 *     reconcileBatch: "3".repeat(64),
 *   },
 *   sourceRelativePaths: [
 *     "api-explorer-xero/playbooks/extract-bankstatementsplus.yaml",
 *   ],
 * })
 * ```
 */
export function buildXeroMigration(
	input: BrowserUseXeroMigrationInput,
): BrowserUseXeroMigration {
	assertMigrationInput(input);
	const extract: BrowserUseXeroMigratedFlow = {
		runbook: buildExtractRunbook(
			input.apiExplorerOrigin,
			input.actionDigests.requestBankStatements,
			input.actionDigests.captureBankStatements,
		),
		activation_state: "staged-inactive",
	};
	const postBankTransaction: BrowserUseXeroMigratedFlow = {
		runbook: buildPostBankTransactionRunbook(
			input.apiExplorerOrigin,
			input.actionDigests.postBankTransaction,
		),
		activation_state: "staged-inactive",
	};
	const reconcileBatch: BrowserUseXeroMigratedFlow = {
		runbook: buildReconcileBatchRunbook(
			input.goXeroOrigin,
			input.actionDigests.reconcileBatch,
		),
		activation_state: "staged-inactive",
	};
	const stagedInactive = [postBankTransaction, reconcileBatch];
	const provenance: BrowserUseXeroProvenance[] = input.sourceRelativePaths.map(
		(source_relative_path): BrowserUseXeroProvenance => {
			const flow = inferFlowForSource(source_relative_path);
			return {
				source_relative_path,
				disposition: "migrated",
				flow_id: flow.flow_id,
				activation_state: flow.activation_state,
			};
		},
	);
	return { extract, stagedInactive, provenance };
}

// Map one source path to the flow it feeds and its activation disposition. The
// mapping is a closed, ordered table keyed on exact flow fragments: the single
// active extraction edge, the staged-inactive bank-transaction post, and the
// staged-inactive reconciliation family (batch/fill/clear-and-fill). Order is
// significant only so a compound fragment ("...-and-extract...") resolves to its
// most specific match; an unrecognized source throws rather than defaulting, so
// a typo or a new unmapped flow surfaces loudly instead of silently labelling
// financial provenance active (fail closed on the classifier itself).
const XERO_SOURCE_FLOW_TABLE: readonly {
	fragment: string;
	flow_id: string;
	activation_state: BrowserUseXeroActivationState;
}[] = [
	{ fragment: "post-banktransaction", flow_id: "post-banktransaction", activation_state: "staged-inactive" },
	{ fragment: "reconcile", flow_id: "reconcile-batch", activation_state: "staged-inactive" },
	{ fragment: "extract-bankstatementsplus", flow_id: "extract-bankstatementsplus", activation_state: "staged-inactive" },
];

function inferFlowForSource(source: string): {
	flow_id: string;
	activation_state: BrowserUseXeroActivationState;
} {
	for (const entry of XERO_SOURCE_FLOW_TABLE) {
		if (source.includes(entry.fragment)) {
			return { flow_id: entry.flow_id, activation_state: entry.activation_state };
		}
	}
	throw new Error(
		`Xero migration cannot classify source provenance path "${source}": it matches no known flow fragment.`,
	);
}

// --- Staged-inactive dispatch refusal (R33) ----------------------------------

/** Typed refusal returned when a staged-inactive Xero flow is run directly (R33). */
export type BrowserUseXeroInactiveRefusal = {
	code: "runbook_inactive";
	service_id: string;
	flow_id: string;
	message: string;
};

/**
 * Refuse a direct run of a migrated Xero flow BEFORE any handoff or dispatch
 * (R33/AE9). An `active` flow returns `{ ok: true }`; a `staged-inactive` flow
 * returns a typed `runbook_inactive` refusal so an active list/show/run never
 * reaches a financial mutation. Pure and total — it never dispatches.
 *
 * @param flow - One migrated flow with its activation state
 * @returns Ok for an active flow, or a typed `runbook_inactive` refusal
 *
 * @example
 * ```typescript
 * const gate = refuseInactiveXeroRun(migrated.stagedInactive[0]);
 * if (!gate.ok) {
 *   // gate.refusal.code === "runbook_inactive"; never dispatched.
 * }
 * ```
 */
export function refuseInactiveXeroRun(
	flow: BrowserUseXeroMigratedFlow,
):
	| { ok: true }
	| { ok: false; refusal: BrowserUseXeroInactiveRefusal } {
	if (flow.activation_state === "active") {
		return { ok: true };
	}
	return {
		ok: false,
		refusal: {
			code: "runbook_inactive",
			service_id: flow.runbook.service_id,
			flow_id: flow.runbook.flow_id,
			message:
				"this Xero flow is staged inactive; it requires exact action approval and auth, plus separate caller confirmation for financial writes, before dispatch.",
		},
	};
}

// --- Reconciliation simulation (R28) -----------------------------------------

/** Typed refusal for a reconciliation batch that fails shape validation (R28). */
export type BrowserUseXeroReconcileRefusal = {
	code: "reconcile_variant_invalid" | "reconcile_batch_shape_invalid";
	message: string;
};

/**
 * Typed outcome of one simulated reconciliation batch (no dispatch). The
 * `ok: false` branch nests its detail under `refusal` to match the union shape
 * used by {@link refuseInactiveXeroRun} and {@link preflightXeroExtract}, so a
 * caller pattern-matching `.refusal.code` handles every Xero refusal uniformly.
 */
export type BrowserUseXeroReconcileSimulation =
	| {
			ok: true;
			/** One checkpoint per validated variant, in batch order. */
			checkpoints: readonly {
				item_key: string;
				kind: BrowserUseXeroReconcileVariantKind;
				outcome: "simulated-confirmed";
			}[];
	  }
	| {
			ok: false;
			refusal: BrowserUseXeroReconcileRefusal;
	  };

/**
 * Validate and checkpoint a reconciliation batch in SIMULATION only (R28). Each
 * entry is validated against the discriminated-union variant schema and paired
 * with its stable item key; a confirmed simulation checkpoint is recorded. This
 * NEVER dispatches a browser step and NEVER performs a financial write — it
 * proves the batch shape ahead of any (separately confirmed) live activation.
 *
 * @param input - Ordered stable keys and the caller-owned discriminated batch
 * @returns Per-key simulated checkpoints, or a typed shape refusal
 *
 * @example
 * ```typescript
 * const sim = simulateXeroReconcileBatch({
 *   itemKeys: ["line-1"],
 *   batch: [{ kind: "CLICK_OK", line_index: 0 }],
 * });
 * if (sim.ok) {
 *   // sim.checkpoints[0].outcome === "simulated-confirmed" (no dispatch).
 * }
 * ```
 */
export function simulateXeroReconcileBatch(input: {
	itemKeys: readonly string[];
	batch: readonly unknown[];
}): BrowserUseXeroReconcileSimulation {
	if (
		input.itemKeys.length === 0 ||
		input.itemKeys.length !== input.batch.length ||
		new Set(input.itemKeys).size !== input.itemKeys.length
	) {
		return {
			ok: false,
			refusal: {
				code: "reconcile_batch_shape_invalid",
				message:
					"a reconciliation batch requires one distinct stable item key per entry.",
			},
		};
	}
	const checkpoints: {
		item_key: string;
		kind: BrowserUseXeroReconcileVariantKind;
		outcome: "simulated-confirmed";
	}[] = [];
	for (const [index, entry] of input.batch.entries()) {
		const variant = parseReconcileVariant(entry);
		if (variant === undefined) {
			return {
				ok: false,
				refusal: {
					code: "reconcile_variant_invalid",
					message: `reconciliation entry ${index} is not a valid CLICK_OK / FILL / CLEAR_AND_FILL variant.`,
				},
			};
		}
		checkpoints.push({
			item_key: input.itemKeys[index] as string,
			kind: variant.kind,
			outcome: "simulated-confirmed",
		});
	}
	return { ok: true, checkpoints };
}

function parseReconcileVariant(
	value: unknown,
): BrowserUseXeroReconcileVariant | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const lineIndexValid =
		typeof record.line_index === "number" &&
		Number.isInteger(record.line_index) &&
		record.line_index >= 0;
	if (!lineIndexValid) return undefined;
	if (record.kind === "CLICK_OK") {
		if (!hasOnlyKeys(record, ["kind", "line_index"])) return undefined;
		return { kind: "CLICK_OK", line_index: record.line_index as number };
	}
	if (record.kind === "FILL") {
		if (!hasOnlyKeys(record, ["kind", "line_index", "who", "what"])) return undefined;
		if (!nonEmptyString(record.who) || !nonEmptyString(record.what)) return undefined;
		return {
			kind: "FILL",
			line_index: record.line_index as number,
			who: record.who,
			what: record.what,
		};
	}
	if (record.kind === "CLEAR_AND_FILL") {
		if (!hasOnlyKeys(record, ["kind", "line_index", "what"])) return undefined;
		if (!nonEmptyString(record.what)) return undefined;
		return {
			kind: "CLEAR_AND_FILL",
			line_index: record.line_index as number,
			what: record.what,
		};
	}
	return undefined;
}

function hasOnlyKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
): boolean {
	const keys = Object.keys(record);
	return keys.length <= allowed.length && keys.every((key) => allowed.includes(key));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

// --- Extraction preflight + response-envelope proof (R21/R27) ----------------

/** Typed preflight refusal for the BankStatementsPlus extraction (R27). */
export type BrowserUseXeroExtractPreflightRefusal = {
	code:
		| "extract_bank_account_invalid"
		| "extract_date_invalid"
		| "extract_date_order_invalid"
		| "extract_range_too_large";
	message: string;
};

const UUID_V = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Enforce the BankStatementsPlus extraction preflight BEFORE touching the
 * browser (R27): a canonical UUID bank account, calendar-valid ISO dates in
 * non-reversed order, and an inclusive range no longer than
 * {@link BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS} days. Pure and total.
 *
 * @param input - Bank account UUID plus inclusive from/to dates
 * @returns Ok when the range is admissible, or a typed preflight refusal
 *
 * @example
 * ```typescript
 * const pre = preflightXeroExtract({
 *   bankAccountId: "00000000-0000-4000-8000-000000000000",
 *   fromDate: "2026-01-01",
 *   toDate: "2026-03-31",
 * });
 * if (pre.ok) {
 *   // pre.range_days <= 366; safe to dispatch the extraction action.
 * }
 * ```
 */
export function preflightXeroExtract(input: {
	bankAccountId: string;
	fromDate: string;
	toDate: string;
}):
	| { ok: true; range_days: number }
	| { ok: false; refusal: BrowserUseXeroExtractPreflightRefusal } {
	if (!UUID_V.test(input.bankAccountId)) {
		return {
			ok: false,
			refusal: {
				code: "extract_bank_account_invalid",
				message: "the bank account id is not a canonical lowercase UUID.",
			},
		};
	}
	if (
		!isCalendarValidIsoDate(input.fromDate) ||
		!isCalendarValidIsoDate(input.toDate)
	) {
		return {
			ok: false,
			refusal: {
				code: "extract_date_invalid",
				message: "from_date and to_date must be calendar-valid ISO dates.",
			},
		};
	}
	const fromMs = Date.parse(`${input.fromDate}T00:00:00Z`);
	const toMs = Date.parse(`${input.toDate}T00:00:00Z`);
	if (toMs < fromMs) {
		return {
			ok: false,
			refusal: {
				code: "extract_date_order_invalid",
				message: "to_date must not precede from_date.",
			},
		};
	}
	const rangeDays = Math.round((toMs - fromMs) / 86_400_000);
	if (rangeDays > BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS) {
		return {
			ok: false,
			refusal: {
				code: "extract_range_too_large",
				message: `the inclusive date range spans ${rangeDays} days, exceeding the ${BROWSER_USE_XERO_EXTRACT_MAX_RANGE_DAYS}-day bound.`,
			},
		};
	}
	return { ok: true, range_days: rangeDays };
}

/**
 * The typed result schema for one BankStatementsPlus response envelope (R21).
 * A read action's captured result is validated against this before any bounded
 * summary reaches shared-run state; the raw envelope never rides the run inline.
 */
export const BROWSER_USE_XERO_STATEMENTS_ENVELOPE_SCHEMA: BrowserUseActionValueSchema = {
	kind: "object",
	fields: {
		bankAccountId: { schema: { kind: "string", max_length: 128 }, required: true },
		bankAccountName: { schema: { kind: "string", max_length: 512 }, required: true },
		bankAccountCurrencyCode: {
			schema: { kind: "string", max_length: 8 },
			required: true,
		},
		statements: {
			required: true,
			schema: {
				kind: "array",
				items: {
					kind: "object",
					fields: {
						statementLines: {
							required: true,
							schema: {
								kind: "array",
								items: {
									kind: "object",
									fields: {
										description: {
											schema: { kind: "string", max_length: 1024 },
											required: false,
										},
										amount: { schema: { kind: "number" }, required: false },
									},
								},
							},
						},
					},
				},
			},
		},
	},
};

/**
 * Capture one BankStatementsPlus response envelope as a bounded, redacted
 * structured-result proof (R21/R27) through the shared `captureStructuredResult`
 * seam. A validated, low-sensitivity envelope small enough stays inline; a large
 * or high-sensitivity envelope spills to a governed artifact whose reference the
 * caller mints — the full envelope NEVER enters shared-run state inline. This
 * module owns no capture policy; it only wires the shared R21 seam.
 *
 * @param input - The raw envelope value, its sensitivity, and a spill minter
 * @returns The bounded structured-result outcome, or a typed capture refusal
 *
 * @example
 * ```typescript
 * const captured = captureXeroStatementsResult({
 *   envelope,
 *   sensitivity: "high",
 *   spillToGovernedArtifact: (payload) => retention.mint(payload),
 * });
 * // A large or high-sensitivity envelope spills; the full payload never inlines.
 * ```
 */
export function captureXeroStatementsResult(input: {
	envelope: unknown;
	sensitivity: "low" | "high";
	spillToGovernedArtifact: (canonicalPayload: string) => string;
}) {
	return captureStructuredResult({
		value: input.envelope,
		schema: BROWSER_USE_XERO_STATEMENTS_ENVELOPE_SCHEMA,
		sensitivity: input.sensitivity,
		spillToGovernedArtifact: input.spillToGovernedArtifact,
	});
}

// The reviewed-action registry owns exact action bytes and their effect audit
// (R19/KTD7); this module never embeds action bytes. Re-export the registry's
// audit helper and inline-byte ceiling so a caller (or test) can classify a
// migrated Xero action's effect class without re-declaring the audit here.
export { auditActionEffectClass, STRUCTURED_RESULT_MAX_INLINE_BYTES };
