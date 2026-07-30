import { describe, expect, test } from "bun:test";

import {
	createBooking,
	listBookings,
	login,
	normalizeBookings,
	normalizeSessions,
} from "./glofox-client.ts";
import type { AuthSession, Credentials } from "./model.ts";

describe("login", () => {
	test("sends the captured member-login contract and keeps the password out of output", async () => {
		const credentials: Credentials = {
			login: "member@example.test",
			password: "private-password",
			branchId: "branch-1",
			namespace: "bft",
			headers: { "x-glofox-access-token": "private-app-token" },
			device: "ios",
		};
		let requestBody: Record<string, unknown> | undefined;
		const fetcher = (async (
			_input: string | URL | Request,
			init?: RequestInit,
		) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify({ token: "short-lived-token" }), {
				status: 200,
			});
		}) as typeof fetch;
		const auth = await login(credentials, fetcher);
		expect(requestBody).toEqual({
			branch_id: "branch-1",
			device: "ios",
			login: "member@example.test",
			namespace: "bft",
			password: "private-password",
		});
		expect(JSON.stringify(auth)).not.toContain("private-password");
	});
});

describe("normalizeSessions", () => {
	test("calculates capacity and waitlist state", () => {
		const sessions = normalizeSessions({
			data: [
				{
					id: "session-1",
					name: "Strength",
					start_date: "2026-07-31T06:15:00+10:00",
					capacity: 48,
					booked_count: 48,
					waiting_list_count: 3,
					waiting_list_available: true,
				},
			],
		});
		expect(sessions).toEqual([
			expect.objectContaining({
				id: "session-1",
				available: 0,
				full: true,
				waitlist_count: 3,
				waitlist_available: true,
			}),
		]);
	});
});

describe("normalizeBookings", () => {
	test("reads nested event details", () => {
		const bookings = normalizeBookings({
			bookings: [
				{
					id: "booking-1",
					model_id: "session-1",
					status: "booked",
					event: {
						id: "session-1",
						name: "Cardio",
						start_date: "2026-08-01T07:15:00+10:00",
					},
				},
			],
		});
		expect(bookings[0]).toEqual(
			expect.objectContaining({
				id: "booking-1",
				session_id: "session-1",
				name: "Cardio",
			}),
		);
	});
});

describe("createBooking", () => {
	test("sends the captured waitlist payload shape", async () => {
		const auth: AuthSession = {
			token: "secret-token",
			branchId: "branch-1",
			namespace: "namespace",
			headers: { "x-glofox-access-token": "app-token" },
		};
		let requestBody: unknown;
		const fetcher = (async (
			_input: string | URL | Request,
			init?: RequestInit,
		) => {
			requestBody = JSON.parse(String(init?.body));
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer secret-token");
			expect(headers.get("x-glofox-branch-id")).toBe("branch-1");
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as typeof fetch;
		await createBooking(auth, "session-1", true, fetcher);
		expect(requestBody).toEqual({
			guest_bookings: [],
			join_waiting_list: true,
			model: "event",
			model_id: "session-1",
			pay_gym: false,
			payment_method: null,
		});
	});
});

describe("legacy response errors", () => {
	test("treats HTTP 200 with success false as a failure", async () => {
		const auth: AuthSession = {
			token: "secret-token",
			branchId: "branch-1",
			namespace: "namespace",
			headers: { "x-glofox-access-token": "app-token" },
		};
		const fetcher = (async () =>
			new Response(JSON.stringify({ success: false }), {
				status: 200,
			})) as unknown as typeof fetch;
		await expect(listBookings(auth, fetcher)).rejects.toThrow(
			"Glofox rejected the request",
		);
	});

	test("marks server failures after a mutation as uncertain", async () => {
		const auth: AuthSession = {
			token: "secret-token",
			branchId: "branch-1",
			namespace: "namespace",
			headers: { "x-glofox-access-token": "app-token" },
		};
		const fetcher = (async () =>
			new Response(JSON.stringify({ success: false }), {
				status: 500,
			})) as unknown as typeof fetch;

		try {
			await createBooking(auth, "session-1", false, fetcher);
			throw new Error("Expected createBooking to fail.");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect(
				(error as { mutationMayHaveChangedState?: boolean })
					.mutationMayHaveChangedState,
			).toBe(true);
		}
	});
});
