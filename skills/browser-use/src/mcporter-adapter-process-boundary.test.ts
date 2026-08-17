import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runForTest } from "./browser-use";
import {
	candidateIdOf,
	handoffEvidenceIdOf,
	targetEnvelopeIdOf,
} from "./browser-use-core";
import { discoverPages } from "./browser-use-discovery";
import { runBrowserUseMcporter } from "./browser-use-transport";
import {
	MCPORTER_COMMAND_ENV_VAR,
	type McporterCommandResult,
	spawnMcporterCommand,
} from "./mcporter-transport";
import {
	makeRuntime,
	okCommand,
	parseJson,
	TARGETS_CONTRACT,
} from "./browser-use-test-helpers";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { REAL_VERIFIED_HANDOFF_ENVELOPE } from "./browser-connect-handoff-fixtures";

const operationXdg = makeTempXdgEnv();
afterAll(() => operationXdg.dispose());

// =========================================================================
// U1 process-boundary proof: the envelope-derived mcporter transport (R6).
//
// U3 replaced the configured-server call path (`call chrome-devtools.
// list_pages`) with an ad-hoc invocation derived entirely from the verified
// handoff envelope: `--stdio <pinned adapter> --stdio-arg --browser-url
// --stdio-arg <endpoint.http>`. This file pinned that invocation's REAL syntax
// and output shapes against real mcporter BEFORE the transport change landed,
// so U3 implemented an observed contract, not an inferred one. Everything here
// was probed live 2026-07-17 against mcporter 0.12.2 and the pinned
// chrome-devtools-mcp 1.5.0 adapter.
//
// Load-bearing findings the argv/env constants below encode:
//   - MCPORTER_NO_KEEPALIVE=* is mandatory. mcporter classifies ANY stdio
//     command containing the fragment `chrome-devtools-mcp` as keep-alive and
//     routes it via its daemon: a bare ad-hoc call with the daemon running was
//     SILENTLY answered by the daemon-managed configured server — wrong
//     binary, wrong endpoint, exit 0, real pages listed despite an unreachable
//     --browser-url. With the env guard the ad-hoc server spawns ephemeral and
//     args forward verbatim. (`=1` matches nothing; the value must be a name
//     list or `*`.)
//   - `--stdio-arg` space form only: `--stdio-arg=--browser-url` is parsed by
//     mcporter as a TOOL argument and the tool rejects it.
//   - `--experimentalPageIdRouting` replaces the select_page→operate two-call
//     sequence: select_page state is process-local, so it only worked while
//     the daemon held one adapter process alive. With the flag, take_snapshot/
//     take_screenshot/emulate accept a pageId directly on a fresh process.
//     Version drift is bounded by the 1.5.0 adapter pin.
// =========================================================================

// Machine deps: LOCALLY hard-required (the developer's local suite is the real
// gate for this live transport proof, so a missing binary must fail loudly, not
// silently pass). Under CI (`CI=true`), this live proof cannot run reliably on a
// hosted runner — mcporter's daemon/process-boundary behavior was captured
// against a specific local environment — so the describe block skips there
// instead of hard-failing. Skipping in CI does NOT drop the only proof: the
// proof still runs on every local `test-runner` invocation, which remains the
// authoritative gate for the U3 invocation contract.
const IS_CI = process.env.CI === "true";
const mcporterOnPath = Bun.which("mcporter");
if (!mcporterOnPath && !IS_CI) {
	throw new Error(
		"mcporter is not on PATH. Install it (`brew install steipete/tap/mcporter`, pinned 0.12.2 at capture time) — the envelope-derived transport proof cannot run without the real binary.",
	);
}
// Re-bound as a plain string so the null-narrowing survives into closures. Empty
// under CI without the binary; the describe below is skipped in that case.
const MCPORTER_PATH: string = mcporterOnPath ?? "";
const PINNED_ADAPTER = join(
	homedir(),
	".side-quest/browser-connect/adapters/chrome-devtools-mcp/1.5.0/node_modules/.bin/chrome-devtools-mcp",
);
const pinnedAdapterPresent = existsSync(PINNED_ADAPTER);
if (!pinnedAdapterPresent && !IS_CI) {
	throw new Error(
		`The pinned chrome-devtools-mcp 1.5.0 adapter is missing at ${PINNED_ADAPTER}. Run \`browser-connect connect chrome-devtools-mcp --json\` once to install the pinned adapter tree.`,
	);
}

// Adapter spawn through mcporter (node startup + connect attempt) can take
// several seconds; the Bun test deadline sits above the child kill timer so a
// slow shutdown still has room for child.exited to settle and stdout to drain.
const SPAWN_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

// --- The pinned invocation contract (scenario 4) -----------------------------

// This is the syntax contract U3 implements; captured empirically 2026-07-17.
// Placeholders (<...>) are the envelope-derived slots; every other token is
// literal. The env guard below must ride the same child spawn.
export const ENVELOPE_ADAPTER_ARGV_CONTRACT = [
	"call",
	"--stdio",
	"<probe_executable>",
	"--stdio-arg",
	"--browser-url",
	"--stdio-arg",
	"<endpoint_http>",
	"--stdio-arg",
	"--experimentalPageIdRouting",
	"--name",
	"browser-use-envelope-adapter",
	"--tool",
	"<tool>",
	"--args",
	"<args_json>",
	"--output",
	"json",
] as const;

export const ENVELOPE_ADAPTER_ENV_GUARD = {
	MCPORTER_NO_KEEPALIVE: "*",
} as const;

function envelopeAdapterArgv(
	probeExecutable: string,
	endpointHttp: string,
	tool: string,
	argsJson: string,
): string[] {
	return ENVELOPE_ADAPTER_ARGV_CONTRACT.map((token) => {
		if (token === "<probe_executable>") return probeExecutable;
		if (token === "<endpoint_http>") return endpointHttp;
		if (token === "<tool>") return tool;
		if (token === "<args_json>") return argsJson;
		return token;
	});
}

// --- Live-captured success shapes (scenario 3 fixtures) ----------------------

// Verbatim stdout of the pinned invocation's list_pages against real Agent
// Chrome (captured 2026-07-17, run id u1-live-capture-2026-07-17), with one
// REDACTION: page lines 1 and 2 carried personal FastTrack URLs and are
// swapped for same-shape placeholders — title containing spaces, https URL
// with a hash fragment, `[selected]` flag preserved on line 1, no flag on
// line 2. Shape is otherwise byte-for-byte: `## Pages` header, `N: Title
// (url) [flags]` lines, \n separators, pretty-printed 2-space JSON envelope.
// Line 3 is verbatim.
const REAL_LIST_PAGES_STDOUT = `{
  "content": [
    {
      "type": "text",
      "text": "## Pages\\n1: Sample Recruiting Portal (https://portal.example.net/App#/U2FtcGxl) [selected]\\n2: Sample - Search Timesheet (https://portal.example.net/Time#/U2VhcmNo)\\n3: Example Domain (https://example.com/)"
    }
  ]
}
`;

// Verbatim stdout of the pinned invocation's take_snapshot with
// {"pageId": 3} routing (same capture run; page 3 is the verbatim
// example.com page above, so nothing personal appears). The a11y-node tail
// beyond the heading line is elided; header + uid grammar are byte-for-byte.
const REAL_TAKE_SNAPSHOT_STDOUT = `{
  "content": [
    {
      "type": "text",
      "text": "## Latest page snapshot\\nuid=1_0 RootWebArea \\"Example Domain\\" url=\\"https://example.com/\\"\\n  uid=1_1 heading \\"Example Domain\\" level=\\"1\\"\\n"
    }
  ]
}
`;

// --- Fixture identity math (mirrors browser-use-operations.test.ts) ---------

const FIXTURE_ENVELOPE = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE);
const FIXTURE_RUN_ID = FIXTURE_ENVELOPE.run_id as string;
const FIXTURE_EVIDENCE_ID = handoffEvidenceIdOf({
	runId: FIXTURE_ENVELOPE.run_id,
	environmentName: FIXTURE_ENVELOPE.data.environment.name,
	environmentProfile: FIXTURE_ENVELOPE.data.environment.profile,
	attachmentAdapterId: FIXTURE_ENVELOPE.data.attachment.adapter_id,
	route: FIXTURE_ENVELOPE.data.attachment.route,
	endpointHttp: FIXTURE_ENVELOPE.data.endpoint.http,
	endpointWs: FIXTURE_ENVELOPE.data.endpoint.ws,
	proofContractId: FIXTURE_ENVELOPE.data.proof.environment_contract_id,
	proofSchemaVersion: FIXTURE_ENVELOPE.data.proof.environment_schema_version,
});
const FIXTURE_TARGET_ENVELOPE_ID = targetEnvelopeIdOf({
	runId: FIXTURE_RUN_ID,
	mode: "handoff-bound",
	adapter: "chrome-devtools-mcp",
	handoffEvidenceId: FIXTURE_EVIDENCE_ID,
});

// Selected state pinned to page 3 (Example Domain) — the page the snapshot
// capture was routed to, so the state, the list fixture, and the snapshot
// fixture tell one coherent story.
const SELECTED_STATE_PAGE_3 = JSON.stringify({
	contract: TARGETS_CONTRACT,
	schema_version: "2",
	run_id: FIXTURE_RUN_ID,
	selected_adapter_id: "chrome-devtools-mcp",
	verified_endpoint_identity: "127.0.0.1:9222",
	handoff_evidence_id: FIXTURE_EVIDENCE_ID,
	target_envelope_id: FIXTURE_TARGET_ENVELOPE_ID,
	target_candidate_id: candidateIdOf(FIXTURE_TARGET_ENVELOPE_ID, [
		"adapter_page_id",
		"3",
	]),
	selected_candidate_ordinal: 3,
	emitted_at_ms: 1_000,
	expires_at_ms: 1_000 + 15 * 60_000,
	display: { origin: "https://example.com", title: "Example Domain" },
});

// Derive a port with no listener by binding on port 0, reading the assigned
// port, and closing the listener; connecting afterwards gets ECONNREFUSED.
async function closedPort(): Promise<number> {
	const listener = Bun.serve({
		port: 0,
		fetch: () => new Response(""),
	});
	const port = listener.port;
	await listener.stop(true);
	if (port === undefined) throw new Error("port-0 bind returned no port");
	return port;
}

describe.skipIf(IS_CI && (!mcporterOnPath || !pinnedAdapterPresent))(
	"U1 envelope-derived transport proof against real mcporter",
	() => {
	test(
		"ad-hoc pinned-adapter invocation is accepted and fails closed on an unreachable endpoint",
		async () => {
			const port = await closedPort();
			const child = Bun.spawn(
				[
					MCPORTER_PATH,
					...envelopeAdapterArgv(
						PINNED_ADAPTER,
						`http://127.0.0.1:${port}`,
						"list_pages",
						"{}",
					),
				],
				{
					// The env guard is part of the contract: without it, a running
					// mcporter daemon with a configured chrome-devtools server would
					// answer this call itself (wrong binary, wrong endpoint, exit 0).
					env: { ...process.env, ...ENVELOPE_ADAPTER_ENV_GUARD },
					stdout: "pipe",
					stderr: "pipe",
					stdin: "ignore",
				},
			);
			const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
			const [stdout, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				child.exited,
			]);
			clearTimeout(timeout);

			// Adapter-level failure: mcporter accepted the argv (no usage error),
			// spawned the pinned adapter, and the adapter failed closed against the
			// endpoint verbatim (R2/R10 hold at the spawn).
			expect(exitCode).not.toBe(0);
			const result = parseJson(stdout);
			const content = result.content as Array<Record<string, unknown>>;
			expect(content[0]?.type).toBe("text");
			expect(String(content[0]?.text)).toMatch(/Could not connect to Chrome/);
			expect(result.isError).toBe(true);
			// Daemon-shadowing tripwire: if a daemon-managed configured server had
			// answered instead of the ephemeral ad-hoc spawn, real pages would be
			// listed here and the exit would be 0.
			expect(stdout).not.toContain("## Pages");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"missing pinned adapter routes to dependency_missing through the real taxonomy",
		async () => {
			// Real runtime end to end: real env, real spawn, real mcporter. The
			// wrapper only captures the raw transport result so the classification
			// mechanism can be asserted alongside the taxonomy outcome. No env guard
			// needed: the nonexistent path contains no `chrome-devtools-mcp`
			// fragment, so mcporter's keep-alive routing never engages.
			const env = { ...process.env };
			// A leaked ambient override would swap the command vector under the
			// test; the proof targets the default PATH `mcporter` resolution.
			delete env[MCPORTER_COMMAND_ENV_VAR];
			let captured: McporterCommandResult | undefined;
			const runtime = makeRuntime({
				env,
				runCommand: async (input) => {
					captured = await spawnMcporterCommand(input);
					return captured;
				},
			});
			const result = await runBrowserUseMcporter(
				runtime,
				envelopeAdapterArgv(
					"/nonexistent/browser-use-missing-adapter",
					"http://127.0.0.1:1",
					"list_pages",
					"{}",
				),
			);
			expect(result).toMatchObject({
				ok: false,
				failure: {
					kind: "dependency_missing",
					code: "browser_operation_dependency_missing",
				},
			});
			// The classifier fired on the ENOENT text, not the exit-127 path:
			// mcporter itself started fine and exits 1 after its child spawn fails.
			expect(captured?.exitCode).toBe(1);
			expect(`${captured?.stderr}\n${captured?.stdout}`).toMatch(/ENOENT/);
		},
		TEST_TIMEOUT_MS,
	);

	test("captured list_pages envelope feeds the current discovery parser", async () => {
		// Process-shaped path: discoverPages consumes the transport result exactly
		// as it would a live call; the fake runtime replays the captured stdout
		// verbatim (exit 0), so this pins the current parser against the real
		// shape the envelope-derived transport will hand it.
		const runtime = makeRuntime({
			runCommand: async () => okCommand(REAL_LIST_PAGES_STDOUT),
		});
		const discovery = await discoverPages(runtime, {
			adapter: "chrome-devtools-mcp",
			probeExecutable: FIXTURE_ENVELOPE.data.attachment
				.probe_executable as string,
			endpointHttp: FIXTURE_ENVELOPE.data.endpoint.http as string,
			endpointWs: FIXTURE_ENVELOPE.data.endpoint.ws as string,
			runId: FIXTURE_ENVELOPE.run_id as string,
		});
		if (!discovery.ok) {
			throw new Error(
				`real-shape list_pages failed discovery parse: ${discovery.failure.code}`,
			);
		}
		expect(discovery.pages).toHaveLength(3);
		for (const page of discovery.pages) {
			expect(page.id).toBeTruthy();
			expect(page.url).toBeTruthy();
			expect(page.title).toBeTruthy();
		}
		// pageId is the leading ordinal; the [selected] flag is dropped, the hash
		// fragment survives into the raw url.
		expect(discovery.pages[0]).toEqual({
			id: "1",
			title: "Sample Recruiting Portal",
			url: "https://portal.example.net/App#/U2FtcGxl",
		});
		expect(discovery.pages[2]).toEqual({
			id: "3",
			title: "Example Domain",
			url: "https://example.com/",
		});
	});

	test("captured take_snapshot envelope feeds the operate snapshot consumer", async () => {
		// Full operate path against replayed real shapes: list_pages resolves the
		// selected candidate from the captured page list, take_snapshot returns
		// the captured pageId-routed snapshot. normalizeSnapshot/extractTextContent
		// are module-private, so runForTest is the narrowest real consumer.
		const files: Record<string, string> = {
			"/h.json": REAL_VERIFIED_HANDOFF_ENVELOPE,
			"/state.json": SELECTED_STATE_PAGE_3,
		};
		const runtime = makeRuntime({
			env: operationXdg.env,
			now: () => 2_000,
			readTextFile: async (path) => {
				const contents = files[path];
				if (contents === undefined) throw new Error(`ENOENT: ${path}`);
				return contents;
			},
			runCommand: async (input) => {
				// The envelope-derived argv names the tool via --tool (U3).
				const toolIndex = input.args.indexOf("--tool");
				const tool = toolIndex >= 0 ? input.args[toolIndex + 1] : undefined;
				if (tool === "list_pages") {
					return okCommand(REAL_LIST_PAGES_STDOUT);
				}
				return okCommand(REAL_TAKE_SNAPSHOT_STDOUT);
			},
		});
		const result = await runForTest(
			["operate", "snapshot", "--state", "/state.json", "--handoff", "/h.json", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		const data = json.data as Record<string, Record<string, unknown>>;
		// The operations parser expects the `## Latest page snapshot` contract;
		// the captured envelope satisfies it and the text survives normalization.
		expect(String(data.snapshot.text)).toStartWith("## Latest page snapshot");
		expect(String(data.snapshot.text)).toContain(
			'uid=1_0 RootWebArea "Example Domain" url="https://example.com/"',
		);
		expect(data.snapshot.truncated).toBe(false);
		expect(data.target).toMatchObject({ origin: "https://example.com" });
	});

	test("the recorded argv contract substitutes envelope slots and nothing else", () => {
		expect(
			envelopeAdapterArgv(
				PINNED_ADAPTER,
				"http://127.0.0.1:53412",
				"take_snapshot",
				'{"pageId":3}',
			),
		).toEqual([
			"call",
			"--stdio",
			PINNED_ADAPTER,
			"--stdio-arg",
			"--browser-url",
			"--stdio-arg",
			"http://127.0.0.1:53412",
			"--stdio-arg",
			"--experimentalPageIdRouting",
			"--name",
			"browser-use-envelope-adapter",
			"--tool",
			"take_snapshot",
			"--args",
			'{"pageId":3}',
			"--output",
			"json",
		]);
		expect(ENVELOPE_ADAPTER_ENV_GUARD).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
	});
});
