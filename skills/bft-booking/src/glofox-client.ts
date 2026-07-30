import type {
	AuthSession,
	Booking,
	Credentials,
	Session,
} from "./model.ts";

const AUTH_URL = "https://auth.glofox.com/login?as=member";
const API_URL = "https://api.glofox.com/2.0";

/** Error raised for a known HTTP or response-contract failure. */
export class GlofoxError extends Error {
	readonly status?: number;
	readonly mutationMayHaveChangedState: boolean;

	constructor(
		message: string,
		options: { status?: number; mutationMayHaveChangedState?: boolean } = {},
	) {
		super(message);
		this.status = options.status;
		this.mutationMayHaveChangedState =
			options.mutationMayHaveChangedState ?? false;
	}
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function textValue(
	value: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim()) return candidate;
	}
	return undefined;
}

function numberValue(
	value: Record<string, unknown>,
	keys: string[],
): number | undefined {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return candidate;
		}
		if (typeof candidate === "string" && candidate.trim()) {
			const parsed = Number(candidate);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}

function booleanValue(
	value: Record<string, unknown>,
	keys: string[],
): boolean | undefined {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "boolean") return candidate;
		if (candidate === 1 || candidate === "1" || candidate === "true") return true;
		if (candidate === 0 || candidate === "0" || candidate === "false")
			return false;
	}
	return undefined;
}

function objectCandidates(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value.flatMap(objectCandidates);
	}
	const object = record(value);
	if (!object) return [];
	const directId = textValue(object, ["id", "_id", "uuid"]);
	const directDate = textValue(object, [
		"start_at",
		"starts_at",
		"start_date",
		"startDate",
		"start_time",
		"date",
	]);
	const current = directId && directDate ? [object] : [];
	return [
		...current,
		...Object.values(object).flatMap((child) => objectCandidates(child)),
	];
}

function allRecords(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.flatMap(allRecords);
	const object = record(value);
	if (!object) return [];
	return [object, ...Object.values(object).flatMap(allRecords)];
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new GlofoxError(`Glofox returned non-JSON HTTP ${response.status}.`, {
			status: response.status,
		});
	}
}

function authHeaders(auth: AuthSession): Headers {
	const headers = new Headers(auth.headers);
	headers.set("authorization", `Bearer ${auth.token}`);
	headers.set("accept", "application/json");
	headers.set("content-type", "application/json");
	if (!headers.has("x-glofox-namespace")) {
		headers.set("x-glofox-namespace", auth.namespace);
	}
	if (!headers.has("x-glofox-branch-id")) {
		headers.set("x-glofox-branch-id", auth.branchId);
	}
	return headers;
}

/**
 * Exchange 1Password-backed member credentials for a short-lived API token.
 *
 * @param credentials - In-memory login material
 * @param fetcher - Fetch implementation used for live calls or tests
 * @returns Authenticated session without the password
 * @throws {GlofoxError} When authentication or response parsing fails
 *
 * @example
 * ```ts
 * const auth = await login(credentials)
 * ```
 */
export async function login(
	credentials: Credentials,
	fetcher: typeof fetch = fetch,
): Promise<AuthSession> {
	let response: Response;
	try {
		response = await fetcher(AUTH_URL, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...credentials.headers,
			},
			body: JSON.stringify({
				branch_id: credentials.branchId,
				device: credentials.device,
				login: credentials.login,
				namespace: credentials.namespace,
				password: credentials.password,
			}),
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new GlofoxError("Could not reach Glofox authentication.");
	}
	const body = record(await readJson(response));
	const token = body ? textValue(body, ["token", "access_token"]) : undefined;
	if (!response.ok || !token) {
		throw new GlofoxError(
			`Glofox authentication failed with HTTP ${response.status}.`,
			{ status: response.status },
		);
	}
	return {
		token,
		branchId: credentials.branchId,
		namespace: credentials.namespace,
		headers: credentials.headers,
	};
}

/** Normalize a Glofox timetable payload for stable CLI output. */
export function normalizeSessions(payload: unknown): Session[] {
	const seen = new Set<string>();
	return objectCandidates(payload)
		.map((value): Session | undefined => {
			const id = textValue(value, ["id", "_id", "uuid"]);
			const startAt = textValue(value, [
				"start_at",
				"starts_at",
				"start_date",
				"startDate",
				"start_time",
				"date",
			]);
			if (!id || !startAt || seen.has(id)) return undefined;
			seen.add(id);
			const capacity = numberValue(value, [
				"capacity",
				"max_capacity",
				"maxCapacity",
				"spaces",
			]);
			const booked = numberValue(value, [
				"booked",
				"booked_count",
				"bookings_count",
				"attendees_count",
			]);
			const available =
				numberValue(value, [
					"available",
					"available_spaces",
					"spaces_available",
				]) ??
				(capacity !== undefined && booked !== undefined
					? Math.max(0, capacity - booked)
					: undefined);
			const explicitFull = booleanValue(value, ["full", "is_full"]);
			return {
				id,
				name:
					textValue(value, ["name", "title", "class_name", "event_name"]) ??
					"Class",
				start_at: startAt,
				end_at: textValue(value, ["end_at", "ends_at", "end_date", "endDate"]),
				trainer: textValue(value, [
					"trainer",
					"trainer_name",
					"instructor",
					"instructor_name",
				]),
				capacity,
				booked,
				available,
				waitlist_count: numberValue(value, [
					"waitlist_count",
					"waiting_list_count",
				]),
				waitlist_available: booleanValue(value, [
					"waitlist_available",
					"waiting_list_available",
					"allow_waitlist",
				]),
				full:
					explicitFull ??
					(available !== undefined
						? available === 0
						: capacity !== undefined &&
							booked !== undefined &&
							booked >= capacity),
			};
		})
		.filter((session): session is Session => Boolean(session))
		.sort((left, right) => left.start_at.localeCompare(right.start_at));
}

/** Normalize a Glofox bookings payload for stable CLI output. */
export function normalizeBookings(payload: unknown): Booking[] {
	const seen = new Set<string>();
	return allRecords(payload)
		.map((value): Booking | undefined => {
			const id = textValue(value, ["booking_id", "id", "_id", "uuid"]);
			const event =
				record(value.event) ?? record(value.session) ?? record(value.model);
			const looksLikeBooking =
				"booking_id" in value ||
				"model_id" in value ||
				"booking_status" in value ||
				"waitlisted" in value ||
				Boolean(event);
			if (!id || !looksLikeBooking || seen.has(id)) return undefined;
			seen.add(id);
			return {
				id,
				session_id:
					textValue(value, ["model_id", "session_id", "event_id"]) ??
					(event ? textValue(event, ["id", "_id", "uuid"]) : undefined),
				name:
					textValue(value, ["name", "title", "event_name"]) ??
					(event
						? textValue(event, ["name", "title", "event_name"])
						: undefined) ??
					"Class",
				start_at:
					textValue(value, ["start_at", "starts_at", "start_date"]) ??
					(event
						? textValue(event, [
								"start_at",
								"starts_at",
								"start_date",
								"startDate",
							])
						: undefined),
				status: textValue(value, ["status", "booking_status"]),
				waitlisted:
					booleanValue(value, ["waitlisted", "on_waitlist", "waiting_list"]) ??
					false,
			};
		})
		.filter((booking): booking is Booking => Boolean(booking))
		.sort((left, right) =>
			(left.start_at ?? "").localeCompare(right.start_at ?? ""),
		);
}

async function apiRequest(
	auth: AuthSession,
	path: string,
	options: RequestInit,
	fetcher: typeof fetch,
	mutation: boolean,
): Promise<unknown> {
	let response: Response;
	try {
		response = await fetcher(`${API_URL}${path}`, {
			...options,
			headers: authHeaders(auth),
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new GlofoxError("The Glofox request did not complete.", {
			mutationMayHaveChangedState: mutation,
		});
	}
	let body: unknown;
	try {
		body = await readJson(response);
	} catch (error) {
		if (
			error instanceof GlofoxError &&
			mutation &&
			(response.ok || response.status >= 500)
		) {
			throw new GlofoxError(error.message, {
				status: error.status,
				mutationMayHaveChangedState: true,
			});
		}
		throw error;
	}
	const bodyRecord = record(body);
	if (!response.ok) {
		throw new GlofoxError(`Glofox returned HTTP ${response.status}.`, {
			status: response.status,
			mutationMayHaveChangedState: mutation && response.status >= 500,
		});
	}
	if (bodyRecord?.success === false) {
		throw new GlofoxError("Glofox rejected the request.", {
			status: 400,
			mutationMayHaveChangedState: false,
		});
	}
	return body;
}

/** Fetch sessions for a local calendar range. */
export async function listSessions(
	auth: AuthSession,
	from: string,
	to: string,
	fetcher: typeof fetch = fetch,
): Promise<Session[]> {
	const query = new URLSearchParams({ from, to });
	const payload = await apiRequest(
		auth,
		`/branches/${encodeURIComponent(auth.branchId)}/events/?${query}`,
		{ method: "GET" },
		fetcher,
		false,
	);
	return normalizeSessions(payload);
}

/** Fetch the member's current bookings. */
export async function listBookings(
	auth: AuthSession,
	fetcher: typeof fetch = fetch,
): Promise<Booking[]> {
	const payload = await apiRequest(
		auth,
		"/bookings",
		{ method: "GET" },
		fetcher,
		false,
	);
	return normalizeBookings(payload);
}

/** Create one booking or waiting-list entry. */
export async function createBooking(
	auth: AuthSession,
	sessionId: string,
	joinWaitlist: boolean,
	fetcher: typeof fetch = fetch,
): Promise<unknown> {
	return apiRequest(
		auth,
		"/bookings",
		{
			method: "POST",
			body: JSON.stringify({
				guest_bookings: [],
				join_waiting_list: joinWaitlist,
				model: "event",
				model_id: sessionId,
				pay_gym: false,
				payment_method: null,
			}),
		},
		fetcher,
		true,
	);
}

/** Cancel one booking by its exact booking identifier. */
export async function cancelBooking(
	auth: AuthSession,
	bookingId: string,
	fetcher: typeof fetch = fetch,
): Promise<unknown> {
	return apiRequest(
		auth,
		`/bookings/${encodeURIComponent(bookingId)}`,
		{ method: "DELETE" },
		fetcher,
		true,
	);
}
