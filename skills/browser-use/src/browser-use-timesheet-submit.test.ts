import { beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	actionAssetDigest,
	auditActionEffectClass,
} from "./browser-use-runbook-actions";

const DIGEST = "8399adac343c38ef70738370781330137e1405320091fcf374210ff6b51f9174";
const VERIFY_DIGEST = "892fcae3dbd68649628a9ce3e644d599557d3c57c4b0fbce0427d59ad7c09916";
const ACTION_PATH = join(import.meta.dir, "..", "actions", "assets", `${DIGEST}.js`);
const REGISTRY_PATH = join(import.meta.dir, "..", "actions", "registry.json");

let actionSource = "";

beforeAll(async () => {
	actionSource = await readFile(ACTION_PATH, "utf8");
});

type ControlSpec = {
	text: string;
	ngClick: string;
	hidden?: boolean;
};

type FixtureState = {
	clicks: string[];
	events: string[];
};

class FixtureInput {
	constructor(readonly value: string) {}

	getAttribute(name: string) {
		return name === "value" ? this.value : null;
	}
}

class FixtureCell {
	constructor(readonly innerText: string) {}

	get textContent() {
		return this.innerText;
	}

	getAttribute() {
		return null;
	}
}

class FixtureRow {
	private readonly workDate: FixtureInput;
	private readonly startDate: FixtureInput;
	private readonly cell: FixtureCell;

	constructor(workDate: string, startDate: string) {
		this.workDate = new FixtureInput(workDate);
		this.startDate = new FixtureInput(startDate);
		this.cell = new FixtureCell(startDate);
	}

	querySelector(selector: string) {
		if (selector === "[ng-model='rxg.workDate1']") return this.workDate;
		if (selector === "[ng-model='rxg.startDateTime']") return this.startDate;
		return null;
	}

	querySelectorAll() {
		return [this.cell];
	}
}

class FixtureControl {
	readonly innerText: string;
	readonly textContent: string;
	readonly value = "";
	readonly classList = { contains: () => false };

	constructor(
		private readonly spec: ControlSpec,
		private readonly state: FixtureState,
	) {
		this.innerText = spec.text;
		this.textContent = spec.text;
	}

	get hidden() {
		return this.spec.hidden === true;
	}

	getAttribute(name: string) {
		if (name === "ng-click") return this.spec.ngClick;
		if (name === "aria-hidden") return this.spec.hidden ? "true" : null;
		return null;
	}

	getClientRects() {
		return this.spec.hidden ? [] : [{}];
	}

	scrollIntoView() {}

	dispatchEvent(event: { type: string }) {
		this.state.events.push(`${this.spec.text}:${event.type}`);
		return true;
	}

	click() {
		this.state.clicks.push(this.spec.text);
	}
}

async function runSubmitAction(input: {
	controls: readonly ControlSpec[];
	wrongWeek?: boolean;
}): Promise<{ result: Record<string, unknown>; state: FixtureState }> {
	const state: FixtureState = { clicks: [], events: [] };
	const targetDates = [
		"03/08/2026",
		"04/08/2026",
		"05/08/2026",
		"06/08/2026",
		"07/08/2026",
	];
	const foreignDates = [
		"10/08/2026",
		"11/08/2026",
		"12/08/2026",
		"13/08/2026",
		"14/08/2026",
	];
	const rows = (input.wrongWeek ? foreignDates : targetDates).map(
		(workDate, index) =>
			new FixtureRow(workDate, targetDates[index] ?? "03/08/2026"),
	);
	const controls = input.controls.map((spec) => new FixtureControl(spec, state));
	const location = { href: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/Time" };
	const document = {
		title: "Time - Available Timesheet",
		querySelectorAll(selector: string) {
			return selector === "tr[ng-repeat]" ? rows : controls;
		},
	};
	const globals = globalThis as unknown as Record<string, unknown>;
	const originals = {
		document: globals.document,
		location: globals.location,
		window: globals.window,
		MouseEvent: globals.MouseEvent,
		setTimeout: globals.setTimeout,
	};
	Object.assign(globals, {
		document,
		location,
		window: { location },
		MouseEvent: class {
			constructor(readonly type: string) {}
		},
		setTimeout: (callback: () => void) => {
			callback();
			return 0;
		},
	});
	try {
		// biome-ignore lint/security/noGlobalEval lint/complexity/noCommaOperator: hermetic indirect execution of exact authored Reviewed Action bytes.
		const action = (0, eval)(`(${actionSource})`) as (input: {
			inputs: Record<string, unknown>;
		}) => Promise<Record<string, unknown>>;
		try {
			return {
				result: await action({
					inputs: { week_start: "2026-08-03", week_end: "2026-08-09" },
				}),
				state,
			};
		} catch (error) {
			return {
				result: JSON.parse((error as Error).message) as Record<string, unknown>,
				state,
			};
		}
	} finally {
		Object.assign(globals, originals);
	}
}

describe("FastTrack exact Submit Reviewed Action", () => {
	test("clicks only one visible exact Submit bound to saveAndSubmit", async () => {
		const { result, state } = await runSubmitAction({
			controls: [
				{ text: "Submit", ngClick: "saveAndSubmit()" },
				{ text: "Submit & Approve", ngClick: "saveSubmitAndApprove()" },
				{ text: "Approve", ngClick: "bulkApproveTimesheets()" },
				{ text: "Save & Submit", ngClick: "saveAndSubmit()" },
			],
		});

		expect(result).toMatchObject({
			ok: true,
			controlText: "Submit",
			controlNgClick: "saveAndSubmit()",
		});
		expect(state.clicks).toEqual(["Submit"]);
		expect(state.events).toEqual([
			"Submit:mouseover",
			"Submit:mousedown",
			"Submit:mouseup",
		]);
	});

	for (const controls of [
		[
			{ text: "Submit & Approve", ngClick: "saveSubmitAndApprove()" },
			{ text: "Approve", ngClick: "bulkApproveTimesheets()" },
			{ text: "Save & Submit", ngClick: "saveAndSubmit()" },
		],
		[
			{ text: "Submit", ngClick: "saveAndSubmit()" },
			{ text: "Submit", ngClick: "saveAndSubmit()" },
		],
		[{ text: "Submit", ngClick: "saveSubmitAndApprove()" }],
	]) {
		test(`refuses unsafe or ambiguous controls: ${controls.map((control) => control.text).join(", ")}`, async () => {
			const { result, state } = await runSubmitAction({ controls });

			expect(result).toMatchObject({ reason: "ambiguous_submit_control" });
			expect(state.clicks).toEqual([]);
		});
	}

	test("workDate1 takes precedence and wrong-week refusal occurs before click", async () => {
		const { result, state } = await runSubmitAction({
			wrongWeek: true,
			controls: [{ text: "Submit", ngClick: "saveAndSubmit()" }],
		});

		expect(result).toMatchObject({ reason: "wrong_week_open" });
		expect(state.clicks).toEqual([]);
	});

	test("registry pins the exact promoted authored bytes", async () => {
		const bytes = await readFile(ACTION_PATH);
		const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as {
			actions: Array<{
				record: {
					action_id: string;
					expected_digest: string;
					promotion_receipt: unknown;
				};
			}>;
		};
		const record = registry.actions.find(
			(candidate) => candidate.record.action_id === "fasttrack-submit",
		)?.record;

		expect(createHash("sha256").update(bytes).digest("hex")).toBe(DIGEST);
		expect(record).toMatchObject({
			expected_digest: DIGEST,
			promotion_receipt: {
				disposition: "approved",
				approved_digest: DIGEST,
			},
		});
	});

	test("verify-submitted is exact, promoted, and mechanically read-only", async () => {
		const bytes = await readFile(
			join(import.meta.dir, "..", "actions", "assets", `${VERIFY_DIGEST}.js`),
			"utf8",
		);
		const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as {
			actions: Array<{
				record: {
					action_id: string;
					expected_digest: string;
					effect_class: string;
					promotion_receipt: unknown;
				};
			}>;
		};
		const record = registry.actions.find(
			(candidate) => candidate.record.action_id === "fasttrack-verify-submitted",
		)?.record;

		expect(actionAssetDigest(bytes)).toBe(VERIFY_DIGEST);
		expect(auditActionEffectClass(bytes)).toBe("read");
		expect(record).toMatchObject({
			expected_digest: VERIFY_DIGEST,
			effect_class: "read",
			promotion_receipt: {
				disposition: "approved",
				approved_digest: VERIFY_DIGEST,
			},
		});
	});
});
