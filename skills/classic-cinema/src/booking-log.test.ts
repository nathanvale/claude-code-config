import { describe, expect, test } from "bun:test";
import { scanLog, validateLine } from "./booking-log.ts";

const GOOD =
	'{"timestamp":"2026-06-10T18:38:06+10:00","movie_title":"Princess Mononoke (1997)","session_datetime":"Wed 10 Jun, 07:00PM","screen":"Screen 1","seats":"R8, R9","tickets":[{"type":"ADULT","quantity":2,"price":"$26.50"}],"booking_fee":"$3.90","total":"$56.90","gmail_message_id":"19eb0ae522343b52","notes":""}';

describe("validateLine", () => {
	test("accepts a compact JSON object line", () => {
		expect(validateLine(GOOD).valid).toBe(true);
	});
	test("rejects a pretty-printed fragment", () => {
		expect(validateLine("  \"notes\": \"\"").valid).toBe(false);
		expect(validateLine("}").valid).toBe(false);
		expect(validateLine("{").valid).toBe(false);
	});
	test("rejects empty and array lines", () => {
		expect(validateLine("").valid).toBe(false);
		expect(validateLine("[]").valid).toBe(false);
		expect(validateLine("{}").valid).toBe(false);
	});
});

describe("scanLog (the booking-log corruption case from 2026-06-10)", () => {
	test("clean log has no bad lines", () => {
		const content = `${GOOD}\n${GOOD}\n`;
		const scan = scanLog(content);
		expect(scan.totalLines).toBe(2);
		expect(scan.validLines).toBe(2);
		expect(scan.badLines).toHaveLength(0);
		expect(scan.lastValidLineNo).toBe(2);
	});

	test("isolates a pretty-printed tail after the valid prefix", () => {
		// 2 good lines, then a multi-line pretty-printed fragment (the real bug).
		const fragment = ["{", '  "timestamp": "x",', '  "total": ".90",', '  "notes": ""'].join(
			"\n",
		);
		const content = `${GOOD}\n${GOOD}\n${fragment}\n`;
		const scan = scanLog(content);
		expect(scan.validLines).toBe(2);
		expect(scan.lastValidLineNo).toBe(2);
		expect(scan.badLines.length).toBeGreaterThan(0);
	});

	test("handles missing trailing newline", () => {
		const scan = scanLog(GOOD);
		expect(scan.totalLines).toBe(1);
		expect(scan.validLines).toBe(1);
	});
});
