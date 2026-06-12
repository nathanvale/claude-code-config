// PROTOTYPE — throwaway. The Layer-2 piece: a ref-normalizer so a facade-level
// `click(ref)` works regardless of which engine produced the ref from `snapshot`.
//
// Built against REAL captured output (live, warm Chrome, example.com):
//   chrome-devtools snapshot: `uid=2_3 link "Learn more" url="..."`     → ref token `uid=2_3`
//   playwright      snapshot: `- link "Learn more" [ref=e2]`           → ref token `[ref=e2]`
//   agent-browser   snapshot: `- link "Learn more" [ref=e2]`           → ref token `[ref=e2]`
//
//   chrome-devtools click: MCP tool, ref passed as JSON field (uid)
//   playwright      click: MCP browser_click, ref passed as JSON field (ref)
//   agent-browser   click: CLI arg `click @e2`  (NOT json — different dispatch shape)
//
// Key finding the 3-way diff surfaced: there are TWO ref *formats* (uid= vs [ref=])
// but THREE click *dispatch shapes* (mcp-uid, mcp-ref, cli-@ref). The normalizer
// must handle both axes. A 2-engine spike would have hidden the dispatch-shape axis
// because both MCP engines pass the ref as a JSON field — agent-browser's CLI @ref
// is what proves the normalizer generalizes instead of pair-hardcoding.

// ---------------------------------------------------------------------------
// 1. A facade-level ref: engine-origin-tagged so click knows how to dispatch.
//    This is the postcondition-floor answer made concrete — the ref is NOT a
//    bare string; it carries which engine's vocabulary produced it (loud, not faked).
// ---------------------------------------------------------------------------

// N=5 matrix. Each ENGINE appears via two TRANSPORTS (MCP server vs CLI/direct-CDP),
// which is the test of whether ref-format and dispatch-shape are truly independent:
//   engine        transport     ref format   dispatch
//   chrome        MCP           uid=         mcp-json {uid}
//   chrome        CLI           uid=         cli positional <uid>
//   playwright    MCP           [ref=]       mcp-json {target}
//   playwright    CLI           [ref=]       cli positional <ref>
//   (chromium)    agent-browser CLI [ref=]   cli @ref
export type EngineId =
	| "chrome-devtools" // N1: Chrome via MCP
	| "playwright-cdp" // N2: Playwright via MCP
	| "agent-browser" // N3: agent-browser CLI (direct CDP)
	| "playwright-cli" // N4: @playwright/cli (Playwright via CLI)
	| "chrome-devtools-cli"; // N5: chrome-devtools CLI (Chrome via CLI, DevTools-for-Agents 1.0)

export type FacadeRef = {
	engine: EngineId; // origin — decides dispatch
	raw: string; // the engine-native ref token, verbatim (uid=2_3 | e2)
	role: string; // "link", "button", "heading" — for human-readable logging
	name: string; // accessible name — for verify-after-operate matching
};

// ---------------------------------------------------------------------------
// 2. PARSE: each engine's snapshot text → FacadeRef[]. One parser per ref FORMAT
//    (two formats, so chrome-devtools has its own; playwright + agent-browser share).
// ---------------------------------------------------------------------------

// chrome-devtools: `uid=2_3 link "Learn more" url="https://..."`
// (leading indent varies; role is the token after the uid; name is first quoted string)
function parseChromeDevtools(text: string): FacadeRef[] {
	const refs: FacadeRef[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/uid=(\S+)\s+(\w+)\s+"([^"]*)"/);
		if (m) {
			refs.push({
				engine: "chrome-devtools",
				raw: `uid=${m[1]}`,
				role: m[2],
				name: m[3],
			});
		}
	}
	return refs;
}

// playwright + agent-browser share `[ref=eN]`, but the line shape differs slightly:
//   playwright:     `  - link "Learn more" [ref=e2]`        (YAML-ish, role then name then ref)
//   agent-browser:  `- link "Learn more" [ref=e2]`          (same idea; role, name, ref)
//   also handles bracket extras: `heading "X" [level=1, ref=e1]`
function parseBracketRef(text: string, engine: EngineId): FacadeRef[] {
	const refs: FacadeRef[] = [];
	for (const line of text.split("\n")) {
		const refM = line.match(/\bref=(\w+)/);
		if (!refM) continue;
		const roleM = line.match(/-\s*(\w+)\s+"/) ?? line.match(/\b(\w+)\s+"/);
		const nameM = line.match(/"([^"]*)"/);
		refs.push({
			engine,
			raw: refM[1], // e2 — bare, brackets/prefix added at dispatch time
			role: roleM?.[1] ?? "unknown",
			name: nameM?.[1] ?? "",
		});
	}
	return refs;
}

export function parseSnapshot(engine: EngineId, snapshotText: string): FacadeRef[] {
	switch (engine) {
		// uid= format — shared by BOTH Chrome transports (MCP and CLI). Same engine,
		// same ref format, regardless of transport. Proves format is engine-bound, not transport-bound.
		case "chrome-devtools":
		case "chrome-devtools-cli":
			return parseChromeDevtools(snapshotText).map((r) => ({ ...r, engine }));
		// [ref=] format — shared by ALL THREE Playwright/Chromium-lineage transports.
		case "playwright-cdp":
		case "playwright-cli":
		case "agent-browser":
			return parseBracketRef(snapshotText, engine);
	}
}

// ---------------------------------------------------------------------------
// 3. DISPATCH: a FacadeRef → the exact click invocation for its engine.
//    THREE dispatch shapes (the axis the 3rd engine exposed):
//      mcp-uid  : mcporter call chrome-devtools.click  --args {"uid": "2_3"}
//      mcp-ref  : mcporter call playwright-cdp.browser_click --args {"ref": "e2", "element": "<name>"}
//      cli-@ref : agent-browser --cdp 9222 click @e2
// ---------------------------------------------------------------------------

// Five distinct dispatch shapes — the `kind` selects which binary runs the argv.
// (The harness maps kind -> binary: mcporter / agent-browser / playwright-cli / chrome-devtools.)
export type ClickDispatch =
	| { kind: "mcporter"; argv: string[] } // N1/N2: ride the mcporter MCP transport
	| { kind: "cli"; argv: string[] } // N3: agent-browser CLI
	| { kind: "cli-pwcli"; argv: string[] } // N4: @playwright/cli (playwright-cli bin)
	| { kind: "cli-cdtcli"; argv: string[] }; // N5: chrome-devtools CLI

export function dispatchClick(ref: FacadeRef): ClickDispatch {
	switch (ref.engine) {
		case "chrome-devtools": {
			// raw is "uid=2_3"; chrome-devtools-mcp click takes the uid value.
			const uid = ref.raw.replace(/^uid=/, "");
			return {
				kind: "mcporter",
				argv: [
					"call",
					"chrome-devtools.click",
					"--args",
					JSON.stringify({ uid }),
					"--output",
					"json",
				],
			};
		}
		case "playwright-cdp": {
			// @playwright/mcp@0.0.76 browser_click wants {target: "<ref>"} — a STRING.
			// (Verified live; older docs showed {ref, element} which this version rejects
			//  with "expected string, received undefined at target" — a real per-engine
			//  schema-drift the spike caught. This is why the mapping must be verified,
			//  not copied from docs — exactly the ADR-0012 "static matrix drifts" warning.)
			return {
				kind: "mcporter",
				argv: [
					"call",
					"playwright-cdp.browser_click",
					"--args",
					JSON.stringify({ target: ref.raw }),
					"--output",
					"json",
				],
			};
		}
		case "agent-browser": {
			// CLI: ref dispatched as a positional @e2 arg, not JSON. Different shape entirely.
			return {
				kind: "cli",
				argv: ["--cdp", "9222", "click", `@${ref.raw}`],
			};
		}
		case "playwright-cli": {
			// N4: @playwright/cli — Playwright engine via CLI. Same [ref=] FORMAT as
			// playwright-mcp, but dispatch is a CLI positional (bare ref), against a
			// named session created by `attach --cdp`. Format shared, dispatch different —
			// the core thing the 5-way matrix proves.
			return {
				kind: "cli-pwcli",
				argv: ["--s=default", "click", ref.raw],
			};
		}
		case "chrome-devtools-cli": {
			// N5: chrome-devtools CLI (DevTools-for-Agents 1.0). Same uid= FORMAT as
			// chrome-devtools-mcp, but dispatch is `chrome-devtools click <uid>` positional.
			// raw is "uid=1_2" → strip prefix to the bare uid the CLI expects.
			const uid = ref.raw.replace(/^uid=/, "");
			return {
				kind: "cli-cdtcli",
				argv: ["click", uid],
			};
		}
	}
}

// ---------------------------------------------------------------------------
// 4. The facade-level click: pick a ref by accessible name (engine-agnostic),
//    then dispatch to whatever engine produced it. This is what a caller writes
//    ONCE and runs on any engine — the swappability payoff, concretely.
// ---------------------------------------------------------------------------

export function clickByName(
	refs: FacadeRef[],
	accessibleName: string,
): { ref: FacadeRef; dispatch: ClickDispatch } | { error: string } {
	const ref = refs.find((r) => r.name === accessibleName);
	if (!ref) {
		return {
			error: `no ref named "${accessibleName}" in snapshot (have: ${refs.map((r) => r.name).filter(Boolean).join(", ")})`,
		};
	}
	return { ref, dispatch: dispatchClick(ref) };
}
