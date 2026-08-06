import { afterAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
} from "./command-contract";
import { readHandoffFacts } from "./browser-use-discovery";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// =========================================================================
// U1 process-boundary proof: browser-use parses REAL browser-connect output.
//
// Fakes must match real output shape — a compact-vs-pretty JSON fake has
// hidden a real parse bug in this repo before. This test spawns the REAL
// `browser-connect` entrypoint at a process boundary and feeds its verbatim
// stdout to browser-use's envelope parser and the full targets-list handler.
//
// A verified envelope cannot be synthesized at the process boundary
// (browser-connect consumes warm-chrome in-process and pins the real Chrome
// app binary), so the live spawn proves the FAILURE shape: a foreign-listener
// fixture answers /json/version but is not an inspectable Google Chrome
// process, so warm-chrome's real proof rejects its identity and browser-connect
// fails closed (exit 20) — the same seam browser-connect's own integration
// suite uses. The verified shape is covered by the emission-path capture in
// browser-connect-handoff-fixtures.ts; this test also re-proves the live
// envelope still carries the contract id and schema version browser-use pins
// (the KTD1 drift tripwire, checked against the real binary on every run).
// =========================================================================

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BROWSER_CONNECT_CLI = join(REPO_ROOT, "runtime", "browser-connect", "src", "cli.ts");
const BROWSER_CONNECT_ROOT = join(REPO_ROOT, "runtime", "browser-connect");
const SPAWN_TIMEOUT_MS = 20_000;
// Bun test deadline sits above the child kill timer so a slow shutdown still
// has room for child.exited to settle and stdout to drain; otherwise both fire
// at the same instant and the controlled failure becomes a runner timeout.
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

// A bare /json/version responder that is NOT an inspectable Google Chrome
// process: warm-chrome's real proof answers the round-trip, fails to resolve
// an inspectable Chrome listener owning the port, and fails closed.
const fixtureServer = Bun.serve({
	port: 0,
	fetch(request: Request): Response {
		const path = new URL(request.url).pathname;
		const body =
			path === "/json/version"
				? JSON.stringify({
						Browser: "Chrome/150.0.0.0",
						"Protocol-Version": "1.3",
						"User-Agent": "Mozilla/5.0 (Macintosh) Chrome/150.0.0.0",
						webSocketDebuggerUrl: `ws://127.0.0.1:${fixtureServer.port}/devtools/browser/foreign`,
					})
				: "{}";
		return new Response(body, {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	},
});

afterAll(() => {
	fixtureServer.stop(true);
});

async function spawnRealConnect(): Promise<{ exitCode: number; stdout: string }> {
	const child = Bun.spawn(
		[process.execPath, BROWSER_CONNECT_CLI, "connect", "chrome-devtools-mcp", "--json", "--run-id", "process-boundary-run"],
		{
			cwd: BROWSER_CONNECT_ROOT,
			env: { ...process.env, WARM_CHROME_CDP_PORT: `${fixtureServer.port}` },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout };
}

describe("U1 process-boundary proof against the real browser-connect CLI", () => {
	test("real connect output parses, matches the pinned contract, and fails closed end to end", async () => {
		const { exitCode, stdout } = await spawnRealConnect();
		// The real CLI failed closed against the unverifiable fixture listener.
		expect(exitCode).toBe(20);

		// The live envelope still carries the exact contract identity browser-use
		// pins (KTD1): if browser-connect revs its schema, this is the tripwire.
		const envelope = parseJson(stdout);
		expect((envelope.data as Record<string, unknown>).contract_id).toBe(
			BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
		);
		expect((envelope.data as Record<string, unknown>).schema_version).toBe(
			BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
		);
		expect((envelope.data as Record<string, unknown>).outcome).toBe("failed");
		// Fail-closed posture survives the boundary: no adapter fallback.
		expect(stdout).toContain("no_adapter_fallback");

		// browser-use's parser reads the verbatim real output and classifies it as
		// a browser-connect failure envelope, not a parse error.
		const runtime = makeRuntime({
			readTextFile: async () => stdout,
		});
		const parse = await readHandoffFacts(runtime, "/real-connect.json");
		expect(parse).toMatchObject({ ok: true, kind: "failed" });

		// And the full handoff-bound handler path refuses it with the typed
		// rejection and single continuation (AE4 posture on the consumer side).
		const listRuntime = makeRuntime({
			readTextFile: async () => stdout,
		});
		const result = await runForTest(
			["targets", "list", "--mode", "handoff-bound", "--handoff", "/real-connect.json", "--json"],
			listRuntime,
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_discovery_handoff_invalid" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"supply_verified_handoff",
		);
	}, TEST_TIMEOUT_MS);
});
