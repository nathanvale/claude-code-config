#!/usr/bin/env bun
// PROTOTYPE — throwaway. THIRD-LINEAGE probe: does adding a Firefox/WebKit engine
// slot into the two-axis mapping at the promised sub-linear cost, or does it expose
// a limit? And what does Firefox being a SEPARATE BROWSER (not CDP-attached to warm
// Chrome) cost the "one warm world" moat?
//
// Two claims under test:
//   (A) SCALING: ref-FORMAT lineage. Chrome lineage = `uid=`, Chromium/Playwright
//       lineage = `[ref=]`. Firefox is driven by Playwright too → does it ALSO emit
//       `[ref=]` (→ 0 new parsers, sub-linear confirmed) or a 3rd format (→ +1 parser)?
//   (B) MOAT BOUNDARY: warm Chrome is ONE world; all 5 current engines attach to it
//       over CDP and see the SAME page state. Firefox CANNOT attach to Chrome's CDP —
//       it is a separate process, separate profile, separate world. So a Chrome-lineage
//       ref and a Firefox ref describe DIFFERENT browser instances. The differential
//       oracle (Set-diff of refs) still works WITHIN one world; across worlds it
//       measures cross-BROWSER rendering divergence, not cross-LENS observer error.
//
// Method:
//   - Chrome lineage baseline: go through the browser-use skill's warm-Chrome front
//     door (requireWarmChrome), snapshot via playwright-cdp (the [ref=] lineage) +
//     chrome-devtools (the uid= lineage).
//   - Firefox: playwright-cli `open --browser firefox` (its OWN process — the spike
//     does NOT and CANNOT route this through warm Chrome; that impossibility is finding B).
//   - Parse all three with the EXISTING ref-normalizer. Count new parsers needed.
//   - Diff interactive-name Sets: Chrome-world vs Firefox-world.
//
// Run: bun skills/browser-use/src/prototype-playwright-vocab-map/run-firefox-lineage.ts
// SAFETY: prints ref shapes + name sets only; no auth URLs, no full page text.

import { parseSnapshot, type EngineId, type FacadeRef } from "./ref-normalizer.ts";
import { PW_CLI, requireWarmChrome, sh, navSnap, interactiveNames } from "./fleet.ts";

const URL = process.argv[2] ?? "https://example.com";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", C = "\x1b[36m", Y = "\x1b[33m";

// Firefox is a NEW engine id not in the EngineId union. The whole question is whether
// it can REUSE an existing parser. We try the [ref=] (Playwright-lineage) parser first
// by parsing AS IF it were playwright-cli, and report whether that parser found refs.
const FIREFOX_SESSION = "ff";

async function firefoxSnapshot(): Promise<{ snap: string; ok: boolean; ms: number }> {
	// Firefox CANNOT attach to warm Chrome's CDP. It launches its OWN browser. This is
	// finding (B) made executable: there is no warm-Chrome front door for a non-CDP browser.
	const start = performance.now();
	const open = await sh([...PW_CLI, `--s=${FIREFOX_SESSION}`, "open", "--browser", "firefox", URL], 120000);
	if (!open.ok) return { snap: open.out, ok: false, ms: performance.now() - start };
	const snap = await sh([...PW_CLI, `--s=${FIREFOX_SESSION}`, "snapshot"], 60000);
	return { snap: snap.out, ok: snap.ok, ms: performance.now() - start };
}

function tryParsers(snap: string): { parser: string; refs: FacadeRef[] }[] {
	// Run the snapshot through BOTH existing parsers; whichever yields refs is the lineage.
	const asBracket = parseSnapshot("playwright-cli" as EngineId, snap); // [ref=]
	const asUid = parseSnapshot("chrome-devtools" as EngineId, snap); // uid=
	return [
		{ parser: "[ref=] (Playwright lineage)", refs: asBracket },
		{ parser: "uid= (Chrome lineage)", refs: asUid },
	];
}

async function main() {
	console.log(`${B}third-lineage probe — Firefox via Playwright${R}`);
	console.log(`${D}claim A: 0 new parsers?  claim B: separate world breaks shared-world moat?${R}\n`);

	// ── Chrome-world baseline (through the skill's warm-Chrome front door) ──
	console.log(`${B}── Chrome world (warm Chrome, via the browser-use skill) ──${R}`);
	await requireWarmChrome();
	const pwCdp = await navSnap("playwright-cdp", URL); // [ref=] lineage, CDP-attached
	const chrome = await navSnap("chrome-devtools", URL); // uid= lineage, CDP-attached
	const pwCdpRefs = parseSnapshot("playwright-cdp", pwCdp.snap);
	const chromeRefs = parseSnapshot("chrome-devtools", chrome.snap);
	console.log(`  ${C}playwright-cdp${R}  refs:${String(pwCdpRefs.length).padStart(2)}  format:${pwCdpRefs[0]?.raw.startsWith("uid=") ? "uid=" : "[ref=]"}  ${G}CDP-attached → same world${R}`);
	console.log(`  ${C}chrome-devtools${R} refs:${String(chromeRefs.length).padStart(2)}  format:${chromeRefs[0]?.raw.startsWith("uid=") ? "uid=" : "[ref=]"}    ${G}CDP-attached → same world${R}`);

	// ── Firefox world (its own process — cannot share warm Chrome) ──
	console.log(`\n${B}── Firefox world (separate browser, NOT warm Chrome) ──${R}`);
	const ff = await firefoxSnapshot();
	if (!ff.ok) {
		console.log(`  ${RED}✗ Firefox snapshot failed:${R} ${ff.snap.replace(/\s+/g, " ").slice(0, 120)}`);
		process.exit(1);
	}
	console.log(`  ${G}✓${R} Firefox launched as its OWN process in ${(ff.ms / 1000).toFixed(1)}s ${D}(no CDP to warm Chrome — separate world)${R}`);

	// ── Claim A: does an EXISTING parser handle Firefox's snapshot? ──
	console.log(`\n${B}── claim A: ref-format lineage (0 new parsers?) ──${R}`);
	const parsed = tryParsers(ff.snap);
	for (const p of parsed) {
		const hit = p.refs.length > 0;
		console.log(`  ${hit ? G + "✓" : D + "·"}${R} ${p.parser.padEnd(28)} → ${String(p.refs.length).padStart(2)} refs ${hit ? "" : D + "(no match)" + R}`);
	}
	const bracketRefs = parsed[0].refs;
	const newParsersNeeded = bracketRefs.length > 0 ? 0 : 1;
	console.log(`  ${newParsersNeeded === 0 ? G : Y}→ new parsers needed for Firefox: ${newParsersNeeded}${R} ${D}${newParsersNeeded === 0 ? "(Firefox reuses the [ref=] parser — sub-linear holds)" : "(Firefox emits a 3rd format — scaling claim dented)"}${R}`);

	// ── Claim B: same-world vs cross-world divergence ──
	console.log(`\n${B}── claim B: what the separate world costs ──${R}`);
	const chromeWorldNames = interactiveNames("playwright-cdp", pwCdp.snap);
	const ffNames = new Set(
		parseSnapshot("playwright-cli" as EngineId, ff.snap)
			.filter((r) => /link|button|textbox|checkbox|combobox|menuitem|tab|switch/i.test(r.role))
			.map((r) => r.name).filter(Boolean),
	);
	const onlyChrome = [...chromeWorldNames].filter((n) => !ffNames.has(n));
	const onlyFf = [...ffNames].filter((n) => !chromeWorldNames.has(n));
	const shared = [...chromeWorldNames].filter((n) => ffNames.has(n));
	console.log(`  Chrome-world interactive names: ${chromeWorldNames.size}  (${[...chromeWorldNames].join(", ") || "—"})`);
	console.log(`  Firefox-world interactive names: ${ffNames.size}  (${[...ffNames].join(", ") || "—"})`);
	console.log(`  ${G}shared:${R} ${shared.length}   ${Y}only-Chrome:${R} ${onlyChrome.length}   ${Y}only-Firefox:${R} ${onlyFf.length}`);

	console.log(`\n${B}═══ VERDICT ═══${R}`);
	console.log(`  ${newParsersNeeded === 0 ? G + "✓ SCALING" : Y + "~ SCALING"}${R}: Firefox needs ${newParsersNeeded} new parser(s). ${newParsersNeeded === 0 ? "The 3rd RENDERING lineage rides the existing [ref=] PARSER — ref-format clusters by DRIVER (Playwright), not by rendering engine." : "Firefox emits its own ref format."}`);
	console.log(`  ${Y}⚠ MOAT${R}: Firefox is a separate process — it does NOT join warm Chrome's world. Cross-world name-diff (${onlyChrome.length}+${onlyFf.length} divergent) measures cross-BROWSER rendering, NOT the same-world observer-error the moat is built on.`);
	console.log(`  ${D}→ Firefox is a cheap ADDITIONAL world (good for cross-browser parity checks), not another LENS on the warm-Chrome world. The oracle's 'no engine is a second opinion on itself' property is intra-world; it does not extend across browsers for free.${R}\n`);

	// cleanup the firefox session
	await sh([...PW_CLI, `--s=${FIREFOX_SESSION}`, "close"], 30000);
}
main();
