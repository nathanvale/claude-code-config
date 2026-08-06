#!/usr/bin/env bun
// PROTOTYPE TUI — throwaway shell over probe-loop.ts. Drive the convergence loop
// by hand to see if it behaves. Run: bun run prototypes/cli-probe-loop/tui.ts
//
// Seeded with the real heal-skill probe history from this session so you can
// watch: pass 1 finds bugs, pass 2 re-finds them (dedup), fixing resolves them,
// and the loop converges when a pass adds zero NEW findings — even while open
// findings still exist.

import {
	type Convergence,
	type Finding,
	initLoop,
	type LoopState,
	openFindings,
	type ProbeResult,
	resolveFinding,
	runPass,
	signatureOf,
} from "./probe-loop.ts";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const RED = "\x1b[31m";

// The real bugs the 15 manual probes found on heal-skill, as probe results.
// Two are genuine (raw bun test, owner-paths zero), the rest are "ok" branches
// that produce no accepted finding (accepted:false) — so a pass over all of them
// yields only the real ones as new findings.
const PROBE_BATCH_1: ProbeResult[] = [
	{ ...mk("tests check", "raw-runner-violation", "tests check ran raw `bun test`"), accepted: true },
	{ ...mk("owner-paths check", "false-pass", "owner-paths matched 0 paths, vacuous pass"), accepted: true },
	{ ...mk("scripts-help check", "silent-coverage-gap", "tests verified only 1 of 4 suites"), accepted: true },
	{ ...mk("repair clean log", "wrong-exit-code", "no-op repair (ok branch)"), accepted: false },
	{ ...mk("explain no id", "wrong-exit-code", "exit 64 (ok branch)"), accepted: false },
	{ ...mk("check --quiet --json", "false-pass", "json intact (ok branch)"), accepted: false },
];

// Pass 2: same probes re-run. The same real bugs reappear (dedup), plus a NEW
// one discovered by a fresh angle (bun assumed on PATH).
const PROBE_BATCH_2: ProbeResult[] = [
	...PROBE_BATCH_1,
	{ ...mk("scripts-help spawn", "unguarded-spawn", "bun assumed on PATH"), accepted: true },
];

// Pass 3: nothing new (everything already seen) — should converge.
const PROBE_BATCH_3: ProbeResult[] = PROBE_BATCH_2;

const BATCHES = [PROBE_BATCH_1, PROBE_BATCH_2, PROBE_BATCH_3];

function mk(branch: string, shape: ProbeResult["shape"], summary: string) {
	return { signature: signatureOf(branch, shape), shape, branch, summary };
}

let state: LoopState = initLoop();
let batchIdx = 0;

function convColor(c: Convergence): string {
	return c === "converged" ? G : c === "active" ? Y : D;
}

function render(): void {
	console.clear();
	console.log(`${B}cli-probe-loop${R} ${D}— convergence prototype (heal-skill seed)${R}\n`);

	const last = state.passes.at(-1);
	console.log(`${B}Convergence:${R} ${convColor(state.convergence)}${state.convergence}${R}`);
	console.log(
		`${B}Passes:${R} ${state.passes.length}` +
			(last ? `  ${D}(last: +${last.newAccepted} new, ${last.dedup} dedup, ${last.rejected} rejected)${R}` : ""),
	);
	console.log(`${B}Next batch:${R} ${batchIdx < BATCHES.length ? `#${batchIdx + 1}` : `${D}(none left)${R}`}\n`);

	console.log(`${B}Pass ledger${R}`);
	if (state.passes.length === 0) console.log(`  ${D}no passes yet${R}`);
	for (const p of state.passes) {
		const conv = p.newAccepted === 0 ? `${G}CONVERGED${R}` : `${Y}active${R}`;
		console.log(`  pass ${p.n}: ${B}+${p.newAccepted}${R} new  ${D}${p.dedup} dedup  ${p.rejected} rejected${R}  ${conv}`);
	}

	console.log(`\n${B}Findings${R} ${D}(${openFindings(state).length} open / ${state.findings.length} total)${R}`);
	if (state.findings.length === 0) console.log(`  ${D}none yet${R}`);
	for (const f of state.findings) {
		const mark = f.status === "open" ? `${RED}● open${R}` : `${G}✓ ${f.status}${R}`;
		console.log(`  ${mark} ${D}[${f.shape}]${R} ${f.branch} ${D}(p${f.firstSeenPass})${R}`);
		console.log(`        ${D}${f.summary}${R}`);
	}

	console.log(
		`\n${D}────────────────────────────────────────${R}\n` +
			`${B}[p]${R} ${D}run next probe pass${R}   ` +
			`${B}[r]${R} ${D}resolve first open finding${R}   ` +
			`${B}[R]${R} ${D}reset${R}   ` +
			`${B}[q]${R} ${D}quit${R}`,
	);
}

function handle(key: string): void {
	if (key === "p") {
		if (batchIdx < BATCHES.length) {
			state = runPass(state, BATCHES[batchIdx]);
			batchIdx += 1;
		} else {
			// No new batch — re-run the last one to prove re-running converged input stays converged.
			state = runPass(state, BATCHES[BATCHES.length - 1]);
		}
	} else if (key === "r") {
		const first = openFindings(state)[0];
		if (first) state = resolveFinding(state, first.signature);
	} else if (key === "R") {
		state = initLoop();
		batchIdx = 0;
	}
}

// --- minimal raw-key TUI loop ---
render();
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data: string) => {
	const key = data.toString();
	if (key === "q" || key === "") {
		process.stdin.setRawMode?.(false);
		console.log("\nbye");
		process.exit(0);
	}
	handle(key);
	render();
});
