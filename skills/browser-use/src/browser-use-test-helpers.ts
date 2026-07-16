import { type BrowserUseCommand, browserUseContracts } from "./command-contract";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

// ---------------------------------------------------------------------------
// Shared test helpers (plan U16).
//
// Cross-region fixtures used by more than one per-module test file. Extracted
// before any carve (KTD5): the test describe blocks do not map 1:1 to modules at
// the fixture level — makeRuntime/parseJson and the envelope builders span
// U3/U4/U5/U6/U7 blocks — so each carved file imports these from here instead of
// redefining them. Helpers import the public barrel (./browser-use) so coverage
// of the helper paths attributes to the modules under test, not to a test file.
// ---------------------------------------------------------------------------

export function makeRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
	return createDefaultBrowserUseRuntime({
		env: {},
		now: () => 1_000,
		// Stub the live I/O seams so tests never touch real stdin/disk. Individual
		// tests override readStdin/writeTextFile/readTextFile as needed.
		readStdin: async () => "",
		writeTextFile: async () => {},
		ensureDirectory: async () => {},
		...overrides,
	});
}

// Capture the exact command vector the transport hands the runtime, so tests can
// assert how the override prefixes mcporter subcommands. okCommand stands in for
// a clean mcporter response.
export function capturingRuntime(
	env: Record<string, string | undefined>,
	response: McporterCommandResult = okCommand("{}"),
): { runtime: BrowserUseRuntime; calls: McporterCommandInput[] } {
	const calls: McporterCommandInput[] = [];
	const runtime = makeRuntime({
		env,
		runCommand: async (input) => {
			calls.push(input);
			return response;
		},
	});
	return { runtime, calls };
}

export function okCommand(stdout: string): McporterCommandResult {
	return { exitCode: 0, stdout, stderr: "" };
}

// list_pages stdout for an array of {id,url,title} pages. Cross-region: U5
// discovery builds list responses, U7 operations stubs list_pages on the
// operation runtime, so it lives here rather than in either carved file.
export function listPagesStdout(
	pages: Array<{ id?: string; url?: string; title?: string }>,
): string {
	return JSON.stringify({ pages });
}

export function commandVector(input: McporterCommandInput): string[] {
	return [input.command, ...input.args];
}

export function commandJsonArgs(
	input: McporterCommandInput,
): Record<string, unknown> {
	const index = input.args.indexOf("--args");
	if (index < 0) return {};
	return JSON.parse(input.args[index + 1] ?? "{}") as Record<string, unknown>;
}

export function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

export function contractFlags(command: BrowserUseCommand): string[] {
	return Object.keys(browserUseContracts[command].flags ?? {}).sort();
}

// Cross-region: U6 selection envelopes/state and the U7 operation state fixture
// both stamp this contract id, so it lives here rather than in either file.
export const TARGETS_CONTRACT = "browser-use.browser-targets";

export function enoent(path: string): Error & { code: string } {
	const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
	(error as Error & { code: string }).code = "ENOENT";
	return error as Error & { code: string };
}

// Returns `any`-valued records by design: tests read arbitrary nested fields
// (e.g. `.display.origin`) off a parsed state write and assert on the leaf. A
// stricter JSON type forces per-assertion narrowing across every call site for
// no safety gain in test code.
// biome-ignore lint/suspicious/noExplicitAny: test-only ergonomic surface
export function parsedWrite(write: { contents: string }): Record<string, any> {
	return JSON.parse(write.contents);
}
