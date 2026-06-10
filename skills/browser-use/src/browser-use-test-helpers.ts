import { createHash } from "node:crypto";
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

export function stateRunKey(runId: string): string {
	return createHash("sha256").update(runId).digest("hex").slice(0, 32);
}

export function contractFlags(command: BrowserUseCommand): string[] {
	return Object.keys(browserUseContracts[command].flags ?? {}).sort();
}

const ADAPTER_PROOF_CONTRACT = "browser-use.browser-adapter-proof";
// Exported: U5 discovery blocks reference it directly to build inline route
// envelopes, not only through routeSuccessEnvelope.
export const ROUTER_CONTRACT = "browser-use.browser-adapter-router";

// A valid Browser Adapter Proof success envelope (schema v2), as written to a
// --adapter-proof file. Mirrors preflight-browser-adapter's emitted shape.
export function adapterProofEnvelope(
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		status: "ok",
		run_id: "proof-run",
		data: {
			ok: true,
			action: "adapter_ready",
			contract: ADAPTER_PROOF_CONTRACT,
			schema_version: "2",
			command: "check",
			adapter: "chrome-devtools",
			endpoint: "http://127.0.0.1:9222",
			port: "9222",
			warm_chrome_run_id: "warm-1",
			adapter_proof_id: "proof-abc",
			verified_endpoint_identity: "127.0.0.1:9222",
			page_count: 0,
			...overrides,
		},
	});
}

// A valid Router route success envelope with the operation binding tuple (U2),
// as written to a --route file.
export function routeSuccessEnvelope(
	bindingOverrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		status: "ok",
		run_id: "route-run",
		data: {
			outcome: "selected",
			contract: ROUTER_CONTRACT,
			evaluation_date: "2026-06-04",
			mode: "auto",
			requested_adapter: null,
			selected_adapter: "chrome-devtools",
			required_capabilities: ["snapshot_refs"],
			route_confidence: 90,
			ranking: [],
			candidate_decisions: [],
			provenance_summary: [],
			binding: {
				run_id: "route-run",
				selected_adapter_id: "chrome-devtools",
				warm_chrome_run_id: "warm-1",
				adapter_proof_id: "proof-abc",
				verified_endpoint_identity: "127.0.0.1:9222",
				route_evidence_hash: "hash-xyz",
				authorized_capabilities: ["snapshot_refs"],
				emitted_at: "2026-06-04T00:00:00.000Z",
				expires_at: "2026-06-05T00:00:00.000Z",
				...bindingOverrides,
			},
		},
	});
}

export function enoent(path: string): Error & { code: string } {
	const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
	(error as Error & { code: string }).code = "ENOENT";
	return error as Error & { code: string };
}

export function parsedWrite(write: { contents: string }): Record<string, any> {
	return JSON.parse(write.contents);
}
