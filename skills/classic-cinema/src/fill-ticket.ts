#!/usr/bin/env bun
// Fill the FROZEN Classic Cinemas ticket email template with booking data.
//
// The template at references/assets/ticket-template.html is frozen — this script
// only substitutes its 13 {{PLACEHOLDER}} tokens; it never edits the template.
//
// Usage:
//   bun run src/fill-ticket.ts \
//     --movie-title "Princess Mononoke (1997)" \
//     --session-datetime "2026-06-10T19:00:00" \
//     --screen "Screen 1" --seats "R8, R9" \
//     --tickets-file /tmp/cc-tickets-selected.json \
//     --booking-fee 390 --total 5690 \
//     --poster-url "movies/headers/..." [--runtime 134] [--customer-name Nathan]
//
// Tickets file: [{"type":"Adult","qty":1,"price":2700}] (prices in cents).
// Output: path to the filled HTML file on stdout. Diagnostics on stderr.
//
// Exit codes: 0 ok, 1 runtime failure (bad datetime, missing file), 64 invalid usage.

import { dirname, join } from "node:path";

export const CDN_BASE = "https://movingstory-prod.imgix.net/";

// "Fri 10 Apr, 11:00AM" with an optional "-end" time.
const SESSION_DT_PATTERN =
	/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2}[AP]M(-\d{1,2}:\d{2}[AP]M)?$/;

const BARCODE_URL =
	"https://ci3.googleusercontent.com/meips/ADKq_NaPR1UO0ABCDdjEmZOs7Nnk" +
	"HZe3ZB9YpKHGLyNCZXD0FH7h5UZJtQMgCD1Mn6jiareUCWODOHBZEfc1cWLPEXox" +
	"FYlSTfxxbYlc9PY9F8A=s0-d-e1-ft#https://www.classiccinemas.com.au" +
	"/api/barcode/WHRT69C.jpg";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

const HELP = `classic-cinema fill-ticket — substitute booking data into the frozen template

Usage:
  bun run src/fill-ticket.ts --movie-title T --session-datetime D --screen S \\
    --seats SEATS --tickets-file PATH --booking-fee CENTS --total CENTS \\
    --poster-url URL [--runtime MIN] [--customer-name NAME]

Output: path to /tmp/classic-cinema-ticket-<ts>.html on stdout.
Exit: 0 ok, 1 runtime failure, 64 invalid usage.`;

interface SelectedTicket {
	type: string;
	qty: number;
	price: number;
}

/** Match Python html.escape(quote=True): & < > " '. */
export function htmlEscape(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

/** Prepend the CDN base unless the URL is already absolute. Notes to stderr when resolving. */
export function resolvePosterUrl(rawUrl: string): string {
	if (rawUrl.startsWith("http")) return rawUrl;
	const resolved = `${CDN_BASE}${rawUrl}`;
	console.error(`[fill-ticket] image URL was relative, resolved to: ${resolved}`);
	return resolved;
}

export function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** ADULT -> "Adult Ticket" (Python str.capitalize: first upper, rest lower). */
export function formatTicketType(name: string): string {
	const t = name.trim();
	const cap = t.length ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t;
	return `${cap} Ticket`;
}

// strftime-equivalent helpers reading wall-clock fields (no timezone math).
function clock12(hours: number, minutes: number): string {
	const ampm = hours >= 12 ? "PM" : "AM";
	let h = hours % 12;
	if (h === 0) h = 12;
	return `${h}:${minutes.toString().padStart(2, "0")}${ampm}`;
}

/**
 * Format to "Fri 10 Apr, 11:00AM". Accepts ISO (with optional offset) or an
 * already-formatted string (passthrough). Appends an end time when runtimeMinutes
 * > 0. Throws when the result doesn't match the expected email pattern.
 */
export function formatSessionDatetime(rawDt: string, runtimeMinutes = 0): string {
	let formatted: string;
	// ISO if it looks like YYYY-MM-DD[THH:MM...]; read wall-clock fields directly
	// so a trailing offset like +10:00 does not shift the displayed time.
	const isoMatch = rawDt.match(
		/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/,
	);
	if (isoMatch) {
		const [, y, mo, d, hh = "0", mm = "0"] = isoMatch;
		const year = Number(y);
		const month = Number(mo);
		const day = Number(d);
		const hours = Number(hh);
		const minutes = Number(mm);
		// Weekday via UTC Date (date-only math, no tz display impact).
		const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
		const datePart = `${weekday} ${day} ${MONTHS[month - 1]}`;
		const startTime = clock12(hours, minutes);
		if (runtimeMinutes > 0) {
			const endTotal = hours * 60 + minutes + runtimeMinutes;
			const endTime = clock12(Math.floor((endTotal % 1440) / 60), endTotal % 60);
			formatted = `${datePart}, ${startTime}-${endTime}`;
		} else {
			formatted = `${datePart}, ${startTime}`;
		}
	} else {
		formatted = rawDt;
	}

	if (!SESSION_DT_PATTERN.test(formatted)) {
		throw new Error(
			`Session datetime '${formatted}' (from input '${rawDt}') ` +
				"doesn't match expected pattern 'Fri 10 Apr, 11:00AM'",
		);
	}
	return formatted;
}

export function buildTicketLines(tickets: SelectedTicket[]): string {
	return tickets
		.map((t) => {
			const ttype = htmlEscape(formatTicketType(t.type));
			const qty = t.qty;
			return (
				'                                                                <tr>\n' +
				'                                                                    <td\n' +
				'                                                                            style="font-family: antwerp, sans-serif; font-size: 16px; line-height: 24px; color: #000000;">\n' +
				`                                                                    <span class="outlook-body-font">${ttype} x ${qty}</span>\n` +
				'                                                                    </td>\n' +
				"                                                                </tr>"
			);
		})
		.join("\n");
}

export function buildInvoiceLines(tickets: SelectedTicket[]): string {
	return tickets
		.map((t) => {
			const desc = htmlEscape(`${formatTicketType(t.type)} x ${t.qty}`);
			const price = htmlEscape(formatPrice(t.price * t.qty));
			return (
				"                    <tr>\n" +
				"                        <td\n" +
				'                                style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141;">\n' +
				`                            <span class="outlook-body-font">${desc}</span>\n` +
				"                        </td>\n" +
				'                        <td style="font-family: antwerp, sans-serif; font-size: 14px; line-height: 14px; color: #414141; text-align: right;">\n' +
				`                            <span class="outlook-body-font">${price}</span>\n` +
				"                        </td>\n" +
				"                    </tr>\n" +
				'                    <tr class="no-print">\n' +
				'                        <td colspan="2" style="font-size: 0; padding-top: 2px; padding-bottom: 2px;">\n' +
				'                            <p style="width: 100%; border-top: dashed 1px #000000; font-size: 1;">\n' +
				"                                &nbsp;</p>\n" +
				"                        </td>\n" +
				"                    </tr>"
			);
		})
		.join("\n");
}

interface FillArgs {
	movieTitle: string;
	sessionDatetime: string;
	screen: string;
	seats: string;
	ticketsFile: string;
	bookingFee: number;
	total: number;
	posterUrl: string;
	runtime: number;
	customerName: string;
}

function parseArgs(argv: string[]): FillArgs {
	const v: Partial<FillArgs> = { runtime: 0, customerName: "Nathan" };
	const takeNum = (raw: string, flag: string): number => {
		const n = Number.parseInt(raw, 10);
		if (Number.isNaN(n)) {
			console.error(`${flag} expects an integer, got '${raw}'`);
			process.exit(64);
		}
		return n;
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = (): string => argv[++i] ?? "";
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--movie-title") v.movieTitle = next();
		else if (arg === "--session-datetime") v.sessionDatetime = next();
		else if (arg === "--screen") v.screen = next();
		else if (arg === "--seats") v.seats = next();
		else if (arg === "--tickets-file") v.ticketsFile = next();
		else if (arg === "--booking-fee") v.bookingFee = takeNum(next(), "--booking-fee");
		else if (arg === "--total") v.total = takeNum(next(), "--total");
		else if (arg === "--poster-url") v.posterUrl = next();
		else if (arg === "--runtime") v.runtime = takeNum(next(), "--runtime");
		else if (arg === "--customer-name") v.customerName = next();
		else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	const required: (keyof FillArgs)[] = [
		"movieTitle",
		"sessionDatetime",
		"screen",
		"seats",
		"ticketsFile",
		"bookingFee",
		"total",
		"posterUrl",
	];
	const missing = required.filter((k) => v[k] === undefined);
	if (missing.length) {
		console.error(`Missing required: ${missing.join(", ")}`);
		console.error(HELP);
		process.exit(64);
	}
	return v as FillArgs;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const tickets = JSON.parse(await Bun.file(args.ticketsFile).text()) as SelectedTicket[];

	// Template lives one level up from src/.
	const here = dirname(Bun.fileURLToPath(import.meta.url));
	const templatePath = join(here, "..", "references", "assets", "ticket-template.html");
	const tpl = await Bun.file(templatePath).text();

	const ticketLines = buildTicketLines(tickets);
	const invoiceLines = buildInvoiceLines(tickets);
	const sessionDt = formatSessionDatetime(args.sessionDatetime, args.runtime);
	const posterUrl = resolvePosterUrl(args.posterUrl);

	// Replace each placeholder once. Text fields are escaped; URLs and the
	// pre-built ticket/invoice blocks are inserted verbatim (matches v1).
	const subs: [string, string][] = [
		["{{CUSTOMER_NAME}}", htmlEscape(args.customerName)],
		["{{MOVIE_TITLE}}", htmlEscape(args.movieTitle)],
		["{{MOVIE_IMAGE_URL}}", posterUrl],
		["{{SESSION_DATE_TIME}}", htmlEscape(sessionDt)],
		["{{SCREEN_NUMBER}}", htmlEscape(args.screen)],
		["{{SEATS}}", htmlEscape(args.seats)],
		["{{BARCODE_URL}}", BARCODE_URL],
		["{{WEB_VIEW_URL}}", "#"],
		["{{BOOKING_NUMBER}}", htmlEscape("N/A")],
		["{{BOOKING_FEE}}", htmlEscape(formatPrice(args.bookingFee))],
		["{{TOTAL_AMOUNT}}", htmlEscape(formatPrice(args.total))],
		["{{TICKET_LINES}}", ticketLines],
		["{{INVOICE_LINES}}", invoiceLines],
	];
	// replaceAll, not replace: MOVIE_TITLE appears 3x and WEB_VIEW_URL 2x in the
	// template; Python str.replace substituted every occurrence.
	let result = tpl;
	for (const [token, value] of subs) {
		result = result.replaceAll(token, value);
	}

	const ts = Math.floor(Date.now() / 1000);
	const outPath = `/tmp/classic-cinema-ticket-${ts}.html`;
	await Bun.write(outPath, result);
	console.log(outPath);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
