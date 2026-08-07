import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateReviewedActionCandidate } from "./browser-use-reviewed-action-authoring";
import { validateRunbook } from "./browser-use-runbook-model";

const ACTIONS_ROOT = join(import.meta.dir, "..", "actions", "oncore");
const SUBMIT_ACTION_PATH = join(ACTIONS_ROOT, "submit.js");
const VERIFY_ACTION_PATH = join(ACTIONS_ROOT, "verify-submitted.js");
const RUNBOOK_PATH = join(
	import.meta.dir,
	"..",
	"runbooks",
	"oncore",
	"submit",
	"runbook.json",
);
const TIMESHEET_ID = "45705908116";
const PERIOD_START = "2026-08-03";
const PERIOD_END = "2026-08-09";
const RATE_VALUE = "45548822362";
const EXPECTED_ROWS = [
	{ date: "2026-08-03", units: 1 },
	{ date: "2026-08-04", units: 1 },
	{ date: "2026-08-05", units: 1 },
	{ date: "2026-08-06", units: 1 },
	{ date: "2026-08-07", units: 1 },
] as const;

type Action = (input: {
	inputs: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

class FixtureElement {
	innerText = "";
	textContent = "";
	value = "";
	type = "";
	hidden = false;
	disabled = false;
	readonly attributes = new Map<string, string>();

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}

	getClientRects() {
		return this.hidden ? [] : [{}];
	}

	scrollIntoView() {}
	click() {}
	closest(_selector: string): FixtureElement | null {
		return null;
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
	constructor(readonly cells: string[]) {
		super();
		this.innerText = cells.join(" | ");
		this.textContent = this.innerText;
	}

	querySelectorAll(selector: string) {
		return selector === "td" ? this.cells.map((text) => new FixtureCell(text)) : [];
	}
}

class FixtureGrid extends FixtureElement {
	constructor(readonly rows: FixtureRow[]) {
		super();
	}

	querySelectorAll(selector: string) {
		return selector === "tr.rgRow, tr.rgAltRow" || selector === "tbody tr"
			? this.rows
			: [];
	}
}

class FixtureSubmitControl extends FixtureElement {
	constructor(
		private readonly fixture: OncoreSubmitFixture,
		label = "Submit timesheet",
	) {
		super();
		this.value = label;
		this.type = "submit";
		this.attributes.set("type", "submit");
	}

	override click() {
		this.fixture.clicks.push("submit-timesheet");
	}
}

class FixtureLink extends FixtureElement {
	readonly href: string;

	constructor(
		timesheetId: string,
		private readonly row: FixtureRow,
	) {
		super();
		this.href = `/pages/TimesheetSubmitRedir.aspx?id=${timesheetId}`;
		this.attributes.set("href", this.href);
	}

	override closest(selector: string) {
		return selector === "tr" ? this.row : null;
	}
}

class OncoreSubmitFixture {
	baseUrl = `https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmit.aspx?id=${TIMESHEET_ID}`;
	bodyText = "";
	readonly clicks: string[] = [];
	readonly rows = EXPECTED_ROWS.map(
		(row) =>
			new FixtureRow([
				`${Number(row.date.slice(-2))}/08/2026`,
				"Standard Day",
				String(row.units),
			]),
	);
	readonly controls: FixtureSubmitControl[] = [new FixtureSubmitControl(this)];
	readonly links: FixtureLink[] = [];
	readonly html = new FixtureElement();
	readonly body = new FixtureElement();

	constructor() {
		Object.defineProperty(this.html, "baseURI", {
			get: () => this.baseUrl,
		});
		Object.defineProperties(this.body, {
			innerText: { get: () => this.bodyText, set: () => {} },
			textContent: { get: () => this.bodyText, set: () => {} },
		});
	}

	get document() {
		return {
			querySelector: (selector: string) => {
				if (selector === "html") return this.html;
				if (selector === "body") return this.body;
				if (
					selector === "#ctl00_MainContent_TimesheetWorkGrid_ctl00" ||
					selector === "[id$='TimesheetWorkGrid_ctl00']"
				) {
					return new FixtureGrid(this.rows);
				}
				if (selector === "#MainContent_btnSubmit") {
					return this.controls.at(0) ?? null;
				}
				return null;
			},
			querySelectorAll: (selector: string) => {
				if (selector === "#MainContent_btnSubmit") return this.controls;
				if (selector === "a[href]") return this.links;
				return [];
			},
		};
	}
}

const submitInputs = () => ({
	timesheet_id: TIMESHEET_ID,
	period_start: PERIOD_START,
	period_end: PERIOD_END,
	rate_value: RATE_VALUE,
	expected_total_units: 5,
	rows: EXPECTED_ROWS,
});

const verifyInputs = () => ({
	timesheet_id: TIMESHEET_ID,
	period_start: PERIOD_START,
	period_end: PERIOD_END,
});

async function runAction(
	path: string,
	fixture: OncoreSubmitFixture,
	inputs: Record<string, unknown>,
) {
	const source = await readFile(path, "utf8");
	const globals = globalThis as unknown as Record<string, unknown>;
	const originals = {
		document: globals.document,
		setTimeout: globals.setTimeout,
	};
	Object.assign(globals, {
		document: fixture.document,
		setTimeout: (callback: () => void) => {
			callback();
			return 0;
		},
	});
	try {
		// biome-ignore lint/security/noGlobalEval lint/complexity/noCommaOperator: execute exact reviewable action bytes against a hermetic DOM.
		const action = (0, eval)(`(${source})`) as Action;
		return await action({ inputs });
	} finally {
		Object.assign(globals, originals);
	}
}

async function runFailure(
	path: string,
	fixture: OncoreSubmitFixture,
	inputs: Record<string, unknown>,
) {
	try {
		await runAction(path, fixture, inputs);
		throw new Error("expected action failure");
	} catch (error) {
		return JSON.parse((error as Error).message) as Record<string, unknown>;
	}
}

describe("Oncore exact submit Reviewed Action", () => {
	test("re-verifies the draft and clicks one exact enabled submit control", async () => {
		const fixture = new OncoreSubmitFixture();

		const result = await runAction(SUBMIT_ACTION_PATH, fixture, submitInputs());

		expect(result).toMatchObject({
			ok: true,
			timesheet_id: TIMESHEET_ID,
			row_count: 5,
			total_units: 5,
			control_id: "MainContent_btnSubmit",
			control_text: "Submit timesheet",
		});
		expect(fixture.clicks).toEqual(["submit-timesheet"]);
	});

	test("rejects a wrong timesheet before clicking", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.baseUrl =
			"https://iteraterecruitment.oncoreservices.com/pages/TimesheetSubmit.aspx?id=999";

		const failure = await runFailure(
			SUBMIT_ACTION_PATH,
			fixture,
			submitInputs(),
		);

		expect(failure).toMatchObject({
			failure_code: "wrong_timesheet_id_open",
			current_timesheet_id: "999",
		});
		expect(fixture.clicks).toEqual([]);
	});

	test("rejects changed draft rows before clicking", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.rows[0] = new FixtureRow(["3/08/2026", "Standard Day", "0.5"]);

		const failure = await runFailure(
			SUBMIT_ACTION_PATH,
			fixture,
			submitInputs(),
		);

		expect(failure).toMatchObject({
			failure_code: "readback_mismatch_before_submit",
		});
		expect(fixture.clicks).toEqual([]);
	});

	test("rejects an invalid calendar period before clicking", async () => {
		const fixture = new OncoreSubmitFixture();

		const failure = await runFailure(SUBMIT_ACTION_PATH, fixture, {
			...submitInputs(),
			period_start: "2026-02-30",
		});

		expect(failure).toMatchObject({
			failure_code: "period_boundary_rejected",
		});
		expect(fixture.clicks).toEqual([]);
	});

	test("rejects an out-of-period row before clicking", async () => {
		const fixture = new OncoreSubmitFixture();

		const failure = await runFailure(SUBMIT_ACTION_PATH, fixture, {
			...submitInputs(),
			rows: [{ date: "2026-08-10", units: 1 }],
			expected_total_units: 1,
		});

		expect(failure).toMatchObject({ failure_code: "row_dates_rejected" });
		expect(fixture.clicks).toEqual([]);
	});

	test.each([
		["wrong label", (control: FixtureSubmitControl): void => {
			control.value = "Submit";
		}],
		["disabled", (control: FixtureSubmitControl): void => {
			control.disabled = true;
		}],
		["hidden", (control: FixtureSubmitControl): void => {
			control.hidden = true;
		}],
	] as const)("rejects a %s submit control", async (_label, mutate) => {
		const fixture = new OncoreSubmitFixture();
		mutate(fixture.controls[0]);

		const failure = await runFailure(
			SUBMIT_ACTION_PATH,
			fixture,
			submitInputs(),
		);

		expect(failure).toMatchObject({ failure_code: "submit_control_rejected" });
		expect(fixture.clicks).toEqual([]);
	});

	test("rejects duplicate exact submit controls", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.controls.push(new FixtureSubmitControl(fixture));

		const failure = await runFailure(
			SUBMIT_ACTION_PATH,
			fixture,
			submitInputs(),
		);

		expect(failure).toMatchObject({
			failure_code: "ambiguous_submit_control",
			submit_control_count: 2,
		});
		expect(fixture.clicks).toEqual([]);
	});
});

describe("Oncore submitted-state proof", () => {
	test("rejects invalid submission identity before reading page state", async () => {
		const fixture = new OncoreSubmitFixture();

		const failure = await runFailure(VERIFY_ACTION_PATH, fixture, {
			...verifyInputs(),
			period_end: "2026-02-30",
		});

		expect(failure).toMatchObject({
			failure_code: "submission_identity_rejected",
		});
	});

	test("accepts explicit submitted detail with the submit control absent", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.bodyText = "Timesheet was successfully submitted";
		fixture.controls.length = 0;

		const result = await runAction(VERIFY_ACTION_PATH, fixture, verifyInputs());

		expect(result).toMatchObject({
			proof_schema: "OncoreSubmittedTimesheetProofV1",
			timesheet_id: TIMESHEET_ID,
			submitted: true,
			submitted_state: "submitted",
			submitted_state_source:
				"submitted_detail_message_and_locked_controls",
		});
	});

	test.each([
		["marker missing", "", 0],
		["control still present", "Timesheet was submitted", 1],
	] as const)("rejects detail when %s", async (_label, bodyText, controls) => {
		const fixture = new OncoreSubmitFixture();
		fixture.bodyText = bodyText;
		fixture.controls.length = controls;

		const failure = await runFailure(
			VERIFY_ACTION_PATH,
			fixture,
			verifyInputs(),
		);

		expect(failure).toMatchObject({
			failure_code: "submitted_detail_state_not_observed",
		});
	});

	test("accepts the exact timesheet and week in a submitted summary row", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.baseUrl =
			"https://iteraterecruitment.oncoreservices.com/pages/ContractorSummary.aspx";
		const row = new FixtureRow([
			"3/8/2026",
			"9/8/2026",
			"Status: Submitted",
		]);
		fixture.links.push(new FixtureLink(TIMESHEET_ID, row));

		const result = await runAction(VERIFY_ACTION_PATH, fixture, verifyInputs());

		expect(result).toMatchObject({
			submitted: true,
			submitted_state_source: "contractor_summary_row",
		});
	});

	test("rejects an exact summary row without submitted state", async () => {
		const fixture = new OncoreSubmitFixture();
		fixture.baseUrl =
			"https://iteraterecruitment.oncoreservices.com/pages/ContractorSummary.aspx";
		const row = new FixtureRow(["3/8/2026", "9/8/2026", "Editing"]);
		fixture.links.push(new FixtureLink(TIMESHEET_ID, row));

		const failure = await runFailure(
			VERIFY_ACTION_PATH,
			fixture,
			verifyInputs(),
		);

		expect(failure).toMatchObject({
			failure_code: "submitted_summary_state_not_observed",
			submitted_marker_observed: false,
		});
	});
});

describe("Oncore submit authoring closure", () => {
	test("candidates embed exact source and pass the action model", async () => {
		for (const id of ["submit", "verify-submitted"] as const) {
			const source = await readFile(join(ACTIONS_ROOT, `${id}.js`), "utf8");
			const candidate = JSON.parse(
				await readFile(join(ACTIONS_ROOT, `${id}.candidate.json`), "utf8"),
			);
			expect(candidate.source).toBe(source);
			const validation = validateReviewedActionCandidate(candidate);
			expect(validation.ok).toBe(true);
			if (validation.ok) {
				expect(validation.digest).toBe(
					createHash("sha256").update(source).digest("hex"),
				);
				expect(validation.effect_class).toBe(
					id === "submit" ? "mutation" : "read",
				);
			}
		}
	});

	test("canonical runbook mirrors FastTrack submit sequencing and exact action digests", async () => {
		const runbook = JSON.parse(await readFile(RUNBOOK_PATH, "utf8")) as {
			steps: Array<{
				action_id?: string;
				expected_digest?: string;
				kind: string;
			}>;
		};
		expect(validateRunbook(runbook as never)).toEqual([]);
		expect(runbook.steps.map((step) => step.kind)).toEqual([
			"open",
			"snapshot",
			"action",
			"snapshot",
			"action",
			"approval-gate",
			"snapshot",
			"action",
			"snapshot",
			"action",
		]);
		expect(
			runbook.steps
				.filter((step) => step.kind === "action")
				.map((step) => step.action_id),
		).toEqual([
			"oncore-open-week",
			"oncore-verify-filled",
			"oncore-submit",
			"oncore-verify-submitted",
		]);
		for (const [index, step] of runbook.steps.entries()) {
			if (step.kind !== "action") continue;
			expect(runbook.steps.at(index - 1)?.kind).toBe("snapshot");
			if (step.action_id === "oncore-submit") {
				const source = await readFile(SUBMIT_ACTION_PATH);
				expect(step.expected_digest).toBe(
					createHash("sha256").update(source).digest("hex"),
				);
			}
			if (step.action_id === "oncore-verify-submitted") {
				const source = await readFile(VERIFY_ACTION_PATH);
				expect(step.expected_digest).toBe(
					createHash("sha256").update(source).digest("hex"),
				);
			}
		}
	});
});
