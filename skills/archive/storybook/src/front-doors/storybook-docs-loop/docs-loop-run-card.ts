import {
	DOCS_LOOP_OPTIONAL_FIELDS,
	DOCS_LOOP_REQUIRED_FIELDS,
	DOCS_LOOP_VERIFICATION_FIELDS,
	type DocsLoopItemStatus,
	type DocsLoopReceiptStatus,
	type DocsLoopSideEffectStance,
	type DocsLoopVerificationField,
	type StorybookDocsLoopCommand,
} from "./docs-loop-model.ts";
import type { DocsLoopComponentCluster } from "./docs-loop-inventory.ts";
import { DocsLoopStateError } from "./docs-loop-state.ts";

/** Verification receipt stored for one ledger field. */
export interface DocsLoopReceipt {
	/** Receipt status. */
	readonly status: DocsLoopReceiptStatus;
	/** Optional reason for na or blocked. */
	readonly reason?: string;
	/** Last update timestamp. */
	readonly updated_at: string;
}

/** Durable docs-loop item state. */
export interface DocsLoopRunItem {
	/** Component name. */
	readonly component: string;
	/** Discovered story cluster. */
	readonly cluster: DocsLoopComponentCluster;
	/** Explicit item status when set outside derived receipt state. */
	readonly status: DocsLoopItemStatus;
}

/** Durable docs-loop run state. */
export interface DocsLoopRunState {
	/** Run identifier. */
	readonly run: string;
	/** Target repository path. */
	readonly repo: string;
	/** Target package path, when provided. */
	readonly pkg?: string;
	/** Creation timestamp. */
	readonly created_at: string;
	/** Last update timestamp. */
	readonly updated_at: string;
	/** Current cursor into items. */
	readonly cursor: number;
	/** Batch size. */
	readonly batch_size: number;
	/** Discovered clusters. */
	readonly inventory: readonly DocsLoopComponentCluster[];
	/** Run items. */
	readonly items: readonly DocsLoopRunItem[];
	/** Verification ledger keyed by component then field. */
	readonly ledger: Record<
		string,
		Partial<Record<DocsLoopVerificationField, DocsLoopReceipt | null>>
	>;
	/** Forced advance decisions. */
	readonly forced_advances: readonly DocsLoopForcedAdvance[];
}

/** Forced advance record for degraded or blocked items. */
export interface DocsLoopForcedAdvance {
	/** Component name. */
	readonly component: string;
	/** Derived status at force time. */
	readonly status: DocsLoopItemStatus;
	/** Operator or agent reason. */
	readonly reason: string;
	/** Timestamp. */
	readonly forced_at: string;
}

/** Run-card payload emitted by run-card commands. */
export interface DocsLoopRunCard {
	/** Correlates this output with durable run state. */
	readonly run: string | null;
	/** Current command route that produced the card. */
	readonly command: StorybookDocsLoopCommand;
	/** Component for the current card, when available. */
	readonly component: string | null;
	/** Current item status after receipt derivation. */
	readonly item_status: DocsLoopItemStatus | "none";
	/** Whether this output changed durable docs-loop state. */
	readonly changed_state: "none" | "loop_state";
	/** Same-input retry safety for the command result. */
	readonly retry_safe: boolean;
	/** Declared side-effect stance for the command result. */
	readonly side_effect_stance: DocsLoopSideEffectStance;
	/** Current continuation for the next agent. */
	readonly next_safe_action: string;
	/** Current batch projection. */
	readonly current_batch: readonly DocsLoopRunCardItem[];
	/** Current cluster, when available. */
	readonly cluster: DocsLoopComponentCluster | null;
	/** Story-set decision prompts for the next agent. */
	readonly story_set_decisions: readonly string[];
	/** Verification receipt map for the current item. */
	readonly verification_receipts: Record<string, DocsLoopReceiptProjection>;
	/** Owner path for completion proof. */
	readonly checklist_path: string;
}

/** Current batch item projection. */
export interface DocsLoopRunCardItem {
	/** Component name. */
	readonly component: string;
	/** Derived item status. */
	readonly status: DocsLoopItemStatus;
	/** Main story path. */
	readonly main_story: string | null;
}

/** Receipt projection for run cards. */
export interface DocsLoopReceiptProjection {
	/** Whether the field is required by the docs-loop ledger. */
	readonly required: boolean;
	/** Receipt status, when already marked. */
	readonly status: DocsLoopReceiptStatus | "missing";
	/** Optional reason. */
	readonly reason?: string;
}

const CHECKLIST_PATH = "skills/storybook/references/docs-workflow-checklist.md";

/**
 * Create durable run state from inventory clusters.
 *
 * @param input - Run id, target data, clusters, batch size, and timestamp
 * @returns Initial run state with ledger skeleton
 *
 * @example
 * ```typescript
 * const state = createDocsLoopRunState({ run: "docs", repo: "/repo", clusters, batchSize: 1, now: "..." })
 * ```
 */
export function createDocsLoopRunState(input: {
	readonly run: string;
	readonly repo: string;
	readonly pkg?: string;
	readonly clusters: readonly DocsLoopComponentCluster[];
	readonly batchSize: number;
	readonly now: string;
}): DocsLoopRunState {
	const items = input.clusters.map((cluster) => ({
		component: cluster.component,
		cluster,
		status: "queued" as const,
	}));
	return {
		run: input.run,
		repo: input.repo,
		...(input.pkg ? { pkg: input.pkg } : {}),
		created_at: input.now,
		updated_at: input.now,
		cursor: 0,
		batch_size: input.batchSize,
		inventory: input.clusters,
		items,
		ledger: Object.fromEntries(
			items.map((item) => [item.component, createLedgerSkeleton()]),
		),
		forced_advances: [],
	};
}

/**
 * Build a run card for the current item.
 *
 * @param state - Durable run state or null for single scouting
 * @param input - Command, cluster, and side-effect metadata
 * @returns Run-card payload
 *
 * @example
 * ```typescript
 * const card = buildDocsLoopRunCard(state, { command: "resume", changedState: "none", sideEffectStance: "read_only" })
 * ```
 */
export function buildDocsLoopRunCard(
	state: DocsLoopRunState | null,
	input: {
		readonly command: StorybookDocsLoopCommand;
		readonly cluster?: DocsLoopComponentCluster;
		readonly changedState: "none" | "loop_state";
		readonly retrySafe: boolean;
		readonly sideEffectStance: DocsLoopSideEffectStance;
	},
): DocsLoopRunCard {
	const item = state?.items[state.cursor] ?? null;
	const cluster = input.cluster ?? item?.cluster ?? null;
	const component = cluster?.component ?? item?.component ?? null;
	const receipts =
		state && component ? (state.ledger[component] ?? createLedgerSkeleton()) : {};
	const status =
		item && component
			? deriveDocsLoopItemStatus(item.status, receipts)
			: component
				? "editing"
				: "none";
	const runComplete = Boolean(
		state && state.items.length > 0 && state.cursor >= state.items.length,
	);
	const currentBatch = state
		? state.items
				.slice(state.cursor, state.cursor + state.batch_size)
				.map((batchItem) => ({
					component: batchItem.component,
					status: deriveDocsLoopItemStatus(
						batchItem.status,
						state.ledger[batchItem.component] ?? createLedgerSkeleton(),
					),
					main_story: batchItem.cluster.main_story,
				}))
		: cluster
			? [{ component: cluster.component, status: "editing" as const, main_story: cluster.main_story }]
			: [];
	return {
		run: state?.run ?? null,
		command: input.command,
		component,
		item_status: status,
		changed_state: input.changedState,
		retry_safe: input.retrySafe,
		side_effect_stance: input.sideEffectStance,
		next_safe_action: runComplete
			? "All items complete. Purge this run or review forced_advances."
			: nextSafeActionForStatus(status),
		current_batch: currentBatch,
		cluster,
		story_set_decisions: [
			"Decide Default/Primary readiness.",
			"Decide Matrix inclusion.",
			"Decide UX tips inclusion.",
			"Decide focused stories to keep, remove, or hide.",
		],
		verification_receipts: projectReceipts(receipts),
		checklist_path: CHECKLIST_PATH,
	};
}

/**
 * Derive item status from ledger receipts.
 *
 * @param explicitStatus - Stored item status
 * @param receipts - Ledger receipts for the item
 * @returns Derived item status
 *
 * @example
 * ```typescript
 * const status = deriveDocsLoopItemStatus("editing", ledger.Button)
 * ```
 */
export function deriveDocsLoopItemStatus(
	explicitStatus: DocsLoopItemStatus,
	receipts: Partial<Record<DocsLoopVerificationField, DocsLoopReceipt | null>>,
): DocsLoopItemStatus {
	if (explicitStatus === "skipped") return "skipped";
	if (
		DOCS_LOOP_VERIFICATION_FIELDS.some(
			(field) => receipts[field]?.status === "blocked",
		)
	) {
		return "blocked";
	}
	const requiredResolved = DOCS_LOOP_REQUIRED_FIELDS.every((field) =>
		["done", "na"].includes(receipts[field]?.status ?? ""),
	);
	if (!requiredResolved) return explicitStatus === "queued" ? "editing" : explicitStatus;
	const optionalResolved = DOCS_LOOP_OPTIONAL_FIELDS.every((field) =>
		["done", "na"].includes(receipts[field]?.status ?? ""),
	);
	return optionalResolved ? "verified" : "degraded";
}

/** Create an empty ledger skeleton for all verification fields. */
export function createLedgerSkeleton(): Partial<
	Record<DocsLoopVerificationField, DocsLoopReceipt | null>
> {
	return Object.fromEntries(DOCS_LOOP_VERIFICATION_FIELDS.map((field) => [field, null]));
}

/**
 * Coerce JSON state into the docs-loop run state shape after structural checks.
 *
 * Validates the required top-level fields and `batch_size` range so a partial
 * write, hand-edited file, or schema drift surfaces a repairable
 * {@link DocsLoopStateError} instead of crashing a downstream property access.
 *
 * @param state - Parsed JSON state object
 * @returns The same object typed as run state
 * @throws DocsLoopStateError when required fields are missing or out of range
 */
export function asDocsLoopRunState(
	state: Record<string, unknown>,
): DocsLoopRunState {
	assertDocsLoopRunStateShape(state);
	return state as unknown as DocsLoopRunState;
}

/**
 * Assert that parsed JSON carries a usable docs-loop run state shape.
 *
 * @param state - Parsed JSON state object
 * @throws DocsLoopStateError with code `corrupt_state_schema` on any violation
 */
export function assertDocsLoopRunStateShape(
	state: Record<string, unknown>,
): void {
	const fail = (detail: string): never => {
		throw new DocsLoopStateError(
			"corrupt_state_schema",
			`Run state is structurally invalid: ${detail}`,
			"Purge and recreate the run.",
			true,
		);
	};
	if (typeof state.run !== "string") fail("run must be a string");
	if (!Array.isArray(state.items)) fail("items must be an array");
	if (typeof state.cursor !== "number" || !Number.isInteger(state.cursor)) {
		fail("cursor must be an integer");
	}
	if (
		typeof state.batch_size !== "number" ||
		!Number.isInteger(state.batch_size) ||
		state.batch_size < 1 ||
		state.batch_size > 100
	) {
		fail("batch_size must be an integer from 1 to 100");
	}
	if (state.ledger === null || typeof state.ledger !== "object") {
		fail("ledger must be an object");
	}
}

/** Update one receipt in durable state. */
export function withReceipt(
	state: DocsLoopRunState,
	input: {
		readonly component: string;
		readonly field: DocsLoopVerificationField;
		readonly status: DocsLoopReceiptStatus;
		readonly reason?: string;
		readonly now: string;
	},
): DocsLoopRunState {
	const componentLedger = state.ledger[input.component] ?? createLedgerSkeleton();
	return {
		...state,
		updated_at: input.now,
		ledger: {
			...state.ledger,
			[input.component]: {
				...componentLedger,
				[input.field]: {
					status: input.status,
					...(input.reason ? { reason: input.reason } : {}),
					updated_at: input.now,
				},
			},
		},
	};
}

/** Advance cursor and record forced decisions when needed. */
export function advanceDocsLoopState(
	state: DocsLoopRunState,
	input: { readonly reason?: string; readonly now: string },
): DocsLoopRunState {
	const batch = state.items.slice(state.cursor, state.cursor + state.batch_size);
	if (batch.length === 0) return { ...state, updated_at: input.now };
	const forcedAdvances: DocsLoopForcedAdvance[] = [];
	if (input.reason) {
		for (const item of batch) {
			const status = deriveDocsLoopItemStatus(
				item.status,
				state.ledger[item.component] ?? createLedgerSkeleton(),
			);
			if (status === "degraded" || status === "blocked") {
				forcedAdvances.push({
					component: item.component,
					status,
					reason: input.reason,
					forced_at: input.now,
				});
			}
		}
	}
	return {
		...state,
		updated_at: input.now,
		cursor: Math.min(state.cursor + state.batch_size, state.items.length),
		forced_advances:
			forcedAdvances.length > 0
				? [...state.forced_advances, ...forcedAdvances]
				: state.forced_advances,
	};
}

function projectReceipts(
	receipts: Partial<Record<DocsLoopVerificationField, DocsLoopReceipt | null>>,
): Record<string, DocsLoopReceiptProjection> {
	return Object.fromEntries(
		DOCS_LOOP_VERIFICATION_FIELDS.map((field) => {
			const receipt = receipts[field];
			return [
				field,
				{
					required: (DOCS_LOOP_REQUIRED_FIELDS as readonly string[]).includes(
						field,
					),
					status: receipt?.status ?? "missing",
					...(receipt?.reason ? { reason: receipt.reason } : {}),
				},
			];
		}),
	);
}

function nextSafeActionForStatus(status: DocsLoopItemStatus | "none"): string {
	switch (status) {
		case "verified":
			return "Advance to the next batch item.";
		case "degraded":
			return "Review optional gaps before forcing advance.";
		case "blocked":
			return "Resolve the blocking receipt before advance.";
		case "none":
			return "Create or select a run.";
		default:
			return "Read cluster files and fill verification receipts.";
	}
}
