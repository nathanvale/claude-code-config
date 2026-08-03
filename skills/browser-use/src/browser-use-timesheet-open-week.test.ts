import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ACTION_SOURCE_PATH = join(
	import.meta.dir,
	"..",
	"actions",
	"fasttrack",
	"open-week.js",
);
const REGISTRY_PATH = join(import.meta.dir, "..", "actions", "registry.json");
const RUNBOOK_PATH = join(
	import.meta.dir,
	"..",
	"runbooks",
	"fasttrack",
	"submit",
	"runbook.json",
);

type FixtureState = {
	activeTab: string;
	clicks: string[];
	events: string[];
	gridOpen: boolean;
};

class FixtureInput {
	readonly hidden = false;
	readonly innerText = "";
	readonly textContent = "";
	readonly offsetParent = {};

	constructor(readonly value: string) {}

	getAttribute(name: string) {
		return name === "value" ? this.value : null;
	}

	getClientRects() {
		return [{}];
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

class FixtureEditRow {
	private readonly workDate: FixtureInput;
	private readonly startTime = new FixtureInput("09:00");

	constructor(workDate: string) {
		this.workDate = new FixtureInput(workDate);
	}

	querySelector(selector: string) {
		if (
			selector === "[ng-model='rxg.workDate1']" ||
			selector.includes("workDate")
		) {
			return this.workDate;
		}
		if (selector === "[ng-model='rxg.startDateTime']") return this.startTime;
		return null;
	}

	querySelectorAll() {
		return [];
	}
}

class FixtureLink {
	readonly href = "https://manpowergroup.fasttrack360.com.au/timesheet/edit";
	readonly innerText = "Open";
	readonly textContent = "Open";

	constructor(
		private readonly state: FixtureState,
		private readonly opensGrid: boolean,
	) {}

	scrollIntoView() {}

	dispatchEvent(event: { type: string }) {
		this.state.events.push(`row:${event.type}`);
		return true;
	}

	click() {
		this.state.clicks.push("target-week");
		if (this.opensGrid) this.state.gridOpen = true;
	}
}

class FixtureSearchRow {
	private readonly cells: FixtureCell[];
	private readonly link: FixtureLink;

	constructor(
		periodStart: string,
		periodEnd: string,
		state: FixtureState,
		opensGrid: boolean,
	) {
		this.cells = [new FixtureCell(periodStart), new FixtureCell(periodEnd)];
		this.link = new FixtureLink(state, opensGrid);
	}

	querySelectorAll(selector: string) {
		if (selector === "td") return this.cells;
		if (selector === "a[href]") return [this.link];
		return [];
	}
}

class FixtureTab {
	readonly textContent: string;

	constructor(
		readonly innerText: string,
		private readonly state: FixtureState,
	) {
		this.textContent = innerText;
	}

	dispatchEvent(event: { type: string }) {
		this.state.events.push(`${this.innerText}:${event.type}`);
		return true;
	}

	click() {
		this.state.activeTab = this.innerText;
		this.state.clicks.push(this.innerText);
	}
}

async function runOpenWeekAction(input: {
	searchPeriodStart: string;
	searchPeriodEnd: string;
}): Promise<{
	document: { querySelectorAll: (selector: string) => unknown[] };
	result: Record<string, unknown>;
	state: FixtureState;
}> {
	const actionSource = await readFile(ACTION_SOURCE_PATH, "utf8");
	const state: FixtureState = {
		activeTab: "Available",
		clicks: [],
		events: [],
		gridOpen: false,
	};
	const tabs = ["Available", "Incomplete", "Submitted"].map(
		(label) => new FixtureTab(label, state),
	);
	const searchRow = new FixtureSearchRow(
		input.searchPeriodStart,
		input.searchPeriodEnd,
		state,
		input.searchPeriodStart === "03/08/2026",
	);
	const editRows = [
		"03/08/2026",
		"04/08/2026",
		"05/08/2026",
		"06/08/2026",
		"07/08/2026",
	].map((date) => new FixtureEditRow(date));
	const location = {
		href: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/VGltZUFuZEF0dGVuZGFuY2U00",
	};
	const document = {
		title: "Time - Search Timesheet",
		body: {},
		querySelector(selector: string) {
			if (selector === "input[type='password']") return null;
			if (selector === "[ng-app]") return null;
			return null;
		},
		querySelectorAll(selector: string): unknown[] {
			if (selector === "tr[ng-repeat]") return state.gridOpen ? editRows : [];
			if (selector === "ul.nav.nav-tabs.top-3 li a, .nav-tabs a") return tabs;
			if (selector === "table tbody tr") {
				return state.gridOpen || state.activeTab !== "Available" ? [] : [searchRow];
			}
			if (
				selector ===
				"a[href], [ng-click], [role='link'], [role='menuitem']"
			) {
				return [];
			}
			return [];
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
				document,
				result: await action({
					inputs: {
						week_start: "2026-08-03",
						week_end: "2026-08-09",
					},
				}),
				state,
			};
		} catch (error) {
			return {
				document,
				result: JSON.parse((error as Error).message) as Record<string, unknown>,
				state,
			};
		}
	} finally {
		Object.assign(globals, originals);
	}
}

describe("FastTrack open-week Reviewed Action", () => {
	test("opens the requested filled week and proves its edit grid by workDate1", async () => {
		const { document, result, state } = await runOpenWeekAction({
			searchPeriodStart: "03/08/2026",
			searchPeriodEnd: "09/08/2026",
		});

		expect(result).toMatchObject({
			ok: true,
			mode: "opened_from_available",
			period_start: "2026-08-03",
			period_end: "2026-08-09",
			row_count: 5,
		});
		expect(state.clicks).toContain("target-week");
		const rows = document.querySelectorAll("tr[ng-repeat]") as FixtureEditRow[];
		expect(rows).toHaveLength(5);
		expect(rows[0]?.querySelector("[ng-model='rxg.startDateTime']")).toBeDefined();
	});

	test("refuses a search page containing only the wrong week", async () => {
		const { result, state } = await runOpenWeekAction({
			searchPeriodStart: "10/08/2026",
			searchPeriodEnd: "16/08/2026",
		});

		expect(result).toMatchObject({ reason: "wrong_week_open" });
		expect(state.clicks).not.toContain("target-week");
		expect(state.gridOpen).toBeFalse();
	});

	test("registry binds the authored bytes and structural postcondition", async () => {
		const actionBytes = await readFile(ACTION_SOURCE_PATH);
		const digest = createHash("sha256").update(actionBytes).digest("hex");
		const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as {
			actions: Array<{
				asset_path: string;
				record: {
					action_id: string;
					expected_digest: string;
					promotion_receipt: unknown;
					required_postcondition: unknown;
				};
			}>;
		};
		const entry = registry.actions.find(
			(candidate) => candidate.record.action_id === "fasttrack-open-week",
		);

		expect(entry?.record).toMatchObject({
			expected_digest: digest,
			promotion_receipt: null,
			required_postcondition: {
				kind: "element-visible",
				selector: "tr[ng-repeat]",
			},
		});
		expect(
			await readFile(join(import.meta.dir, "..", "actions", entry?.asset_path ?? "")),
		).toEqual(actionBytes);
	});
});

describe("FastTrack submit Runbook", () => {
	test("opens the target week before verify and snapshots before every action", async () => {
		const runbook = JSON.parse(await readFile(RUNBOOK_PATH, "utf8")) as {
			steps: Array<{ action_id?: string; kind: string }>;
		};
		const actionIds = runbook.steps
			.filter((step) => step.kind === "action")
			.map((step) => step.action_id);

		expect(actionIds).toEqual([
			"fasttrack-open-week",
			"fasttrack-verify-filled-week",
			"fasttrack-submit",
			"fasttrack-verify-submitted",
		]);
		for (const [index, step] of runbook.steps.entries()) {
			if (step.kind !== "action") continue;
			expect(runbook.steps[index - 1]?.kind).toBe("snapshot");
		}
	});
});
