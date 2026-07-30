import { type BrowserUseCommand, browserUseContracts } from "./command-contract";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use";
import { verifiedHandoffEnvelope } from "./browser-connect-handoff-fixtures";
import { createDefaultPlatformFs } from "./browser-use-paths";
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
		// Platform store fs (U2): the REAL fs rooted nowhere — with the empty
		// env every store-backed command refuses at XDG resolution before any
		// I/O. Store tests pass explicit temp XDG env + real fs, or the
		// volatile-overlay fake.
		platformFs: createDefaultPlatformFs(),
		// Internal mint seam (D4): the production default imports browser-connect
		// and can PROVE-OR-LAUNCH a real browser — never acceptable from a unit
		// test. Default to a typed fail-closed stub; mint tests inject their own
		// fixture-backed fake.
		mintHandoff: async (input) =>
			input.port === undefined
				? {
						exitCode: 20,
						stdout: JSON.stringify({
							status: "error",
							data: {
								outcome: "failed",
								failure_class: "environment-unavailable",
							},
							error: {
								code: "mint_not_faked",
								message:
									"mintHandoff was not faked in this test; inject a fixture-backed mint.",
							},
						}),
						stderr: "",
					}
				: {
						exitCode: 0,
						stdout: verifiedHandoffEnvelope((envelope) => {
							envelope.run_id = input.runId ?? "fixture-run";
							envelope.data.attachment.adapter_id = input.adapterId;
							envelope.data.endpoint.http = `http://127.0.0.1:${input.port}`;
							envelope.data.endpoint.ws =
								`ws://127.0.0.1:${input.port}/devtools/browser/reproved-fixture`;
							envelope.data.proof.profile_posture.effective.observer.port =
								input.port;
						}),
						stderr: "",
					},
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
