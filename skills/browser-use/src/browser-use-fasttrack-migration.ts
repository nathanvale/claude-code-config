import { isAbsolute } from "node:path";
import { actionDigestIsValid } from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	runbookExactOriginIsValid,
} from "./browser-use-runbook-model";

/** Exact action digests supplied by one staged generation. */
export type BrowserUseFasttrackSaveDraftActionDigests = {
	/** Route-reconciliation action (a navigating diagnostic, audited as mutation). */
	diagnoseRoute: string;
	/** Per-day fill mutation action. */
	fillDay: string;
	/** Per-day break-insertion mutation action. */
	addBreaks: string;
	/** Controlled draft-save mutation action (never Submit). */
	saveDraft: string;
	/** Post-reload persistence-proof action (navigates, audited as mutation). */
	verifySavedDraft: string;
};

/** Inputs required to build the staged FastTrack write-capable flow. */
export type BrowserUseFasttrackSaveDraftMigrationInput = {
	/** Exact portal origin admitted by every reviewed action. */
	allowedOrigin: string;
	/** Exact timesheet URL re-opened after the controlled draft save. */
	timesheetUrl: string;
	/** Winning per-day-split source candidate retained as active provenance. */
	activeSourceRelativePath: string;
	/** Older candidates retained as inspectable superseded provenance. */
	supersededSourceRelativePaths: readonly string[];
	/** Content identities resolved later through the generation action seam. */
	actionDigests: BrowserUseFasttrackSaveDraftActionDigests;
};

/** One inspectable source edge for the canonical FastTrack flow. */
export type BrowserUseFasttrackSaveDraftProvenance =
	| {
			source_relative_path: string;
			disposition: "migrated";
	  }
	| {
			source_relative_path: string;
			disposition: "superseded-by";
			superseded_by: string;
	  };

/** Staged FastTrack flow plus its reconciled source lineage. */
export type BrowserUseFasttrackSaveDraftMigration = {
	/** The only canonical executable definition produced for this intent. */
	runbook: BrowserUseRunbook;
	/** Winner and superseded candidates without copied legacy bytes. */
	provenance: readonly BrowserUseFasttrackSaveDraftProvenance[];
};

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

function assertMigrationInput(
	input: BrowserUseFasttrackSaveDraftMigrationInput,
): void {
	const origin = exactOrigin(input.allowedOrigin);
	let timesheet: URL;
	try {
		timesheet = new URL(input.timesheetUrl);
	} catch {
		throw new Error(
			"FastTrack staged migration requires an exact HTTP(S) timesheet URL.",
		);
	}
	if (timesheet.protocol !== "http:" && timesheet.protocol !== "https:") {
		throw new Error(
			"FastTrack staged migration requires an exact HTTP(S) timesheet URL.",
		);
	}
	if (origin === undefined || timesheet.origin !== origin) {
		throw new Error(
			"FastTrack staged migration requires the timesheet URL and reviewed actions to share one exact allowed origin.",
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
			"FastTrack staged migration requires distinct safe relative source provenance paths.",
		);
	}
	if (
		Object.values(input.actionDigests).some(
			(digest) => !actionDigestIsValid(digest),
		)
	) {
		throw new Error(
			"FastTrack staged migration requires one exact content digest for every reviewed action.",
		);
	}
}

/**
 * Build the single staged FastTrack fill/breaks/save-draft flow and reconcile
 * its sources.
 *
 * The builder owns only declarative orchestration and provenance. Exact action
 * bytes, effect audit, promotion receipts, and postconditions remain owned by
 * the generation-scoped reviewed-action registry. The legacy manifest labelled
 * `diagnose_route`, `verify_filled_week`, and `verify_saved_draft` as
 * `read-only`, but every one of those helpers navigates (`$location.path`,
 * `location.href`), clicks tabs, and mutates through `scope.$apply(...)`. The
 * legacy `risk_class` is NEVER authority here: the reviewed-action registry
 * re-derives each effect class from audited behavior (R19/AE6), so a mislabelled
 * diagnostic still carries write-ahead mutation truth. Submit is PROHIBITED: no
 * step targets a final submission boundary, and the runbook is Submit-free by
 * construction (R26/AE8).
 *
 * @param input - Exact staged origin, source lineage, and action identities
 * @returns One canonical runbook plus migrated/superseded provenance edges
 * @throws {Error} When origin, digest, or source-lineage invariants are invalid
 *
 * @example
 * ```typescript
 * const staged = buildFasttrackSaveDraftMigration({
 *   allowedOrigin: "https://portal.example.com",
 *   timesheetUrl: "https://portal.example.com/timesheets/current",
 *   activeSourceRelativePath: "fasttrack/playbooks/fill-week-per-day.json",
 *   supersededSourceRelativePaths: ["fasttrack/playbooks/fill-week-broad.json"],
 *   actionDigests: {
 *     diagnoseRoute: "1".repeat(64),
 *     fillDay: "2".repeat(64),
 *     addBreaks: "3".repeat(64),
 *     saveDraft: "4".repeat(64),
 *     verifySavedDraft: "5".repeat(64),
 *   },
 * })
 * ```
 */
export function buildFasttrackSaveDraftMigration(
	input: BrowserUseFasttrackSaveDraftMigrationInput,
): BrowserUseFasttrackSaveDraftMigration {
	assertMigrationInput(input);
	const runbook: BrowserUseRunbook = {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "fasttrack",
		flow_id: "fill-week",
		flow_name: "fill-week",
		version: "2",
		summary:
			"Reconcile the timesheet route, fill checkpointed days, add per-day breaks, and preserve a controlled draft.",
		allowed_origins: [input.allowedOrigin],
		auth_context_ref: "interactive-login",
		inputs: [
			{
				id: "day_keys",
				summary: "Ordered stable day keys (Mon..Sun) to fill and break.",
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 7,
					items: {
						kind: "string",
						min_length: 1,
						max_length: 16,
						pattern: "^[A-Za-z0-9._:-]+$",
					},
				},
			},
			{
				id: "days",
				summary: "Expected per-day rows keyed to the ordered day-key sequence.",
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 7,
					items: {
						kind: "object",
						fields: {
							day_key: {
								required: true,
								schema: { kind: "string", min_length: 1, max_length: 16 },
							},
							start_time: {
								required: true,
								schema: {
									kind: "string",
									pattern: "^[0-2][0-9]:[0-5][0-9]$",
								},
							},
							end_time: {
								required: true,
								schema: {
									kind: "string",
									pattern: "^[0-2][0-9]:[0-5][0-9]$",
								},
							},
							attendance_type: {
								required: true,
								schema: {
									kind: "enum",
									values: ["Standard", "Public Holiday Worked"],
								},
							},
							break_start: {
								required: false,
								schema: {
									kind: "string",
									pattern: "^[0-2][0-9]:[0-5][0-9]$",
								},
							},
							break_end: {
								required: false,
								schema: {
									kind: "string",
									pattern: "^[0-2][0-9]:[0-5][0-9]$",
								},
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
				action_id: "fasttrack-diagnose-route",
				expected_digest: input.actionDigests.diagnoseRoute,
				inputs: { days: "{{days}}" },
			},
			{
				kind: "iterate",
				over_input: "day_keys",
				step: {
					kind: "action",
					action_id: "fasttrack-fill-day",
					expected_digest: input.actionDigests.fillDay,
					inputs: { days: "{{days}}" },
				},
			},
			{
				kind: "iterate",
				over_input: "day_keys",
				step: {
					kind: "action",
					action_id: "fasttrack-add-breaks",
					expected_digest: input.actionDigests.addBreaks,
					inputs: { days: "{{days}}" },
				},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "fasttrack-save-draft",
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
				action_id: "fasttrack-verify-saved-draft",
				expected_digest: input.actionDigests.verifySavedDraft,
				inputs: {
					day_keys: "{{day_keys}}",
					days: "{{days}}",
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
				(source_relative_path): BrowserUseFasttrackSaveDraftProvenance => ({
					source_relative_path,
					disposition: "superseded-by",
					superseded_by: input.activeSourceRelativePath,
				}),
			),
		],
	};
}
