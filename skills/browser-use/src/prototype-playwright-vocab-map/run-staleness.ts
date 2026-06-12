#!/usr/bin/env bun
// PROTOTYPE — throwaway. Characterizes REF STALENESS per engine — the verify-layer
// gap (R7). We observed MCP refs go stale silently while agent-browser re-resolves,
// but never measured it systematically. This harness, per engine:
//   1. snapshot page A, capture a ref to a known element
//   2. navigate away (page B) then back (page A) — the ref is now stale
//   3. try to USE the stale ref (click it)
//   4. record the FAILURE MODE: hard error | silent no-op | auto-recovered
//
// The failure-mode taxonomy is what a facade verify layer must handle. An engine
// that errors loudly is easy; one that silently no-ops is the dangerous case the
// verify layer exists to catch.
//
// Run (warm Chrome + fleet up): bun run-staleness.ts
// SAFETY: prints engine + element name + failure-mode classification only.

import { existsSync } from "node:fs";
import { sh } from "./fleet.ts";
import type { EngineId } from "./ref-normalizer.ts";

const PAGE_A = "https://example.com";
const PAGE_B = "https://www.iana.org/help/example-domains";
const ELEMENT = "Learn more"; // the link on example.com
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", Y = "\x1b[33m", RED = "\x1b[31m", C = "\x1b[36m";

const BIN = `${import.meta.dir}/node_modules/.bin`;
const CDT_CLI = existsSync(`${BIN}/chrome-devtools`) ? [`${BIN}/chrome-devtools`] : ["npx", "-y", "-p", "chrome-devtools-mcp@latest", "chrome-devtools"];
const PW_CLI = existsSync(`${BIN}/playwright-cli`) ? [`${BIN}/playwright-cli`] : ["npx", "-y", "@playwright/cli@latest"];
const mcpText = (raw: string) => { try { return JSON.parse(raw).content?.[0]?.text ?? raw; } catch { return raw; } };

type Outcome = { captured: string | null; mode: "hard-error" | "silent-noop" | "auto-recovered" | "stale-used-wrong" | "inconclusive"; detail: string };

// classify what happened when a stale ref is used
function classify(captured: string | null, clickOut: string, landedOnExpected: boolean): Outcome {
	if (!captured) return { captured, mode: "inconclusive", detail: "could not capture initial ref" };
	const out = clickOut.toLowerCase();
	const errored = /error|not found|no element|stale|invalid|failed|cannot|missing/.test(out);
	if (errored) return { captured, mode: "hard-error", detail: clickOut.replace(/\s+/g, " ").slice(0, 70) };
	if (landedOnExpected) return { captured, mode: "auto-recovered", detail: "stale ref still resolved to the element (engine re-resolved)" };
	// no error AND didn't land = the dangerous silent case
	return { captured, mode: "silent-noop", detail: "click 'succeeded' but page did not change — SILENT FAILURE" };
}

async function chromeDevtools(): Promise<Outcome> {
	await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: PAGE_A }), "--output", "json"]);
	const snapA = mcpText((await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"])).out);
	const uid = snapA.split("\n").find((l) => l.includes(ELEMENT))?.match(/uid=(\S+)/)?.[1] ?? null;
	// go away and back → uid from snapA is now stale
	await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: PAGE_B }), "--output", "json"]);
	await sh(["mcporter", "call", "chrome-devtools.navigate_page", "--args", JSON.stringify({ url: PAGE_A }), "--output", "json"]);
	if (!uid) return classify(null, "", false);
	const click = await sh(["mcporter", "call", "chrome-devtools.click", "--args", JSON.stringify({ uid }), "--output", "json"], 10000);
	const after = mcpText((await sh(["mcporter", "call", "chrome-devtools.take_snapshot", "--args", "{}", "--output", "json"])).out);
	const landed = /iana|example-domains/i.test(after); // clicking "Learn more" navigates to iana
	return classify(uid, mcpText(click.out), landed);
}

async function playwrightMcp(): Promise<Outcome> {
	await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: PAGE_A }), "--output", "json"]);
	const snapA = mcpText((await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"])).out);
	const ref = snapA.split("\n").find((l) => l.includes(ELEMENT))?.match(/ref=(\w+)/)?.[1] ?? null;
	await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: PAGE_B }), "--output", "json"]);
	await sh(["mcporter", "call", "playwright-cdp.browser_navigate", "--args", JSON.stringify({ url: PAGE_A }), "--output", "json"]);
	if (!ref) return classify(null, "", false);
	const click = await sh(["mcporter", "call", "playwright-cdp.browser_click", "--args", JSON.stringify({ target: ref }), "--output", "json"], 10000);
	const after = mcpText((await sh(["mcporter", "call", "playwright-cdp.browser_snapshot", "--args", "{}", "--output", "json"])).out);
	const landed = /iana|example-domains/i.test(after);
	return classify(ref, mcpText(click.out), landed);
}

async function agentBrowser(): Promise<Outcome> {
	await sh(["agent-browser", "--cdp", "9222", "open", PAGE_A]);
	const snapA = (await sh(["agent-browser", "--cdp", "9222", "snapshot", "-i"])).out;
	const ref = snapA.split("\n").find((l) => l.includes(ELEMENT))?.match(/ref=(\w+)/)?.[1] ?? null;
	await sh(["agent-browser", "--cdp", "9222", "open", PAGE_B]);
	await sh(["agent-browser", "--cdp", "9222", "open", PAGE_A]);
	if (!ref) return classify(null, "", false);
	const click = await sh(["agent-browser", "--cdp", "9222", "click", `@${ref}`], 10000);
	const after = (await sh(["agent-browser", "--cdp", "9222", "get", "url"])).out;
	const landed = /iana|example-domains/i.test(after);
	return classify(ref, click.out, landed);
}

async function playwrightCli(): Promise<Outcome> {
	await sh([...PW_CLI, "--s=default", "goto", PAGE_A]);
	const snapA = (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
	const ref = snapA.split("\n").find((l) => l.includes(ELEMENT))?.match(/ref=(\w+)/)?.[1] ?? null;
	await sh([...PW_CLI, "--s=default", "goto", PAGE_B]);
	await sh([...PW_CLI, "--s=default", "goto", PAGE_A]);
	if (!ref) return classify(null, "", false);
	const click = await sh([...PW_CLI, "--s=default", "click", ref], 12000);
	const after = (await sh([...PW_CLI, "--s=default", "snapshot"])).out;
	const landed = /iana|example-domains/i.test(after);
	return classify(ref, click.out, landed);
}

async function chromeCli(): Promise<Outcome> {
	await sh([...CDT_CLI, "navigate_page", "--url", PAGE_A]);
	const snapA = (await sh([...CDT_CLI, "take_snapshot"])).out;
	const uid = snapA.split("\n").find((l) => l.includes(ELEMENT))?.match(/uid=(\S+)/)?.[1] ?? null;
	await sh([...CDT_CLI, "navigate_page", "--url", PAGE_B]);
	await sh([...CDT_CLI, "navigate_page", "--url", PAGE_A]);
	if (!uid) return classify(null, "", false);
	const click = await sh([...CDT_CLI, "click", uid], 10000);
	const after = (await sh([...CDT_CLI, "take_snapshot"])).out;
	const landed = /iana|example-domains/i.test(after);
	return classify(uid, click.out, landed);
}

const RUNNERS: { engine: EngineId; label: string; run: () => Promise<Outcome> }[] = [
	{ engine: "chrome-devtools", label: "chrome-MCP", run: chromeDevtools },
	{ engine: "playwright-cdp", label: "playwright-MCP", run: playwrightMcp },
	{ engine: "agent-browser", label: "agent-browser", run: agentBrowser },
	{ engine: "playwright-cli", label: "playwright-CLI", run: playwrightCli },
	{ engine: "chrome-devtools-cli", label: "chrome-CLI", run: chromeCli },
];

async function main() {
	console.log(`${B}ref-staleness characterization — the verify-layer gap (R7)${R}`);
	console.log(`${D}per engine: snapshot A → capture ref → nav B → nav back A → use STALE ref → classify${R}\n`);

	const results: { label: string; o: Outcome }[] = [];
	for (const r of RUNNERS) {
		const o = await r.run();
		results.push({ label: r.label, o });
		const color = o.mode === "hard-error" ? G : o.mode === "auto-recovered" ? C : o.mode === "silent-noop" ? RED : Y;
		console.log(`  ${r.label.padEnd(15)} ${color}${o.mode}${R}  ${D}${o.detail}${R}`);
	}

	console.log(`\n${B}═══ FAILURE-MODE TAXONOMY (what the verify layer must handle) ═══${R}`);
	const hard = results.filter((r) => r.o.mode === "hard-error").map((r) => r.label);
	const silent = results.filter((r) => r.o.mode === "silent-noop").map((r) => r.label);
	const recovered = results.filter((r) => r.o.mode === "auto-recovered").map((r) => r.label);
	if (hard.length) console.log(`  ${G}hard-error (safe — verify layer just retries):${R} ${hard.join(", ")}`);
	if (recovered.length) console.log(`  ${C}auto-recovered (engine re-resolves, no action needed):${R} ${recovered.join(", ")}`);
	if (silent.length) console.log(`  ${RED}SILENT NO-OP (DANGEROUS — verify layer MUST catch via post-state check):${R} ${silent.join(", ")}`);
	console.log(`\n  ${D}Verify-layer design implication: engines split across failure modes, so the facade${R}`);
	console.log(`  ${D}CANNOT assume a uniform staleness contract. It must verify POST-STATE (did the page${R}`);
	console.log(`  ${D}change as intended?) rather than trust any engine's click return — exactly the${R}`);
	console.log(`  ${D}postcondition-floor answer, now forced by measured per-engine divergence.${R}\n`);
}
main();
