import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_FAMILIES,
	BROWSER_USE_OPERATE_SUBCOMMANDS,
	BROWSER_USE_TARGETS_SUBCOMMANDS,
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

// =========================================================================
// R4 no-dangle sweep (migration cleanup U3, AE3). The browser-adapter-router,
// preflight-browser-adapter, and browser-adapter-map command surfaces were
// deleted; nothing an agent can reach from the surviving browser-use surface
// may still point at them. This gate mechanically enumerates every string the
// surviving command contracts and rendered help expose — summaries, usage,
// flag/env descriptions, exit-code prose, runtime action ids and summaries,
// continuation prose — and rejects any reference to a deleted command name.
//
// Scope note: the retained R9 router engine/model/recovery/validation files
// keep their internal action vocabulary (browserAdapterRouter*Actions) until
// the cluster's own retirement unit; no surviving command contract references
// those arrays, so they are deliberately outside this sweep's corpus.
// =========================================================================

const DELETED_COMMAND_NAMES = [
	"browser-adapter-router",
	"preflight-browser-adapter",
	"browser-adapter-map",
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

// Recursively harvest every string value (and string key prose is static
// identifiers, so values suffice) from a contract object.
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
			collectStrings(entry, `${path}.${key}`, out);
		}
	}
}

function offendersIn(corpus: Array<{ path: string; text: string }>): string[] {
	return corpus
		.filter(({ text }) =>
			DELETED_COMMAND_NAMES.some((name) => text.includes(name)),
		)
		.map(({ path, text }) => `${path}: ${text}`);
}

describe("R4 no-dangle sweep — deleted command surfaces", () => {
	test("surviving command contracts never reference a deleted command name", () => {
		const corpus: Array<{ path: string; text: string }> = [];
		for (const [command, contract] of Object.entries(browserUseContracts)) {
			collectStrings(contract, `browserUseContracts.${command}`, corpus);
		}
		// Contracts are non-trivial: an empty corpus means the harvest broke, not
		// that the surface is clean.
		expect(corpus.length).toBeGreaterThan(50);
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

	test("rendered help never references a deleted command name", () => {
		const corpus: Array<{ path: string; text: string }> = [
			{ path: "help(root)", text: renderHelp() },
		];
		for (const family of BROWSER_USE_FAMILIES) {
			corpus.push({ path: `help(${family})`, text: renderHelp(family) });
		}
		const commands: Array<[BrowserUseFamily, string]> = [
			...BROWSER_USE_TARGETS_SUBCOMMANDS.map(
				(sub): [BrowserUseFamily, string] => ["targets", sub],
			),
			...BROWSER_USE_OPERATE_SUBCOMMANDS.map(
				(sub): [BrowserUseFamily, string] => ["operate", sub],
			),
		];
		for (const [family, sub] of commands) {
			const command = `${family}-${sub}` as BrowserUseCommand;
			corpus.push({
				path: `help(${command})`,
				text: renderHelp(family, command),
			});
		}
		expect(offendersIn(corpus)).toEqual([]);
	});
});
