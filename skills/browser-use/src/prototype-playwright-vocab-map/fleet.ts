// PROTOTYPE — throwaway shared helper. The Layer-1 snapshot mapping for all 5
// engines, extracted so the dividend prototypes (perception, repro) reuse it
// instead of copy-pasting. Thin wrapper over mcporter / the CLIs against warm Chrome.

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

// Layer-1 map: navigate + snapshot per engine. Returns raw snapshot text + ms.
export async function navSnap(engine: EngineId, url: string): Promise<{ snap: string; ms: number; ok: boolean }> {
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
