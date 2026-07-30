import { isAbsolute } from "node:path";
import { actionDigestIsValid } from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	runbookExactOriginIsValid,
} from "./browser-use-runbook-model";
import { BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA } from "./browser-use-timesheet-run-contract";

/** Exact action digests supplied by one staged generation. */
export type BrowserUseFasttrackSaveDraftActionDigests = {
	/** Whole-week field mutation action. */
	fillWeek: string;
	/** Pre-save field verification action (navigates, audited as mutation). */
	verifyFilledWeek: string;
	/** Controlled draft-save mutation action (never Submit). */
	saveDraft: string;
	/** Post-save persistence-proof action (clicks tabs, audited as mutation). */
	verifySavedDraft: string;
};

/** Inputs required to build the staged FastTrack write-capable flow. */
export type BrowserUseFasttrackSaveDraftMigrationInput = {
	/** Exact portal origin admitted by every reviewed action. */
	allowedOrigin: string;
	/** Winning whole-week source candidate retained as active provenance. */
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
	if (origin === undefined) {
		throw new Error(
			"FastTrack staged migration requires one exact allowed origin.",
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
 * Build the single staged FastTrack fill/save-draft flow and reconcile
 * its sources.
 *
 * The builder owns only declarative orchestration and provenance. Exact action
 * bytes, effect audit, promotion receipts, and postconditions remain owned by
 * the generation-scoped reviewed-action registry. The legacy manifest labelled
 * `diagnose_route`, `verify_filled_week`, and `verify_saved_draft` as
 * `read-only`, but the verification helpers navigate (`$location.path`,
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
 *   activeSourceRelativePath: "fasttrack/playbooks/fill-week-per-day.json",
 *   supersededSourceRelativePaths: ["fasttrack/playbooks/fill-week-broad.json"],
 *   actionDigests: {
 *     fillWeek: "1".repeat(64),
 *     verifyFilledWeek: "2".repeat(64),
 *     saveDraft: "3".repeat(64),
 *     verifySavedDraft: "4".repeat(64),
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
			"Prepare and verify one human-authored week as a draft; final Submit stays human-controlled.",
		allowed_origins: [input.allowedOrigin],
		auth_context_ref: "fasttrack-session",
		inputs: [
			{
				id: "timesheet_run",
				summary:
					"Shared run envelope plus the FastTrack clock-time and attendance payload.",
				required: true,
				custody: "sensitive",
				schema: BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA,
			},
		],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "fasttrack-fill-week",
				expected_digest: input.actionDigests.fillWeek,
				inputs: {
					week_start: "{{timesheet_run.envelope.period_start}}",
					week_end: "{{timesheet_run.envelope.period_end}}",
					rows: "{{timesheet_run.payload.rows}}",
				},
			},
			{
				kind: "action",
				action_id: "fasttrack-verify-filled-week",
				expected_digest: input.actionDigests.verifyFilledWeek,
				inputs: {
					week_start: "{{timesheet_run.envelope.period_start}}",
					week_end: "{{timesheet_run.envelope.period_end}}",
					rows: "{{timesheet_run.payload.rows}}",
				},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "fasttrack-save-draft",
				expected_digest: input.actionDigests.saveDraft,
				inputs: {},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "fasttrack-verify-saved-draft",
				expected_digest: input.actionDigests.verifySavedDraft,
				inputs: {
					week_start: "{{timesheet_run.envelope.period_start}}",
					week_end: "{{timesheet_run.envelope.period_end}}",
					rows: "{{timesheet_run.payload.rows}}",
					expected_total_hours:
						"{{timesheet_run.envelope.expected_aggregate.value}}",
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
