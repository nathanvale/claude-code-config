#!/usr/bin/env bun
// PROTOTYPE — throwaway. Proves dividend ★4: drive-observe split. One task, two
// engines composed by strength on the SAME warm Chrome:
//   DRIVER  = playwright (auto-wait robustness) performs the action
//   OBSERVER = chrome-devtools (44-tool network/console surface) captures the
//              side-effects that action triggered
// Emits one combined record: action-from-driver + side-effects-from-observer.
// Catches the canonical failure "the click worked but the backend 500'd" as one
// atomic observation instead of two engine swaps.
//
// Run: bun run-drive-observe.ts <url> "<link/button name>"
//   e.g. bun run-drive-observe.ts https://example.com "Learn more"
// SAFETY: prints request methods + status codes + host only; no auth URLs/bodies.

import { sh, PW_CLI } from "./fleet.ts";

const TARGET_URL = process.argv[2] ?? "https://example.com";
const ACTION = process.argv[3] ?? "Learn more";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

// redact a network line to method + status + host (never full url/query)
function redactNetLine(line: string): string | null {
	// chrome-devtools format: "reqid=N METHOD https://host/path [status]"
	const m = line.match(/reqid=\S+\s+(\w+)\s+(https?:\/\/[^/\s]+)\S*\s+\[(\d+)\]/);
	if (!m) return null;
	const [, method, origin, status] = m;
	let host = origin;
	try { host = new URL(origin).host; } catch {}
	return `${method} ${host} [${status}]`;
}

async function main() {
	console.log(`${B}drive-observe split — robust driver + debug observer, one task${R}`);
	console.log(`${D}driver: playwright (auto-wait)  ·  observer: chrome-devtools (network)  ·  same warm Chrome${R}\n`);

	// 0. both engines land on the page
	await sh([...PW_CLI, "--s=default", "goto", TARGET_URL]);
	await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: TARGET_URL }), "--output", "json"]);

	// 1. OBSERVER establishes a baseline (clear/snapshot network before the action)
	const before = mcpText((await sh(["mcporter", "call", "chrome-devtools.list_network_requests", "--args", "{}", "--output", "json"])).out);
	const beforeCount = (before.match(/reqid=/g) ?? []).length;
	console.log(`${B}1. observer baseline:${R} ${beforeCount} network requests before the action`);

	// 2. DRIVER performs the action (playwright auto-waits for actionability)
	console.log(`${B}2. driver acts:${R} playwright click "${ACTION}" ${D}(auto-wait)${R}`);
	// fresh snapshot to get a current ref, then click by ref
	const snap = (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
	const refLine = snap.split("\n").find((l) => l.includes(`"${ACTION}"`) && /ref=/.test(l));
	const refM = refLine?.match(/ref=(\w+)/);
	if (!refM) {
		console.log(`  ${RED}driver could not find "${ACTION}" to click${R}\n`);
		return;
	}
	const clickRes = await sh([...PW_CLI, "--s=default", "click", refM[1]]);
	const drove = clickRes.ok;
	console.log(`  ${drove ? `${G}✓ driver reports click landed${R}` : `${RED}✗ driver click failed${R}`}`);

	// 3. OBSERVER captures the side-effects the action triggered
	const after = mcpText((await sh(["mcporter", "call", "chrome-devtools.list_network_requests", "--args", "{}", "--output", "json"])).out);
	const console_ = mcpText((await sh(["mcporter", "call", "chrome-devtools.list_console_messages", "--args", "{}", "--output", "json"])).out);
	const afterLines = after.split("\n").map(redactNetLine).filter(Boolean) as string[];
	const newReqs = afterLines.slice(beforeCount); // requests added after baseline
	const failures = afterLines.filter((l) => /\[(4\d\d|5\d\d)\]/.test(l));
	const consoleErrors = (console_.match(/error/gi) ?? []).length;

	console.log(`${B}3. observer side-effects (chrome-devtools network + console):${R}`);
	console.log(`  total requests now: ${afterLines.length}  ${D}(+${Math.max(0, afterLines.length - beforeCount)} from the action)${R}`);
	for (const l of newReqs.slice(0, 6)) {
		const bad = /\[(4\d\d|5\d\d)\]/.test(l);
		console.log(`    ${bad ? `${RED}${l}${R}` : `${G}${l}${R}`}`);
	}
	console.log(`  console errors: ${consoleErrors === 0 ? `${G}0${R}` : `${RED}${consoleErrors}${R}`}`);

	// 4. COMBINED VERDICT — the thing neither engine gives alone
	console.log(`\n${B}── combined record (driver + observer) ──${R}`);
	const ok = drove && failures.length === 0 && consoleErrors === 0;
	console.log(`  action: ${drove ? "landed" : "failed"}  |  network failures: ${failures.length}  |  console errors: ${consoleErrors}`);
	if (drove && failures.length > 0) {
		console.log(`  ${Y}⚠ DRIVER SAID SUCCESS, OBSERVER SAW FAILURE:${R} ${failures.join(", ")}`);
		console.log(`  ${D}This is the bug a single engine hides: the click "worked" but a request ${failures[0].match(/\[(\d+)\]/)?.[1]}'d.${R}`);
	} else if (ok) {
		console.log(`  ${G}✓ verified clean:${R} click landed AND no failed requests AND no console errors`);
	}

	console.log(`\n${B}═══ WHY THIS MATTERS ═══${R}`);
	console.log(`  The robust engine drove; the debug engine watched — in ONE task, ONE warm Chrome.`);
	console.log(`  ${D}"The click worked but the backend 500'd" becomes one atomic observation, not two engine swaps.${R}\n`);
}
main();
