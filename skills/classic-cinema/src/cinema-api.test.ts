import { describe, expect, test } from "bun:test";
import { formatTime, todayAest } from "./cinema-api.ts";

describe("formatTime (AEST +10)", () => {
	test("evening session renders lowercase pm", () => {
		// 2026-06-10T19:00:00 stamped in AEST → 7:00pm
		expect(formatTime("2026-06-10T19:00:00")).toBe("7:00pm");
	});

	test("morning session renders lowercase am with zero-padded minutes", () => {
		expect(formatTime("2026-06-10T09:05:00")).toBe("9:05am");
	});

	test("midnight renders 12:00am, noon renders 12:00pm", () => {
		expect(formatTime("2026-06-10T00:00:00")).toBe("12:00am");
		expect(formatTime("2026-06-10T12:00:00")).toBe("12:00pm");
	});
});

describe("todayAest", () => {
	test("returns a YYYY-MM-DD string", () => {
		expect(todayAest()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});
