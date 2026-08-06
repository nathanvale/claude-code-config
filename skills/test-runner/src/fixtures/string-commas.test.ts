import { describe, expect, test } from "bun:test";

function statusLine(): string {
	return "ready, blocked, done";
}

describe("string commas fixture", () => {
	test("keeps comma separated status line", () => {
		expect(statusLine()).toBe("ready, waiting, done");
	});
});
