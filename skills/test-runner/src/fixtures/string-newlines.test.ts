import { describe, expect, test } from "bun:test";

function summaryBlock(): string {
	return ["header", "middle", "footer"].join("\n");
}

describe("string newlines fixture", () => {
	test("keeps multiline summary shape", () => {
		expect(summaryBlock()).toBe(["header", "changed", "footer"].join("\n"));
	});
});
