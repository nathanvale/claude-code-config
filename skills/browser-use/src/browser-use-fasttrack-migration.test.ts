import { describe, expect, test } from "bun:test";
import {
	buildFasttrackSaveDraftMigration,
	type BrowserUseFasttrackSaveDraftMigrationInput,
} from "./browser-use-fasttrack-migration";
import { auditActionEffectClass } from "./browser-use-runbook-actions";
import { validateRunbook } from "./browser-use-runbook-model";

const DIGESTS = {
	diagnoseRoute: "1".repeat(64),
	fillDay: "2".repeat(64),
	addBreaks: "3".repeat(64),
	saveDraft: "4".repeat(64),
	verifySavedDraft: "5".repeat(64),
};

// Representative shape of the legacy `diagnose_route` / `verify_saved_draft`
// helpers: the manifest labels them `read-only`, but they navigate and mutate
// through the Angular scope. Bytes only — never copied into a runbook (AE6).
const LEGACY_READ_ONLY_LABELLED_NAVIGATING_BYTES =
	"async () => { rootScope.$apply(() => locationService.path('/timesheet')); tab.click(); return { ok: true }; }";

function migrationInput(
	overrides: Partial<BrowserUseFasttrackSaveDraftMigrationInput> = {},
): BrowserUseFasttrackSaveDraftMigrationInput {
	return {
		allowedOrigin: "https://portal.example.com",
		timesheetUrl: "https://portal.example.com/timesheets/current",
		activeSourceRelativePath:
			"fasttrack/playbooks/fill-week-per-day-2026-05-25.json",
		supersededSourceRelativePaths: [
			"fasttrack/playbooks/fill-week-broad-2026-05-18.json",
		],
		actionDigests: DIGESTS,
		...overrides,
	};
}

describe("FastTrack save-draft staged migration (U5, R19/R26/AE6/AE8)", () => {
	test("builds one valid canonical flow from the per-day winner", () => {
		const migrated = buildFasttrackSaveDraftMigration(migrationInput());

		expect(validateRunbook(migrated.runbook)).toEqual([]);
		expect(migrated.runbook).toMatchObject({
			service_id: "fasttrack",
			flow_id: "fill-week",
			auth_context_ref: "interactive-login",
			allowed_origins: ["https://portal.example.com"],
		});
		expect(migrated.runbook.steps).toEqual([
			{ kind: "snapshot", interactive: false },
			expect.objectContaining({
				kind: "action",
				action_id: "fasttrack-diagnose-route",
				expected_digest: DIGESTS.diagnoseRoute,
			}),
			expect.objectContaining({
				kind: "iterate",
				over_input: "day_keys",
				step: expect.objectContaining({
					action_id: "fasttrack-fill-day",
					expected_digest: DIGESTS.fillDay,
				}),
			}),
			expect.objectContaining({
				kind: "iterate",
				over_input: "day_keys",
				step: expect.objectContaining({
					action_id: "fasttrack-add-breaks",
					expected_digest: DIGESTS.addBreaks,
				}),
			}),
			{ kind: "snapshot", interactive: false },
			expect.objectContaining({
				kind: "action",
				action_id: "fasttrack-save-draft",
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
				action_id: "fasttrack-verify-saved-draft",
				expected_digest: DIGESTS.verifySavedDraft,
				inputs: {
					day_keys: "{{day_keys}}",
					days: "{{days}}",
				},
			}),
		]);
	});

	test("keeps both candidates inspectable while only one is active", () => {
		const migrated = buildFasttrackSaveDraftMigration(migrationInput());

		expect(migrated.provenance).toEqual([
			{
				source_relative_path:
					"fasttrack/playbooks/fill-week-per-day-2026-05-25.json",
				disposition: "migrated",
			},
			{
				source_relative_path:
					"fasttrack/playbooks/fill-week-broad-2026-05-18.json",
				disposition: "superseded-by",
				superseded_by: "fasttrack/playbooks/fill-week-per-day-2026-05-25.json",
			},
		]);
		expect(
			migrated.provenance.filter((source) => source.disposition === "migrated"),
		).toHaveLength(1);
	});

	test("splits fill and breaks by stable day key with per-item checkpoints", () => {
		const migrated = buildFasttrackSaveDraftMigration(migrationInput());

		const iterations = migrated.runbook.steps.filter(
			(step) => step.kind === "iterate",
		);
		expect(iterations).toHaveLength(2);
		for (const step of iterations) {
			expect(step).toMatchObject({ kind: "iterate", over_input: "day_keys" });
		}
	});

	test("rejects duplicate or self-superseding source lineage", () => {
		expect(() =>
			buildFasttrackSaveDraftMigration(
				migrationInput({
					supersededSourceRelativePaths: [
						"fasttrack/playbooks/fill-week-per-day-2026-05-25.json",
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
			buildFasttrackSaveDraftMigration(migrationInput(overrides)),
		).toThrow(message);
	});
});

describe("FastTrack effect-class audit — legacy read-only label is not authority (R19/AE6)", () => {
	test("a helper the manifest labels read-only but navigates/clicks/mutates is a mutation", () => {
		// The source label says read-only; the audited behavior says mutation.
		// The audit is the authority, so the false label never bypasses
		// write-ahead truth.
		expect(auditActionEffectClass(LEGACY_READ_ONLY_LABELLED_NAVIGATING_BYTES)).toBe(
			"mutation",
		);
	});

	test.each([
		["angular scope navigation", "rootScope.$apply(() => location.href = '/x')"],
		["tab click", "const tab = tabs[0]; tab.click();"],
		["location assign", "window.location.href = 'https://x/y'"],
	] as const)(
		"a navigating/clicking diagnostic cannot retain read effect: %s",
		(_label, bytes) => {
			expect(auditActionEffectClass(bytes)).toBe("mutation");
		},
	);
});

describe("FastTrack Submit exclusion (R26/AE8)", () => {
	test("no step targets a final submission boundary", () => {
		const migrated = buildFasttrackSaveDraftMigration(migrationInput());

		expect(JSON.stringify(migrated.runbook)).not.toMatch(/\bsubmit\b/i);
	});

	test("save-draft is present but no submit action id exists", () => {
		const migrated = buildFasttrackSaveDraftMigration(migrationInput());

		const actionIds = migrated.runbook.steps.flatMap((step) => {
			if (step.kind === "action") return [step.action_id];
			if (step.kind === "iterate") return [step.step.action_id];
			return [];
		});
		expect(actionIds).toContain("fasttrack-save-draft");
		expect(actionIds.some((id) => /submit/i.test(id))).toBe(false);
	});
});
