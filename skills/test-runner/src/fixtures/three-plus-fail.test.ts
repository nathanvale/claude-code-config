import { describe, expect, test } from "bun:test";

describe("three plus failure fixture", () => {
	test("formats account code", () => {
		expect("acct-7").toBe("acct-007");
	});

	test("rounds invoice total", () => {
		expect(10.4).toBe(10);
	});

	test("marks overdue invoice", () => {
		expect(false).toBe(true);
	});

	test("keeps tax code", () => {
		expect("gst").toBe("vat");
	});
});
