import { isAbsolute } from "node:path";
import { actionDigestIsValid } from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	runbookExactOriginIsValid,
} from "./browser-use-runbook-model";

/** Exact action digests supplied by one staged generation. */
export type BrowserUseOncoreSaveDraftActionDigests = {
	/** Observational reconciliation action. */
	reconcileRows: string;
	/** Per-entry mutation action. */
	fillEntry: string;
	/** Controlled draft-save mutation action. */
	saveDraft: string;
	/** Observational post-reload proof action. */
	verifyDraft: string;
};

/** Inputs required to build the staged Oncore write-capable flow. */
export type BrowserUseOncoreSaveDraftMigrationInput = {
	/** Exact portal origin admitted by every reviewed action. */
	allowedOrigin: string;
	/** Exact timesheet URL re-opened after the controlled draft save. */
	timesheetUrl: string;
	/** Winning split-entry source candidate retained as active provenance. */
	activeSourceRelativePath: string;
	/** Older candidates retained as inspectable superseded provenance. */
	supersededSourceRelativePaths: readonly string[];
	/** Content identities resolved later through the generation action seam. */
	actionDigests: BrowserUseOncoreSaveDraftActionDigests;
};

/** One inspectable source edge for the canonical Oncore flow. */
export type BrowserUseOncoreSaveDraftProvenance =
	| {
			source_relative_path: string;
			disposition: "migrated";
	  }
	| {
			source_relative_path: string;
			disposition: "superseded-by";
			superseded_by: string;
	  };

/** Staged Oncore flow plus its reconciled source lineage. */
export type BrowserUseOncoreSaveDraftMigration = {
	/** The only canonical executable definition produced for this intent. */
	runbook: BrowserUseRunbook;
	/** Winner and superseded candidates without copied legacy bytes. */
	provenance: readonly BrowserUseOncoreSaveDraftProvenance[];
};

function exactOrigin(value: string): string | undefined {
	return runbookExactOriginIsValid(value) ? value : undefined;
}

function sourceRelativePathValid(value: string): boolean {
	return (
		value.length > 0 &&
		!isAbsolute(value) &&
		!value.split("/").some((segment) => segment === "" || segment === "..")
	);
}

function assertMigrationInput(input: BrowserUseOncoreSaveDraftMigrationInput): void {
	const origin = exactOrigin(input.allowedOrigin);
	let timesheet: URL;
	try {
		timesheet = new URL(input.timesheetUrl);
	} catch {
		throw new Error("Oncore staged migration requires an exact HTTP(S) timesheet URL.");
	}
	if (timesheet.protocol !== "http:" && timesheet.protocol !== "https:") {
		throw new Error("Oncore staged migration requires an exact HTTP(S) timesheet URL.");
	}
	if (origin === undefined || timesheet.origin !== origin) {
		throw new Error(
			"Oncore staged migration requires the timesheet URL and reviewed actions to share one exact allowed origin.",
		);
	}
	const sources = [
		input.activeSourceRelativePath,
		...input.supersededSourceRelativePaths,
	];
	if (
		sources.some((source) => !sourceRelativePathValid(source)) ||
		new Set(sources).size !== sources.length
	) {
		throw new Error(
			"Oncore staged migration requires distinct safe relative source provenance paths.",
		);
	}
	if (
		Object.values(input.actionDigests).some(
			(digest) => !actionDigestIsValid(digest),
		)
	) {
		throw new Error(
			"Oncore staged migration requires one exact content digest for every reviewed action.",
		);
	}
}

/**
 * Build the single staged Oncore fill/save-draft flow and reconcile its sources.
 *
 * The builder owns only declarative orchestration and provenance. Exact action
 * bytes, effect audit, promotion receipts, and postconditions remain owned by
 * the generation-scoped reviewed-action registry.
 *
 * @param input - Exact staged origin, source lineage, and action identities
 * @returns One canonical runbook plus migrated/superseded provenance edges
 * @throws {Error} When origin, digest, or source-lineage invariants are invalid
 *
 * @example
 * ```typescript
 * const staged = buildOncoreSaveDraftMigration({
 *   allowedOrigin: "https://portal.example.com",
 *   timesheetUrl: "https://portal.example.com/timesheets/current",
 *   activeSourceRelativePath: "oncore/playbooks/fill-split.json",
 *   supersededSourceRelativePaths: ["oncore/playbooks/fill-broad.json"],
 *   actionDigests: {
 *     reconcileRows: "1".repeat(64),
 *     fillEntry: "2".repeat(64),
 *     saveDraft: "3".repeat(64),
 *     verifyDraft: "4".repeat(64),
 *   },
 * })
 * ```
 */
export function buildOncoreSaveDraftMigration(
	input: BrowserUseOncoreSaveDraftMigrationInput,
): BrowserUseOncoreSaveDraftMigration {
	assertMigrationInput(input);
	const runbook: BrowserUseRunbook = {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "oncore",
		flow_id: "fill-timesheet",
		flow_name: "fill-timesheet",
		version: "2",
		summary: "Reconcile rows, fill checkpointed entries, and preserve a controlled draft.",
		allowed_origins: [input.allowedOrigin],
		auth_context_ref: "oncore-session",
		inputs: [
			{
				id: "item_keys",
				summary: "Ordered stable keys for the entries to reconcile and fill.",
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 31,
					items: {
						kind: "string",
						min_length: 1,
						max_length: 128,
						pattern: "^[A-Za-z0-9._:-]+$",
					},
				},
			},
			{
				id: "entries",
				summary: "Expected draft rows keyed to the ordered checkpoint sequence.",
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 31,
					items: {
						kind: "object",
						fields: {
							item_key: {
								required: true,
								schema: { kind: "string", min_length: 1, max_length: 128 },
							},
							date: { required: true, schema: { kind: "date" } },
							units: {
								required: true,
								schema: { kind: "number", minimum: 0, maximum: 24 },
							},
						},
					},
				},
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "oncore-reconcile-rows",
				expected_digest: input.actionDigests.reconcileRows,
				inputs: { entries: "{{entries}}" },
			},
			{
				kind: "iterate",
				over_input: "item_keys",
				step: {
					kind: "action",
					action_id: "oncore-fill-entry",
					expected_digest: input.actionDigests.fillEntry,
					inputs: { entries: "{{entries}}" },
				},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "oncore-save-draft",
				expected_digest: input.actionDigests.saveDraft,
				inputs: {},
			},
			{
				kind: "open",
				url: input.timesheetUrl,
				postcondition: { kind: "url-equals", url: input.timesheetUrl },
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "oncore-verify-draft",
				expected_digest: input.actionDigests.verifyDraft,
				inputs: {
					item_keys: "{{item_keys}}",
					entries: "{{entries}}",
				},
			},
		],
	};
	return {
		runbook,
		provenance: [
			{
				source_relative_path: input.activeSourceRelativePath,
				disposition: "migrated",
			},
			...input.supersededSourceRelativePaths.map(
				(source_relative_path): BrowserUseOncoreSaveDraftProvenance => ({
					source_relative_path,
					disposition: "superseded-by",
					superseded_by: input.activeSourceRelativePath,
				}),
			),
		],
	};
}
