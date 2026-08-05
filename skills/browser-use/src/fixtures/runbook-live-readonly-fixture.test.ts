import { expect, test } from "bun:test";
import { liveRunbookFixtureResponse } from "./runbook-live-readonly-fixture";

test("live fixture is hermetically inspectable without binding a port", async () => {
	const response = liveRunbookFixtureResponse();
	expect(response.headers.get("content-type")).toContain("text/html");
	expect((await response.text()).match(/class="row"/g)).toHaveLength(2);
});
