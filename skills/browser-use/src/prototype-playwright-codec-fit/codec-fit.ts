// PROTOTYPE — throwaway. Question: does a playwright engine actually FIT the
// browser-use facade's existing transport seam, or does the seam secretly assume
// chrome-devtools' MCP vocabulary? Pure portable module; the TUI is the shell.
//
// This module models the SEAM, not the browser. It encodes what each of the
// existing machinery's call sites demands of an adapter, and what each candidate
// engine actually offers, then computes fit per verb. No network, no browser —
// the fit logic is the thing being validated, and it's checkable on paper once
// you see it laid out. (Tool-name + connect facts gathered live from
// command-contract.ts, browser-use-operations.ts, browser-use-discovery.ts,
// and `npx @playwright/mcp --help` during the spike.)

// ---------------------------------------------------------------------------
// What the EXISTING machinery demands of any adapter, verb by verb.
// Sourced from the real call sites (file:line in `demandedBy`).
// ---------------------------------------------------------------------------

export type FloorVerb = "navigate" | "click" | "snapshot";

// A seam is one demand the machinery makes. An engine "fits" the seam only if it
// can satisfy the demand WITHOUT editing the machinery.
export type Seam = {
	id: string;
	verb: FloorVerb | "precondition";
	// The exact call the machinery emits today. `${adapter}` is templated in.
	machineryEmits: string;
	demandedBy: string; // file:line
	// Why this is the demand — what the machinery assumes.
	assumes: string;
};

export const SEAMS: readonly Seam[] = [
	{
		id: "proof-gate",
		verb: "precondition",
		machineryEmits: "BROWSER_ADAPTER_PROOF_ADAPTERS.includes(adapter)",
		demandedBy: "command-contract.ts:31 + browser-use-discovery.ts:552",
		assumes:
			"adapter is in a hardcoded allowlist of ['chrome-devtools']; everything else fails closed",
	},
	{
		id: "proof-impl",
		verb: "precondition",
		machineryEmits: "executeAdapterProof switch → case adapter",
		demandedBy: "preflight-browser-adapter.ts:670",
		assumes: "a hand-written proof function exists for this adapter (switch, not plugin)",
	},
	{
		id: "discover",
		verb: "navigate",
		machineryEmits: "mcporter call ${adapter}.list_pages --args {}",
		demandedBy: "browser-use-discovery.ts:566",
		assumes: "engine is an MCP server exposing a tool literally named `list_pages`",
	},
	{
		id: "select",
		verb: "navigate",
		machineryEmits: "mcporter call ${adapter}.select_page",
		demandedBy: "browser-use-operations.ts:490",
		assumes: "engine exposes a tool named `select_page` and has a multi-page target model",
	},
	{
		id: "snapshot",
		verb: "snapshot",
		machineryEmits: "mcporter call ${adapter}.take_snapshot --args {verbose?}",
		demandedBy: "browser-use-operations.ts:821",
		assumes: "engine exposes `take_snapshot` returning an a11y-ref JSON shape",
	},
	{
		id: "click",
		verb: "click",
		machineryEmits: "(element-ref action via snapshot refs; re-snapshot before action)",
		demandedBy: "SKILL.md Page Actions + browser-use-operations.ts ref flow",
		assumes:
			"click targets a ref FROM take_snapshot; ref semantics + staleness match chrome-devtools' a11y tree",
	},
];

// ---------------------------------------------------------------------------
// What each candidate engine actually OFFERS. Facts, not opinion.
// ---------------------------------------------------------------------------

export type EngineOffer = {
	// Can it satisfy the seam as the machinery emits it, with NO machinery edit?
	satisfies: "native" | "rename-needed" | "shape-mismatch" | "absent" | "machinery-edit";
	// What the engine actually provides for this seam.
	provides: string;
	note: string;
};

export type Engine = {
	id: string;
	transport: string;
	connectsToWarmChrome: boolean;
	connectNote: string;
	offers: Record<string, EngineOffer>; // keyed by seam.id
};

export const CHROME_DEVTOOLS: Engine = {
	id: "chrome-devtools",
	transport: "mcporter → chrome-devtools-mcp (MCP server)",
	connectsToWarmChrome: true,
	connectNote: "mcporter config binds to verified loopback CDP; this is the reference engine",
	offers: {
		"proof-gate": { satisfies: "native", provides: "in allowlist", note: "it IS the allowlist" },
		"proof-impl": { satisfies: "native", provides: "proveChromeDevTools()", note: "the only case" },
		discover: { satisfies: "native", provides: "list_pages tool", note: "exact name match" },
		select: { satisfies: "native", provides: "select_page tool", note: "exact name match" },
		snapshot: { satisfies: "native", provides: "take_snapshot tool", note: "exact name + shape" },
		click: { satisfies: "native", provides: "a11y-tree refs", note: "the reference ref model" },
	},
};

// Facts gathered live: @playwright/mcp@0.0.76 exists, has --cdp-endpoint, uses
// browser_* tool names, single-context page model, auto-waiting click.
export const PLAYWRIGHT_MCP: Engine = {
	id: "playwright-cdp",
	transport: "mcporter → @playwright/mcp (MCP server, --cdp-endpoint)",
	connectsToWarmChrome: true,
	connectNote:
		"@playwright/mcp --cdp-endpoint CAN attach to the warm loopback CDP (verify it doesn't grab its own context)",
	offers: {
		"proof-gate": {
			satisfies: "machinery-edit",
			provides: "NOT in BROWSER_ADAPTER_PROOF_ADAPTERS",
			note: "must edit command-contract.ts:31 — fails closed otherwise",
		},
		"proof-impl": {
			satisfies: "machinery-edit",
			provides: "no provePlaywrightCdp() case",
			note: "must hand-write a proof fn + switch case (preflight-browser-adapter.ts)",
		},
		discover: {
			satisfies: "absent",
			provides: "no list_pages tool",
			note: "@playwright/mcp has no multi-page list; vocab is browser_*; single context",
		},
		select: {
			satisfies: "absent",
			provides: "no select_page tool",
			note: "playwright-mcp manages one page; no select_page concept",
		},
		snapshot: {
			satisfies: "rename-needed",
			provides: "browser_snapshot tool",
			note: "different name (browser_snapshot vs take_snapshot) AND different ref shape",
		},
		click: {
			satisfies: "shape-mismatch",
			provides: "browser_click + AUTO-WAIT",
			note: "playwright auto-waits actionability; chrome-devtools fire-and-forget. Refs differ. THE divergence.",
		},
	},
};

// ---------------------------------------------------------------------------
// The fit computation — this is the answer the spike exists to produce.
// ---------------------------------------------------------------------------

export type SeamFit = {
	seam: Seam;
	offer: EngineOffer;
	fits: boolean; // true only if no machinery edit AND engine provides it natively/renamed-cleanly
	cost: "free" | "rename-shim" | "machinery-edit" | "blocked";
};

export function computeFit(engine: Engine): SeamFit[] {
	return SEAMS.map((seam) => {
		const offer = engine.offers[seam.id];
		let cost: SeamFit["cost"];
		let fits: boolean;
		switch (offer.satisfies) {
			case "native":
				cost = "free";
				fits = true;
				break;
			case "rename-needed":
				// A rename COULD be a shim — but the machinery templates `${adapter}.<fixed-name>`,
				// so there is no per-adapter rename hook. A rename REQUIRES editing the transport.
				cost = "machinery-edit";
				fits = false;
				break;
			case "shape-mismatch":
				cost = "machinery-edit";
				fits = false;
				break;
			case "absent":
				cost = "blocked";
				fits = false;
				break;
			case "machinery-edit":
				cost = "machinery-edit";
				fits = false;
				break;
		}
		return { seam, offer, fits, cost };
	});
}

export function verdict(engine: Engine): {
	engine: string;
	fitCount: number;
	total: number;
	machineryEdits: number;
	blocked: number;
	codecCheap: boolean;
	summary: string;
} {
	const fits = computeFit(engine);
	const fitCount = fits.filter((f) => f.fits).length;
	const machineryEdits = fits.filter((f) => f.cost === "machinery-edit").length;
	const blocked = fits.filter((f) => f.cost === "blocked").length;
	// "Codec cheap" was the success bar: thin codec, ride existing seams, no machinery edits.
	const codecCheap = machineryEdits === 0 && blocked === 0;
	return {
		engine: engine.id,
		fitCount,
		total: fits.length,
		machineryEdits,
		blocked,
		codecCheap,
		summary: codecCheap
			? "Rides existing seams — codec is cheap."
			: `Does NOT ride existing seams: ${machineryEdits} machinery edits, ${blocked} blocked seams. The transport templates one engine's MCP vocabulary; a different engine cannot slot in without editing the machinery.`,
	};
}
