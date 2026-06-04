import { describe, expect, test } from "bun:test";

function initials(name: string): string {
	return name
		.split(/\s+/)
		.map((part) => part[0])
		.join("");
}

describe("multi failure fixture", () => {
	test("builds initials", () => {
		expect(initials("Ada Lovelace")).toBe("AD");
	});

	test("handles empty names", () => {
		expect(initials("")).toBe("");
	});
});

