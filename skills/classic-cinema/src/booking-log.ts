// Booking log model + validation.
// Owner for the JSONL line shape at ~/.local/state/classic-cinema/bookings.jsonl.
// The append-only invariant and field set are owned by
// references/booking-log.md; this module enforces the "one compact valid JSON
// object per line" rule that heal-skill repairs.

import { homedir } from "node:os";
import { join } from "node:path";

export function bookingLogPath(): string {
	return join(homedir(), ".local", "state", "classic-cinema", "bookings.jsonl");
}

export interface LineVerdict {
	lineNo: number;
	raw: string;
	valid: boolean;
	reason?: string;
}

export interface LogScan {
	totalLines: number;
	validLines: number;
	badLines: LineVerdict[];
	/** Index (1-based) of the last line that is a valid compact JSON object. */
	lastValidLineNo: number;
}

const REQUIRED_FIELDS = [
	"timestamp",
	"movie_title",
	"session_datetime",
	"screen",
	"seats",
	"tickets",
	"total",
	"gmail_message_id",
];

/** A line is valid when it parses as a single JSON object on one physical line. */
export function validateLine(raw: string): { valid: boolean; reason?: string } {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return { valid: false, reason: "empty line" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { valid: false, reason: "not valid JSON (likely a pretty-printed fragment)" };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { valid: false, reason: "not a JSON object" };
	}
	// A line that parses but is missing core fields is a known-good legacy variant
	// only if it still looks like a booking; flag truly empty objects.
	const keys = Object.keys(parsed as Record<string, unknown>);
	if (keys.length === 0) return { valid: false, reason: "empty object" };
	return { valid: true };
}

export function scanLog(content: string): LogScan {
	const lines = content.split("\n");
	// Trailing newline produces a final empty element; drop it from the count.
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

	const badLines: LineVerdict[] = [];
	let validLines = 0;
	let lastValidLineNo = 0;
	lines.forEach((raw, idx) => {
		const lineNo = idx + 1;
		const { valid, reason } = validateLine(raw);
		if (valid) {
			validLines += 1;
			lastValidLineNo = lineNo;
		} else {
			badLines.push({ lineNo, raw, valid: false, reason });
		}
	});

	return { totalLines: lines.length, validLines, badLines, lastValidLineNo };
}

/** Whether a booking object carries the required fields (advisory, not enforced on read). */
export function hasRequiredFields(obj: Record<string, unknown>): string[] {
	return REQUIRED_FIELDS.filter((f) => !(f in obj));
}
