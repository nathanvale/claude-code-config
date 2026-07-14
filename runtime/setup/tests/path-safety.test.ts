import { describe, expect, test } from "bun:test";

import { isInsideOrEqual } from "../src/path-safety.ts";

describe("path containment", () => {
	test("accepts the root itself", () => {
		expect(isInsideOrEqual("/repo", "/repo")).toBe(true);
	});

	test("accepts a child of the root", () => {
		expect(isInsideOrEqual("/repo", "/repo/skills/fallow")).toBe(true);
	});

	test("rejects a parent of the root", () => {
		expect(isInsideOrEqual("/repo/skills", "/repo")).toBe(false);
	});
});
