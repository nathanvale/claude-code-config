// PROTOTYPE — throwaway shared helper. The Layer-1 snapshot mapping for all 5
// engines, extracted so the dividend prototypes (perception, repro) reuse it
// instead of copy-pasting. Thin wrapper over mcporter / the CLIs against warm Chrome.
//
// WARM-CHROME RULE (per browser-use skill): a spike must NOT hand-launch Chrome. It
// proves Warm Chrome through the skill's own front door (preflight-warm-chrome check) and
// refuses with the skill's guidance if absent. The skill owns browser entry + the Warm
// Chrome invariant; spikes are consumers. Call `await requireWarmChrome()` at the top of
// any browser-driving spike before touching the fleet.

import { existsSync } from "node:fs";
import type { EngineId } from "./ref-normalizer.ts";

const BIN = `${import.meta.dir}/node_modules/.bin`;
export const CDT_CLI = existsSync(`${BIN}/chrome-devtools`)
	? [`${BIN}/chrome-devtools`]
	: ["npx", "-y", "-p", "chrome-devtools-mcp@latest", "chrome-devtools"];
export const PW_CLI = existsSync(`${BIN}/playwright-cli`)
	? [`${BIN}/playwright-cli`]
	: ["npx", "-y", "@playwright/cli@latest"];

export const ENGINES: EngineId[] = [
	"chrome-devtools",
	"playwright-cdp",
	"agent-browser",
	"playwright-cli",
	"chrome-devtools-cli",
];
export const LABEL: Record<EngineId, string> = {
	"chrome-devtools": "chrome-MCP",
	"playwright-cdp": "playwright-MCP",
	"agent-browser": "agent-browser",
	"playwright-cli": "playwright-CLI",
	"chrome-devtools-cli": "chrome-CLI",
};

export async function sh(cmd: string[], timeoutMs = 60000): Promise<{ ok: boolean; out: string; ms: number }> {
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

// Prove Warm Chrome THROUGH the browser-use skill's front door, not by hand-launching.
// Runs `preflight-warm-chrome check`; on failure, prints the skill's continuation guidance
// and throws. A spike calls this first and never wires Chrome itself (the skill owns entry).
const SKILL_DIR = `${import.meta.dir}/../..`; // skills/browser-use
export async function requireWarmChrome(): Promise<void> {
	// run the skill's package script FROM the skill dir (it's `bun run preflight-warm-chrome`)
	const r = await sh(["bash", "-lc", `cd ${SKILL_DIR} && bun run preflight-warm-chrome check --json`], 60000);
	// envelope (last JSON obj): {status:"ok", continuation:{next_action_id:"use_verified_endpoint"}}
	const reachable = /"status":\s*"ok"/.test(r.out)
		&& /use_verified_endpoint/.test(r.out)
		&& !/endpoint_unreachable/.test(r.out);
	if (!reachable) {
		console.error("\x1b[31m✗ Warm Chrome not verified via the browser-use skill.\x1b[0m");
		console.error("  This spike does NOT launch Chrome itself — the browser-use skill owns browser entry.");
		console.error("  Run the skill's front door (approved browser entry required):");
		console.error("    cd skills/browser-use && bun run preflight-warm-chrome launch --json");
		console.error("  then rerun this spike. (preflight check output below)");
		console.error(r.out.split("\n").filter((l) => l.includes("\"code\"") || l.includes("\"next_action_id\"")).slice(0, 3).join("\n"));
		throw new Error("warm-chrome-not-verified");
	}
}

// note: SKILL_DIR-relative `bun run preflight-warm-chrome` requires cwd at the skill or the
// script invoked from there; the helper spawns from the prototype cwd, so resolve explicitly.

// Warm-Chrome gate is proven once per process, then cached — every browser spike that
// calls navSnap is automatically routed through the skill's preflight first.
let _warmProven = false;
async function ensureWarmOnce(): Promise<void> {
	if (_warmProven) return;
	await requireWarmChrome();
	_warmProven = true;
}

// Layer-1 map: navigate + snapshot per engine. Returns raw snapshot text + ms.
// Proves Warm Chrome through the browser-use skill on first call (never hand-launches).
export async function navSnap(engine: EngineId, url: string): Promise<{ snap: string; ms: number; ok: boolean }> {
	await ensureWarmOnce();
	switch (engine) {
		case "chrome-devtools": {
			await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url }), "--output", "json"]);
			const r = await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"]);
			return { snap: mcpText(r.out), ms: r.ms, ok: r.ok };
		}
		case "playwright-cdp": {
			await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url }), "--output", "json"]);
			const r = await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"]);
			return { snap: mcpText(r.out), ms: r.ms, ok: r.ok };
		}
		case "agent-browser": {
			await sh(["agent-browser", "--cdp", "9222", "open", url]);
			const r = await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
		case "playwright-cli": {
			await sh([...PW_CLI, "--s=default", "goto", url]);
			const r = await sh([...PW_CLI, "--s=default", "snapshot"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
		case "chrome-devtools-cli": {
			await sh([...CDT_CLI, "navigate_page", "--url", url]);
			const r = await sh([...CDT_CLI, "take_snapshot"]);
			return { snap: r.out, ms: r.ms, ok: r.ok };
		}
	}
}

// Interactive element names an engine sees (link/button/textbox/etc), as a Set.
import { parseSnapshot } from "./ref-normalizer.ts";
export function interactiveNames(engine: EngineId, snap: string): Set<string> {
	return new Set(
		parseSnapshot(engine, snap)
			.filter((r) => /link|button|textbox|checkbox|combobox|menuitem|tab|switch/i.test(r.role))
			.map((r) => r.name)
			.filter(Boolean),
	);
}
