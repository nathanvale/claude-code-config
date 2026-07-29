import { describe, expect, test } from "bun:test";
import {
	buildOncoreSaveDraftMigration,
	type BrowserUseOncoreSaveDraftMigrationInput,
} from "./browser-use-oncore-migration";
import { validateRunbook } from "./browser-use-runbook-model";

const DIGESTS = {
	reconcileRows: "1".repeat(64),
	fillEntry: "2".repeat(64),
	saveDraft: "3".repeat(64),
	verifyDraft: "4".repeat(64),
};

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
	test("builds one valid canonical flow from the split-entry winner", () => {
		const migrated = buildOncoreSaveDraftMigration(migrationInput());

		expect(validateRunbook(migrated.runbook)).toEqual([]);
		expect(migrated.runbook).toMatchObject({
			service_id: "oncore",
			flow_id: "fill-timesheet",
			auth_context_ref: "oncore-session",
			allowed_origins: ["https://portal.example.com"],
		});
		expect(migrated.runbook.steps).toEqual([
			{ kind: "snapshot", interactive: false },
			expect.objectContaining({
				kind: "action",
				action_id: "oncore-reconcile-rows",
				expected_digest: DIGESTS.reconcileRows,
			}),
			expect.objectContaining({
				kind: "iterate",
				over_input: "item_keys",
				step: expect.objectContaining({
					action_id: "oncore-fill-entry",
					expected_digest: DIGESTS.fillEntry,
				}),
			}),
			{ kind: "snapshot", interactive: false },
			expect.objectContaining({
				kind: "action",
				action_id: "oncore-save-draft",
				expected_digest: DIGESTS.saveDraft,
			}),
			{
				kind: "open",
				url: "https://portal.example.com/timesheets/current",
				postcondition: {
					kind: "url-equals",
					url: "https://portal.example.com/timesheets/current",
				},
			},
			{ kind: "snapshot", interactive: false },
			expect.objectContaining({
				kind: "action",
				action_id: "oncore-verify-draft",
				expected_digest: DIGESTS.verifyDraft,
				inputs: {
					item_keys: "{{item_keys}}",
					entries: "{{entries}}",
				},
			}),
		]);
		expect(JSON.stringify(migrated.runbook)).not.toMatch(/\bsubmit\b/i);
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
