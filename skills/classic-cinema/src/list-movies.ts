#!/usr/bin/env bun
// Fetch Classic Cinemas APIs and print today's movie listing.
//
// Usage:
//   bun run src/list-movies.ts [--movie QUERY]
//
// Without --movie: prints a numbered listing of all movies showing today (Browse mode).
// With --movie:    fuzzy-matches QUERY and prints only matching movies with session ids.
//
// Side effects: writes /tmp/cc-sessions.json and /tmp/cc-movies.json.
//
// Output (one JSON object per line, stdout):
//   {"name","vistaId","rating","runtime","trailer","summary","headerImage",
//    "posterImage","sessions":[{"id","time","screen","screenNumber","date"}],"index"}
//
// Exit codes:
//   0 — success
//   1 — no sessions today / no matches for query
//   64 — invalid usage

import {
	BASE_URL,
	CINEMA_ID,
	fetchJson,
	formatTime,
	type MovieEntry,
	type RawMovie,
	type RawSession,
	todayAest,
} from "./cinema-api.ts";

const HELP = `classic-cinema list-movies — today's Elsternwick listing

Usage:
  bun run src/list-movies.ts [--movie QUERY]

Options:
  --movie QUERY   Fuzzy-match a movie name (substring, case-insensitive)
  -h, --help      Show this help

Output: one JSON object per line on stdout. Diagnostics on stderr.
Exit: 0 ok, 1 no sessions/no match, 64 invalid usage.`;

function parseArgs(argv: string[]): { movie: string | null } {
	let movie: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-h" || arg === "--help") {
			console.log(HELP);
			process.exit(0);
		} else if (arg === "--movie") {
			movie = argv[++i] ?? "";
		} else if (arg.startsWith("--movie=")) {
			movie = arg.slice("--movie=".length);
		} else {
			console.error(`Unknown argument: ${arg}`);
			console.error(HELP);
			process.exit(64);
		}
	}
	return { movie };
}

async function main(): Promise<void> {
	const { movie } = parseArgs(process.argv.slice(2));

	const sessions = await fetchJson<RawSession[]>(
		`${BASE_URL}/sessions/${CINEMA_ID}`,
		"/tmp/cc-sessions.json",
	);
	const movies = await fetchJson<RawMovie[]>(`${BASE_URL}/movies`, "/tmp/cc-movies.json");

	const today = todayAest();

	const movieMap = new Map<string, RawMovie>();
	for (const m of movies) {
		if (m.vistaId) movieMap.set(m.vistaId, m);
	}

	const todaySessions = new Map<string, RawSession[]>();
	for (const s of sessions) {
		if (s.date?.slice(0, 10) !== today) continue;
		const mid = s.movieId;
		if (mid && movieMap.has(mid)) {
			const list = todaySessions.get(mid) ?? [];
			list.push(s);
			todaySessions.set(mid, list);
		}
	}

	if (todaySessions.size === 0) {
		console.error("No sessions showing today at Elsternwick");
		process.exit(1);
	}

	const earliest = (slist: RawSession[]) =>
		slist.reduce((min, s) => (s.date < min ? s.date : min), slist[0].date);
	const sorted = [...todaySessions.entries()].sort((a, b) =>
		earliest(a[1]).localeCompare(earliest(b[1])),
	);

	let entries: MovieEntry[] = sorted.map(([mid, slist]) => {
		// biome-ignore lint/style/noNonNullAssertion: mid came from movieMap above
		const m = movieMap.get(mid)!;
		const sessList = [...slist]
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((s) => ({
				id: s.id,
				time: formatTime(s.date),
				screen: s.screenName ?? "?",
				screenNumber: s.screenNumber ?? 0,
				date: s.date,
			}));
		const trailer = m.trailer ?? "";
		return {
			name: m.name,
			vistaId: mid,
			rating: m.rating?.id ?? "?",
			runtime: m.runtime ?? "?",
			trailer: trailer ? `https://www.youtube.com/watch?v=${trailer}` : null,
			summary: m.summary ?? "",
			headerImage: m.headerImage ?? "",
			posterImage: m.posterImage ?? "",
			sessions: sessList,
		};
	});

	if (movie) {
		const query = movie.toLowerCase();
		const matched = entries.filter((e) => e.name.toLowerCase().includes(query));
		if (matched.length === 0) {
			console.error(`No movies matching '${movie}' today`);
			entries.forEach((e, i) => {
				console.error(`  ${i + 1}. ${e.name}`);
			});
			process.exit(1);
		}
		entries = matched;
	}

	entries.forEach((e, i) => {
		e.index = i + 1;
		console.log(JSON.stringify(e));
	});
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
