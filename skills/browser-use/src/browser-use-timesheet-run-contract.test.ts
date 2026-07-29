import { describe, expect, test } from "bun:test";
import { valueMatchesSchema } from "./browser-use-runbook-model";
import {
	BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA,
	BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA,
	BROWSER_USE_TIMESHEET_FINAL_ACTION,
	BROWSER_USE_TIMESHEET_MUTATION_MODE,
	type BrowserUseFasttrackTimesheetRunInput,
	type BrowserUseOncoreTimesheetRunInput,
	validateFasttrackTimesheetRunInput,
	validateOncoreTimesheetRunInput,
} from "./browser-use-timesheet-run-contract";

const FASTTRACK_INPUT: BrowserUseFasttrackTimesheetRunInput = {
	envelope: {
		target_account: "worker@example.com",
		period_start: "2026-07-27",
		period_end: "2026-08-02",
		selected_work_dates: ["2026-07-27", "2026-07-28"],
		expected_aggregate: { unit: "hours", value: 16 },
		mutation_mode: BROWSER_USE_TIMESHEET_MUTATION_MODE,
		final_action: BROWSER_USE_TIMESHEET_FINAL_ACTION,
	},
	payload: {
		portal: "fasttrack",
		rows: [
			{
				date: "2026-07-27",
				day: "Mon",
				start_time: "08:30",
				end_time: "16:30",
				attendance_type: "Standard",
				breaks: [{ start_time: "12:00", end_time: "13:00" }],
			},
			{
				date: "2026-07-28",
				day: "Tue",
				start_time: "08:30",
				end_time: "16:30",
				attendance_type: "Standard",
			},
		],
	},
};

const ONCORE_INPUT: BrowserUseOncoreTimesheetRunInput = {
	envelope: {
		target_account: "worker@example.com",
		period_start: "2026-07-27",
		period_end: "2026-08-02",
		selected_work_dates: ["2026-07-27", "2026-07-28"],
		expected_aggregate: { unit: "units", value: 2 },
		mutation_mode: BROWSER_USE_TIMESHEET_MUTATION_MODE,
		final_action: BROWSER_USE_TIMESHEET_FINAL_ACTION,
	},
	payload: {
		portal: "oncore",
		timesheet_id: "TS-123",
		empty_grid_policy: "require-empty",
		item_keys: ["mon", "tue"],
		entries: [
			{
				item_key: "mon",
				date: "2026-07-27",
				units: 1,
				rate_value: "STANDARD",
				client_state: "2026-07-27-00-00-00",
			},
			{
				item_key: "tue",
				date: "2026-07-28",
				units: 1,
				rate_value: "STANDARD",
				client_state: "2026-07-28-00-00-00",
			},
		],
		expected_row_count: 2,
	},
};

describe("shared timesheet run envelope", () => {
	test("admits portal-owned payloads without collapsing their semantics", () => {
		expect(
			valueMatchesSchema(
				FASTTRACK_INPUT,
				BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA,
			),
		).toBe(true);
		expect(
			valueMatchesSchema(
				ONCORE_INPUT,
				BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA,
			),
		).toBe(true);
		expect(
			valueMatchesSchema(
				FASTTRACK_INPUT,
				BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA,
			),
		).toBe(false);
		expect(
			valueMatchesSchema(
				ONCORE_INPUT,
				BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA,
			),
		).toBe(false);
	});

	test("admits only draft preparation with human final submission", () => {
		expect(BROWSER_USE_TIMESHEET_MUTATION_MODE).toBe("prepare-draft");
		expect(BROWSER_USE_TIMESHEET_FINAL_ACTION).toBe("human-submit");
		expect(
			valueMatchesSchema(
				{
					...FASTTRACK_INPUT,
					envelope: {
						...FASTTRACK_INPUT.envelope,
						final_action: "automated-submit",
					},
				},
				BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA,
			),
		).toBe(false);
	});
});

describe("FastTrack timesheet validation", () => {
	test("accepts matching dates, hours, attendance, and contained breaks", () => {
		expect(validateFasttrackTimesheetRunInput(FASTTRACK_INPUT)).toEqual([]);
	});

	test("rejects mismatched dates, clock totals, day labels, and breaks", () => {
		const invalid = structuredClone(FASTTRACK_INPUT);
		invalid.envelope.selected_work_dates = ["2026-07-28", "2026-07-27"];
		invalid.envelope.expected_aggregate.value = 15;
		const firstRow = invalid.payload.rows[0];
		expect(firstRow).toBeDefined();
		if (firstRow === undefined) return;
		firstRow.day = "Tue";
		firstRow.breaks = [
			{ start_time: "07:00", end_time: "09:00" },
		];

		expect(validateFasttrackTimesheetRunInput(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "payload.rows" }),
				expect.objectContaining({
					path: "envelope.expected_aggregate.value",
				}),
				expect.objectContaining({ path: "payload.rows.0.day" }),
				expect.objectContaining({ path: "payload.rows.0.breaks.0" }),
			]),
		);
	});
});

describe("Oncore timesheet validation", () => {
	test("accepts exact checkpoint, rate, client-state, row-count, and unit proof", () => {
		expect(validateOncoreTimesheetRunInput(ONCORE_INPUT)).toEqual([]);
	});

	test("rejects partial-grid and identity mismatches before mutation", () => {
		const invalid = structuredClone(ONCORE_INPUT);
		invalid.payload.item_keys = ["tue", "mon"];
		invalid.payload.expected_row_count = 1;
		const firstEntry = invalid.payload.entries[0];
		expect(firstEntry).toBeDefined();
		if (firstEntry === undefined) return;
		firstEntry.client_state = "2026-07-28-00-00-00";
		invalid.envelope.expected_aggregate.value = 3;

		expect(validateOncoreTimesheetRunInput(invalid)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "payload.entries" }),
				expect.objectContaining({ path: "payload.expected_row_count" }),
				expect.objectContaining({
					path: "payload.entries.0.client_state",
				}),
				expect.objectContaining({
					path: "envelope.expected_aggregate.value",
				}),
			]),
		);
	});
});
