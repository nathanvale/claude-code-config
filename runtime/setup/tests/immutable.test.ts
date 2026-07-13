import { describe, expect, test } from "bun:test";

import { deepFreeze } from "../src/immutable.ts";

describe("deep freeze", () => {
	test("freezes every reachable object while preserving values", () => {
		const value = deepFreeze({ nested: { items: ["alpha"] } });

		expect(value).toEqual({ nested: { items: ["alpha"] } });
		expect(Object.isFrozen(value)).toBe(true);
		expect(Object.isFrozen(value.nested)).toBe(true);
		expect(Object.isFrozen(value.nested.items)).toBe(true);
	});
});
