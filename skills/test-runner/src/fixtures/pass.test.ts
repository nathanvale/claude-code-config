import { describe, expect, test } from "bun:test";

function add(left: number, right: number): number {
	return left + right;
}

describe("passing fixture", () => {
	test("adds positive numbers", () => {
		expect(add(2, 3)).toBe(5);
	});

	test("keeps zero identity", () => {
		expect(add(7, 0)).toBe(7);
	});
});

