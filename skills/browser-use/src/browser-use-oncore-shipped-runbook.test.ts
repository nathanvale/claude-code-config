import { describe, expect, test } from "bun:test";
import shippedOncoreRunbook from "./fixtures/browser-use-runbook/oncore/timesheet-snapshot-verify/runbook.json";
import { parseRunbookRecord } from "./browser-use-runbook-model";

describe("shipped Oncore read-only runbook", () => {
	test("uses the current Oncore tenant and shared session route", () => {
		const parsed = parseRunbookRecord(shippedOncoreRunbook);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.runbook.allowed_origins).toEqual([
			"https://iteraterecruitment.oncoreservices.com",
		]);
		expect(parsed.runbook.auth_context_ref).toBe("oncore-session");
		expect(parsed.runbook.flow_name).toBe("verify-oncore-portal-loaded");
		expect(parsed.runbook.steps[0]).toEqual({
			kind: "open",
			url: "https://iteraterecruitment.oncoreservices.com/pages/ContractorSummary.aspx",
			postcondition: {
				kind: "url-equals",
				url: "https://iteraterecruitment.oncoreservices.com/pages/ContractorSummary.aspx",
			},
		});
	});
});
