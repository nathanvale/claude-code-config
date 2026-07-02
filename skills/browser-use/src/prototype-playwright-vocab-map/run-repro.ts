#!/usr/bin/env bun
// PROTOTYPE — throwaway. Proves dividend ★5 (reproduce-everywhere). The agent hits
// an anomaly — "element X not found" — and issues repro(target): replay the lookup
// across all 5 engines and return a verdict matrix that classifies the anomaly as:
//   REAL SITE BUG   — element absent on every engine (fix the page / re-plan)
//   ENGINE ARTIFACT — present on some lineages, absent on others (it's the engine)
//   PRESENT         — found everywhere; the original miss was transient
//
// This resolves the single most expensive ambiguity in browser automation:
// "is the button gone, or does only MY engine think it's gone?" — which a
// single-engine agent literally cannot answer.
//
// Run: bun run-repro.ts <url> "<element accessible name>"
//   e.g. bun run-repro.ts https://en.wikipedia.org/wiki/Web_browser "GND"      (lineage artifact)
//        bun run-repro.ts https://example.com "Learn more"                     (present everywhere)
//        bun run-repro.ts https://example.com "Buy now"                        (real absence)
// SAFETY: prints engine ids + the queried name + present/absent only.

import { ENGINES, LABEL, interactiveNames, navSnap } from "./fleet.ts";
import type { EngineId } from "./ref-normalizer.ts";

const TARGET_URL = process.argv[2] ?? "https://en.wikipedia.org/wiki/Web_browser";
const NEEDLE = process.argv[3] ?? "GND";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";

// engine → lineage (the ref-format family; the axis that explains most divergence)
const LINEAGE: Record<EngineId, string> = {
	"chrome-devtools": "chrome (uid=)",
	"chrome-devtools-cli": "chrome (uid=)",
	"playwright-cdp": "chromium ([ref=])",
	"playwright-cli": "chromium ([ref=])",
	"agent-browser": "chromium ([ref=])",
};

async function main() {
	console.log(`${B}reproduce-everywhere — anomaly triage across the fleet${R}`);
	console.log(`${D}agent reported: "${NEEDLE}" not found. repro() across ${ENGINES.length} engines...${R}\n`);

	const present: Record<string, boolean> = {};
	for (const e of ENGINES) {
		const r = await navSnap(e, TARGET_URL);
		const names = r.ok ? interactiveNames(e, r.snap) : new Set<string>();
		// match: exact, or the needle appears in an element name (case-insensitive)
		present[e] = [...names].some((n) => n === NEEDLE || n.toLowerCase().includes(NEEDLE.toLowerCase()));
	}

	console.log(`${B}── verdict matrix ──${R}`);
	for (const e of ENGINES) {
		const ok = present[e];
		console.log(`  ${ok ? `${G}✓ present${R}` : `${RED}✗ absent ${R}`}  ${LABEL[e].padEnd(14)} ${D}${LINEAGE[e]}${R}`);
	}

	const seenCount = ENGINES.filter((e) => present[e]).length;
	const total = ENGINES.length;
	// lineage analysis
	const byLineage: Record<string, { seen: number; total: number }> = {};
	for (const e of ENGINES) {
		const l = LINEAGE[e];
		byLineage[l] ??= { seen: 0, total: 0 };
		byLineage[l].total++;
		if (present[e]) byLineage[l].seen++;
	}
	const lineageSplit = Object.entries(byLineage).every(([, v]) => v.seen === 0 || v.seen === v.total)
		&& Object.values(byLineage).some((v) => v.seen === 0)
		&& Object.values(byLineage).some((v) => v.seen === v.total);

	console.log(`\n${B}═══ DIAGNOSIS ═══${R}`);
	if (seenCount === 0) {
		console.log(`  ${RED}REAL SITE BUG / TRUE ABSENCE${R} — "${NEEDLE}" is absent on all ${total} engines.`);
		console.log(`  ${D}The agent's miss was correct. Fix the page or re-plan — not an engine problem.${R}`);
	} else if (seenCount === total) {
		console.log(`  ${G}PRESENT EVERYWHERE${R} — "${NEEDLE}" found on all ${total} engines.`);
		console.log(`  ${D}The original miss was transient (timing/stale ref). Retry; it's really there.${R}`);
	} else if (lineageSplit) {
		const blind = Object.entries(byLineage).filter(([, v]) => v.seen === 0).map(([l]) => l);
		console.log(`  ${Y}ENGINE ARTIFACT (lineage-bound)${R} — present ${seenCount}/${total}, absent entirely on: ${C}${blind.join(", ")}${R}`);
		console.log(`  ${D}NOT a site bug. Route this task to a lineage that sees the element. The fleet just told you which.${R}`);
	} else {
		console.log(`  ${Y}PARTIAL / FLAKY${R} — present ${seenCount}/${total}, no clean lineage split.`);
		console.log(`  ${D}Likely timing/rendering flake on specific engines; prefer a consensus tier here.${R}`);
	}
	console.log(`\n  ${D}A single-engine agent sees only one row of this matrix and cannot tell these cases apart.${R}\n`);
}
main();
