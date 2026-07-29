import { describe, expect, test } from "bun:test";
import {
	buildOncoreSaveDraftMigration,
	buildOncoreTimesheetDiagnosisMigration,
	type BrowserUseOncoreSaveDraftMigrationInput,
	type BrowserUseOncoreTimesheetDiagnosisMigrationInput,
} from "./browser-use-oncore-migration";
import {
	actionAssetDigest,
	ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
} from "./browser-use-runbook-actions";
import { validateRunbook } from "./browser-use-runbook-model";

const DIGESTS = {
	reconcileRows: "1".repeat(64),
	fillEntry: "2".repeat(64),
	saveDraft: "3".repeat(64),
	verifyDraft: "4".repeat(64),
};

const DIAGNOSIS_DIGEST = actionAssetDigest(
	ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
);

function diagnosisInput(
	overrides: Partial<BrowserUseOncoreTimesheetDiagnosisMigrationInput> = {},
): BrowserUseOncoreTimesheetDiagnosisMigrationInput {
	return {
		allowedOrigin: "https://portal.example.com",
		sourceRelativePath: "oncore/domain-script-actions/diagnose-grid-state.js",
		actionDigest: DIAGNOSIS_DIGEST,
		...overrides,
	};
}

function migrationInput(
	overrides: Partial<BrowserUseOncoreSaveDraftMigrationInput> = {},
): BrowserUseOncoreSaveDraftMigrationInput {
	return {
		allowedOrigin: "https://portal.example.com",
		timesheetUrl: "https://portal.example.com/timesheets/current",
		activeSourceRelativePath:
			"oncore/playbooks/fill-timesheet-split-dsa-2026-05-25.json",
		supersededSourceRelativePaths: [
			"oncore/playbooks/fill-timesheet-dsa-candidate-2026-05-18.json",
		],
		actionDigests: DIGESTS,
		...overrides,
	};
}

describe("Oncore save-draft staged migration (U4, R25/AE7)", () => {
	test("stages the split-entry winner with a mechanical unsupported-cadence blocker", () => {
		const migrated = buildOncoreSaveDraftMigration(migrationInput());

		expect(validateRunbook(migrated.runbook)).toEqual([]);
		expect(migrated.runbook).toMatchObject({
			service_id: "oncore",
			flow_id: "fill-timesheet",
			auth_context_ref: "oncore-session",
			allowed_origins: ["https://portal.example.com"],
		});
		expect(migrated.runbook.steps).toHaveLength(8);
		expect(migrated.runbook.steps[0]).toEqual({
			kind: "snapshot",
			interactive: false,
		});
		expect(migrated.activation_blocker).toContain(
			"open-entry, wait, fill-entry, wait",
		);
		expect(migrated.legacy_action_digests).toEqual(DIGESTS);
		expect(JSON.stringify(migrated.runbook.steps)).not.toMatch(/\bsubmit\b/i);
		expect(migrated.runbook.inputs.map((input) => input.id)).toEqual([
			"timesheet_run",
		]);
		expect(
			migrated.runbook.steps.find((step) => step.kind === "iterate"),
		).toMatchObject({
			over_input: "timesheet_run.payload.item_keys",
		});
		expect(JSON.stringify(migrated.runbook.inputs)).toContain("human-submit");
	});

	test("keeps both candidates inspectable while only one is active", () => {
		const migrated = buildOncoreSaveDraftMigration(migrationInput());

		expect(migrated.provenance).toEqual([
			{
				source_relative_path:
					"oncore/playbooks/fill-timesheet-split-dsa-2026-05-25.json",
				disposition: "migrated",
			},
			{
				source_relative_path:
					"oncore/playbooks/fill-timesheet-dsa-candidate-2026-05-18.json",
				disposition: "superseded-by",
				superseded_by:
					"oncore/playbooks/fill-timesheet-split-dsa-2026-05-25.json",
			},
		]);
		expect(
			migrated.provenance.filter((source) => source.disposition === "migrated"),
		).toHaveLength(1);
	});

	test("rejects duplicate or self-superseding source lineage", () => {
		expect(() =>
			buildOncoreSaveDraftMigration(
				migrationInput({
					supersededSourceRelativePaths: [
						"oncore/playbooks/fill-timesheet-split-dsa-2026-05-25.json",
					],
				}),
			),
		).toThrow("distinct");
	});

	test.each([
		[
			"non-exact origin",
			{ allowedOrigin: "https://portal.example.com/path" },
			"exact allowed origin",
		],
		[
			"cross-origin URL",
			{ timesheetUrl: "https://other.example.com/timesheets/current" },
			"exact allowed origin",
		],
		[
			"malformed URL",
			{ timesheetUrl: "not-a-url" },
			"exact HTTP(S) timesheet URL",
		],
		[
			"file URL",
			{ timesheetUrl: "file:///tmp/timesheet.html" },
			"exact HTTP(S) timesheet URL",
		],
		[
			"FTP URL",
			{ timesheetUrl: "ftp://portal.example.com/timesheets/current" },
			"exact HTTP(S) timesheet URL",
		],
		[
			"unsafe source path",
			{ activeSourceRelativePath: "../fill.json" },
			"safe relative source",
		],
		[
			"backslash source path (POSIX traversal bypass)",
			{ activeSourceRelativePath: "..\\fill.json" },
			"safe relative source",
		],
		[
			"invalid action digest",
			{ actionDigests: { ...DIGESTS, saveDraft: "not-a-digest" } },
			"exact content digest",
		],
	] as const)("rejects %s", (_label, overrides, message) => {
		expect(() =>
			buildOncoreSaveDraftMigration(migrationInput(overrides)),
		).toThrow(message);
	});
});

describe("Oncore read-only timesheet diagnosis migration", () => {
	test("builds one valid bounded structural diagnosis flow", () => {
		const migrated = buildOncoreTimesheetDiagnosisMigration(diagnosisInput());

		expect(validateRunbook(migrated.runbook)).toEqual([]);
		expect(migrated.runbook).toEqual({
			contract: "browser-use.runbook",
			schema_version: "2",
			service_id: "oncore",
			flow_id: "timesheet-diagnose",
			flow_name: "timesheet-diagnose",
			version: "2",
			summary:
				"Diagnose bounded structural state for the open Oncore timesheet.",
			allowed_origins: ["https://portal.example.com"],
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
					expected_digest: DIAGNOSIS_DIGEST,
					inputs: { timesheet_id: "{{timesheet_id}}" },
				},
			],
		});
		expect(JSON.stringify(migrated.runbook)).not.toMatch(
			/(?:innerHTML|textContent|row_values|timesheet_id.*result)/i,
		);
	});

	test("retains the exact source as migrated provenance", () => {
		const migrated = buildOncoreTimesheetDiagnosisMigration(diagnosisInput());

		expect(migrated.provenance).toEqual([
			{
				source_relative_path:
					"oncore/domain-script-actions/diagnose-grid-state.js",
				disposition: "migrated",
			},
		]);
	});

	test.each([
		[
			"non-exact origin",
			{ allowedOrigin: "https://portal.example.com/path" },
			"exact allowed origin",
		],
		[
			"unsafe source path",
			{ sourceRelativePath: "../diagnose.js" },
			"safe relative source",
		],
		[
			"backslash source path",
			{ sourceRelativePath: "..\\diagnose.js" },
			"safe relative source",
		],
		[
			"invalid action digest",
			{ actionDigest: "not-a-digest" },
			"exact content digest",
		],
	] as const)("rejects %s", (_label, overrides, message) => {
		expect(() =>
			buildOncoreTimesheetDiagnosisMigration(diagnosisInput(overrides)),
		).toThrow(message);
	});
});
