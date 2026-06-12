#!/usr/bin/env bun
// PROTOTYPE — throwaway live harness. Drives `snapshot` through BOTH engines via
// the same mcporter transport the real machinery uses, against the live warm
// Chrome, then diffs. Answers the two questions the first spike couldn't reach:
//   (1) does the Layer-1 vocab map make playwright's snapshot REACHABLE?
//   (2) how bad is the Layer-2 ref-shape diff between engines?
//
// Run (warm Chrome must be up on 127.0.0.1:9222):
//   bun skills/browser-use/src/prototype-playwright-vocab-map/run.ts <url>
//
// SAFETY: prints snapshot SHAPE + small redacted samples only — never full page
// text, never auth-bearing URLs. Default URL is a neutral public page.

import { type EngineMap, ENGINE_MAPS, resolve } from "./vocab-map.ts";

const TARGET = process.argv[2] ?? "https://example.com";
const B = "\x1b[1m";
const D = "\x1b[2m";
const R = "\x1b[0m";
const G = "\x1b[32m";
const RED = "\x1b[31m";

function redactUrl(u: string): string {
	try {
		const url = new URL(u);
		return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : "/…"}`;
	} catch {
		return "(non-url)";
	}
}

// Build the mcporter argv for an engine+tool, riding the real transport shape.
function mcporterArgs(map: EngineMap, tool: string, args: Record<string, unknown>): string[] {
	const base =
		map.transport.kind === "configured"
			? [`${map.transport.server}.${tool}`]
			: [
					tool,
					"--stdio",
					map.transport.command,
					...map.transport.args.flatMap((a) => ["--stdio-arg", a]),
				];
	return ["call", ...base, "--args", JSON.stringify(args), "--output", "json", "--timeout", "60000"];
}

async function callMcporter(argv: string[]): Promise<{ ok: boolean; text: string }> {
	const proc = Bun.spawn(["mcporter", ...argv], { stdout: "pipe", stderr: "pipe" });
	const out = await new Response(proc.stdout).text();
	const err = await new Response(proc.stderr).text();
	const code = await proc.exited;
	if (code !== 0) return { ok: false, text: err.slice(0, 400) };
	return { ok: true, text: out };
}

// Pull the snapshot text out of an MCP result envelope (both engines wrap in content[].text).
function extractSnapshotText(raw: string): string {
	try {
		const j = JSON.parse(raw);
		const blocks = j.content ?? [];
		return blocks
			.filter((b: { type: string }) => b.type === "text")
			.map((b: { text: string }) => b.text)
			.join("\n");
	} catch {
		return raw;
	}
}

// Characterize a snapshot's SHAPE without dumping it — this is the diff signal.
function shape(text: string): {
	bytes: number;
	lines: number;
	refStyle: string;
	refCount: number;
	sample: string;
} {
	const lines = text.split("\n").length;
	// chrome-devtools uses uid= refs; playwright uses [ref=...] refs.
	const uidRefs = (text.match(/uid=/g) ?? []).length;
	const pwRefs = (text.match(/\[ref=/g) ?? []).length;
	const roleLines = (text.match(/\b(button|link|textbox|heading|image)\b/gi) ?? []).length;
	const refStyle = uidRefs > pwRefs ? "uid= (chrome-devtools a11y)" : pwRefs > 0 ? "[ref=] (playwright)" : "none detected";
	// redacted sample: first non-empty line, truncated, no urls
	const firstLine = (text.split("\n").find((l) => l.trim()) ?? "").slice(0, 80);
	return {
		bytes: text.length,
		lines,
		refStyle,
		refCount: Math.max(uidRefs, pwRefs),
		sample: firstLine.replace(/https?:\/\/\S+/g, "<url>"),
	};
}

async function snapshotEngine(map: EngineMap) {
	console.log(`\n${B}── ${map.id} ──${R}`);
	// navigate first (both support it)
	const nav = resolve(map, "navigate", { url: TARGET });
	if (nav.ok) {
		console.log(`${D}navigate → ${nav.tool}({url})${R}`);
		const r = await callMcporter(mcporterArgs(map, nav.tool, nav.args));
		if (!r.ok) {
			console.log(`${RED}navigate failed: ${r.text.split("\n")[0]}${R}`);
			return null;
		}
	}
	const snap = resolve(map, "snapshot");
	if (!snap.ok) {
		console.log(`${RED}snapshot ABSENT for ${map.id}${R}`);
		return null;
	}
	console.log(`${D}snapshot → ${snap.tool}() ${G}[Layer-1 map resolved]${R}`);
	const r = await callMcporter(mcporterArgs(map, snap.tool, snap.args));
	if (!r.ok) {
		console.log(`${RED}snapshot call failed:${R} ${r.text.split("\n")[0]}`);
		return null;
	}
	const sh = shape(extractSnapshotText(r.text));
	console.log(`  ${G}reachable ✓${R}  ${sh.bytes}b / ${sh.lines} lines`);
	console.log(`  refStyle: ${B}${sh.refStyle}${R}  refCount≈${sh.refCount}`);
	console.log(`  ${D}sample: ${sh.sample}${R}`);
	return sh;
}

async function main() {
	console.log(`${B}vocab-map spike — live cross-engine snapshot diff${R}`);
	console.log(`${D}target: ${redactUrl(TARGET)}  ·  warm Chrome 127.0.0.1:9222${R}`);

	const results: Record<string, ReturnType<typeof shape> | null> = {};
	for (const map of ENGINE_MAPS) {
		results[map.id] = await snapshotEngine(map);
	}

	console.log(`\n${B}═══ DIFF / VERDICT ═══${R}`);
	const cd = results["chrome-devtools"];
	const pw = results["playwright-cdp"];

	const reachable = cd && pw;
	console.log(
		`${B}Half 1 — Layer-1 map makes playwright snapshot reachable:${R} ${pw ? `${G}YES${R}` : `${RED}NO${R}`}`,
	);
	console.log(
		`${B}Half 2 — cross-engine diff produces signal:${R} ${reachable ? `${G}YES${R}` : `${RED}couldn't run${R}`}`,
	);
	if (reachable) {
		console.log(`\n  chrome-devtools: ${cd.refStyle}, ${cd.refCount} refs, ${cd.bytes}b`);
		console.log(`  playwright-cdp : ${pw.refStyle}, ${pw.refCount} refs, ${pw.bytes}b`);
		const refStyleDiffers = cd.refStyle !== pw.refStyle;
		console.log(
			`\n  ${B}ref-shape divergence:${R} ${refStyleDiffers ? `${RED}DIFFERENT ref models${R} — Layer-2 normalization needed (the real work)` : `${G}same ref model${R}`}`,
		);
		console.log(
			`  ${D}This is the postcondition-floor question made concrete: same 'snapshot' verb,${R}`,
		);
		console.log(`  ${D}two ref vocabularies. A click consuming these refs needs normalization.${R}`);
	}
	console.log("");
}

main();
