import { describe, expect, test } from "bun:test";
import { emitCliDiagnostic } from "@side-quest/cli-command-facade";
import {
	assertCommandResultContract,
	assertJsonErrorEnvelope,
	assertNoRuntimeContractFixtureLeaks,
	RUNTIME_CONTRACT_REDACTION_FIXTURES,
} from "@side-quest/cli-command-facade/testing";

import {
	main,
	warmChromeRuntimeAction,
	type WarmChromeCommandHandlers,
} from "../src/cli.ts";
import { warmChromeContracts } from "../src/command-contract.ts";
import {
	WARM_CHROME_CLI_NAME,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	createDefaultRuntime,
	REAL_GOOGLE_CHROME_BINARY,
	redactListenerDetail,
	redactWsUrl,
	redactWsUrlsDeep,
	WarmChromeRuntimeError,
	type WarmChromeRuntime,
} from "../src/runtime.ts";

// Every error envelope self-describes the package result contract (R12).
const WARM_CHROME_ERROR_RESULT_CONTRACT = warmChromeContracts.check
	.resultContract as {
	id: typeof WARM_CHROME_CONTRACT_ID;
	kind: string;
	schema_version: typeof WARM_CHROME_SCHEMA_VERSION;
};

interface MemoryWriter {
	output: string;
	write(chunk: string): true;
}

function createMemoryWriter(): MemoryWriter {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
			return true;
		},
	};
}

function fixture(label: string): string {
	const found = RUNTIME_CONTRACT_REDACTION_FIXTURES.find(
		(entry) => entry.label === label,
	);
	if (!found) throw new Error(`missing redaction fixture: ${label}`);
	return found.value;
}

const wsUrlFixture = fixture("browser-debugger-url");
const credentialFixture = fixture("credential");
const bearerFixture = fixture("bearer-token");
const localPathFixture = fixture("local-path");
const opSecretFixture = fixture("op-secret-ref");

// A hostile foreign listener whose cmdline carries every secret shape the
// fixture catalog knows about. Nothing beyond pid + basename may survive.
const foreignListener = {
	pid: 4242,
	command: `/opt/tools/proxy-server --password=${credentialFixture} --authorization "${bearerFixture}" --state ${localPathFixture} --vault ${opSecretFixture} --upstream ${wsUrlFixture}`,
};

function testRuntime(overrides: Partial<WarmChromeRuntime> = {}): WarmChromeRuntime {
	return createDefaultRuntime({
		env: {},
		// The facade stamps startedAtMs from real time; a fixed epoch here would
		// produce a negative duration_ms and fail envelope validation.
		now: () => Date.now(),
		fetchJson: async () => {
			throw new Error("fetchJson must not run in this test");
		},
		findListener: async () => null,
		currentUser: async () => "501",
		statProfile: async () => {
			throw new Error("statProfile must not run in this test");
		},
		ensureProfileDir: async () => {
			throw new Error("ensureProfileDir must not run in this test");
		},
		chmod: async () => {},
		writeTextFile: async () => {},
		spawnChrome: async () => {
			throw new Error("spawnChrome must not run in this test");
		},
		readSingletonLock: async () => null,
		sleep: async () => {},
		...overrides,
	});
}

async function runCli(
	argv: readonly string[],
	handlers: Partial<WarmChromeCommandHandlers>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime: testRuntime(),
		handlers,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

describe("warm-chrome websocket URL redaction (R13)", () => {
	test("redactWsUrl reduces a CDP debugger websocket URL to its path prefix", () => {
		const redacted = redactWsUrl(wsUrlFixture);

		expect(redacted).toBe("/devtools/browser/");
		assertNoRuntimeContractFixtureLeaks(redacted);
	});

	test("redactWsUrlsDeep scrubs websocket URLs from nested diagnostic payloads", () => {
		const scrubbed = redactWsUrlsDeep({
			phase: "verify",
			version: { webSocketDebuggerUrl: wsUrlFixture },
			notes: [`endpoint advertised ${wsUrlFixture}`],
		});

		assertNoRuntimeContractFixtureLeaks(scrubbed, [
			{ label: "browser-debugger-url", value: wsUrlFixture },
		]);
		expect(JSON.stringify(scrubbed)).toContain("/devtools/browser/");
	});
});

describe("warm-chrome foreign listener redaction (R13)", () => {
	test("foreign listener detail is pid and process basename only", () => {
		const detail = redactListenerDetail(foreignListener);

		expect(detail).toEqual({
			pid: 4242,
			process: "proxy-server",
			foreign: true,
		});
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	test("real-Chrome listener is non-foreign and may expose its user-data-dir", () => {
		const detail = redactListenerDetail({
			pid: 7,
			command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=9223 --user-data-dir=/Users/example/other-warm-profile --auth-token=${credentialFixture}`,
		});

		expect(detail.foreign).toBe(false);
		expect(detail.pid).toBe(7);
		expect(detail.process).toBe("Google Chrome");
		expect(detail.user_data_dir).toBe("/Users/example/other-warm-profile");
		// The rest of the observed cmdline never survives the chokepoint.
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	// #252: a real Chrome whose executable is the macOS code-sign clone path is
	// still real Chrome — non-foreign, and may expose its non-default user-data-dir.
	test("code-sign clone real-Chrome listener is non-foreign and may expose its user-data-dir", () => {
		const cloneBinary =
			"/private/var/folders/_b/0fxx/X/com.google.Chrome.code_sign_clone/code_sign_clone.H5bJ4j/Google Chrome.app.bundle/Contents/MacOS/Google Chrome";
		const detail = redactListenerDetail({
			pid: 7,
			command: `${cloneBinary} --remote-debugging-port=9223 --user-data-dir=/Users/example/other-warm-profile --auth-token=${credentialFixture}`,
		});

		expect(detail.foreign).toBe(false);
		expect(detail.process).toBe("Google Chrome");
		expect(detail.user_data_dir).toBe("/Users/example/other-warm-profile");
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	// #252: the default-profile guard must still fire when identity now passes via
	// the clone path — a clone-path real Chrome on the default profile stays foreign
	// and never leaks the default-profile path.
	test("code-sign clone real-Chrome listener on the default profile drops its user-data-dir", () => {
		const cloneBinary =
			"/private/var/folders/_b/0fxx/X/com.google.Chrome.code_sign_clone/code_sign_clone.H5bJ4j/Google Chrome.app.bundle/Contents/MacOS/Google Chrome";
		const detail = redactListenerDetail(
			{
				pid: 7,
				command: `${cloneBinary} --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome`,
			},
			{ env: { HOME: "/Users/example" } },
		);

		expect(detail.foreign).toBe(false);
		expect(detail.user_data_dir).toBeUndefined();
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	// Re-audit (medium/low): a real Chrome on the operator's DEFAULT profile is a
	// foreign instance; its user_data_dir discloses the OS account / HOME layout
	// and must never reach the envelope, even though the binary matches.
	test("real-Chrome listener on the default profile drops its user-data-dir when env is supplied", () => {
		const detail = redactListenerDetail(
			{
				pid: 7,
				command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome`,
			},
			{ env: { HOME: "/Users/example" } },
		);

		expect(detail.foreign).toBe(false);
		expect(detail.user_data_dir).toBeUndefined();
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	// CodeRabbit review (PR #226): the default-profile guard must fire even when
	// env is omitted. proof.ts/repair.ts failed-probe branches call this without
	// env; without the unconditional guard they leaked the default-profile path.
	// The HOME-absent regex fallback recognizes the default-profile shape.
	test("real-Chrome listener on the default profile drops its user-data-dir even without env", () => {
		const detail = redactListenerDetail({
			pid: 7,
			command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=9222 --user-data-dir=/Users/example/Library/Application Support/Google/Chrome`,
		});

		expect(detail.foreign).toBe(false);
		expect(detail.user_data_dir).toBeUndefined();
		assertNoRuntimeContractFixtureLeaks(detail);
	});

	test("forceForeign redacts a real-Chrome listener to pid and basename only", () => {
		const detail = redactListenerDetail(
			{
				pid: 7,
				command: `${REAL_GOOGLE_CHROME_BINARY} --user-data-dir=/Users/example/Library/Application Support/Google/Chrome`,
			},
			{ forceForeign: true },
		);

		expect(detail).toEqual({ pid: 7, process: "Google Chrome", foreign: true });
		assertNoRuntimeContractFixtureLeaks(detail);
	});
});

describe("warm-chrome envelope redaction boundary (R12/R13)", () => {
	test("usage redaction scrubs path values attached with equals", async () => {
		const result = await runCli(["check", `--bogus=${localPathFixture}`], {});

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toContain("[redacted]");
		expect(result.stdout).not.toContain(localPathFixture);
	});

	test("listener_mismatch envelope keeps the observed user-data-dir and the no_adapter_fallback constraint", async () => {
		const observed = redactListenerDetail({
			pid: 7,
			command: `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=9223 --user-data-dir=/Users/example/other-warm-profile --auth-token=${credentialFixture}`,
		});
		const result = await runCli(["check", "--json", "--run-id", "redaction-run"], {
			check: async () => {
				throw new WarmChromeRuntimeError(
					"listener_mismatch",
					"Listener profile does not match the requested Warm Chrome profile.",
					{ data: { listener: observed } },
				);
			},
		});

		expect(result.exitCode).toBe(20);
		const envelope = assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "listener_mismatch",
			recoverability: "repair_state",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 20,
			runId: "redaction-run",
			failureDomain: "browser_entry_handoff",
		});
		const listener = (envelope.data as { listener: Record<string, unknown> })
			.listener;
		expect(listener.user_data_dir).toBe("/Users/example/other-warm-profile");
		expect(envelope.continuation?.constraints?.map((c) => c.id)).toEqual([
			WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
		]);
		expect(envelope.continuation?.constraints?.[0]?.forbidden_action_ids).toEqual([
			"adapter_fallback",
			"cold_browser_fallback",
		]);
		expect(envelope.runtime_actions?.[0]?.id).toBe("inspect_listener");
		assertNoRuntimeContractFixtureLeaks(result.stdout);
		assertNoRuntimeContractFixtureLeaks(result.stderr);
	});

	test("hostile raw error never leaks into the envelope or diagnostics; post-mortem flush stays clean", async () => {
		const result = await runCli(["check", "--json", "--run-id", "flush-run"], {
			check: async () => {
				// Chokepoint-shaped debug emit plus a raw ws URL: the diagnostic
				// redactor must scrub the URL even when a call site forgets to.
				emitCliDiagnostic(WARM_CHROME_CLI_NAME, "debug", "verify", {
					listener: redactListenerDetail(foreignListener),
					web_socket_debugger_url: wsUrlFixture,
				});
				throw new Error(
					`upstream exploded: ${credentialFixture} ${wsUrlFixture} ${opSecretFixture}`,
				);
			},
		});

		expect(result.exitCode).toBe(1);
		const envelope = assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "runtime_failure",
			recoverability: "none",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 1,
			runId: "flush-run",
			failureDomain: "runtime_diagnostics",
		});
		expect(envelope.runtime_actions?.[0]?.id).toBe("inspect_diagnostics");
		// Default mode buffers debug records; the error-level record flushes the
		// post-mortem buffer to stderr. The flush must already be redacted.
		expect(result.stderr).toContain("verify");
		expect(result.stderr).toContain("/devtools/browser/");
		assertNoRuntimeContractFixtureLeaks(result.stdout);
		assertNoRuntimeContractFixtureLeaks(result.stderr);
	});

	test("LogTape debug emits are redacted on the visible --debug stream too", async () => {
		const result = await runCli(
			["check", "--json", "--debug", "--run-id", "debug-run"],
			{
				check: async () => {
					emitCliDiagnostic(WARM_CHROME_CLI_NAME, "debug", "verify", {
						web_socket_debugger_url: wsUrlFixture,
						listener: redactListenerDetail(foreignListener),
					});
					throw new WarmChromeRuntimeError(
						"endpoint_unreachable",
						"No Chrome DevTools endpoint answered.",
					);
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(result.stderr).toContain("verify");
		expect(result.stderr).toContain("/devtools/browser/");
		assertNoRuntimeContractFixtureLeaks(result.stdout);
		assertNoRuntimeContractFixtureLeaks(result.stderr);
	});

	test("ok envelope keeps the verified websocket URL on the JSON channel while ok-path diagnostics redact it", async () => {
		const result = await runCli(
			["check", "--json", "--debug", "--run-id", "ok-run"],
			{
				check: async () => {
					emitCliDiagnostic(WARM_CHROME_CLI_NAME, "debug", "verify-ready", {
						web_socket_debugger_url: wsUrlFixture,
					});
					return {
						data: {
							contract_id: WARM_CHROME_CONTRACT_ID,
							schema_version: WARM_CHROME_SCHEMA_VERSION,
							ok: true,
							action: "browser_ready",
							command: "check",
							endpoint: "http://127.0.0.1:9222",
							port: "9222",
							webSocketDebuggerUrl: wsUrlFixture,
						},
						plain: "browser_ready command=check port=9222",
						runtimeActions: [warmChromeRuntimeAction("use_verified_endpoint")],
						continuation: { next_action_id: "use_verified_endpoint" },
					};
				},
			},
		);

		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout) as {
			data: { webSocketDebuggerUrl: string };
		};
		// Authority survives redaction: the structured JSON output channel is the
		// one surface allowed to carry the verified capability handle intact.
		expect(envelope.data.webSocketDebuggerUrl).toBe(wsUrlFixture);
		assertCommandResultContract({
			command: "check",
			contract: warmChromeContracts.check,
			envelope,
		});
		// The diagnostic sink has weaker access control: path prefix only.
		expect(result.stderr).toContain("verify-ready");
		expect(result.stderr).toContain("/devtools/browser/");
		assertNoRuntimeContractFixtureLeaks(result.stderr);
	});
});
