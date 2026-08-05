import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auditActionEffectClass } from "./browser-use-runbook-actions";

const ACTION_SOURCE_PATH = join(
	import.meta.dir,
	"..",
	"actions",
	"fasttrack",
	"verify-submitted.js",
);

let actionSource = "";

beforeAll(async () => {
	actionSource = await readFile(ACTION_SOURCE_PATH, "utf8");
});

class FixtureText {
	readonly textContent: string;
	readonly value = "";
	nextElementSibling: FixtureText | null = null;
	parentElement: FixtureText | null = null;

	constructor(readonly innerText: string) {
		this.textContent = innerText;
	}

	getAttribute(_name?: string): string | null {
		return null;
	}

	closest() {
		return null;
	}

	querySelector() {
		return null;
	}

	querySelectorAll() {
		return [];
	}
}

class FixtureRow {
	constructor(private readonly values: readonly string[]) {}

	querySelectorAll(selector: string) {
		return selector === "td" ? this.values.map((value) => new FixtureText(value)) : [];
	}
}

class FixturePane {
	constructor(private readonly rows: readonly FixtureRow[]) {}

	querySelectorAll(selector: string) {
		return selector === "table tbody tr" ? this.rows : [];
	}

	getAttribute() {
		return null;
	}
}

class FixtureTab extends FixtureText {
	constructor(
		text: string,
		private readonly target: string,
	) {
		super(text);
	}

	override getAttribute(name?: string) {
		return name === "href" ? this.target : null;
	}
}

type FixturePage = {
	bodyText: string;
	status?: string;
	title: string;
	url: string;
	searchRows?: readonly (readonly string[])[];
};

async function runVerifySubmitted(page: FixturePage): Promise<Record<string, unknown>> {
	const statusLabel = new FixtureText("Status:");
	statusLabel.nextElementSibling = page.status ? new FixtureText(page.status) : null;
	const submittedPane = new FixturePane(
		(page.searchRows ?? []).map((row) => new FixtureRow(row)),
	);
	const submittedTab = page.searchRows ? new FixtureTab("Submitted", "#submitted") : null;
	const location = { href: page.url, toString: () => page.url };
	const document = {
		body: new FixtureText(page.bodyText),
		title: page.title,
		querySelector(selector: string) {
			return selector === "#submitted" ? submittedPane : null;
		},
		querySelectorAll(selector: string) {
			if (selector.includes("role='tab'")) return submittedTab ? [submittedTab] : [];
			if (selector.includes("control-label")) return page.status ? [statusLabel] : [];
			if (selector.includes("tab-pane")) return page.searchRows ? [submittedPane] : [];
			return [];
		},
	};
	const globals = globalThis as unknown as Record<string, unknown>;
	const originals = {
		document: globals.document,
		location: globals.location,
	};
	Object.assign(globals, { document, location });
	try {
		// biome-ignore lint/security/noGlobalEval lint/complexity/noCommaOperator: hermetic indirect execution of exact authored Reviewed Action bytes.
		const action = (0, eval)(`(${actionSource})`) as (input: {
			inputs: Record<string, unknown>;
		}) => Promise<Record<string, unknown>>;
		try {
			return await action({
				inputs: { week_start: "2026-08-03", week_end: "2026-08-09" },
			});
		} catch (error) {
			return JSON.parse((error as Error).message) as Record<string, unknown>;
		}
	} finally {
		Object.assign(globals, originals);
	}
}

describe("FastTrack verify-submitted Reviewed Action", () => {
	test("remains mechanically read-only", () => {
		expect(auditActionEffectClass(actionSource)).toBe("read");
	});

	test("proves the requested week from the submitted detail page", async () => {
		const result = await runVerifySubmitted({
			bodyText: "Timesheet Period 03/08/2026 - 09/08/2026 Status: Submitted",
			status: " Submitted ",
			title: "Time - Submitted Timesheet",
			url: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/c3VibWl0dGVkVGltZXNoZWV0/MTMwNjkzOQ0000",
		});

		expect(result).toMatchObject({
			proof_schema: "FastTrack360SubmittedProofV1",
			period_start: "2026-08-03",
			period_end: "2026-08-09",
			submitted: true,
			submitted_state: "submitted",
			submitted_state_source: "submitted_detail",
		});
	});

	for (const status of ["Editing", "Incomplete", "Approved"]) {
		test(`refuses ${status} on a submitted-detail route`, async () => {
			const result = await runVerifySubmitted({
				bodyText: `Timesheet Period 03/08/2026 - 09/08/2026 Status: ${status}`,
				status,
				title: "Time - Submitted Timesheet",
				url: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/c3VibWl0dGVkVGltZXNoZWV0/OTHER",
			});

			expect(result).toMatchObject({
				reason: "submitted_detail_state_not_observed",
				status,
			});
		});
	}

	test("refuses a submitted detail page for the wrong week", async () => {
		const result = await runVerifySubmitted({
			bodyText: "Timesheet Period 10/08/2026 - 16/08/2026 Status: Submitted",
			status: "Submitted",
			title: "Time - Submitted Timesheet",
			url: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/c3VibWl0dGVkVGltZXNoZWV0/OTHER",
		});

		expect(result).toMatchObject({ reason: "submitted_detail_week_not_observed" });
	});

	test("keeps the Submitted tab and target-week row as fallback", async () => {
		const result = await runVerifySubmitted({
			bodyText: "Search Timesheet",
			title: "Time - Search Timesheet",
			url: "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/VGltZUFuZEF0dGVuZGFuY2U00",
			searchRows: [["03/08/2026", "09/08/2026", "Submitted"]],
		});

		expect(result).toMatchObject({
			proof_schema: "FastTrack360SubmittedProofV1",
			submitted: true,
			submitted_state: "submitted",
			submitted_state_source: "target_week_present_in_submitted_pane",
			tab_text: "Submitted",
		});
	});
});
