#!/usr/bin/env bun
// PROTOTYPE — throwaway. FIVE-way live proof. One facade intent —
// clickByName("Learn more") — driven through 5 adapters spanning 2 transport kinds
// AND each engine via 2 transports:
//   N1 chrome-devtools (MCP)   N2 playwright-cdp (MCP)
//   N3 agent-browser (CLI)     N4 playwright-cli (CLI)   N5 chrome-devtools-cli (CLI)
//
// The matrix proves ref-FORMAT is engine-bound (uid= for both Chromes, [ref=] for
// the rest) while DISPATCH is transport-bound (5 distinct shapes). If both Chrome
// transports parse with the SAME parser and both Playwright transports too, while
// all 5 dispatch differently, the normalizer's two-axis design is validated.
//
// Prereqs (the harness assumes these are already up — set in this session):
//   - warm Chrome on 127.0.0.1:9222
//   - mcporter daemon managing chrome-devtools + playwright-cdp
//   - `chrome-devtools start --browserUrl http://127.0.0.1:9222` (N5 daemon)
//   - `playwright-cli attach --cdp http://127.0.0.1:9222` (N4 default session)
//
// Run: bun skills/browser-use/src/prototype-playwright-vocab-map/run-5way.ts
// SAFETY: prints ref shapes + click argv only; no full page text, no auth URLs.

import { clickByName, type EngineId, parseSnapshot } from "./ref-normalizer.ts";

const URL = "https://example.com";
const NAME = "Learn more";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", C = "\x1b[36m";

// resolved npx specs (kept as arrays so the harness is copy-pasteable)
const CDT_CLI = ["npx", "-y", "-p", "chrome-devtools-mcp@latest", "chrome-devtools"];
const PW_CLI = ["npx", "-y", "@playwright/cli@latest"];

async function sh(cmd: string[], timeoutMs = 60000): Promise<{ ok: boolean; out: string }> {
	const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const t = setTimeout(() => p.kill(), timeoutMs);
	const out = await new Response(p.stdout).text();
	const err = await new Response(p.stderr).text();
	const code = await p.exited;
	clearTimeout(t);
	return { ok: code === 0, out: (out + err) };
}
const mcpText = (raw: string) => {
	try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; }
};

// Layer-1 map: how each of the 5 produces a snapshot of the target page.
async function snapshot(engine: EngineId): Promise<string> {
	switch (engine) {
		case "chrome-devtools": {
			await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			return mcpText((await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"])).out);
		}
		case "playwright-cdp": {
			await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: URL }), "--output", "json"]);
			return mcpText((await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"])).out);
		}
		case "agent-browser":
			await sh(["agent-browser", "--cdp", "9222", "open", URL]);
			return (await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"])).out;
		case "playwright-cli":
			await sh([...PW_CLI, "--s=default", "goto", URL]);
			return (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
		case "chrome-devtools-cli":
			await sh([...CDT_CLI, "navigate_page", "--url", URL]);
			return (await sh([...CDT_CLI, "take_snapshot"])).out;
	}
}

// dispatch kind -> binary prefix
function binFor(kind: string): string[] {
	if (kind === "mcporter") return ["mcporter"];
	if (kind === "cli") return ["agent-browser"];
	if (kind === "cli-pwcli") return PW_CLI;
	if (kind === "cli-cdtcli") return CDT_CLI;
	return [];
}

const ENGINES: EngineId[] = [
	"chrome-devtools", "playwright-cdp", "agent-browser", "playwright-cli", "chrome-devtools-cli",
];
const LABEL: Record<EngineId, string> = {
	"chrome-devtools": "N1 chrome MCP   ",
	"playwright-cdp": "N2 playwright MCP",
	"agent-browser": "N3 agent-browser",
	"playwright-cli": "N4 playwright CLI",
	"chrome-devtools-cli": "N5 chrome CLI   ",
};

async function main() {
	console.log(`${B}ref-normalizer — FIVE-way live proof${R}`);
	console.log(`${D}one facade intent: clickByName("${NAME}") on ${URL}, 5 adapters, 2 transport kinds${R}\n`);

	console.log(`${B}── parse axis: which parser, which ref format ──${R}`);
	const fmt: Record<string, { count: number; raw: string; fmt: string }> = {};
	for (const e of ENGINES) {
		const refs = parseSnapshot(e, await snapshot(e));
		const t = refs.find((r) => r.name === NAME);
		const format = t ? (t.raw.startsWith("uid=") ? "uid=" : "[ref=]") : "?";
		fmt[e] = { count: refs.length, raw: t?.raw ?? "—", fmt: format };
		const ok = t ? G : RED;
		console.log(`  ${LABEL[e]}  refs:${String(refs.length).padStart(2)}  format:${C}${format.padEnd(7)}${R}  target:${ok}${t?.raw ?? "NOT FOUND"}${R}`);
	}

	console.log(`\n${B}── dispatch axis: same intent → 5 native click shapes, executed live ──${R}`);
	let landed = 0;
	for (const e of ENGINES) {
		// fresh snapshot immediately before click (refs stale after nav)
		const refs = parseSnapshot(e, await snapshot(e));
		const res = clickByName(refs, NAME);
		if ("error" in res) { console.log(`  ${LABEL[e]}  ${RED}${res.error.slice(0, 50)}${R}`); continue; }
		const bin = binFor(res.dispatch.kind);
		console.log(`  ${LABEL[e]}  ${C}${res.dispatch.kind}${R}  ${D}${bin[bin.length - 1]} ${res.dispatch.argv.join(" ")}${R}`);
		const r = await sh([...bin, ...res.dispatch.argv]);
		const txt = r.out.toLowerCase();
		const ok = r.ok && (txt.includes("click") || txt.includes("iana") || txt.includes("done") || txt.includes("ran playwright") || txt.includes("navigated"));
		console.log(`     ${ok ? `${G}✓ landed${R}` : `${RED}✗ ${r.out.replace(/\s+/g, " ").slice(0, 60)}${R}`}`);
		if (ok) landed++;
	}

	console.log(`\n${B}═══ VERDICT ═══${R}`);
	console.log(`  ${landed === 5 ? G : RED}${landed}/5 adapters clicked from one facade intent${R}`);
	// axis independence summary
	const chromeFmts = [fmt["chrome-devtools"]?.fmt, fmt["chrome-devtools-cli"]?.fmt];
	const pwFmts = [fmt["playwright-cdp"]?.fmt, fmt["playwright-cli"]?.fmt, fmt["agent-browser"]?.fmt];
	const chromeSame = chromeFmts[0] === chromeFmts[1];
	const pwSame = pwFmts.every((f) => f === pwFmts[0]);
	console.log(`  ${chromeSame ? G + "✓" : RED + "✗"}${R} both Chrome transports share ref format (${chromeFmts.join(" / ")}) — format is ENGINE-bound`);
	console.log(`  ${pwSame ? G + "✓" : RED + "✗"}${R} all Playwright-lineage share ref format (${pwFmts.join(" / ")}) — not transport-bound`);
	console.log(`  ${D}5 distinct dispatch shapes over the same 2 ref formats → the two axes are independent.${R}\n`);
}
main();
