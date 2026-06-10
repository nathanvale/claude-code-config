import { describe, test } from "bun:test";

function normalizeName(value: unknown): string {
	return (value as { name: string }).name.toUpperCase();
}

describe("runtime error fixture", () => {
	test("reports runtime type failure", () => {
		normalizeName(null);
	});
});
