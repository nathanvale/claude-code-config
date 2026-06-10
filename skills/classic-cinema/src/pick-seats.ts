#!/usr/bin/env bun
// Auto-select the best adjacent seats in a cinema zone.
//
// Usage:
//   bun run src/pick-seats.ts --seatmap-file /tmp/cc-seatmap-122004.json --zone back --count 2
//
// Zones are computed from the seating map rows (split into thirds). Seats are
// scored by proximity to the horizontal centre of the row; rows nearest the
// zone centre are tried first. Falls back to adjacent zones if the requested
// zone has no run.
//
// Output: comma-joined seat codes on stdout (e.g. "R8, R9").
//         A stderr note when the zone was expanded.
//
// Exit codes:
//   0 — seats found
//   1 — empty/invalid seatmap, or no adjacent run in any zone
//   64 — invalid usage

import { type SeatRow, type Seat } from "./cinema-api.ts";

const ZONES = ["front", "middle", "back", "surprise"] as const;
type Zone = (typeof ZONES)[number];

const HELP = `classic-cinema pick-seats — best adjacent seats in a zone

Usage:
  bun run src/pick-seats.ts --seatmap-file PATH --zone ZONE --count N

Options:
  --seatmap-file PATH   Path to a seating map JSON file (required)
  --zone ZONE           front | middle | back | surprise (required)
  --count N             Number of adjacent seats (required)
  -h, --help            Show this help

Output: comma-joined seat codes on stdout. Expansion note on stderr.
Exit: 0 found, 1 none/invalid map, 64 invalid usage.`;

type IndexedSeat = [number, string];

async function loadSeatmap(path: string): Promise<SeatRow[]> {
	const file = Bun.file(path);
	const parsed = JSON.parse(await file.text()) as SeatRow[] | { rows?: SeatRow[] };
	return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
}

/** Rows with at least one real (non-gap) seat and a non-blank name. */
function getValidRows(rows: SeatRow[]): SeatRow[] {
	return rows.filter((row) => {
		const seats = row.seats ?? [];
		const hasReal = seats.some((s) => {
			const t = s.typeId ?? "";
			return t !== "gap" && t !== "";
		});
		return hasReal && (row.name ?? "").trim().length > 0;
	});
}

/** Split rows into Front / Middle / Back thirds (matches v1 boundaries). */
function splitZones(rows: SeatRow[]): { front: SeatRow[]; middle: SeatRow[]; back: SeatRow[] } {
	const n = rows.length;
	if (n === 0) return { front: [], middle: [], back: [] };
	const third = Math.max(1, Math.floor(n / 3));
	const front = rows.slice(0, third);
	const back = rows.slice(n - third);
	let middle = n > 2 ? rows.slice(third, n - third) : rows;
	if (middle.length === 0) middle = rows;
	return { front, middle, back };
}

/** Available standard seats as [index, name]; excludes gaps, accessible, sold. */
function availableSeats(row: SeatRow): IndexedSeat[] {
	const result: IndexedSeat[] = [];
	const seats = row.seats ?? [];
	seats.forEach((seat: Seat, i: number) => {
		const typeId = seat.typeId ?? "standard";
		if (typeId === "gap" || typeId === "wheelchair" || typeId === "companion") return;
		if (seat.sold || seat.unavailable) return;
		result.push([i, seat.name ?? `${row.name}${i + 1}`]);
	});
	return result;
}

/** All contiguous runs of `count` seats (consecutive seat-list indices). */
function findAdjacentRuns(seats: IndexedSeat[], count: number): IndexedSeat[][] {
	if (seats.length < count) return [];
	const runs: IndexedSeat[][] = [];
	for (let start = 0; start <= seats.length - count; start++) {
		const run = seats.slice(start, start + count);
		const consecutive = run.every(
			(s, j) => j === 0 || s[0] - run[j - 1][0] === 1,
		);
		if (consecutive) runs.push(run);
	}
	return runs;
}

/** Distance of a run's average index from row centre. Lower is better. */
function scoreRun(run: IndexedSeat[], rowTotalSeats: number): number {
	const center = (rowTotalSeats - 1) / 2;
	const avgIdx = run.reduce((sum, s) => sum + s[0], 0) / run.length;
	return Math.abs(avgIdx - center);
}

const ZONE_EXPANSION: Record<Zone, Zone[]> = {
	front: ["front", "middle", "back"],
	middle: ["middle", "front", "back"],
	back: ["back", "middle", "front"],
	surprise: ["middle", "front", "back"],
};

export function pickSeats(
	rows: SeatRow[],
	zoneName: Zone,
	count: number,
): { codes: string[]; zoneUsed: Zone } | null {
	const validRows = getValidRows(rows);
	const { front, middle, back } = splitZones(validRows);
	const zoneMap: Record<Zone, SeatRow[]> = {
		front,
		middle,
		back,
		surprise: middle,
	};

	for (const tryZone of ZONE_EXPANSION[zoneName] ?? ["middle", "front", "back"]) {
		const zoneRows = zoneMap[tryZone] ?? middle;
		if (zoneRows.length === 0) continue;

		// Prefer rows nearest the centre of the zone.
		const zoneCenter = (zoneRows.length - 1) / 2;
		const sortedRows = zoneRows
			.map((row, idx) => ({ row, idx }))
			.sort((a, b) => Math.abs(a.idx - zoneCenter) - Math.abs(b.idx - zoneCenter));

		let bestRun: IndexedSeat[] | null = null;
		let bestScore = Number.POSITIVE_INFINITY;

		for (const { row } of sortedRows) {
			const seats = availableSeats(row);
			const totalSeats = (row.seats ?? []).length;
			for (const run of findAdjacentRuns(seats, count)) {
				const s = scoreRun(run, totalSeats);
				if (s < bestScore) {
					bestScore = s;
					bestRun = run;
				}
			}
		}

		if (bestRun) {
			return { codes: bestRun.map((s) => s[1]), zoneUsed: tryZone };
		}
	}

	return null;
}

function parseArgs(argv: string[]): { seatmapFile: string; zone: Zone; count: number } {
	let seatmapFile: string | null = null;
	let zone: string | null = null;
	let count: number | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--seatmap-file") {
			seatmapFile = argv[++i] ?? "";
		} else if (arg.startsWith("--seatmap-file=")) {
			seatmapFile = arg.slice("--seatmap-file=".length);
		} else if (arg === "--zone") {
			zone = argv[++i] ?? "";
		} else if (arg.startsWith("--zone=")) {
			zone = arg.slice("--zone=".length);
		} else if (arg === "--count") {
			count = Number.parseInt(argv[++i] ?? "", 10);
		} else if (arg.startsWith("--count=")) {
			count = Number.parseInt(arg.slice("--count=".length), 10);
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	if (seatmapFile === null || zone === null || count === null || Number.isNaN(count)) {
		console.error("Missing/invalid required --seatmap-file, --zone, --count");
		console.error(HELP);
		process.exit(64);
	}
	if (!ZONES.includes(zone as Zone)) {
		console.error(`Invalid --zone '${zone}' (choose: ${ZONES.join(", ")})`);
		console.error(HELP);
		process.exit(64);
	}
	return { seatmapFile, zone: zone as Zone, count };
}

async function main(): Promise<void> {
	const { seatmapFile, zone, count } = parseArgs(process.argv.slice(2));

	let rows: SeatRow[];
	try {
		rows = await loadSeatmap(seatmapFile);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`Error: cannot read seating map: ${msg}`);
		process.exit(1);
	}
	if (rows.length === 0) {
		console.error("Error: empty or invalid seating map");
		process.exit(1);
	}

	const result = pickSeats(rows, zone, count);
	if (!result) {
		console.error(`Error: no ${count} adjacent seats found in any zone`);
		process.exit(1);
	}

	console.log(result.codes.join(", "));
	if (result.zoneUsed !== zone && zone !== "surprise") {
		console.error(`Note: expanded from ${zone} to ${result.zoneUsed}`);
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
