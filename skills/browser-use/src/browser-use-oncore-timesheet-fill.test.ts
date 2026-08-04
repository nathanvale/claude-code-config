import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateRunbook } from "./browser-use-runbook-model";

const ACTIONS_ROOT = join(import.meta.dir, "..", "actions", "oncore");
const OPEN_ACTION_PATH = join(ACTIONS_ROOT, "open-week.js");
const FILL_ACTION_PATH = join(ACTIONS_ROOT, "fill-week.js");
const VERIFY_ACTION_PATH = join(ACTIONS_ROOT, "verify-filled.js");
const RUNBOOK_PATH = join(
	import.meta.dir,
	"..",
	"runbooks",
	"oncore",
	"fill",
	"runbook.json",
);

const TIMESHEET_ID = "45705908115";
const PERIOD_START = "2026-07-27";
const PERIOD_END = "2026-08-02";
const RATE_VALUE = "45548822362";
const GRID_ID = "ctl00_MainContent_TimesheetWorkGrid_ctl00";
const ADD_ID =
	"ctl00_MainContent_TimesheetWorkGrid_ctl00_ctl02_ctl00_AddNewRecordButton";
const EDIT_PREFIX =
	"ctl00_MainContent_TimesheetWorkGrid_ctl00_ctl02_ctl02_EditFormControl_";

const EXPECTED_ROWS = [
	{ date: "2026-07-27", units: 1 },
	{ date: "2026-07-28", units: 1 },
	{ date: "2026-07-29", units: 1 },
	{ date: "2026-07-30", units: 1 },
	{ date: "2026-07-31", units: 1 },
] as const;

type Action = (input: {
	inputs: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

type RowRecord = {
	dateDisplay: string;
	rateText: string;
	units: number;
};

class SyntheticElement {
	innerText = "";
	textContent = "";
	value = "";
	selectedIndex = 0;
	readonly options: Array<{ value: string; text: string }> = [];

	click() {}

	dispatchEvent() {
		throw new Error(
			"OnCore Reviewed Actions must not dispatch synthetic events",
		);
	}

	getAttribute(_name: string): string | null {
		return null;
	}

	scrollIntoView() {}
}

class SyntheticCell extends SyntheticElement {
	constructor(text: string) {
		super();
		this.innerText = text;
		this.textContent = text;
	}
}

class SyntheticRow extends SyntheticElement {
	constructor(private readonly record: RowRecord) {
		super();
	}

	querySelectorAll(selector: string) {
		if (selector !== "td") return [];
		return [
			new SyntheticCell(this.record.dateDisplay),
			new SyntheticCell(this.record.rateText),
			new SyntheticCell(this.record.units > 0 ? String(this.record.units) : ""),
		].filter((cell) => cell.innerText.length > 0);
	}
}

class SyntheticGrid extends SyntheticElement {
	constructor(private readonly fixture: OncoreFixture) {
		super();
	}

	querySelectorAll(selector: string) {
		if (selector === "tr.rgRow, tr.rgAltRow") {
			return this.fixture.rows.map((row) => new SyntheticRow(row));
		}
		if (selector === "tbody tr") {
			if (this.fixture.rows.length > 0) {
				return this.fixture.rows.map((row) => new SyntheticRow(row));
			}
			return [
				new SyntheticRow({
					dateDisplay: "No timesheet entries.",
					rateText: "",
					units: 0,
				}),
				new SyntheticRow({
					dateDisplay: "Add new timesheet entry",
					rateText: "",
					units: 0,
				}),
			];
		}
		return [];
	}
}

class SyntheticSelect extends SyntheticElement {
	constructor(options: Array<{ value: string; text: string }>) {
		super();
		this.options.push(...options);
		this.value = options.at(0)?.value ?? "";
	}
}

class SyntheticStateInput extends SyntheticElement {
	constructor(value: Record<string, unknown>) {
		super();
		this.value = JSON.stringify(value);
	}
}

class SyntheticTimesheetLink extends SyntheticElement {
	readonly href: string;

	constructor(
		private readonly fixture: OncoreFixture,
		timesheetId: string,
		label: string,
	) {
		super();
		this.href = `https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmitRedir.aspx?id=${timesheetId}`;
		this.innerText = label;
		this.textContent = label;
	}

	override getAttribute(name: string) {
		return name === "href" ? this.href : null;
	}

	override click() {
		this.fixture.clicks.push("timesheet-link");
		this.fixture.baseUrl = `https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmit.aspx?id=${TIMESHEET_ID}`;
	}
}

type SyntheticForm = {
	rate: SyntheticSelect;
	units: SyntheticElement;
	unitsState: SyntheticStateInput;
	date: SyntheticElement;
	dateInputState: SyntheticStateInput;
	datePickerState: SyntheticStateInput;
};

class OncoreFixture {
	baseUrl = `https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmit.aspx?id=${TIMESHEET_ID}`;
	bodyText = "";
	editable = true;
	formOpen = false;
	rows: RowRecord[] = [];
	readonly clicks: string[] = [];
	readonly links: SyntheticTimesheetLink[] = [];
	private form: SyntheticForm | undefined;

	readonly html = { baseURI: this.baseUrl };
	readonly body = {
		get innerText() {
			return "";
		},
		get textContent() {
			return "";
		},
	};

	constructor() {
		Object.defineProperties(this.body, {
			innerText: { get: () => this.bodyText },
			textContent: { get: () => this.bodyText },
		});
		Object.defineProperty(this.html, "baseURI", {
			get: () => this.baseUrl,
		});
	}

	openForm() {
		this.clicks.push("add");
		this.formOpen = true;
		this.form = {
			rate: new SyntheticSelect([{ value: RATE_VALUE, text: "Standard Day" }]),
			units: new SyntheticElement(),
			unitsState: new SyntheticStateInput({}),
			date: new SyntheticElement(),
			dateInputState: new SyntheticStateInput({}),
			datePickerState: new SyntheticStateInput({
				minDateStr: `${PERIOD_START}-00-00-00`,
				maxDateStr: `${PERIOD_END}-00-00-00`,
			}),
		};
	}

	insertRow() {
		this.clicks.push("insert");
		const form = this.form;
		if (!form) throw new Error("synthetic form missing");
		this.rows.push({
			dateDisplay: form.date.value,
			rateText:
				form.rate.options.find((option) => option.value === form.rate.value)
					?.text ?? "",
			units: Number(form.units.value),
		});
		this.formOpen = false;
		this.form = undefined;
	}

	querySelector(selector: string): unknown {
		if (selector === "html") return this.html;
		if (selector === "body") return this.body;
		if (selector === `#${GRID_ID}`) return new SyntheticGrid(this);
		if (selector === "[id$='TimesheetWorkGrid_ctl00']") {
			return new SyntheticGrid(this);
		}
		if (selector === `#${ADD_ID}`) {
			if (!this.editable || this.formOpen) return null;
			const button = new SyntheticElement();
			button.click = () => this.openForm();
			return button;
		}
		if (selector === "#MainContent_btnSubmit") {
			return this.editable ? new SyntheticElement() : null;
		}
		if (!this.formOpen || !this.form) return null;
		if (selector === `#${EDIT_PREFIX}ddlRate`) return this.form.rate;
		if (selector === `#${EDIT_PREFIX}radTxtUnits`) return this.form.units;
		if (selector === `#${EDIT_PREFIX}radTxtUnits_ClientState`) {
			return this.form.unitsState;
		}
		if (selector === `#${EDIT_PREFIX}dpTimeSheetWorkDate_dateInput`) {
			return this.form.date;
		}
		if (
			selector === `#${EDIT_PREFIX}dpTimeSheetWorkDate_dateInput_ClientState`
		) {
			return this.form.dateInputState;
		}
		if (selector === `#${EDIT_PREFIX}dpTimeSheetWorkDate_ClientState`) {
			return this.form.datePickerState;
		}
		if (selector === `#${EDIT_PREFIX}btnInsert`) {
			const button = new SyntheticElement();
			button.click = () => this.insertRow();
			return button;
		}
		return null;
	}

	querySelectorAll(selector: string): unknown[] {
		if (selector === "a[href]") return this.links;
		return [];
	}

	document() {
		return {
			body: this.body,
			title: "OnCore Timesheet",
			querySelector: (selector: string) => this.querySelector(selector),
			querySelectorAll: (selector: string) => this.querySelectorAll(selector),
		};
	}
}

async function loadAction(path: string): Promise<Action> {
	const source = await readFile(path, "utf8");
	// biome-ignore lint/security/noGlobalEval lint/complexity/noCommaOperator: execute exact reviewed-action candidate bytes against the synthetic DOM seam.
	return (0, eval)(`(${source})`) as Action;
}

async function runAction(
	path: string,
	fixture: OncoreFixture,
	inputs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const globals = globalThis as Record<string, unknown>;
	const originals = {
		document: globals.document,
		Event: globals.Event,
		MouseEvent: globals.MouseEvent,
		setTimeout: globals.setTimeout,
	};
	Object.assign(globals, {
		document: fixture.document(),
		Event: class {
			constructor(readonly type: string) {}
		},
		MouseEvent: class {
			constructor(readonly type: string) {}
		},
		setTimeout: (callback: () => void) => {
			callback();
			return 0;
		},
	});
	try {
		const action = await loadAction(path);
		return await action({ inputs });
	} finally {
		Object.assign(globals, originals);
	}
}

const fillInputs = (
	rows: readonly { date: string; units: number }[] = EXPECTED_ROWS,
) => ({
	timesheet_id: TIMESHEET_ID,
	period_start: PERIOD_START,
	period_end: PERIOD_END,
	rate_value: RATE_VALUE,
	require_empty_grid: true,
	rows,
});

async function runFailure(
	path: string,
	fixture: OncoreFixture,
	inputs: Record<string, unknown>,
) {
	try {
		await runAction(path, fixture, inputs);
		return { failure_code: "action_did_not_fail" };
	} catch (error) {
		return JSON.parse((error as Error).message) as Record<string, unknown>;
	}
}

describe("OnCore reviewed-action fill path", () => {
	test("opens the exact summary-row timesheet and rejects adjacent periods", async () => {
		const fixture = new OncoreFixture();
		fixture.baseUrl =
			"https://iteraterecruitment.oncoreservices.com/pages/ContractorSummary.aspx";
		fixture.links.push(
			new SyntheticTimesheetLink(
				fixture,
				TIMESHEET_ID,
				"Submit Timesheet for period 27/07/2026 - 2/08/2026",
			),
			new SyntheticTimesheetLink(
				fixture,
				"999",
				"Submit Timesheet for period 3/08/2026 - 9/08/2026",
			),
		);

		const opened = await runAction(OPEN_ACTION_PATH, fixture, {
			timesheet_id: TIMESHEET_ID,
			period_start: PERIOD_START,
			period_end: PERIOD_END,
		});

		expect(opened).toMatchObject({
			ok: true,
			timesheet_id: TIMESHEET_ID,
			mode: "timesheet_link_clicked",
		});
		expect(fixture.clicks).toEqual(["timesheet-link"]);
		expect(fixture.baseUrl).toEndWith(
			`TimesheetSubmit.aspx?id=${TIMESHEET_ID}`,
		);
	});

	test("fills exact ISO dates through the Telerik form and verifies persisted rows", async () => {
		const fixture = new OncoreFixture();
		const filled = await runAction(FILL_ACTION_PATH, fixture, fillInputs());

		expect(filled).toMatchObject({
			ok: true,
			timesheet_id: TIMESHEET_ID,
			period_start: PERIOD_START,
			period_end: PERIOD_END,
			row_count: 5,
		});
		expect(fixture.rows).toEqual([
			{ dateDisplay: "27/07/2026", rateText: "Standard Day", units: 1 },
			{ dateDisplay: "28/07/2026", rateText: "Standard Day", units: 1 },
			{ dateDisplay: "29/07/2026", rateText: "Standard Day", units: 1 },
			{ dateDisplay: "30/07/2026", rateText: "Standard Day", units: 1 },
			{ dateDisplay: "31/07/2026", rateText: "Standard Day", units: 1 },
		]);
		expect(fixture.clicks).toEqual([
			"add",
			"insert",
			"add",
			"insert",
			"add",
			"insert",
			"add",
			"insert",
			"add",
			"insert",
		]);

		const proof = await runAction(VERIFY_ACTION_PATH, fixture, fillInputs());
		expect(proof).toMatchObject({
			proof_schema: "OncoreFillTimesheetProofV1",
			timesheet_id: TIMESHEET_ID,
			period_start: PERIOD_START,
			period_end: PERIOD_END,
			row_count: 5,
			total_units: 5,
			submitted: false,
			editable_state: "editable",
			entries: EXPECTED_ROWS.map((row) => ({
				...row,
				rate_value: RATE_VALUE,
			})),
		});
	});
});

describe("OnCore fill guards", () => {
	test("rejects a row outside the requested period before any DOM mutation", async () => {
		const fixture = new OncoreFixture();
		const failure = await runFailure(
			FILL_ACTION_PATH,
			fixture,
			fillInputs([{ date: "2026-08-03", units: 1 }]),
		);

		expect(failure).toMatchObject({
			failure_code: "period_boundary_rejected",
		});
		expect(fixture.clicks).toEqual([]);
		expect(fixture.rows).toEqual([]);
	});

	test.each([
		["submitted", "Timesheet was successfully submitted"],
		["approved", "This timesheet is approved"],
	] as const)("rejects the %s state", async (expectedState, bodyText) => {
		const fixture = new OncoreFixture();
		fixture.bodyText = bodyText;
		const failure = await runFailure(FILL_ACTION_PATH, fixture, fillInputs());

		expect(failure).toMatchObject({
			failure_code: "editable_state_unexpected",
			editable_state: expectedState,
		});
		expect(fixture.clicks).toEqual([]);
	});

	test("rejects a wrong open timesheet before any DOM mutation", async () => {
		const fixture = new OncoreFixture();
		fixture.baseUrl =
			"https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmit.aspx?id=999";
		const failure = await runFailure(FILL_ACTION_PATH, fixture, fillInputs());

		expect(failure).toMatchObject({
			failure_code: "wrong_timesheet_id_open",
			current_timesheet_id: "999",
		});
		expect(fixture.clicks).toEqual([]);
	});

	test("verification rejects a persisted row that does not match expected units", async () => {
		const fixture = new OncoreFixture();
		fixture.rows = [
			{ dateDisplay: "27/07/2026", rateText: "Standard Day", units: 2 },
		];
		const failure = await runFailure(
			VERIFY_ACTION_PATH,
			fixture,
			fillInputs([{ date: "2026-07-27", units: 1 }]),
		);

		expect(failure).toMatchObject({
			failure_code: "readback_mismatch",
		});
	});
});

describe("OnCore fill assets and runbook", () => {
	test("candidates embed the exact reviewable action bytes", async () => {
		for (const id of ["open-week", "fill-week", "verify-filled"]) {
			const source = await readFile(join(ACTIONS_ROOT, `${id}.js`), "utf8");
			const candidate = JSON.parse(
				await readFile(join(ACTIONS_ROOT, `${id}.candidate.json`), "utf8"),
			) as Record<string, unknown>;
			expect(candidate).toMatchObject({
				contract: "browser-use.reviewed-action-candidate",
				schema_version: "1",
				action_id: `oncore-${id}`,
				origin: "https://iteraterecruitment.oncoreservices.com",
				source,
				containment: "none",
				result_sensitivity: "low",
			});
		}
	});

	test("runbook snapshots immediately before every digest-pinned action", async () => {
		const runbook = JSON.parse(await readFile(RUNBOOK_PATH, "utf8")) as {
			steps: Array<{
				action_id?: string;
				expected_digest?: string;
				kind: string;
			}>;
		};
		expect(validateRunbook(runbook as never)).toEqual([]);
		expect(
			runbook.steps
				.filter((step) => step.kind === "action")
				.map((step) => step.action_id),
		).toEqual(["oncore-open-week", "oncore-fill-week", "oncore-verify-filled"]);
		for (const [index, step] of runbook.steps.entries()) {
			if (step.kind !== "action") continue;
			expect(runbook.steps.at(index - 1)?.kind).toBe("snapshot");
			const actionId = step.action_id?.replace(/^oncore-/, "");
			const source = await readFile(join(ACTIONS_ROOT, `${actionId}.js`));
			expect(step.expected_digest).toBe(
				createHash("sha256").update(source).digest("hex"),
			);
		}
	});
});
