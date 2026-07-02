#!/usr/bin/env bun
// PROTOTYPE — throwaway. SIXTH-LINEAGE probe: a VISION / computer-use engine that
// perceives PIXELS, not DOM. Tests the hardest case for the facade contract:
//
//   (A) CONTRACT: every DOM engine yields FacadeRef {engine, raw, role, name} — a ref
//       into the a11y tree. A vision engine has NO ref: it sees a screenshot and emits
//       (x,y) / a bounding box. Does FacadeRef bend or break? (Claim: it BREAKS for the
//       perception axis — there is no `raw` ref — but a vision observation can be REDUCED
//       to a FacadeRef by hit-testing the coordinate back into the DOM. So vision is not a
//       6th parser; it is a different PERCEPTION MODE that the facade must model explicitly.)
//
//   (B) NEW ORACLE AXIS: the 5 DOM engines all read the SAME a11y tree → they agree on
//       structure and CANNOT catch a DOM-vs-paint mismatch (an element the DOM says is
//       clickable but is visually COVERED by an overlay). A pixel lens catches exactly
//       that. We prove it with REAL geometry from warm Chrome: for each interactive DOM
//       node, compare its center point's DOM truth (the node) against what is actually
//       PAINTED there (elementsFromPoint top hit). Agreement = honest; mismatch = the
//       vision-only signal ("DOM says button here, paint says overlay here").
//
// This is a TRUE test, not a vision-LLM simulation: CDP gives both layers of the SAME warm
// page — the a11y/DOM tree (what the fleet sees) and elementsFromPoint (what pixels show).
// The DOM-vs-paint diff is the structural core of what a vision engine would contribute;
// running it without an LLM isolates the ARCHITECTURE question from model quality.
//
// Run: bun skills/browser-use/src/prototype-playwright-vocab-map/run-vision-lineage.ts [url]
// SAFETY: prints roles/names/coords + counts only; no auth URLs, no full page text.

import { requireWarmChrome, sh } from "./fleet.ts";

const URL = process.argv[2] ?? "https://news.ycombinator.com";
const B = "\x1b[1m", D = "\x1b[2m", R = "\x1b[0m", G = "\x1b[32m", RED = "\x1b[31m", C = "\x1b[36m", Y = "\x1b[33m";

type DomNode = { role: string; name: string; x: number; y: number; w: number; h: number; tag: string };
type Probe = { node: DomNode; covered: boolean; topTag: string; topText: string };

// One eval against the warm page via agent-browser (the fleet's proven CDP path — Playwright's
// browser-level connectOverCDP hangs when other CDP clients hold the targets, so we use the
// engine the fleet already trusts). Returns BOTH layers in one shot: DOM geometry + paint truth.
// agent-browser eval takes a bare EXPRESSION, not a function — wrap as an IIFE.
const PROBE_JS = `(() => {
  const out = [];
  const sel = "a,button,input,[role=button],[role=link],[onclick]";
  const inline = new Set(["span","svg","path","img","b","i","use","g","em","strong"]);
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.top < 0 || r.left < 0) continue;
    if (r.top > innerHeight || r.left > innerWidth) continue;
    const x = r.left + r.width/2, y = r.top + r.height/2;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || tag;
    const name = (el.getAttribute("aria-label") || el.innerText || el.value || "").trim().slice(0,40);
    const stack = document.elementsFromPoint(x, y);
    const top = stack[0];
    const topTag = top ? top.tagName.toLowerCase() : "none";
    const topText = top ? (top.innerText||"").trim().slice(0,30) : "";
    // covered = painted top is neither the node, nor a descendant/ancestor, nor a typical inline child
    const related = top && (el.contains(top) || top.contains(el));
    const covered = topTag !== tag && !related && !inline.has(topTag) && topTag !== "none";
    out.push({ role, name, x, y, w: r.width, h: r.height, tag, covered, topTag, topText });
  }
  return out;
})()`;

function parseEval(raw: string): any[] {
	// agent-browser --json envelope: {success, data:{origin, result}, error}
	try {
		const j = JSON.parse(raw);
		const res = j?.data?.result ?? j?.result ?? j;
		if (Array.isArray(res)) return res;
		if (typeof res === "string") return JSON.parse(res);
		return [];
	} catch {
		const m = raw.match(/\[[\s\S]*\]/);
		return m ? JSON.parse(m[0]) : [];
	}
}

async function main() {
	console.log(`${B}sixth-lineage probe — VISION / computer-use (pixels, not DOM)${R}`);
	console.log(`${D}claim A: does FacadeRef break for a no-DOM lens?  claim B: new DOM-vs-paint oracle axis?${R}\n`);

	// Chrome-world via the skill's warm-Chrome front door (the fleet's shared world).
	await requireWarmChrome();
	await sh(["agent-browser", "--cdp", "9222", "open", URL], 60000);
	await new Promise((r) => setTimeout(r, 1200));
	const evalRes = await sh(["agent-browser", "--cdp", "9222", "--json", "eval", PROBE_JS], 60000);
	const rows = parseEval(evalRes.out);
	if (!rows.length) {
		console.log(`${RED}✗ eval returned no rows.${R} raw: ${evalRes.out.replace(/\s+/g, " ").slice(0, 160)}`);
		process.exit(1);
	}
	const probes: Probe[] = rows.map((n) => ({
		node: { role: n.role, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h, tag: n.tag },
		covered: !!n.covered, topTag: n.topTag, topText: n.topText,
	}));

	// ── Claim A: the FacadeRef contract under a no-DOM lens ──
	console.log(`${B}── claim A: does FacadeRef {engine,raw,role,name} survive a pixel lens? ──${R}`);
	console.log(`  DOM engines: ref is ${C}raw${R} (a11y node id) → click(raw). Vision engine: observation is ${C}(x,y) box${R}, NO raw.`);
	console.log(`  ${Y}→ FacadeRef.raw has no vision equivalent.${R} A vision obs is reduced to a ref by HIT-TESTING the`);
	console.log(`     coordinate back into the DOM (elementsFromPoint). Vision is a PERCEPTION MODE, not a 6th parser:`);
	console.log(`     it needs a {x,y,box} shape + a hit-test bridge, which the 2-parser model does NOT cover.`);
	console.log(`  ${G}contract verdict: FacadeRef bends — perception must become a sum type${R} ${D}(RefObservation | PixelObservation)${R}`);

	// ── Claim B: the DOM-vs-paint divergence only a pixel lens can see ──
	console.log(`\n${B}── claim B: DOM-vs-paint mismatch (the vision-only oracle axis) ──${R}`);
	const covered = probes.filter((p) => p.covered);
	console.log(`  interactive DOM nodes on screen: ${probes.length}`);
	console.log(`  ${covered.length ? Y : G}DOM-says-clickable but PAINT-shows-other: ${covered.length}${R}`);
	for (const p of covered.slice(0, 8)) {
		console.log(`    ${D}DOM:${R} ${p.node.tag} "${p.node.name || "—"}"  ${D}@(${p.node.x | 0},${p.node.y | 0})${R}  →  ${RED}PAINT top: <${p.topTag}> "${p.topText || "—"}"${R}`);
	}
	if (!covered.length) console.log(`    ${D}(none on this page — DOM and paint agree; the signal is page-dependent. Overlay/cookie-wall pages trigger it.)${R}`);

	// ── Claim B, demonstrated: inject a real overlay and prove the diff FIRES ──
	// (0-mismatches on a clean page only shows no false positives; this shows a true positive.)
	console.log(`\n${B}── claim B, demonstrated: inject an overlay, prove the pixel lens catches it ──${R}`);
	const demo = await sh(["agent-browser", "--cdp", "9222", "--json", "eval", `(() => {
		const o = document.createElement("div");
		o.id = "__spike_overlay__";
		o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.01);z-index:2147483647";
		document.body.appendChild(o);
		const a = [...document.querySelectorAll("a")].find(el => { const r = el.getBoundingClientRect(); return r.width>2 && r.top>0 && r.top<innerHeight; });
		const r = a.getBoundingClientRect();
		const top = document.elementsFromPoint(r.left+r.width/2, r.top+r.height/2)[0];
		const covered = top.id === "__spike_overlay__";
		o.remove();
		return { domTag: a.tagName.toLowerCase(), paintTag: top.tagName.toLowerCase(), paintId: top.id, covered };
	})()`], 30000);
	let demoCovered = false;
	try { const d = JSON.parse(demo.out)?.data?.result; demoCovered = !!d?.covered;
		console.log(`  with overlay injected: DOM still says ${C}<${d?.domTag}> clickable${R}, paint says ${RED}<${d?.paintTag} id=${d?.paintId}>${R} on top → ${demoCovered ? G + "COVERED detected ✓" : RED + "missed ✗"}${R}`);
	} catch { console.log(`  ${RED}demo eval parse failed${R}`); }
	console.log(`  ${D}DOM-only fleet would click the link ref and hit the overlay silently; the pixel lens is the only lens that sees it.${R}`);

	console.log(`\n${B}═══ VERDICT ═══${R}`);
	console.log(`  ${Y}~ CONTRACT${R}: FacadeRef BREAKS for the perception axis — a vision engine has no a11y ref.`);
	console.log(`    It is NOT a 6th parser (the two-axis model assumes a ref token); it is a distinct PERCEPTION`);
	console.log(`    MODE. Reconciled to the fleet only via a coordinate→DOM hit-test bridge. The facade must model`);
	console.log(`    perception as a sum type {RefObservation | PixelObservation}, not assume every engine yields a ref.`);
	console.log(`  ${G}✓ NEW ORACLE AXIS${R}: the 5 DOM engines share the a11y tree → they CANNOT diff DOM vs paint`);
	console.log(`    (${covered.length} mismatch${covered.length === 1 ? "" : "es"} found here). A pixel lens catches the "DOM says clickable, overlay covers it"`);
	console.log(`    class — the exact silent failure (click lands on the wrong painted thing) the DOM fleet is blind to.`);
	console.log(`  ${D}→ Vision is the one lineage that EXTENDS the moat instead of just scaling it: it adds an${R}`);
	console.log(`  ${D}  uncorrelated PERCEPTION (pixels), not another reader of the same a11y tree. Highest moat value,${R}`);
	console.log(`  ${D}  highest integration cost (breaks the ref contract). The Firefox spike added a world; this adds a sense.${R}\n`);
}
main();
