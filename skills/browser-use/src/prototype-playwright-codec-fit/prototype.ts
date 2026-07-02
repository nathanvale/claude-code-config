#!/usr/bin/env bun
// PROTOTYPE — throwaway TUI shell over codec-fit.ts. Drive the seam map by hand:
// switch engines, walk each seam, watch the fit verdict change. The logic lives
// in codec-fit.ts; this file is the disposable terminal frame.
//
// Run:  bun skills/browser-use/src/prototype-playwright-codec-fit/prototype.ts

import {
	CHROME_DEVTOOLS,
	PLAYWRIGHT_MCP,
	computeFit,
	type Engine,
	type SeamFit,
	verdict,
} from "./codec-fit.ts";

const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const RED = "\x1b[31m";

const ENGINES: Engine[] = [CHROME_DEVTOOLS, PLAYWRIGHT_MCP];
let engineIdx = 1; // start on playwright — the engine under question
let cursor = 0;

function costColor(cost: SeamFit["cost"]): string {
	if (cost === "free") return G;
	if (cost === "rename-shim") return Y;
	return RED;
}

function costLabel(cost: SeamFit["cost"]): string {
	return {
		free: "FREE (rides seam)",
		"rename-shim": "rename shim",
		"machinery-edit": "MACHINERY EDIT",
		blocked: "BLOCKED",
	}[cost];
}

function render(): void {
	const engine = ENGINES[engineIdx];
	const fits = computeFit(engine);
	const v = verdict(engine);
	process.stdout.write("\x1b[2J\x1b[H");

	console.log(`${B}browser-use facade — playwright codec-fit spike${R}`);
	console.log(
		`${D}Question: does a 2nd engine ride the existing transport seam, or does the seam assume chrome-devtools' MCP vocab?${R}\n`,
	);

	console.log(`${B}Engine:${R} ${engine.id}   ${D}[tab] switch engine${R}`);
	console.log(`${D}  transport: ${engine.transport}${R}`);
	console.log(
		`${D}  warm-chrome connect: ${engine.connectsToWarmChrome ? `${G}yes${R}${D}` : `${RED}no${R}${D}`} — ${engine.connectNote}${R}\n`,
	);

	console.log(`${B}Seams the existing machinery demands:${R}`);
	fits.forEach((f, i) => {
		const sel = i === cursor ? `${B}▸${R} ` : "  ";
		const c = costColor(f.cost);
		const fitMark = f.fits ? `${G}✓${R}` : `${RED}✗${R}`;
		console.log(
			`${sel}${fitMark} ${B}${f.seam.verb.padEnd(12)}${R}${f.seam.id.padEnd(11)} ${c}${costLabel(f.cost)}${R}`,
		);
	});

	const f = fits[cursor];
	console.log(`\n${B}── seam detail: ${f.seam.id} ──${R}`);
	console.log(`${D}machinery emits:${R} ${f.seam.machineryEmits}`);
	console.log(`${D}demanded by:    ${R} ${f.seam.demandedBy}`);
	console.log(`${D}assumes:        ${R} ${f.seam.assumes}`);
	console.log(`${D}engine provides:${R} ${f.offer.provides}`);
	console.log(`${D}note:           ${R} ${f.offer.note}`);

	const vc = v.codecCheap ? G : RED;
	console.log(`\n${B}── VERDICT (${engine.id}) ──${R}`);
	console.log(
		`  fits ${v.fitCount}/${v.total} seams · ${v.machineryEdits} machinery edits · ${v.blocked} blocked`,
	);
	console.log(`  ${vc}codec cheap: ${v.codecCheap ? "YES" : "NO"}${R}`);
	console.log(`  ${D}${v.summary}${R}`);

	console.log(
		`\n${D}[tab] switch engine  [↑/k ↓/j] move  [q] quit${R}`,
	);
}

// raw keypress loop
const stdin = process.stdin;
stdin.setRawMode?.(true);
stdin.resume();
stdin.setEncoding("utf8");
render();

stdin.on("data", (key: string) => {
	const fits = computeFit(ENGINES[engineIdx]);
	if (key === "q" || key === "") {
		process.stdout.write("\x1b[2J\x1b[H");
		stdin.setRawMode?.(false);
		process.exit(0);
	} else if (key === "\t") {
		engineIdx = (engineIdx + 1) % ENGINES.length;
		cursor = 0;
	} else if (key === "k" || key === "[A") {
		cursor = (cursor - 1 + fits.length) % fits.length;
	} else if (key === "j" || key === "[B") {
		cursor = (cursor + 1) % fits.length;
	}
	render();
});
