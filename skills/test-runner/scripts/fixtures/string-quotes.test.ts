import { describe, expect, test } from "bun:test";

function planLabel(): string {
	return 'release "alpha"';
}

describe("string quotes fixture", () => {
	test("preserves quoted plan label", () => {
		expect(planLabel()).toBe('release "beta"');
	});
});
