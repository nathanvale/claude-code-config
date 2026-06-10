// Classic Cinemas Elsternwick API client + shared types.
// Owner for: base URL, cinema id, AEST time formatting, tmp cache paths, JSON fetch.
// Exact API response shapes are owned upstream by classiccinemas.com.au; the
// fields read here are the contract this skill depends on.

export const CINEMA_ID = "0000000002";
export const BASE_URL = "https://www.classiccinemas.com.au/api";

// Elsternwick is Melbourne. The upstream feed stamps session datetimes as AEST
// wall-clock with no timezone offset (e.g. "2026-06-10T19:00:00" means 7:00pm
// local). formatTime reads those wall-clock fields directly — no timezone math —
// to avoid double-converting on a machine that is itself in AEST.
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;

export interface RawSession {
	id: number;
	movieId?: string;
	date: string;
	screenName?: string;
	screenNumber?: number;
}

export interface RawMovie {
	vistaId?: string;
	name: string;
	rating?: { id?: string };
	runtime?: unknown;
	trailer?: string;
	summary?: string;
	headerImage?: string;
	posterImage?: string;
}

export interface MovieSession {
	id: number;
	time: string;
	screen: string;
	screenNumber: number;
	date: string;
}

export interface MovieEntry {
	name: string;
	vistaId: string;
	rating: string;
	runtime: unknown;
	trailer: string | null;
	summary: string;
	headerImage: string;
	posterImage: string;
	sessions: MovieSession[];
	index?: number;
}

/** Fetch JSON from a URL, optionally caching the raw bytes to a tmp path. */
export async function fetchJson<T>(url: string, destPath?: string): Promise<T> {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`GET ${url} failed: ${resp.status} ${resp.statusText}`);
	}
	const text = await resp.text();
	if (destPath) {
		await Bun.write(destPath, text);
	}
	return JSON.parse(text) as T;
}

/**
 * Read a cached JSON file from a tmp path, fetching from `url` and caching it
 * first if the file does not exist. Mirrors the v1 "auto-fetch if missing"
 * behaviour shared by check-availability and parse-tickets.
 */
export async function readOrFetchJson<T>(path: string, url: string): Promise<T> {
	const file = Bun.file(path);
	if (await file.exists()) {
		return JSON.parse(await file.text()) as T;
	}
	return fetchJson<T>(url, path);
}

// --- Seatmap shapes (Classic Cinemas seating-map endpoint) ---

export interface Seat {
	name?: string;
	typeId?: string;
	sold?: boolean;
	unavailable?: boolean;
}

export interface SeatRow {
	name?: string;
	seats?: Seat[];
}

export interface SeatmapResponse {
	areas?: { name?: string }[];
	rows?: SeatRow[];
}

export function seatmapTmpPath(sessionId: string | number): string {
	return `/tmp/cc-seatmap-${sessionId}.json`;
}

export function seatmapUrl(sessionId: string | number): string {
	return `${BASE_URL}/sessions/${CINEMA_ID}/${sessionId}/seating-map`;
}

/** Format an AEST wall-clock ISO datetime to lowercase clock time, e.g. "7:00pm". */
export function formatTime(isoStr: string): string {
	// Read the wall-clock H:M directly from the string. The feed has no offset and
	// the values already mean AEST local time, so any Date/UTC conversion would
	// shift them. Tolerate a trailing "Z" or "+hh:mm" by splitting on T then time.
	const timePart = isoStr.split("T")[1] ?? "";
	const [hStr = "0", mStr = "0"] = timePart.split(":");
	let hours = Number.parseInt(hStr, 10);
	const minutes = Number.parseInt(mStr, 10);
	const ampm = hours >= 12 ? "pm" : "am";
	hours = hours % 12;
	if (hours === 0) hours = 12;
	const mm = minutes.toString().padStart(2, "0");
	return `${hours}:${mm}${ampm}`;
}

/** Today's date (YYYY-MM-DD) in AEST. */
export function todayAest(): string {
	const now = new Date();
	const local = new Date(now.getTime() + AEST_OFFSET_MS);
	return local.toISOString().slice(0, 10);
}
