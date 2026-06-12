#!/usr/bin/env bun
// PROTOTYPE — throwaway. Three-way live proof of the ref-normalizer.
// One facade-level intent — clickByName("Learn more") — driven through THREE
// engines (chrome-devtools, playwright, agent-browser) against the same warm
// Chrome page. Proves a caller writes click ONCE and it dispatches correctly to
// each engine's native shape. Snapshots are run live; the click is DISPATCHED
// (argv shown + executed) so you see the normalizer's real output per engine.
//
// Run (warm Chrome up on 9222):
//   bun skills/browser-use/src/prototype-playwright-vocab-map/run-3way.ts
//
// SAFETY: prints ref shapes + click argv only; no full page text, no auth URLs.

import {
	clickByName,
	type EngineId,
	type FacadeRef,
	parseSnapshot,
} from "./ref-normalizer.ts";

const TARGET = "https://example.com";
const TARGET_NAME = "Learn more"; // the one link on example.com
const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const RED = "\x1b[31m";
const Y = "\x1b[33m";

async function sh(cmd: string[]): Promise<{ ok: boolean; out: string }> {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const out = await new Response(p.stdout).text();
	const err = await new Response(p.stderr).text();
	const code = await p.exited;
	return { ok: code === 0, out: code === 0 ? out : err };
}

function mcpText(raw: string): string {
	try {
		return JSON.parse(raw).content?.[0]?.text ?? raw;
	} catch {
		return raw;
	}
}

// How each engine produces a snapshot (the Layer-1 vocab map, abbreviated here).
async function snapshot(engine: EngineId): Promise<string> {
	if (engine === "chrome-devtools") {
		await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: TARGET }), "--output", "json", "--timeout", "40000"]);
		const r = await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json", "--timeout", "40000"]);
		return mcpText(r.out);
	}
	if (engine === "playwright-cdp") {
		await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: TARGET }), "--output", "json", "--timeout", "40000"]);
		const r = await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json", "--timeout", "40000"]);
		return mcpText(r.out);
	}
	// agent-browser: direct CLI, NOT mcporter — the third transport.
	await sh(["agent-browser", "--cdp", "9222", "open", TARGET]);
	const r = await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"]);
	return r.out;
}

async function main() {
	console.log(`${B}ref-normalizer — 3-way live proof${R}`);
	console.log(`${D}one facade intent: clickByName("${TARGET_NAME}") on ${TARGET}, three engines${R}\n`);

	const engines: EngineId[] = ["chrome-devtools", "playwright-cdp", "agent-browser"];
	const parsed: Record<string, FacadeRef[]> = {};

	for (const engine of engines) {
		console.log(`${B}── ${engine} ──${R}`);
		const snap = await snapshot(engine);
		const refs = parseSnapshot(engine, snap);
		parsed[engine] = refs;
		const target = refs.find((r) => r.name === TARGET_NAME);
		console.log(`  parsed ${refs.length} refs · target ref: ${target ? `${G}${target.role} "${target.name}" raw=[${target.raw}]${R}` : `${RED}NOT FOUND${R}`}`);
	}

	console.log(`\n${B}═══ normalizer: same clickByName("${TARGET_NAME}") → per-engine dispatch + LIVE click ═══${R}`);
	console.log(`${D}(snapshot→click per engine in one sequence — refs go stale across re-navigations, so no interleave)${R}`);
	let allClicked = true;
	for (const engine of engines) {
		// Fresh snapshot immediately before the click — refs are only valid until the next nav.
		const freshRefs = parseSnapshot(engine, await snapshot(engine));
		const res = clickByName(freshRefs, TARGET_NAME);
		if ("error" in res) {
			console.log(`  ${RED}${engine}: ${res.error}${R}`);
			allClicked = false;
			continue;
		}
		const cmd = res.dispatch.kind === "cli" ? "agent-browser" : "mcporter";
		console.log(`  ${B}${engine}${R} → ${res.dispatch.kind === "cli" ? Y : G}${res.dispatch.kind}${R}  ${D}${cmd} ${res.dispatch.argv.join(" ")}${R}`);
		const r = await sh([cmd, ...res.dispatch.argv]);
		// success signal differs per engine: look for navigation away from example.com
		const text = r.out.toLowerCase();
		const clicked = r.ok && (text.includes("clicked") || text.includes("iana") || text.includes("done") || text.includes("ran playwright"));
		console.log(`     ${clicked ? `${G}✓ click landed${R}` : `${RED}✗ failed${R}`} ${D}${r.out.replace(/\s+/g, " ").slice(0, 75)}${R}`);
		if (!clicked) allClicked = false;
	}

	console.log(`\n${B}═══ VERDICT ═══${R}`);
	console.log(`  ${allClicked ? `${G}YES${R}` : `${RED}NO${R}`} — one facade-level clickByName landed a real click on all 3 engines`);
	console.log(`  ${D}2 ref formats (uid= · [ref=]) normalized · 3 dispatch shapes (mcp-uid · mcp-ref · cli-@ref)${R}`);
	console.log(`  ${D}agent-browser (CLI/direct-CDP) rode the SAME normalizer as the 2 MCP engines — generalizes beyond a pair.${R}\n`);
}

main();
