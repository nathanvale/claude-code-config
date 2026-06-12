// PROTOTYPE — throwaway. Question: does a Layer-1 name/arg mapping table make a
// second engine's snapshot REACHABLE, and how bad is the Layer-2 ref-shape diff?
//
// codec-fit.ts (the first spike) proved the transport hardcodes chrome-devtools'
// tool vocabulary. This module is the proposed fix in its leanest form: a flat
// per-engine mapping table {floorVerb -> {tool, argShape}}. It's pure data + a
// resolver. The harness (run.ts) feeds these through the REAL mcporter transport
// against the live warm Chrome and diffs the results.

export type FloorVerb = "navigate" | "snapshot" | "listPages";

export type VerbMapping = {
	tool: string; // the engine's actual MCP tool name
	// build the --args JSON the engine expects from facade-level intent
	args: (intent: Record<string, unknown>) => Record<string, unknown>;
	// where the engine's result text/refs live, for normalization
	resultNote: string;
};

export type EngineMap = {
	id: string;
	// how mcporter reaches it: a configured server name, or an ad-hoc stdio spec
	transport:
		| { kind: "configured"; server: string }
		| { kind: "stdio"; command: string; args: string[] };
	verbs: Partial<Record<FloorVerb, VerbMapping>>;
	absent: FloorVerb[]; // floor verbs this engine genuinely lacks (Layer-2 policy)
};

// Reference engine — its vocabulary is what the real transport currently hardcodes.
export const CHROME_DEVTOOLS_MAP: EngineMap = {
	id: "chrome-devtools",
	transport: { kind: "configured", server: "chrome-devtools" },
	verbs: {
		listPages: {
			tool: "list_pages",
			args: () => ({}),
			resultNote: "text block: numbered page list",
		},
		navigate: {
			tool: "navigate_page",
			args: (i) => ({ url: i.url }),
			resultNote: "navigates selected page",
		},
		snapshot: {
			tool: "take_snapshot",
			args: () => ({}),
			resultNote: "a11y-tree refs as text (uid= refs)",
		},
	},
	absent: [],
};

// The engine under question. Same warm Chrome via --cdp-endpoint, DIFFERENT vocab.
// This whole object is the "hand-crafted mapping table" the dream needs — proving
// whether Layer-1 is as cheap as it looks.
export const PLAYWRIGHT_MAP: EngineMap = {
	id: "playwright-cdp",
	// Now a CONFIGURED mcporter server (registered in ~/.claude.json, daemon-managed)
	// — same transport kind as chrome-devtools. The --stdio ad-hoc path is gone.
	transport: { kind: "configured", server: "playwright-cdp" },
	verbs: {
		// Layer-1 rename: take_snapshot -> browser_snapshot. THIS is the cheap part.
		snapshot: {
			tool: "browser_snapshot",
			args: () => ({}),
			resultNote: "playwright accessibility snapshot as YAML-ish text (ref= refs)",
		},
		navigate: {
			tool: "browser_navigate",
			args: (i) => ({ url: i.url }),
			resultNote: "navigates the single managed context",
		},
		// listPages is ABSENT — playwright-mcp single-context model. Layer-2 policy:
		// declare it a non-floor capability for this engine, don't fake it.
	},
	absent: ["listPages"],
};

export const ENGINE_MAPS = [CHROME_DEVTOOLS_MAP, PLAYWRIGHT_MAP];

// The resolver the real runOperationTransport SHOULD consult instead of hardcoding
// `${adapter}.take_snapshot`. This is ~10 lines — the proof that Layer-1 is cheap.
export type Resolved =
	| { ok: true; tool: string; args: Record<string, unknown> }
	| { ok: false; reason: "absent"; verb: FloorVerb };

export function resolve(
	map: EngineMap,
	verb: FloorVerb,
	intent: Record<string, unknown> = {},
): Resolved {
	if (map.absent.includes(verb)) return { ok: false, reason: "absent", verb };
	const m = map.verbs[verb];
	if (!m) return { ok: false, reason: "absent", verb };
	return { ok: true, tool: m.tool, args: m.args(intent) };
}
