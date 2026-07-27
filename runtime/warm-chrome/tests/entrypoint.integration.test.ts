import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { assertJsonErrorEnvelope } from "@side-quest/cli-command-facade/testing";

import {
	main,
	notYetImplementedHandlers,
	type WarmChromeCommandHandlers,
	type WarmChromeExecuteInvocation,
} from "../src/cli.ts";
import { warmChromeContracts } from "../src/command-contract.ts";
import {
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_DEFAULT_CDP_PORT,
	WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID,
	WARM_CHROME_SCHEMA_VERSION,
} from "../src/model.ts";
import {
	createDefaultRuntime,
	WarmChromeRuntimeError,
	type WarmChromeRuntime,
} from "../src/runtime.ts";

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

// Every error envelope self-describes the package result contract (R12); the
// expectation references the contract so tests cannot drift from it.
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

// Every IO hook throws so any test that reaches the browser proves it by
// failing loudly; --help/--version must complete without touching them.
function inertRuntime(env: Record<string, string | undefined> = {}): WarmChromeRuntime {
	return createDefaultRuntime({
		env,
		// Real time: the facade stamps startedAtMs from Date.now(), and envelope
		// validation rejects a negative duration_ms.
		now: () => Date.now(),
		fetchJson: async () => {
			throw new Error("fetchJson must not run");
		},
		findListener: async () => {
			throw new Error("findListener must not run");
		},
		currentUser: async () => {
			throw new Error("currentUser must not run");
		},
		statProfile: async () => {
			throw new Error("statProfile must not run");
		},
		ensureProfileDir: async () => {
			throw new Error("ensureProfileDir must not run");
		},
		chmod: async () => {
			throw new Error("chmod must not run");
		},
		writeTextFile: async () => {
			throw new Error("writeTextFile must not run");
		},
		spawnChrome: async () => {
			throw new Error("spawnChrome must not run");
		},
		readSingletonLock: async () => {
			throw new Error("readSingletonLock must not run");
		},
		sleep: async () => {
			throw new Error("sleep must not run");
		},
	});
}

async function runCli(
	argv: readonly string[],
	options: {
		handlers?: Partial<WarmChromeCommandHandlers>;
		env?: Record<string, string | undefined>;
	} = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = createMemoryWriter();
	const stderr = createMemoryWriter();
	const exitCode = await main(argv, {
		runtime: inertRuntime(options.env ?? {}),
		...(options.handlers ? { handlers: options.handlers } : {}),
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.output, stderr: stderr.output };
}

function okHandler(): WarmChromeCommandHandlers["check"] {
	return async (invocation: WarmChromeExecuteInvocation) => ({
		data: {
			contract_id: WARM_CHROME_CONTRACT_ID,
			schema_version: WARM_CHROME_SCHEMA_VERSION,
			ok: true,
			action: "browser_ready",
			command: invocation.displayCommand,
			endpoint: invocation.endpoint,
			port: invocation.port,
		},
		plain: `browser_ready command=${invocation.displayCommand} port=${invocation.port}`,
		runtimeActions: [
			{
				id: "use_verified_endpoint",
				summary: "Pass the verified endpoint to the selected browser adapter.",
				side_effects: ["browser"],
			},
		],
		continuation: { next_action_id: "use_verified_endpoint" },
	});
}

describe("warm-chrome entrypoint surface (U4)", () => {
	test("--version answers without browser work", async () => {
		const result = await runCli(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("warm-chrome 0.1.0");
	});

	test("--help renders the four-command surface without browser work", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: warm-chrome <command> [flags]");
		for (const command of ["check", "status", "launch", "repair"]) {
			expect(result.stdout).toContain(command);
		}
		expect(result.stdout).toContain("help     Show help");
		expect(result.stdout).toContain("--run-id");
		expect(result.stdout).toContain("WARM_CHROME_CDP_PORT");
	});

	test("no args renders help without probing the browser", async () => {
		const result = await runCli([]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: warm-chrome <command> [flags]");
	});

	test("command help renders the facade contract usage", async () => {
		const result = await runCli(["launch", "--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("warm-chrome launch");
		expect(result.stdout).toContain("--chrome");
	});

	test("help subcommand renders command help", async () => {
		const result = await runCli(["help", "repair"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("warm-chrome repair");
		expect(result.stdout).toContain("--profile");
	});

	test("bin keeps its executable bit and bun shebang", async () => {
		const mode = statSync(CLI_PATH).mode;
		const [firstLine] = (await readFile(CLI_PATH, "utf8")).split("\n");

		expect(mode & 0o111).not.toBe(0);
		expect(firstLine).toBe("#!/usr/bin/env bun");
	});

	test("--version and --help pass through the shebang entrypoint without browser work", async () => {
		const version = Bun.spawn([CLI_PATH, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const help = Bun.spawn([CLI_PATH, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [versionOut, versionExit, helpOut, helpExit] = await Promise.all([
			new Response(version.stdout).text(),
			version.exited,
			new Response(help.stdout).text(),
			help.exited,
		]);

		expect(versionExit).toBe(0);
		expect(versionOut).toContain("warm-chrome 0.1.0");
		expect(helpExit).toBe(0);
		expect(helpOut).toContain("Usage: warm-chrome <command> [flags]");
	});
});

describe("warm-chrome usage errors (U4 R2/R3)", () => {
	test("unknown command exits 2 with a structured envelope", async () => {
		const result = await runCli(["bogus", "--run-id", "usage-run"]);

		expect(result.exitCode).toBe(2);
		assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "invalid_usage",
			recoverability: "change_input",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 2,
			runId: "usage-run",
			failureDomain: "input",
		});
	});

	test("--port and --endpoint are mutually exclusive (parser-enforced, exit 2)", async () => {
		const result = await runCli([
			"check",
			"--port",
			"9222",
			"--endpoint",
			"http://127.0.0.1:9222",
		]);

		expect(result.exitCode).toBe(2);
		const envelope = assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "invalid_usage",
			recoverability: "change_input",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 2,
		});
		expect(envelope.error.message).toContain("mutually exclusive");
	});

	test("--endpoint accepts an explicit default-scheme port", async () => {
		const seen: WarmChromeExecuteInvocation[] = [];
		const handler = okHandler();
		const result = await runCli(["check", "--endpoint", "http://127.0.0.1:80"], {
			handlers: {
				check: async (invocation, runtime) => {
					seen.push(invocation);
					return handler(invocation, runtime);
				},
			},
		});

		expect(result.exitCode).toBe(0);
		expect(seen[0]?.endpoint).toBe("http://127.0.0.1:80");
		expect(seen[0]?.port).toBe("80");
	});

	test("--chrome is rejected outside launch", async () => {
		const result = await runCli(["check", "--chrome", "/tmp/x"]);

		expect(result.exitCode).toBe(2);
		assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "invalid_usage",
			recoverability: "change_input",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 2,
		});
	});

	test("non-numeric port is rejected with exit 2", async () => {
		const result = await runCli(["check", "--port", "banana"]);

		expect(result.exitCode).toBe(2);
		assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "invalid_usage",
			recoverability: "change_input",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 2,
		});
	});
});

describe("warm-chrome dispatch (U4)", () => {
	test("check defaults to the JSON channel and passes the invocation to the handler", async () => {
		const seen: WarmChromeExecuteInvocation[] = [];
		const handler = okHandler();
		const result = await runCli(["check", "--run-id", "check-run"], {
			handlers: {
				check: async (invocation, runtime) => {
					seen.push(invocation);
					return handler(invocation, runtime);
				},
			},
		});

		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout) as {
			status: string;
			run_id: string;
			data: { port: string };
		};
		expect(envelope.status).toBe("ok");
		expect(envelope.run_id).toBe("check-run");
		expect(envelope.data.port).toBe(WARM_CHROME_DEFAULT_CDP_PORT);
		expect(seen[0]?.command).toBe("check");
		expect(seen[0]?.displayCommand).toBe("check");
		expect(seen[0]?.outputMode).toBe("json");
		expect(seen[0]?.endpoint).toBe(`http://127.0.0.1:${WARM_CHROME_DEFAULT_CDP_PORT}`);
	});

	test("status resolves as the plain presentation alias of check", async () => {
		const seen: WarmChromeExecuteInvocation[] = [];
		const handler = okHandler();
		const result = await runCli(["status", "--run-id", "status-run"], {
			handlers: {
				check: async (invocation, runtime) => {
					seen.push(invocation);
					return handler(invocation, runtime);
				},
			},
		});

		expect(result.exitCode).toBe(0);
		expect(seen[0]?.command).toBe("check");
		expect(seen[0]?.displayCommand).toBe("status");
		expect(seen[0]?.outputMode).toBe("plain");
		expect(result.stdout).toContain(
			`browser_ready command=status port=${WARM_CHROME_DEFAULT_CDP_PORT}`,
		);
		expect(result.stdout).toContain("run_id=status-run");
	});

	// All three default handlers are real (U5-U7); the typed stubs stay
	// exported for tests that need an inert registry entry, and their
	// envelope contract stays pinned through injection.
	test("an injected not-yet-implemented stub emits a runtime-failure-style envelope with exit 1", async () => {
		const result = await runCli(["launch", "--json", "--run-id", "stub-run"], {
			handlers: { launch: notYetImplementedHandlers.launch },
		});

		expect(result.exitCode).toBe(1);
		const envelope = assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "not_implemented",
			recoverability: "none",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 1,
			runId: "stub-run",
			failureDomain: "runtime_diagnostics",
		});
		expect(envelope.runtime_actions?.[0]?.id).toBe("inspect_diagnostics");
		expect(envelope.continuation?.constraints).toBeUndefined();
		expect(Object.keys(notYetImplementedHandlers).sort()).toEqual([
			"check",
			"launch",
			"repair",
		]);
	});

	test("every exit-20 envelope carries the no_adapter_fallback continuation meaning (R12)", async () => {
		const result = await runCli(["check", "--json", "--run-id", "handoff-run"], {
			handlers: {
				check: async () => {
					throw new WarmChromeRuntimeError(
						"endpoint_unreachable",
						"No Chrome DevTools endpoint answered.",
					);
				},
			},
		});

		expect(result.exitCode).toBe(20);
		const envelope = assertJsonErrorEnvelope(JSON.parse(result.stdout), {
			code: "endpoint_unreachable",
			recoverability: "repair_state",
			errorResultContract: WARM_CHROME_ERROR_RESULT_CONTRACT,
			processExitCode: 20,
			runId: "handoff-run",
			failureDomain: "browser_entry_handoff",
		});
		const constraint = envelope.continuation?.constraints?.[0];
		expect(constraint?.id).toBe(WARM_CHROME_NO_ADAPTER_FALLBACK_CONSTRAINT_ID);
		expect(constraint?.forbidden_action_ids).toEqual([
			"adapter_fallback",
			"cold_browser_fallback",
		]);
		expect(envelope.error.exit_code).toBe(20);
	});

	test("plain output routes errors to stderr with the exit-20 code intact", async () => {
		const result = await runCli(
			["status", "--run-id", "plain-run"],
			{
				handlers: {
					check: async () => {
						throw new WarmChromeRuntimeError(
							"endpoint_unreachable",
							"No Chrome DevTools endpoint answered.",
						);
					},
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("endpoint_unreachable");
		expect(result.stderr).toContain("run_id=plain-run");
	});
});
