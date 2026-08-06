import { describe, expect, spyOn, test } from "bun:test";

import { main, parseArgs } from "./cli.ts";
import type { BftRuntime } from "./cli.ts";
import type {
	AuthSession,
	Booking,
	CommandName,
	Credentials,
	Session,
} from "./model.ts";

const AUTH: AuthSession = {
	token: "secret-token",
	branchId: "branch-1",
	namespace: "bft",
	headers: { "x-glofox-access-token": "app-token" },
};

const CREDENTIALS: Credentials = {
	login: "member@example.test",
	password: "private-password",
	branchId: "branch-1",
	namespace: "bft",
	headers: { "x-glofox-access-token": "app-token" },
	device: "ios",
};

const SESSION: Session = {
	id: "session-1",
	name: "Strength",
	start_at: "2026-08-01T07:00:00+10:00",
	available: 2,
	full: false,
};

const BOOKING: Booking = {
	id: "booking-1",
	session_id: SESSION.id,
	name: SESSION.name,
	start_at: SESSION.start_at,
	waitlisted: false,
};

function runtime(overrides: Partial<BftRuntime> = {}): BftRuntime {
	return {
		now: () => new Date("2026-08-01T00:00:00+10:00"),
		loadCredentials: async () => CREDENTIALS,
		login: async () => AUTH,
		listSessions: async () => [SESSION],
		listBookings: async () => [BOOKING],
		createBooking: async () => ({ success: true }),
		cancelBooking: async () => ({ success: true }),
		...overrides,
	};
}

async function captureMain(
	argv: string[],
	overrides: Partial<BftRuntime> = {},
) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const log = spyOn(console, "log").mockImplementation((value) => {
		stdout.push(String(value));
	});
	const error = spyOn(console, "error").mockImplementation((value) => {
		stderr.push(String(value));
	});
	try {
		const exitCode = await main(argv, runtime(overrides));
		return { exitCode, stdout, stderr };
	} finally {
		log.mockRestore();
		error.mockRestore();
	}
}

describe("parseArgs", () => {
	test("parses a safe booking preview", () => {
		expect(parseArgs(["book", "--session-id", "session-1", "--json"])).toEqual(
			expect.objectContaining({
				command: "book",
				sessionId: "session-1",
				execute: false,
				json: true,
			}),
		);
	});

	test("requires an explicit execute flag for mutation mode", () => {
		expect(
			parseArgs([
				"book",
				"--session-id",
				"session-1",
				"--join-waitlist",
				"--execute",
			]),
		).toEqual(
			expect.objectContaining({
				execute: true,
				joinWaitlist: true,
			}),
		);
	});

	test("rejects unknown flags", () => {
		expect(() => parseArgs(["sessions", "--surprise"])).toThrow(
			"Unknown argument",
		);
	});

	test("rejects mutation flags on read commands", () => {
		expect(() => parseArgs(["sessions", "--execute"])).toThrow(
			"--execute is only valid",
		);
	});

	test("rejects a flag where another flag needs a value", () => {
		expect(() => parseArgs(["sessions", "--date", "--json"])).toThrow(
			"--date needs a value",
		);
	});

	test("leaves omitted days undefined", () => {
		expect(parseArgs(["sessions"]).days).toBeUndefined();
	});

	test("rejects explicit days outside sessions", () => {
		expect(() => parseArgs(["bookings", "--days", "1"])).toThrow(
			"--date and --days are only valid for sessions",
		);
	});
});

describe("main", () => {
	test("keeps command discovery parseable through the public CLI", async () => {
		const captured = await captureMain(["commands", "--json"]);
		expect(captured.exitCode).toBe(0);
		expect(captured.stderr).toEqual([]);
		const output = JSON.parse(captured.stdout[0]) as {
			data: { commands: Array<{ name: CommandName }> };
		};
		const names = output.data.commands.map((command) => command.name);
		expect(names).toEqual([
			"commands",
			"doctor",
			"sessions",
			"bookings",
			"book",
			"cancel",
		]);
		const help = await captureMain(["--help"]);
		for (const name of names) {
			expect(parseArgs([name]).command).toBe(name);
			expect(help.stdout[0]).toContain(`bft-booking ${name}`);
		}
	});

	test("blocks a booking retry when post-write verification fails", async () => {
		const captured = await captureMain(
			["book", "--session-id", SESSION.id, "--execute", "--json"],
			{
				listBookings: async () => {
					throw new Error("verification unavailable");
				},
			},
		);
		expect(captured.exitCode).toBe(1);
		const output = JSON.parse(captured.stdout[0]) as {
			changed: boolean;
			retry_safe: boolean;
			error: { category: string };
		};
		expect(output.changed).toBe(true);
		expect(output.retry_safe).toBe(false);
		expect(output.error.category).toBe("uncertain-mutation");
	});

	test("reports a verified cancellation as unsafe to replay", async () => {
		let bookingReads = 0;
		const captured = await captureMain(
			["cancel", "--booking-id", BOOKING.id, "--execute", "--json"],
			{
				listBookings: async () => {
					bookingReads += 1;
					return bookingReads === 1 ? [BOOKING] : [];
				},
			},
		);
		expect(captured.exitCode).toBe(0);
		const output = JSON.parse(captured.stdout[0]) as {
			changed: boolean;
			retry_safe: boolean;
			data: { verified_absent: boolean };
		};
		expect(output.changed).toBe(true);
		expect(output.retry_safe).toBe(false);
		expect(output.data.verified_absent).toBe(true);
	});

	test("keeps booking previews read-only", async () => {
		let createCalls = 0;
		const captured = await captureMain(
			["book", "--session-id", SESSION.id, "--json"],
			{
				createBooking: async () => {
					createCalls += 1;
					return { success: true };
				},
			},
		);
		expect(captured.exitCode).toBe(0);
		expect(createCalls).toBe(0);
		const output = JSON.parse(captured.stdout[0]) as {
			changed: boolean;
			data: { action: string; will_change: boolean };
		};
		expect(output.changed).toBe(false);
		expect(output.data).toEqual(
			expect.objectContaining({ action: "book", will_change: false }),
		);
	});

	test("verifies a completed booking and blocks replay", async () => {
		const captured = await captureMain([
			"book",
			"--session-id",
			SESSION.id,
			"--execute",
			"--json",
		]);
		expect(captured.exitCode).toBe(0);
		const output = JSON.parse(captured.stdout[0]) as {
			changed: boolean;
			retry_safe: boolean;
			data: { verified_in_bookings: boolean };
		};
		expect(output.changed).toBe(true);
		expect(output.retry_safe).toBe(false);
		expect(output.data.verified_in_bookings).toBe(true);
	});

	test("returns machine-readable usage errors with exit code 2", async () => {
		const captured = await captureMain(["sessions", "--surprise", "--json"]);
		expect(captured.exitCode).toBe(2);
		expect(captured.stderr).toEqual([]);
		const output = JSON.parse(captured.stdout[0]) as {
			ok: boolean;
			error: { category: string };
		};
		expect(output.ok).toBe(false);
		expect(output.error.category).toBe("usage");
	});

	test("uses exit code 2 for command-level usage failures", async () => {
		const captured = await captureMain(["book", "--json"]);
		expect(captured.exitCode).toBe(2);
		const output = JSON.parse(captured.stdout[0]) as {
			error: { category: string };
		};
		expect(output.error.category).toBe("usage");
	});

	test("resolves Melbourne tomorrow across the end of daylight saving", async () => {
		const captured = await captureMain(
			["sessions", "--date", "tomorrow", "--json"],
			{
				now: () => new Date("2026-04-04T13:30:00Z"),
			},
		);
		expect(captured.exitCode).toBe(0);
		const output = JSON.parse(captured.stdout[0]) as {
			data: { from: string; to: string };
		};
		expect(output.data).toEqual(
			expect.objectContaining({
				from: "2026-04-06",
				to: "2026-04-07",
			}),
		);
	});
});
