#!/usr/bin/env bun
// Parse Classic Cinemas ticket types and build a selection file for fill-ticket.
//
// Usage:
//   bun run src/parse-tickets.ts --session-id 122890 --spec "1+1"
//
// Spec: positional slots map to Adult, Child, Concession, Senior, Student, Pension.
//   "1+1" → 1 Adult + 1 Child   "2" → 2 Adult   "1+0+1" → 1 Adult + 1 Concession
//
// Side effects: reads/caches /tmp/cc-tickets.json; writes /tmp/cc-tickets-selected.json.
//
// Output (stdout JSON):
//   {"tickets":[{"type":"Adult","qty":1,"price":2700}],"bookingFeeCents":390,
//    "totalCents":4790,"summary":"1x Adult ($27.00) + fees ($3.90) = $47.90",
//    "selectedFile":"/tmp/cc-tickets-selected.json"}
//
// Exit codes:
//   0 — success
//   1 — invalid spec, missing data, or ticket type unavailable
//   64 — invalid usage

import { BASE_URL, CINEMA_ID, readOrFetchJson } from "./cinema-api.ts";

const SLOT_ORDER = ["Adult", "Child", "Concession", "Senior", "Student", "Pension"] as const;
const TICKETS_TMP = "/tmp/cc-tickets.json";
const SELECTED_TMP = "/tmp/cc-tickets-selected.json";

const HELP = `classic-cinema parse-tickets — price a ticket spec, write selection file

Usage:
  bun run src/parse-tickets.ts --session-id 122890 --spec "1+1"

Options:
  --session-id ID   Session id for ticket fetch (required)
  --spec SPEC       Positional ticket spec, e.g. "1+1" (required)
  -h, --help        Show this help

Slots: Adult+Child+Concession+Senior+Student+Pension.
Output: one JSON object on stdout. Diagnostics on stderr.
Exit: 0 ok, 1 unavailable/invalid, 64 invalid usage.`;

interface TicketType {
	name: string;
	categoryId?: number;
	priceInCents: number;
	bookingFeeInCents: number;
}

interface TicketsResponse {
	ticketTypes?: TicketType[];
}

interface SelectedTicket {
	type: string;
	qty: number;
	price: number;
}

function formatPrice(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** Parse "1+1" into [[slotName, qty], ...], dropping zero-qty slots. Exits on bad input. */
function parseSpec(specStr: string): [string, number][] {
	const parts = specStr.trim().split("+");
	const result: [string, number][] = [];
	for (let i = 0; i < parts.length; i++) {
		const raw = parts[i].trim();
		const qty = Number.parseInt(raw, 10);
		if (!/^\d+$/.test(raw) || Number.isNaN(qty)) {
			console.error(`Invalid spec part: '${parts[i]}' — expected a number`);
			process.exit(1);
		}
		if (i >= SLOT_ORDER.length) {
			console.error(`Too many ticket slots (max ${SLOT_ORDER.length})`);
			process.exit(1);
		}
		if (qty > 0) result.push([SLOT_ORDER[i], qty]);
	}
	return result;
}

function parseArgs(argv: string[]): { sessionId: string; spec: string } {
	let sessionId: string | null = null;
	let spec: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--session-id") {
			sessionId = argv[++i] ?? "";
		} else if (arg.startsWith("--session-id=")) {
			sessionId = arg.slice("--session-id=".length);
		} else if (arg === "--spec") {
			spec = argv[++i] ?? "";
		} else if (arg.startsWith("--spec=")) {
			spec = arg.slice("--spec=".length);
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	if (sessionId === null || spec === null) {
		console.error("Missing required --session-id and/or --spec");
		console.error(HELP);
		process.exit(64);
	}
	return { sessionId, spec };
}

async function main(): Promise<void> {
	const { sessionId, spec } = parseArgs(process.argv.slice(2));

	let data: TicketsResponse;
	try {
		data = await readOrFetchJson<TicketsResponse>(
			TICKETS_TMP,
			`${BASE_URL}/sessions/${CINEMA_ID}/${sessionId}/tickets`,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`Failed to fetch tickets: ${msg}`);
		process.exit(1);
	}

	// categoryId 2 = public tickets
	const typeLookup = new Map<string, TicketType>();
	for (const t of data.ticketTypes ?? []) {
		if (t.categoryId === 2) typeLookup.set(t.name, t);
	}

	const selections = parseSpec(spec);
	if (selections.length === 0) {
		console.error("No tickets in spec");
		process.exit(1);
	}

	const tickets: SelectedTicket[] = [];
	let totalCents = 0;
	let totalFeeCents = 0;
	const summaryParts: string[] = [];

	for (const [typeName, qty] of selections) {
		const tt = typeLookup.get(typeName);
		if (!tt) {
			const available = [...typeLookup.keys()].sort();
			console.error(
				`Ticket type '${typeName}' not available for this session. ` +
					`Available types: ${available.length ? available.join(", ") : "(none)"}`,
			);
			process.exit(1);
		}
		tickets.push({ type: typeName, qty, price: tt.priceInCents });
		const lineTotal = tt.priceInCents * qty;
		totalCents += lineTotal;
		totalFeeCents += tt.bookingFeeInCents * qty;
		summaryParts.push(`${qty}x ${typeName} (${formatPrice(lineTotal)})`);
	}

	const grandTotal = totalCents + totalFeeCents;
	summaryParts.push(`fees (${formatPrice(totalFeeCents)})`);
	const summary = `${summaryParts.join(" + ")} = ${formatPrice(grandTotal)}`;

	// Write selection file for fill-ticket (indent 2 matches the v1 format it reads).
	await Bun.write(SELECTED_TMP, `${JSON.stringify(tickets, null, 2)}\n`);

	console.log(
		JSON.stringify({
			tickets,
			bookingFeeCents: totalFeeCents,
			totalCents: grandTotal,
			summary,
			selectedFile: SELECTED_TMP,
		}),
	);
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
