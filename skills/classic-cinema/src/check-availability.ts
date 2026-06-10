#!/usr/bin/env bun
// Calculate seat availability from Classic Cinemas seatmap JSON.
//
// Usage:
//   bun run src/check-availability.ts --session-ids 122899,122893,122898
//
// Auto-fetches each seatmap from the API if /tmp/cc-seatmap-{sid}.json is missing.
//
// Output (one JSON object per line, stdout):
//   {"screen":"Screen 10","available":78,"total":80,"pct":98,"sid":122899}
//
// Exit codes:
//   0 — at least one session processed
//   1 — no session ids / no seatmaps could be processed
//   64 — invalid usage

import {
	fetchJson,
	type SeatmapResponse,
	seatmapTmpPath,
	seatmapUrl,
} from "./cinema-api.ts";

const HELP = `classic-cinema check-availability — seat availability per session

Usage:
  bun run src/check-availability.ts --session-ids 122899,122893,122898

Options:
  --session-ids LIST   Comma-separated session ids (required)
  -h, --help           Show this help

Output: one JSON object per line on stdout. Diagnostics on stderr.
Exit: 0 ok, 1 none processed, 64 invalid usage.`;

interface Availability {
	screen: string;
	available: number;
	total: number;
	pct: number;
}

/** Count available and total (non-gap) seats from a seatmap response. */
export function calcAvailability(seatmap: SeatmapResponse): Availability {
	const screen = seatmap.areas?.[0]?.name ?? "";
	let total = 0;
	let unavail = 0;
	for (const row of seatmap.rows ?? []) {
		for (const seat of row.seats ?? []) {
			if (seat.typeId === "gap") continue;
			total += 1;
			if (seat.sold || seat.unavailable) unavail += 1;
		}
	}
	const available = total - unavail;
	const pct = total ? Math.round((available / total) * 100) : 0;
	return { screen, available, total, pct };
}

function parseArgs(argv: string[]): { sessionIds: string } {
	let sessionIds: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--session-ids") {
			sessionIds = argv[++i] ?? "";
		} else if (arg.startsWith("--session-ids=")) {
			sessionIds = arg.slice("--session-ids=".length);
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	if (sessionIds === null) {
		console.error("Missing required --session-ids");
		console.error(HELP);
		process.exit(64);
	}
	return { sessionIds };
}

async function main(): Promise<void> {
	const { sessionIds } = parseArgs(process.argv.slice(2));

	const sids = sessionIds
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	if (sids.length === 0) {
		console.error("No session IDs provided");
		process.exit(1);
	}

	let processed = 0;
	for (const sid of sids) {
		const path = seatmapTmpPath(sid);
		let seatmap: SeatmapResponse;
		try {
			const file = Bun.file(path);
			seatmap = (await file.exists())
				? (JSON.parse(await file.text()) as SeatmapResponse)
				: await fetchJson<SeatmapResponse>(seatmapUrl(sid), path);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`Failed to load seatmap for session ${sid}: ${msg}`);
			continue;
		}

		const result = calcAvailability(seatmap);
		console.log(JSON.stringify({ ...result, sid: Number.parseInt(sid, 10) }));
		processed += 1;
	}

	if (processed === 0) {
		console.error("No seatmap files could be processed");
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
