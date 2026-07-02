#!/usr/bin/env bun
// PROTOTYPE — throwaway. Proves dividends ★1 (confidence-annotated perception) +
// ★2 (stakes dial). Fans the same page across 5 engines, tags every interactive
// element with seen_by: N/5, and contrasts the two perception TIERS:
//   cheap     = fastest single engine (one view, fast, possibly wrong)
//   consensus = all 5 fanned out + per-element agreement score
//
// The product story: the agent's perception is consensus-scored, and it pays for
// confidence only when stakes justify it.
//
// Run: bun run-perception.ts [url]
// SAFETY: prints element accessible NAMES + agreement counts only; no auth URLs.

import { ENGINES, LABEL, interactiveNames, navSnap } from "./fleet.ts";
import type { EngineId } from "./ref-normalizer.ts";

const TARGET_URL = process.argv[2] ?? "https://en.wikipedia.org/wiki/Web_browser";
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";

function bar(n: number, total: number): string {
	const full = "█".repeat(n);
	const empty = "░".repeat(total - n);
	const col = n === total ? G : n >= Math.ceil(total / 2) ? Y : RED;
	return `${col}${full}${D}${empty}${R}`;
}

async function main() {
	console.log(`${B}confidence-annotated perception + stakes dial${R}`);
	console.log(`${D}page: ${hostOf(TARGET_URL)}  ·  fleet of ${ENGINES.length}${R}\n`);

	// fan out
	const seen: Record<string, Set<string>> = {};
	const msByEngine: Record<string, number> = {};
	for (const e of ENGINES) {
		const r = await navSnap(e, TARGET_URL);
		seen[e] = r.ok ? interactiveNames(e, r.snap) : new Set();
		msByEngine[e] = r.ms;
	}
	const live = ENGINES.filter((e) => seen[e].size > 0);

	// CHEAP TIER: fastest single engine
	const fastest = live.reduce((a, b) => (msByEngine[a] <= msByEngine[b] ? a : b));
	const cheapView = seen[fastest];

	// CONSENSUS TIER: per-element agreement across the fleet
	const union = new Set<string>();
	for (const e of live) for (const n of seen[e]) union.add(n);
	const score = (name: string) => live.filter((e) => seen[e].has(name)).length;

	console.log(`${B}── TIER 1: cheap (single engine: ${LABEL[fastest]}, ${Math.round(msByEngine[fastest])}ms) ──${R}`);
	console.log(`  sees ${cheapView.size} interactive elements. No confidence signal — trust them all blindly.`);
	console.log(`  ${D}(this is what every single-engine browser agent gets)${R}\n`);

	console.log(`${B}── TIER 2: consensus (all ${live.length} engines, ${Math.round(live.reduce((s, e) => s + msByEngine[e], 0))}ms total) ──${R}`);
	const sorted = [...union].sort((a, b) => score(b) - score(a));
	const full = sorted.filter((n) => score(n) === live.length);
	const contested = sorted.filter((n) => score(n) < live.length);
	console.log(`  ${G}${full.length} elements at ${live.length}/${live.length} consensus${R} — act freely.`);
	console.log(`  ${Y}${contested.length} contested elements${R} — investigate before acting:`);
	for (const name of contested.slice(0, 18)) {
		const s = score(name);
		const who = live.filter((e) => seen[e].has(name)).map((e) => LABEL[e].split("-")[0]).join(",");
		console.log(`    ${bar(s, live.length)} ${s}/${live.length}  "${name.slice(0, 40)}" ${D}${s < live.length ? who : ""}${R}`);
	}
	if (contested.length > 18) console.log(`    ${D}... +${contested.length - 18} more contested${R}`);

	console.log(`\n${B}═══ WHY THIS MATTERS ═══${R}`);
	const missedByCheap = contested.filter((n) => !cheapView.has(n));
	console.log(`  The cheap tier (${LABEL[fastest]}) is MISSING ${RED}${missedByCheap.length}${R} elements the fleet collectively sees.`);
	if (missedByCheap.length) {
		console.log(`  ${D}e.g. "${missedByCheap[0].slice(0, 45)}" — a single-engine agent reports this as NOT FOUND and is wrong.${R}`);
	}
	console.log(`  ${C}stakes dial:${R} scroll a list → tier 1 (${Math.round(msByEngine[fastest])}ms). Confirm a critical row → tier 2 (consensus).`);
	console.log(`  ${D}The agent buys confidence only where it matters. Consensus is the product; cost is opt-in.${R}\n`);
}
main();
