import type { BrowserUseRunbookValueSchema } from "./browser-use-runbook-model";
import { valueMatchesSchema } from "./browser-use-runbook-model";

/** The only automated mutation mode admitted for a real timesheet run. */
export const BROWSER_USE_TIMESHEET_MUTATION_MODE = "prepare-draft" as const;

/** The final payroll action reserved for the human in the bound Warm Chrome target. */
export const BROWSER_USE_TIMESHEET_FINAL_ACTION = "human-submit" as const;

/** Shared aggregate units retain each portal's payroll meaning. */
export type BrowserUseTimesheetAggregateUnit = "hours" | "units";

/**
 * Portal-independent human intent carried by every timesheet run.
 *
 * The run engine derives `normalized_input_digest` from the complete
 * `timesheet_run` value and stores it in the immutable execution binding.
 * Callers never supply a second, potentially divergent digest.
 */
export type BrowserUseTimesheetRunEnvelope = {
	target_account: string;
	period_start: string;
	period_end: string;
	selected_work_dates: readonly string[];
	expected_aggregate: {
		unit: BrowserUseTimesheetAggregateUnit;
		value: number;
	};
	mutation_mode: typeof BROWSER_USE_TIMESHEET_MUTATION_MODE;
	final_action: typeof BROWSER_USE_TIMESHEET_FINAL_ACTION;
};

/** One FastTrack break interval associated with an explicit work-date row. */
export type BrowserUseFasttrackBreak = {
	start_time: string;
	end_time: string;
};

/** One FastTrack portal row; clock intervals remain portal-owned semantics. */
export type BrowserUseFasttrackTimesheetRow = {
	date: string;
	day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
	start_time: string;
	end_time: string;
	attendance_type: "Standard" | "Public Holiday Worked";
	breaks?: readonly BrowserUseFasttrackBreak[];
};

/** FastTrack-only payload kept separate from the shared run envelope. */
export type BrowserUseFasttrackTimesheetPayload = {
	portal: "fasttrack";
	rows: readonly BrowserUseFasttrackTimesheetRow[];
};

/** One Oncore entry; units/rate/client state remain Oncore-owned semantics. */
export type BrowserUseOncoreTimesheetEntry = {
	item_key: string;
	date: string;
	units: number;
	rate_value: string;
	client_state: string;
};

/** Oncore-only payload kept separate from the shared run envelope. */
export type BrowserUseOncoreTimesheetPayload = {
	portal: "oncore";
	timesheet_id: string;
	empty_grid_policy: "require-empty";
	item_keys: readonly string[];
	entries: readonly BrowserUseOncoreTimesheetEntry[];
	expected_row_count: number;
};

/** Shared envelope paired with one portal-owned payload. */
export type BrowserUseTimesheetRunInput<Payload> = {
	envelope: BrowserUseTimesheetRunEnvelope;
	payload: Payload;
};

/** Complete FastTrack timesheet input contract. */
export type BrowserUseFasttrackTimesheetRunInput =
	BrowserUseTimesheetRunInput<BrowserUseFasttrackTimesheetPayload>;

/** Complete Oncore timesheet input contract. */
export type BrowserUseOncoreTimesheetRunInput =
	BrowserUseTimesheetRunInput<BrowserUseOncoreTimesheetPayload>;

/** One safe, user-correctable timesheet input issue. */
export type BrowserUseTimesheetRunIssue = {
	path: string;
	message: string;
};

const TIME_PATTERN = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$";
const DAY_VALUES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const ATTENDANCE_VALUES = ["Standard", "Public Holiday Worked"] as const;

function envelopeSchema(
	unit: BrowserUseTimesheetAggregateUnit,
	maximum: number,
): BrowserUseRunbookValueSchema {
	return {
		kind: "object",
		fields: {
			target_account: {
				required: true,
				schema: { kind: "string", min_length: 1, max_length: 256 },
			},
			period_start: { required: true, schema: { kind: "date" } },
			period_end: { required: true, schema: { kind: "date" } },
			selected_work_dates: {
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 31,
					items: { kind: "date" },
				},
			},
			expected_aggregate: {
				required: true,
				schema: {
					kind: "object",
					fields: {
						unit: {
							required: true,
							schema: { kind: "enum", values: [unit] },
						},
						value: {
							required: true,
							schema: { kind: "number", minimum: 0, maximum },
						},
					},
				},
			},
			mutation_mode: {
				required: true,
				schema: {
					kind: "enum",
					values: [BROWSER_USE_TIMESHEET_MUTATION_MODE],
				},
			},
			final_action: {
				required: true,
				schema: {
					kind: "enum",
					values: [BROWSER_USE_TIMESHEET_FINAL_ACTION],
				},
			},
		},
	};
}

const BREAK_SCHEMA = {
	kind: "object",
	fields: {
		start_time: {
			required: true,
			schema: { kind: "string", pattern: TIME_PATTERN },
		},
		end_time: {
			required: true,
			schema: { kind: "string", pattern: TIME_PATTERN },
		},
	},
} as const satisfies BrowserUseRunbookValueSchema;

/** Runtime schema for the shared envelope plus FastTrack-owned payload. */
export const BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA = {
	kind: "object",
	fields: {
		envelope: {
			required: true,
			schema: envelopeSchema("hours", 168),
		},
		payload: {
			required: true,
			schema: {
				kind: "object",
				fields: {
					portal: {
						required: true,
						schema: { kind: "enum", values: ["fasttrack"] },
					},
					rows: {
						required: true,
						schema: {
							kind: "array",
							min_items: 1,
							max_items: 7,
							items: {
								kind: "object",
								fields: {
									date: { required: true, schema: { kind: "date" } },
									day: {
										required: true,
										schema: { kind: "enum", values: DAY_VALUES },
									},
									start_time: {
										required: true,
										schema: { kind: "string", pattern: TIME_PATTERN },
									},
									end_time: {
										required: true,
										schema: { kind: "string", pattern: TIME_PATTERN },
									},
									attendance_type: {
										required: true,
										schema: {
											kind: "enum",
											values: ATTENDANCE_VALUES,
										},
									},
									breaks: {
										required: false,
										schema: {
											kind: "array",
											max_items: 4,
											items: BREAK_SCHEMA,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	},
} as const satisfies BrowserUseRunbookValueSchema;

/** Runtime schema for the shared envelope plus Oncore-owned payload. */
export const BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA = {
	kind: "object",
	fields: {
		envelope: {
			required: true,
			schema: envelopeSchema("units", 744),
		},
		payload: {
			required: true,
			schema: {
				kind: "object",
				fields: {
					portal: {
						required: true,
						schema: { kind: "enum", values: ["oncore"] },
					},
					timesheet_id: {
						required: true,
						schema: {
							kind: "string",
							min_length: 1,
							max_length: 128,
							pattern: "^[A-Za-z0-9._:-]+$",
						},
					},
					empty_grid_policy: {
						required: true,
						schema: { kind: "enum", values: ["require-empty"] },
					},
					item_keys: {
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
					entries: {
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
										schema: {
											kind: "string",
											min_length: 1,
											max_length: 128,
										},
									},
									date: { required: true, schema: { kind: "date" } },
									units: {
										required: true,
										schema: {
											kind: "number",
											minimum: 0,
											maximum: 24,
										},
									},
									rate_value: {
										required: true,
										schema: {
											kind: "string",
											min_length: 1,
											max_length: 256,
										},
									},
									client_state: {
										required: true,
										schema: {
											kind: "string",
											min_length: 1,
											max_length: 8_192,
										},
									},
								},
							},
						},
					},
					expected_row_count: {
						required: true,
						schema: {
							kind: "number",
							integer: true,
							minimum: 1,
							maximum: 31,
						},
					},
				},
			},
		},
	},
} as const satisfies BrowserUseRunbookValueSchema;

function issue(
	path: string,
	message: string,
): BrowserUseTimesheetRunIssue {
	return { path, message };
}

function commonEnvelopeIssues(
	envelope: BrowserUseTimesheetRunEnvelope,
): BrowserUseTimesheetRunIssue[] {
	const issues: BrowserUseTimesheetRunIssue[] = [];
	if (envelope.period_start > envelope.period_end) {
		issues.push(
			issue("envelope.period_end", "period end precedes period start."),
		);
	}
	const dates = envelope.selected_work_dates;
	if (new Set(dates).size !== dates.length) {
		issues.push(
			issue(
				"envelope.selected_work_dates",
				"selected work dates must be unique.",
			),
		);
	}
	for (const date of dates) {
		if (date < envelope.period_start || date > envelope.period_end) {
			issues.push(
				issue(
					"envelope.selected_work_dates",
					"every selected work date must fall inside the target period.",
				),
			);
			break;
		}
	}
	return issues;
}

function sameOrderedValues(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function minutes(value: string): number {
	const [hour = "0", minute = "0"] = value.split(":");
	return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
}

function expectedDay(date: string): BrowserUseFasttrackTimesheetRow["day"] {
	const values: readonly BrowserUseFasttrackTimesheetRow["day"][] = [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat",
	];
	return values[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "Sun";
}

/**
 * Validate FastTrack shape and its clock/date semantics before browser mutation.
 *
 * Breaks are checked for containment and overlap but do not reduce FastTrack's
 * displayed attendance total.
 *
 * @param value - Human-authored timesheet run input
 * @returns Safe field-level issues; empty means the input is mutation-ready
 */
export function validateFasttrackTimesheetRunInput(
	value: unknown,
): BrowserUseTimesheetRunIssue[] {
	if (!valueMatchesSchema(value, BROWSER_USE_FASTTRACK_TIMESHEET_RUN_SCHEMA)) {
		return [issue("timesheet_run", "input does not match the FastTrack contract.")];
	}
	const input = value as BrowserUseFasttrackTimesheetRunInput;
	const issues = commonEnvelopeIssues(input.envelope);
	const rowDates = input.payload.rows.map((row) => row.date);
	if (!sameOrderedValues(rowDates, input.envelope.selected_work_dates)) {
		issues.push(
			issue(
				"payload.rows",
				"row dates must exactly match selected work dates in order.",
			),
		);
	}
	let totalMinutes = 0;
	for (const [index, row] of input.payload.rows.entries()) {
		const start = minutes(row.start_time);
		const end = minutes(row.end_time);
		if (start >= end) {
			issues.push(
				issue(
					`payload.rows.${index}`,
					"start time must precede end time.",
				),
			);
		} else {
			totalMinutes += end - start;
		}
		if (row.day !== expectedDay(row.date)) {
			issues.push(
				issue(
					`payload.rows.${index}.day`,
					"day label does not match the row date.",
				),
			);
		}
		const breaks = [...(row.breaks ?? [])].sort(
			(left, right) => minutes(left.start_time) - minutes(right.start_time),
		);
		for (const [breakIndex, current] of breaks.entries()) {
			const breakStart = minutes(current.start_time);
			const breakEnd = minutes(current.end_time);
			if (breakStart >= breakEnd || breakStart < start || breakEnd > end) {
				issues.push(
					issue(
						`payload.rows.${index}.breaks.${breakIndex}`,
						"break must be a positive interval inside the work interval.",
					),
				);
			}
			const prior = breaks[breakIndex - 1];
			if (
				prior !== undefined &&
				minutes(prior.end_time) > breakStart
			) {
				issues.push(
					issue(
						`payload.rows.${index}.breaks.${breakIndex}`,
						"break intervals must not overlap.",
					),
				);
			}
		}
	}
	if (
		Math.abs(
			input.envelope.expected_aggregate.value - totalMinutes / 60,
		) > 1e-9
	) {
		issues.push(
			issue(
				"envelope.expected_aggregate.value",
				"expected hours must equal the FastTrack work intervals.",
			),
		);
	}
	return issues;
}

/**
 * Validate Oncore shape and its unit/rate/client-state semantics before mutation.
 *
 * @param value - Human-authored timesheet run input
 * @returns Safe field-level issues; empty means the input is mutation-ready
 */
export function validateOncoreTimesheetRunInput(
	value: unknown,
): BrowserUseTimesheetRunIssue[] {
	if (!valueMatchesSchema(value, BROWSER_USE_ONCORE_TIMESHEET_RUN_SCHEMA)) {
		return [issue("timesheet_run", "input does not match the Oncore contract.")];
	}
	const input = value as BrowserUseOncoreTimesheetRunInput;
	const issues = commonEnvelopeIssues(input.envelope);
	const keys = input.payload.item_keys;
	const entries = input.payload.entries;
	if (new Set(keys).size !== keys.length) {
		issues.push(
			issue("payload.item_keys", "Oncore item keys must be unique."),
		);
	}
	if (
		!sameOrderedValues(
			entries.map((entry) => entry.item_key),
			keys,
		)
	) {
		issues.push(
			issue(
				"payload.entries",
				"entry keys must exactly match the checkpoint keys in order.",
			),
		);
	}
	if (
		!sameOrderedValues(
			entries.map((entry) => entry.date),
			input.envelope.selected_work_dates,
		)
	) {
		issues.push(
			issue(
				"payload.entries",
				"entry dates must exactly match selected work dates in order.",
			),
		);
	}
	if (input.payload.expected_row_count !== entries.length) {
		issues.push(
			issue(
				"payload.expected_row_count",
				"expected row count must equal the entry count.",
			),
		);
	}
	for (const [index, entry] of entries.entries()) {
		if (entry.client_state !== `${entry.date}-00-00-00`) {
			issues.push(
				issue(
					`payload.entries.${index}.client_state`,
					"client state must encode the exact entry date.",
				),
			);
		}
	}
	const totalUnits = entries.reduce((total, entry) => total + entry.units, 0);
	if (
		Math.abs(input.envelope.expected_aggregate.value - totalUnits) >
		1e-9
	) {
		issues.push(
			issue(
				"envelope.expected_aggregate.value",
				"expected units must equal the Oncore entry total.",
			),
		);
	}
	return issues;
}

/**
 * Route a canonical runbook to its portal-owned timesheet validator.
 *
 * Non-timesheet flows are outside this contract and return no issues.
 *
 * @param serviceId - Canonical runbook service id
 * @param flowId - Canonical runbook flow id
 * @param inputs - Materialized runbook inputs
 * @returns Portal validation issues; empty for valid or unrelated flows
 */
export function validateTimesheetRunbookInputs(
	serviceId: string,
	flowId: string,
	inputs: Readonly<Record<string, unknown>>,
): BrowserUseTimesheetRunIssue[] {
	if (serviceId === "fasttrack" && flowId === "fill-week") {
		return validateFasttrackTimesheetRunInput(inputs.timesheet_run);
	}
	if (serviceId === "oncore" && flowId === "fill-timesheet") {
		return validateOncoreTimesheetRunInput(inputs.timesheet_run);
	}
	return [];
}
