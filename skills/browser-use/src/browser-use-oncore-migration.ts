import { isAbsolute } from "node:path";
import { actionDigestIsValid } from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	runbookExactOriginIsValid,
} from "./browser-use-runbook-model";
import { BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA } from "./browser-use-timesheet-run-contract";

/** Inputs required to build the read-only Oncore timesheet diagnosis flow. */
export type BrowserUseOncoreTimesheetDiagnosisMigrationInput = {
	/** Exact portal origin admitted by the reviewed diagnosis action. */
	allowedOrigin: string;
	/** Legacy source retained as inspectable provenance. */
	sourceRelativePath: string;
	/** Exact content identity of the reviewed read-only diagnosis action. */
	actionDigest: string;
};

/** Read-only diagnosis flow plus its source lineage. */
export type BrowserUseOncoreTimesheetDiagnosisMigration = {
	/** Canonical bounded structural diagnosis runbook. */
	runbook: BrowserUseRunbook;
	/** Exact source edge without copied legacy bytes. */
	provenance: readonly [
		{
			source_relative_path: string;
			disposition: "migrated";
		},
	];
};

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
	/** The canonical staged definition; activation remains blocked until sequencing exists. */
	runbook: BrowserUseRunbook;
	/** Exact legacy source identities retained for later reviewed-action promotion. */
	legacy_action_digests: BrowserUseOncoreSaveDraftActionDigests;
	/** Mechanical blocker preventing a false executable claim. */
	activation_blocker: string;
	/** Winner and superseded candidates without copied legacy bytes. */
	provenance: readonly BrowserUseOncoreSaveDraftProvenance[];
};

const ONCORE_SPLIT_CADENCE_BLOCKER =
	"Oncore draft fill requires the proven open-entry, wait, fill-entry, wait cadence per item; the current runbook step vocabulary cannot represent that sequence.";

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

function assertDiagnosisMigrationInput(
	input: BrowserUseOncoreTimesheetDiagnosisMigrationInput,
): void {
	if (exactOrigin(input.allowedOrigin) === undefined) {
		throw new Error(
			"Oncore diagnosis migration requires one exact allowed origin.",
		);
	}
	if (!sourceRelativePathValid(input.sourceRelativePath)) {
		throw new Error(
			"Oncore diagnosis migration requires one safe relative source provenance path.",
		);
	}
	if (!actionDigestIsValid(input.actionDigest)) {
		throw new Error(
			"Oncore diagnosis migration requires the exact content digest of the reviewed action.",
		);
	}
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
 * Build the read-only Oncore timesheet diagnosis flow.
 *
 * Result containment remains owned by the reviewed action registry. The bound
 * action emits only row count, state, submit availability, and a match sentinel.
 *
 * @param input - Exact origin, source lineage, and reviewed action identity
 * @returns One canonical diagnosis runbook plus its migrated source edge
 * @throws {Error} When origin, digest, or source-lineage invariants are invalid
 */
export function buildOncoreTimesheetDiagnosisMigration(
	input: BrowserUseOncoreTimesheetDiagnosisMigrationInput,
): BrowserUseOncoreTimesheetDiagnosisMigration {
	assertDiagnosisMigrationInput(input);
	return {
		runbook: {
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "oncore",
			flow_id: "timesheet-diagnose",
			flow_name: "timesheet-diagnose",
			version: "2",
			summary:
				"Diagnose bounded structural state for the open Oncore timesheet.",
			allowed_origins: [input.allowedOrigin],
			auth_context_ref: "oncore-session",
			inputs: [
				{
					id: "timesheet_id",
					summary: "Exact identifier expected for the open timesheet.",
					required: true,
					custody: "sensitive",
					schema: {
						kind: "string",
						min_length: 1,
						max_length: 128,
						pattern: "^[A-Za-z0-9._:-]+$",
					},
				},
			],
			steps: [
				{ kind: "snapshot", interactive: false },
				{
					kind: "action",
					action_id: "oncore-diagnose-timesheet",
					expected_digest: input.actionDigest,
					inputs: { timesheet_id: "{{timesheet_id}}" },
				},
			],
		},
		provenance: [
			{
				source_relative_path: input.sourceRelativePath,
				disposition: "migrated",
			},
		],
	};
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
		summary:
			"Prepare and verify human-authored Oncore entries as a draft; final Submit stays human-controlled.",
		allowed_origins: [input.allowedOrigin],
		auth_context_ref: "oncore-session",
		inputs: [
			{
				id: "timesheet_run",
				summary:
					"Shared run envelope plus the Oncore timesheet, rate, unit, and client-state payload.",
				required: true,
				custody: "sensitive",
				schema: BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA,
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "oncore-reconcile-rows",
				expected_digest: input.actionDigests.reconcileRows,
				inputs: {
					entries: "{{timesheet_run.payload.entries}}",
				},
			},
			{
				kind: "iterate",
				over_input: "timesheet_run.payload.item_keys",
				step: {
					kind: "action",
					action_id: "oncore-fill-entry",
					expected_digest: input.actionDigests.fillEntry,
					inputs: {
						entries: "{{timesheet_run.payload.entries}}",
					},
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
					item_keys: "{{timesheet_run.payload.item_keys}}",
					entries: "{{timesheet_run.payload.entries}}",
				},
			},
		],
	};
	return {
		runbook,
		legacy_action_digests: { ...input.actionDigests },
		activation_blocker: ONCORE_SPLIT_CADENCE_BLOCKER,
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
