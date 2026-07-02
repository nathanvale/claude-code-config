#!/usr/bin/env bun
// PROTOTYPE — throwaway. Graceful-degradation dividend, LIVE.
// One facade intent (navigate→snapshot→clickByName) with an ORDERED engine
// preference. The facade tries the preferred engine; on failure it falls through
// to the next capable engine and the task STILL COMPLETES. Reports which engine
// served + the fallback depth — the LiteLLM-style fallback chain from ce-ideate.
//
// To prove it's real, run it while killing engines:
//   bun run-degrade.ts                      # all healthy → served by preferred
//   (stop N1's source) then re-run          # preferred fails → falls to N2, etc.
//
// Run: bun skills/browser-use/src/prototype-playwright-vocab-map/run-degrade.ts [url]
// SAFETY: prints engine ids + accessible names only.

import { existsSync } from "node:fs";
import { clickByName, type EngineId, parseSnapshot } from "./ref-normalizer.ts";

const URL = process.argv[2] ?? "https://example.com";
const NAME = "Learn more";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", Y = "\x1b[33m", C = "\x1b[36m";

const BIN = `${import.meta.dir}/node_modules/.bin`;
const CDT_CLI = existsSync(`${BIN}/chrome-devtools`) ? [`${BIN}/chrome-devtools`] : ["npx", "-y", "-p", "chrome-devtools-mcp@latest", "chrome-devtools"];
const PW_CLI = existsSync(`${BIN}/playwright-cli`) ? [`${BIN}/playwright-cli`] : ["npx", "-y", "@playwright/cli@latest"];

async function sh(cmd: string[], timeoutMs = 30000): Promise<{ ok: boolean; out: string }> {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const t = setTimeout(() => p.kill(), timeoutMs);
	const out = await new Response(p.stdout).text();
	const err = await new Response(p.stderr).text();
	const code = await p.exited;
	clearTimeout(t);
	return { ok: code === 0, out: out + err };
}
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

// A single engine's full attempt: navigate → snapshot → click. Throws on any failure
// so the fallback loop treats it as "this engine is down, try the next."
// DOWN env var simulates outages deterministically (comma-separated engine ids).
// Real-world note: `mcporter daemon stop` does NOT simulate an outage — mcporter
// auto-restarts the server on the next call (self-healing, a real finding). To test
// fallback logic you need either a genuine unrecoverable failure or this kill-switch,
// which is how you'd test a fallback chain in CI anyway.
const DOWN = new Set((process.env.DOWN ?? "").split(",").map((s) => s.trim()).filter(Boolean));

async function attempt(engine: EngineId): Promise<{ servedBy: EngineId; clicked: string }> {
	if (DOWN.has(engine)) throw new Error("engine marked DOWN (simulated outage)");
	let snap = "";
	switch (engine) {
		case "chrome-devtools": {
			const nav = await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			if (!nav.ok || /not managed|error|not connected/i.test(nav.out)) throw new Error("nav failed");
			const s = await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"]);
			if (!s.ok || /not managed|error/i.test(s.out)) throw new Error("snapshot failed");
			snap = mcpText(s.out);
			break;
		}
		case "playwright-cdp": {
			const nav = await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			if (!nav.ok || /not managed|error/i.test(nav.out)) throw new Error("nav failed");
			const s = await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"]);
			if (!s.ok || /not managed|### Error/i.test(s.out)) throw new Error("snapshot failed");
			snap = mcpText(s.out);
			break;
		}
		case "agent-browser": {
			const nav = await sh(["agent-browser", "--cdp", "9222", "open", URL]);
			if (!nav.ok) throw new Error("open failed");
			const s = await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"]);
			if (!s.ok) throw new Error("snapshot failed");
			snap = s.out;
			break;
		}
		case "playwright-cli": {
			const nav = await sh([...PW_CLI, "--s=default", "goto", URL]);
			if (!nav.ok || /no browser|not attached|error/i.test(nav.out)) throw new Error("goto failed (session down?)");
			const s = await sh([...PW_CLI, "--s=default", "snapshot"]);
			if (!s.ok || /no browser|not attached/i.test(s.out)) throw new Error("snapshot failed");
			snap = s.out;
			break;
		}
		case "chrome-devtools-cli": {
			const nav = await sh([...CDT_CLI, "navigate_page", "--url", URL]);
			if (!nav.ok || /not running|no daemon/i.test(nav.out)) throw new Error("nav failed (daemon down?)");
			const s = await sh([...CDT_CLI, "take_snapshot"]);
			if (!s.ok || /not running|no daemon/i.test(s.out)) throw new Error("snapshot failed");
			snap = s.out;
			break;
		}
	}
	const refs = parseSnapshot(engine, snap);
	const res = clickByName(refs, NAME);
	if ("error" in res) throw new Error(`no clickable ref: ${res.error.slice(0, 40)}`);
	// dispatch the click
	const bin = res.dispatch.kind === "mcporter" ? ["mcporter"]
		: res.dispatch.kind === "cli" ? ["agent-browser"]
		: res.dispatch.kind === "cli-pwcli" ? PW_CLI
		: CDT_CLI;
	const click = await sh([...bin, ...res.dispatch.argv]);
	const txt = click.out.toLowerCase();
	if (!(click.ok && (txt.includes("click") || txt.includes("iana") || txt.includes("done") || txt.includes("ran playwright") || txt.includes("navigated")))) {
		throw new Error("click did not land");
	}
	return { servedBy: engine, clicked: NAME };
}

// The facade fallback chain: try in order, fall through on failure, complete or exhaust.
async function facadeClick(preference: EngineId[]): Promise<void> {
	console.log(`${B}facade intent:${R} clickByName("${NAME}") on ${URL}`);
	console.log(`${D}preference order: ${preference.join(" → ")}${R}\n`);
	const attempts: string[] = [];
	for (let i = 0; i < preference.length; i++) {
		const engine = preference[i];
		process.stdout.write(`  ${i === 0 ? "try preferred" : `fall back #${i}`}: ${C}${engine}${R} ... `);
		try {
			const r = await attempt(engine);
			console.log(`${G}✓ served${R}`);
			console.log(`\n${B}═══ RESULT ═══${R}`);
			console.log(`  ${G}task COMPLETED${R} — served by ${C}${r.servedBy}${R} at fallback depth ${i}`);
			if (i > 0) console.log(`  ${Y}degraded gracefully:${R} ${attempts.join(", ")} failed, fell through to ${r.servedBy}`);
			console.log(`  ${D}servedBy=${r.servedBy} (the caller never named an engine — facade chose)${R}\n`);
			return;
		} catch (e) {
			console.log(`${RED}✗ ${(e as Error).message}${R}`);
			attempts.push(engine);
		}
	}
	console.log(`\n${RED}═══ ALL ENGINES EXHAUSTED — pool depleted ═══${R}\n`);
}

// Default preference: fastest-first (from the metrics: pw-cli, chrome-mcp, agent-browser, ...)
const PREF: EngineId[] = ["playwright-cli", "chrome-devtools", "agent-browser", "playwright-cdp", "chrome-devtools-cli"];
await facadeClick(PREF);
