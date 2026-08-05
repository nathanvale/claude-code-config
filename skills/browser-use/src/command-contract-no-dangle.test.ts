import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_FAMILIES,
	BROWSER_USE_FAMILY_SUBCOMMANDS,
	BROWSER_USE_ACTION_SUBCOMMANDS,
	type BrowserUseCommand,
	type BrowserUseFamily,
	browserUseContracts,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
	browserUseTargetSelectionFailureActions,
	browserUseTargetSelectionSuccessActions,
} from "./command-contract";

import { renderHelp } from "./browser-use-parser";

// Every declared family/subcommand pair, so new platform families are swept
// automatically instead of the corpus silently shrinking to targets/operate.
const ALL_COMMANDS: Array<[BrowserUseFamily, string]> = BROWSER_USE_FAMILIES.flatMap(
	(family): Array<[BrowserUseFamily, string]> =>
		BROWSER_USE_FAMILY_SUBCOMMANDS[family].map(
			(sub): [BrowserUseFamily, string] => [family, sub],
		),
);

// =========================================================================
// R4 no-dangle sweep (migration cleanup U3, AE3; extended by U5/KTD6). The
// browser-adapter-router, preflight-browser-adapter, browser-adapter-map, and
// preflight-warm-chrome command surfaces were deleted; nothing an agent can
// reach from the surviving browser-use surface may still point at them. This gate mechanically enumerates every string the
// surviving command contracts and rendered help expose — summaries, usage,
// flag/env descriptions, exit-code prose, runtime action ids and summaries,
// continuation prose — and rejects any reference to a deleted command name.
//
// Scope note: the retained R9 router engine/model/recovery/validation files
// keep their internal action vocabulary (browserAdapterRouter*Actions) until
// the cluster's own retirement unit; no surviving command contract references
// those arrays, so they are deliberately outside this sweep's corpus.
// =========================================================================

// Both the hyphenated command names and their prose/product-name forms: a
// contract string that says "Browser Adapter Proof" points an agent at the
// deleted preflight-browser-adapter command just as surely as the bin name.
// Matching is case-insensitive (see offendersIn).
const DELETED_COMMAND_NAMES = [
	"browser-adapter-router",
	"preflight-browser-adapter",
	"browser-adapter-map",
	"preflight-warm-chrome",
	"browser adapter router",
	"browser adapter proof",
	"adapter-proof",
	"browser adapter map",
	"warm chrome preflight",
] as const;

type RuntimeAction = { id: string; summary: string };

const SURVIVING_ACTION_ARRAYS: Record<string, readonly RuntimeAction[]> = {
	browserUseTargetDiscoveryFailureActions,
	browserUseTargetDiscoverySuccessActions,
	browserUseTargetSelectionFailureActions,
	browserUseTargetSelectionSuccessActions,
	browserUseOperationFailureActions,
	browserUseOperationSuccessActions,
};

// Recursively harvest every string value AND every object key from a contract
// object. Keys matter: a deleted command exposed as a contract key (e.g. a
// browserUseContracts entry) never appears as a value, so a values-only sweep
// would let it pass offendersIn.
function collectStrings(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
	if (typeof value === "string") {
		out.push({ path, text: value });
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			collectStrings(entry, `${path}[${index}]`, out);
		}
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const [key, entry] of Object.entries(value)) {
			out.push({ path: `${path}.${key}(key)`, text: key });
			collectStrings(entry, `${path}.${key}`, out);
		}
	}
}

function offendersIn(corpus: Array<{ path: string; text: string }>): string[] {
	return corpus
		.filter(({ text }) => {
			const lowered = text.toLowerCase();
			return DELETED_COMMAND_NAMES.some((name) => lowered.includes(name));
		})
		.map(({ path, text }) => `${path}: ${text}`);
}

describe("R4 no-dangle sweep — deleted command surfaces", () => {
	test("operator-only Reviewed Action promotion stays discoverable and human-gated", () => {
		expect(BROWSER_USE_ACTION_SUBCOMMANDS).toEqual([
			"schema",
			"validate",
			"apply",
			"status",
			"promote",
		]);
		expect(Object.keys(browserUseContracts)).toContain("action-promote");
		expect(renderHelp("action")).toMatch(/^\s+promote(?:\s|$)/m);
		expect(browserUseContracts["action-promote"]).toMatchObject({
			audience: "operator",
			interactivity: "required",
			sideEffects: ["check", "auth", "write"],
		});
	});

	// Canary: the sweep itself must be able to fail. A matcher regression that
	// silently stops matching (case handling, prose forms) would otherwise turn
	// every test below into a vacuous pass.
	test("offendersIn catches hyphenated and prose forms, case-insensitively", () => {
		expect(
			offendersIn([
				{ path: "canary.hyphen", text: "run browser-adapter-router route" },
				{ path: "canary.prose", text: "Shared with Browser Adapter Proof." },
				{ path: "canary.case", text: "BROWSER-ADAPTER-MAP validates docs" },
				{ path: "canary.clean", text: "browser-connect connect --json" },
			]),
		).toHaveLength(3);
	});

	test("surviving command contracts never reference a deleted command name", () => {
		const commandCount = Object.keys(browserUseContracts).length;
		// The surviving surface is exactly the six targets/operate commands; a
		// shrunken contract table means the harvest is scanning less surface than
		// this gate promises, not that the surface got cleaner.
		expect(commandCount).toBeGreaterThanOrEqual(6);
		// Harvest the whole table (not per-entry) so the command names themselves
		// — the top-level keys — land in the corpus too.
		const corpus: Array<{ path: string; text: string }> = [];
		collectStrings(browserUseContracts, "browserUseContracts", corpus);
		// Floor calibrated against the real corpus (424 strings at gate
		// creation): tolerate pruning, fail on a broken harvest.
		expect(corpus.length).toBeGreaterThan(300);
		expect(offendersIn(corpus)).toEqual([]);
	});

	test("surviving runtime action vocabulary never references a deleted command name", () => {
		const corpus: Array<{ path: string; text: string }> = [];
		for (const [name, actions] of Object.entries(SURVIVING_ACTION_ARRAYS)) {
			collectStrings(actions, name, corpus);
		}
		expect(corpus.length).toBeGreaterThan(10);
		expect(offendersIn(corpus)).toEqual([]);
	});

	// U4 one-adapter-vocabulary sweep: the two-name attachment-adapter mapping
	// is deleted; the live surface keys adapters on the envelope's
	// attachment.adapter_id verbatim. No bare
	// "chrome-devtools" token — the retired mcporter server name — may survive
	// anywhere an agent can read. chrome-devtools-mcp CONTAINS that substring,
	// so the match is precise: "chrome-devtools" not followed by "-mcp".
	test("live contract, actions, and help carry no bare chrome-devtools token", () => {
		const bareToken = /chrome-devtools(?!-mcp)/i;
		// Canary: the precision must hold in both directions.
		expect(bareToken.test("--adapter chrome-devtools-mcp")).toBe(false);
		expect(bareToken.test("mcporter call chrome-devtools.list_pages")).toBe(true);
		const corpus: Array<{ path: string; text: string }> = [];
		collectStrings(browserUseContracts, "browserUseContracts", corpus);
		for (const [name, actions] of Object.entries(SURVIVING_ACTION_ARRAYS)) {
			collectStrings(actions, name, corpus);
		}
		corpus.push({ path: "help(root)", text: renderHelp() });
		for (const family of BROWSER_USE_FAMILIES) {
			corpus.push({ path: `help(${family})`, text: renderHelp(family) });
		}
		// Command-level help renders flag enum values (the --adapter union), so
		// it must be in the corpus for this sweep to bite.
		for (const [family, sub] of ALL_COMMANDS) {
			const command = `${family}-${sub}` as BrowserUseCommand;
			corpus.push({ path: `help(${command})`, text: renderHelp(family, command) });
		}
		const offenders = corpus
			.filter(({ text }) => bareToken.test(text))
			.map(({ path, text }) => `${path}: ${text}`);
		expect(offenders).toEqual([]);
	});

	test("rendered help never references a deleted command name", () => {
		const corpus: Array<{ path: string; text: string }> = [
			{ path: "help(root)", text: renderHelp() },
		];
		for (const family of BROWSER_USE_FAMILIES) {
			corpus.push({ path: `help(${family})`, text: renderHelp(family) });
		}
		for (const [family, sub] of ALL_COMMANDS) {
			const command = `${family}-${sub}` as BrowserUseCommand;
			corpus.push({
				path: `help(${command})`,
				text: renderHelp(family, command),
			});
		}
		expect(offendersIn(corpus)).toEqual([]);
	});
});
