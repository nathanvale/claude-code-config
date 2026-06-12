#!/usr/bin/env bun
// PROTOTYPE — throwaway. Prototypes the ce-ideate swappability dividends with LIVE
// numbers across the 5 adapters:
//   1. METRICS / cost-routing      — latency, snapshot bytes, ref count, success per adapter
//   2. DIFFERENTIAL ORACLE         — do the engines AGREE on the page's interactive set?
//                                     (agreement = trust; disagreement = a real signal)
//   3. (degradation is observable)  — any adapter that errors shows what a fallback skips
//
// Run (5 adapters must be up — see run-5way.ts prereqs):
//   bun skills/browser-use/src/prototype-playwright-vocab-map/run-metrics.ts [url] [reps]
// SAFETY: prints aggregate shapes + accessible NAMES of interactive elements only
//   (names are public a11y labels, not secrets); no full page text, no auth URLs.

import { type EngineId, parseSnapshot } from "./ref-normalizer.ts";

const URL = process.argv[2] ?? "https://example.com";
const REPS = Number(process.argv[3] ?? 3);
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", C = "\x1b[36m", Y = "\x1b[33m";

// Prefer locally-installed bins (warm, no npx cold-start) — falls back to npx if absent.
// This is the cost-routing fairness fix: npx adds ~500ms/call that isn't the engine's fault.
import { existsSync } from "node:fs";
const BIN = `${import.meta.dir}/node_modules/.bin`;
const CDT_CLI = existsSync(`${BIN}/chrome-devtools`)
	? [`${BIN}/chrome-devtools`]
	: ["npx", "-y", "-p", "chrome-devtools-mcp@latest", "chrome-devtools"];
const PW_CLI = existsSync(`${BIN}/playwright-cli`)
	? [`${BIN}/playwright-cli`]
	: ["npx", "-y", "@playwright/cli@latest"];
console.error(`[bins] chrome-cli=${CDT_CLI[0].includes("node_modules") ? "local" : "npx"} pw-cli=${PW_CLI[0].includes("node_modules") ? "local" : "npx"}`);

async function sh(cmd: string[], timeoutMs = 60000): Promise<{ ok: boolean; out: string; ms: number }> {
	const start = performance.now();
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const t = setTimeout(() => p.kill(), timeoutMs);
	const out = await new Response(p.stdout).text();
	const err = await new Response(p.stderr).text();
	const code = await p.exited;
	clearTimeout(t);
	return { ok: code === 0, out: out + err, ms: performance.now() - start };
}
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

// One timed navigate→snapshot. Returns the raw snapshot text + the snapshot ms only
// (navigate excluded so we compare the observe op, not network).
async function navSnap(engine: EngineId): Promise<{ snap: string; ms: number; ok: boolean }> {
	switch (engine) {
		case "chrome-devtools": {
			await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			const r = await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"]);
			return { snap: mcpText(r.out), ms: r.ms, ok: r.ok };
		}
		case "playwright-cdp": {
			await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			const r = await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"]);
			return { snap: mcpText(r.out), ms: r.ms, ok: r.ok };
		}
		case "agent-browser": {
			await sh(["agent-browser", "--cdp", "9222", "open", URL]);
			const r = await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
		case "playwright-cli": {
			await sh([...PW_CLI, "--s=default", "goto", URL]);
			const r = await sh([...PW_CLI, "--s=default", "snapshot"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
		case "chrome-devtools-cli": {
			await sh([...CDT_CLI, "navigate_page", "--url", URL]);
			const r = await sh([...CDT_CLI, "take_snapshot"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
	}
}

const ENGINES: EngineId[] = ["chrome-devtools", "playwright-cdp", "agent-browser", "playwright-cli", "chrome-devtools-cli"];
const LABEL: Record<EngineId, string> = {
	"chrome-devtools": "N1 chrome MCP", "playwright-cdp": "N2 pw MCP", "agent-browser": "N3 agent-browser",
	"playwright-cli": "N4 pw CLI", "chrome-devtools-cli": "N5 chrome CLI",
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// the interactive set an engine sees = sorted accessible names of link/button/textbox refs
const interactiveSet = (engine: EngineId, snap: string) =>
	new Set(parseSnapshot(engine, snap)
		.filter((r) => /link|button|textbox|checkbox|combobox|menuitem/i.test(r.role))
		.map((r) => r.name).filter(Boolean));

async function main() {
	console.log(`${B}swappability dividends — live metrics across 5 adapters${R}`);
	console.log(`${D}target: ${URL}  ·  ${REPS} reps  ·  snapshot-op latency (navigate excluded)${R}\n`);

	const rows: { e: EngineId; msList: number[]; bytes: number; refs: number; ok: number; set: Set<string> }[] = [];
	for (const e of ENGINES) {
		const msList: number[] = []; let bytes = 0, refs = 0, ok = 0; let lastSet = new Set<string>();
		for (let i = 0; i < REPS; i++) {
			const r = await navSnap(e);
			if (r.ok && r.snap) {
				msList.push(r.ms);
				bytes = r.snap.length;
				const parsed = parseSnapshot(e, r.snap);
				refs = parsed.length;
				lastSet = interactiveSet(e, r.snap);
				ok++;
			}
		}
		rows.push({ e, msList, bytes, refs, ok, set: lastSet });
	}

	// ---- 1. METRICS TABLE (cost-routing dividend) ----
	console.log(`${B}── 1. metrics (cost-routing: pick cheapest engine that satisfies) ──${R}`);
	console.log(`${D}  adapter           med-ms   p-min   bytes   refs   ok${R}`);
	const fastest = Math.min(...rows.filter((r) => r.msList.length).map((r) => median(r.msList)));
	for (const r of rows) {
		if (!r.msList.length) { console.log(`  ${LABEL[r.e].padEnd(17)} ${RED}no successful snapshot${R}`); continue; }
		const med = median(r.msList);
		const tag = med === fastest ? ` ${G}◄ fastest${R}` : "";
		console.log(`  ${LABEL[r.e].padEnd(17)} ${String(Math.round(med)).padStart(6)}  ${String(Math.round(Math.min(...r.msList))).padStart(6)}  ${String(r.bytes).padStart(6)}  ${String(r.refs).padStart(4)}  ${r.ok}/${REPS}${tag}`);
	}

	// ---- 2. DIFFERENTIAL ORACLE (do engines agree on the interactive set?) ----
	console.log(`\n${B}── 2. differential oracle (cross-engine agreement on interactive elements) ──${R}`);
	const live = rows.filter((r) => r.set.size > 0);
	const union = new Set<string>();
	for (const r of live) for (const n of r.set) union.add(n);
	if (union.size === 0) {
		console.log(`  ${Y}no interactive elements parsed — page may be ref-light (example.com has 1 link)${R}`);
	}
	for (const name of union) {
		const seenBy = live.filter((r) => r.set.has(name)).map((r) => LABEL[r.e].split(" ")[0]);
		const agree = seenBy.length === live.length;
		console.log(`  ${agree ? `${G}✓ all${R}` : `${Y}⚠ ${seenBy.length}/${live.length}${R}`}  "${name}" ${D}${agree ? "" : `(only: ${seenBy.join(",")})`}${R}`);
	}
	const fullAgree = [...union].every((n) => live.every((r) => r.set.has(n)));
	console.log(`  ${fullAgree ? `${G}consensus: engines agree on the interactive set → high trust${R}` : `${Y}divergence: engines disagree → the oracle flagged something to inspect${R}`}`);

	// ---- 3. degradation read ----
	console.log(`\n${B}── 3. degradation (which engines could serve as fallback) ──${R}`);
	const healthy = rows.filter((r) => r.ok === REPS).map((r) => LABEL[r.e].split(" ").slice(0, 2).join(" "));
	const flaky = rows.filter((r) => r.ok > 0 && r.ok < REPS).map((r) => LABEL[r.e]);
	const dead = rows.filter((r) => r.ok === 0).map((r) => LABEL[r.e]);
	console.log(`  ${G}healthy (${healthy.length}):${R} ${healthy.join(", ")}`);
	if (flaky.length) console.log(`  ${Y}flaky:${R} ${flaky.join(", ")}`);
	if (dead.length) console.log(`  ${RED}down:${R} ${dead.join(", ")}`);
	console.log(`  ${D}${healthy.length}-deep fallback pool: any can serve if the preferred engine drops (graceful degradation dividend).${R}\n`);
}
main();
