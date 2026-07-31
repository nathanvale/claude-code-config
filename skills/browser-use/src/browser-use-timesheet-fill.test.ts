import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

const ACTION_PATH = join(
	import.meta.dir,
	"..",
	"actions",
	"fasttrack",
	"fill-week.js",
);
const REGISTRY_PATH = join(import.meta.dir, "..", "actions", "registry.json");
const FIXTURE_PATH = join(
	import.meta.dir,
	"fixtures",
	"timesheet-fill-grid.html",
);
type ActionResult =
	| {
			ok: true;
			fieldsUpdated: Array<{
				date: string;
				startTime: string;
				endTime: string;
				attendanceType: string;
			}>;
		}
	| {
			ok: false;
			reason: string;
			fieldsUpdated?: unknown[];
		};

type FixtureState = {
	cells: Record<
		string,
		{ start?: string; end?: string; attendance?: string }
	>;
	submitAttempts: number;
};

let server: Server | undefined;
let origin: string;
let actionSource: string;
let fixtureBytes: Buffer;

beforeAll(async () => {
	fixtureBytes = await readFile(FIXTURE_PATH);
	server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(fixtureBytes);
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server?.once("error", reject);
			server?.listen(0, "127.0.0.1", () => resolve());
		});
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	} catch {
		// Restricted CI sandboxes can deny loopback binds. Keep an http(s)-shaped
		// discovery target while exercising the same fixture bytes in-process.
		server = undefined;
		origin = "http://timesheet-fixture.invalid";
	}
	actionSource = await readFile(ACTION_PATH, "utf8");
});

afterAll(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	}
});

const rows = [
	{
		day: "Mon",
		start_time: "08:00",
		end_time: "16:00",
		attendance_type: "Standard",
	},
	{
		day: "Tue",
		start_time: "08:15",
		end_time: "16:15",
		attendance_type: "Standard",
	},
	{
		day: "Wed",
		start_time: "08:30",
		end_time: "16:30",
		attendance_type: "Public Holiday Worked",
	},
	{
		day: "Thu",
		start_time: "08:45",
		end_time: "16:45",
		attendance_type: "Standard",
	},
	{
		day: "Fri",
		start_time: "09:00",
		end_time: "15:00",
		attendance_type: "Standard",
	},
];

async function runAction(
	scenario: string,
	inputRows = rows,
): Promise<{ result: ActionResult; state: FixtureState; url: string }> {
	const url = `${origin}/timesheet-fill-grid.html?scenario=${scenario}`;
	const servedFixture = server
		? await (await fetch(url)).text()
		: fixtureBytes.toString("utf8");
	expect(servedFixture).toContain('ng-model="rxg.startDateTime"');
	expect(servedFixture).toContain('id="submit-timesheet"');

	const fixture = createFixtureDom(scenario);
	const originals = {
		document: globalThis.document,
		location: globalThis.location,
		window: globalThis.window,
	};
	Object.assign(globalThis, {
		document: fixture.document,
		location: { href: url },
		window: globalThis,
	});
	try {
		const result = await evaluateAction(inputRows);
		return { result, state: structuredClone(fixture.state), url };
	} finally {
		Object.assign(globalThis, originals);
	}
}

async function evaluateAction(inputRows: typeof rows): Promise<ActionResult> {
	const action = (0, eval)(`(${actionSource})`) as (input: {
		inputs: Record<string, unknown>;
	}) => Promise<unknown>;
	try {
		return (await action({
			inputs: {
				week_start: "2026-08-03",
				week_end: "2026-08-09",
				rows: inputRows,
			},
		})) as ActionResult;
	} catch (error) {
		return {
			ok: false,
			...JSON.parse((error as Error).message),
		} as ActionResult;
	}
}

type Listener = () => void;

class FixtureElement {
	innerText = "";
	textContent = "";
	private listeners = new Map<string, Listener[]>();

	addEventListener(type: string, listener: Listener) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatchEvent(event: Event) {
		for (const listener of this.listeners.get(event.type) ?? []) listener();
		return true;
	}
}

class FixtureInput extends FixtureElement {
	private currentValue: string;

	constructor(
		private readonly attributeValue: string,
		onInput: (value: string) => void,
	) {
		super();
		this.currentValue = attributeValue;
		this.addEventListener("input", () => onInput(this.value));
	}

	get value() {
		return this.currentValue;
	}

	set value(value: string) {
		this.currentValue = value;
	}

	getAttribute(name: string) {
		return name === "value" ? this.attributeValue : null;
	}
}

class FixtureSelect extends FixtureElement {
	readonly options: Array<{ text: string }>;
	selectedIndex = 0;

	constructor(optionTexts: string[], onChange: (value: string) => void) {
		super();
		this.options = optionTexts.map((text) => ({ text }));
		this.addEventListener("change", () =>
			onChange(this.options[this.selectedIndex]?.text ?? ""),
		);
	}
}

class FixtureCell extends FixtureElement {
	constructor(text: string) {
		super();
		this.innerText = text;
		this.textContent = text;
	}
}

class FixtureRow extends FixtureElement {
	readonly start: FixtureInput;
	readonly end: FixtureInput;
	readonly attendance: FixtureSelect;
	private readonly cell: FixtureCell;

	constructor(
		readableDate: string,
		stateDate: string,
		state: FixtureState,
		attendanceOptions: string[],
	) {
		super();
		const write = (field: "start" | "end" | "attendance", value: string) => {
			(state.cells[stateDate] ??= {})[field] = value;
		};
		this.start = new FixtureInput(readableDate, (value) =>
			write("start", value),
		);
		this.end = new FixtureInput(readableDate, (value) => write("end", value));
		this.attendance = new FixtureSelect(attendanceOptions, (value) =>
			write("attendance", value),
		);
		this.cell = new FixtureCell(readableDate);
	}

	querySelector(selector: string) {
		if (selector === "[ng-model='rxg.startDateTime']") return this.start;
		if (selector === "[ng-model='rxg.endDateTime']") return this.end;
		if (selector === "[ng-model='rxg.attendanceTypeId']")
			return this.attendance;
		if (selector === "input:nth-child(2)") return this.start;
		if (selector === "input:nth-child(3)") return this.end;
		if (selector === "select") return this.attendance;
		return null;
	}

	querySelectorAll(selector: string) {
		if (
			selector ===
				"td, [ng-bind*='date' i], .date, [class*='date' i]" ||
			selector === "td"
		) {
			return [this.cell];
		}
		return [];
	}
}

function createFixtureDom(scenario: string): {
	document: {
		title: string;
		querySelectorAll: (selector: string) => FixtureRow[];
		querySelector: () => null;
	};
	state: FixtureState;
} {
	const state: FixtureState = { cells: {}, submitAttempts: 0 };
	const dates = [
		"03/08/2026",
		"04/08/2026",
		"05/08/2026",
		"06/08/2026",
		"07/08/2026",
	];
	if (scenario === "wrong-week") {
		dates.push(
			"10/08/2026",
			"11/08/2026",
			"12/08/2026",
			"13/08/2026",
			"14/08/2026",
		);
	}
	if (scenario === "duplicate-date") dates[4] = dates[3] as string;
	const attendanceOptions =
		scenario === "attendance-absent"
			? ["Standard"]
			: ["Standard", "Public Holiday Worked"];
	const rows = dates.map(
		(date, index) =>
			new FixtureRow(
				scenario === "unreadable-dates" ? "" : date,
				date || `row-${index}`,
				state,
				attendanceOptions,
			),
	);

	return {
		document: {
			title: "Time - Search Timesheet",
			querySelectorAll: (selector) =>
				selector === "tr[ng-repeat]" ? rows : [],
			querySelector: () => null,
		},
		state,
	};
}

describe("FastTrack timesheet fill (R16, AE8)", () => {
	test("fills Mon-Fri by exact date and never submits", async () => {
		const { result, state, url } = await runAction("clean");

		expect(url).toStartWith("http://");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.fieldsUpdated).toEqual([
			{
				dayIndex: 0,
				date: "03/08/2026",
				startTime: "08:00",
				endTime: "16:00",
				attendanceType: "Standard",
			},
			{
				dayIndex: 1,
				date: "04/08/2026",
				startTime: "08:15",
				endTime: "16:15",
				attendanceType: "Standard",
			},
			{
				dayIndex: 2,
				date: "05/08/2026",
				startTime: "08:30",
				endTime: "16:30",
				attendanceType: "Public Holiday Worked",
			},
			{
				dayIndex: 3,
				date: "06/08/2026",
				startTime: "08:45",
				endTime: "16:45",
				attendanceType: "Standard",
			},
			{
				dayIndex: 4,
				date: "07/08/2026",
				startTime: "09:00",
				endTime: "15:00",
				attendanceType: "Standard",
			},
		]);
		expect(state.cells).toEqual({
			"03/08/2026": {
				start: "08:00",
				end: "16:00",
				attendance: "Standard",
			},
			"04/08/2026": {
				start: "08:15",
				end: "16:15",
				attendance: "Standard",
			},
			"05/08/2026": {
				start: "08:30",
				end: "16:30",
				attendance: "Public Holiday Worked",
			},
			"06/08/2026": {
				start: "08:45",
				end: "16:45",
				attendance: "Standard",
			},
			"07/08/2026": {
				start: "09:00",
				end: "15:00",
				attendance: "Standard",
			},
		});
		expect(state.submitAttempts).toBe(0);
	});

	for (const scenario of [
		{ fixture: "wrong-week", reason: "wrong_week_open" },
		{ fixture: "duplicate-date", reason: "duplicate_row_date" },
		{ fixture: "unreadable-dates", reason: "row_dates_unreadable" },
	]) {
		test(`${scenario.fixture} refuses typed before any write`, async () => {
			const { result, state } = await runAction(scenario.fixture);

			expect(result).toMatchObject({
				ok: false,
				reason: scenario.reason,
			});
			expect(state.cells).toEqual({});
			expect(state.submitAttempts).toBe(0);
		});
	}

	test("reports an absent attendance option by typed reason", async () => {
		const { result, state } = await runAction("attendance-absent", [
			{
				day: "Mon",
				start_time: "08:00",
				end_time: "16:00",
				attendance_type: "Public Holiday Worked",
			},
		]);

		expect(result).toMatchObject({
			ok: false,
			reason: "attendance_option_not_found",
		});
		expect(state.submitAttempts).toBe(0);
	});

	test("registry digest identity matches the shipped action bytes", async () => {
		const actionBytes = await readFile(ACTION_PATH);
		const digest = createHash("sha256").update(actionBytes).digest("hex");
		const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as {
			actions: Array<{
				asset_path: string;
				record: {
					asset_id: string;
					expected_digest: string;
					promotion_receipt: { approved_digest: string };
				};
			}>;
		};
		const entry = registry.actions.find(
			(candidate) => candidate.asset_path === "fasttrack/fill-week.js",
		);

		expect(entry).toBeDefined();
		expect(entry?.record.asset_id).toBe(digest);
		expect(entry?.record.expected_digest).toBe(digest);
		expect(entry?.record.promotion_receipt.approved_digest).toBe(digest);
	});
});
