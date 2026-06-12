#!/usr/bin/env bun
// PROTOTYPE — throwaway. EARNS the drive-observe dividend honestly by proving the
// DRIVER GAP is real: on a page where the button is disabled for 1500ms then becomes
// actionable, chrome-devtools' fire-and-forget CDP click MISSES (clicks during the
// disabled window, no effect) while playwright's auto-wait click WAITS and lands.
//
// This is the case the example.com demo could NOT show (static link = no driver gap).
// Only here does "compose a robust driver with a debug observer" beat a single engine —
// because the single fire-and-forget engine genuinely fails the action.
//
// Prereq: a delayed-actionability page served locally (see the harness comment).
// Run: bun run-driver-gap.ts [url]

import { existsSync } from "node:fs";
import { sh } from "./fleet.ts";

const URL = process.argv[2] ?? "http://127.0.0.1:8899/delayed.html";
const BIN = `${import.meta.dir}/node_modules/.bin`;
const PW_CLI = existsSync(`${BIN}/playwright-cli`) ? [`${BIN}/playwright-cli`] : ["npx", "-y", "@playwright/cli@latest"];
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", Y = "\x1b[33m", C = "\x1b[36m";
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };
const pageState = (snap: string) => (snap.match(/CLICKED at \d+|no click yet/) ?? ["?"])[0];

async function chromeAttempt(): Promise<string> {
	// fire-and-forget: navigate, snapshot, click IMMEDIATELY (button still disabled)
	await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
	const snap = mcpText((await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"])).out);
	// find the snapshot line naming the button, pull its uid
	const line = snap.split("\n").find((l) => l.includes("Submit Order"));
	const uid = line?.match(/uid=(\S+)/)?.[1];
	if (!uid) return "could not find button";
	await sh(["mcporter", "call", "chrome-devtools.click", "--args", JSON.stringify({ uid }), "--output", "json"], 8000);
	// re-read state
	const after = mcpText((await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"])).out);
	return pageState(after);
}

async function playwrightAttempt(): Promise<string> {
	// auto-wait: navigate, click IMMEDIATELY — playwright blocks until actionable
	await sh([...PW_CLI, "--s=default", "goto", URL]);
	const snap = (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
	const ref = snap.match(/Submit Order[^\n]*?\[ref=(\w+)/)?.[1] ?? snap.match(/\[ref=(\w+)\][^\n]*Submit Order/)?.[1]
		?? snap.split("\n").find((l) => l.includes("Submit Order"))?.match(/ref=(\w+)/)?.[1];
	if (!ref) return "could not find button";
	await sh([...PW_CLI, "--s=default", "click", ref], 15000); // auto-wait inside
	const after = (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
	return pageState(after);
}

async function main() {
	console.log(`${B}driver gap — fire-and-forget vs auto-wait on a delayed button${R}`);
	console.log(`${D}page: button disabled 1500ms then actionable. Both click IMMEDIATELY.${R}\n`);

	const chrome = await chromeAttempt();
	const pw = await playwrightAttempt();

	const chromeLanded = chrome.startsWith("CLICKED");
	const pwLanded = pw.startsWith("CLICKED");

	console.log(`  ${chromeLanded ? G : RED}chrome-devtools (fire-and-forget): ${chrome}${R}`);
	console.log(`  ${pwLanded ? G : RED}playwright     (auto-wait):        ${pw}${R}`);

	console.log(`\n${B}═══ VERDICT ═══${R}`);
	if (!chromeLanded && pwLanded) {
		console.log(`  ${G}DRIVER GAP CONFIRMED${R} — fire-and-forget MISSED, auto-wait LANDED.`);
		console.log(`  ${C}This is where drive-observe earns it:${R} route the ACTION to the robust driver`);
		console.log(`  (playwright), keep the debug observer (chrome-devtools) for side-effects.`);
		console.log(`  ${D}A single fire-and-forget engine fails this click outright — composition wins.${R}`);
	} else if (chromeLanded && pwLanded) {
		console.log(`  ${Y}both landed${R} — no driver gap on this run (chrome may have been slow enough to`);
		console.log(`  ${D}land after the 1500ms window). The gap is timing-sensitive; re-run or shorten click latency.${R}`);
	} else {
		console.log(`  ${Y}inconclusive${R} — chrome:${chrome} pw:${pw}`);
	}
	console.log("");
}
main();
