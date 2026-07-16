import { describe, expect, test } from "bun:test";
import {
	isMissingTransportCommandResult,
	resolveTransportCommandVector,
	runTransportCommand,
	spawnTransportCommand,
	transportDependencyHintText,
	transportOverrideInvalidHintText,
	type TransportCommandChannel,
	type TransportCommandInput,
	type TransportCommandResult,
} from "../src/index.ts";

// Channel fixture: deliberately NOT browser-use's env var, proving the shared
// contract accepts the channel as caller-owned input instead of hardcoding one
// surface's variable.
const CHANNEL: TransportCommandChannel = {
	envVarName: "TEST_TRANSPORT_COMMAND_JSON",
	defaultCommand: ["fake-transport"],
	overrideExamples: '["bunx","fake-transport"] or ["npx","-y","fake-transport"]',
};

function capturingRuntime(env: Record<string, string | undefined>) {
	const calls: TransportCommandInput[] = [];
	return {
		calls,
		runtime: {
			env,
			runCommand: async (input: TransportCommandInput) => {
				calls.push(input);
				return { exitCode: 0, stdout: "{}", stderr: "" };
			},
		},
	};
}

describe("command-vector resolution", () => {
	test("missing override resolves to the channel default vector", () => {
		const resolved = resolveTransportCommandVector(CHANNEL, {});
		expect(resolved).toEqual({ ok: true, vector: ["fake-transport"] });
	});

	test("JSON-array override on the channel env var wins", () => {
		const resolved = resolveTransportCommandVector(CHANNEL, {
			TEST_TRANSPORT_COMMAND_JSON: '["bunx","fake-transport"]',
		});
		expect(resolved).toEqual({ ok: true, vector: ["bunx", "fake-transport"] });
	});

	test("override entries are trimmed", () => {
		const resolved = resolveTransportCommandVector(CHANNEL, {
			TEST_TRANSPORT_COMMAND_JSON: '[" bunx ","fake-transport"]',
		});
		expect(resolved).toEqual({ ok: true, vector: ["bunx", "fake-transport"] });
	});

	test("a shell string override is rejected, never shell-evaluated", () => {
		const resolved = resolveTransportCommandVector(CHANNEL, {
			TEST_TRANSPORT_COMMAND_JSON: "bunx fake-transport --flag",
		});
		expect(resolved).toEqual({
			ok: false,
			reason: "invalid_override",
			message:
				"TEST_TRANSPORT_COMMAND_JSON must be a JSON array of non-empty strings.",
		});
	});

	test.each([
		["non-array JSON", '{"command":"fake-transport"}'],
		["empty array", "[]"],
	])("%s override is invalid", (_label, rawOverride) => {
		const resolved = resolveTransportCommandVector(CHANNEL, {
			TEST_TRANSPORT_COMMAND_JSON: rawOverride,
		});
		expect(resolved).toEqual({
			ok: false,
			reason: "invalid_override",
			message:
				"TEST_TRANSPORT_COMMAND_JSON must be a non-empty JSON array of strings.",
		});
	});

	test.each([
		["non-string member", '["bunx",42]'],
		["blank member", '["bunx","  "]'],
	])("%s override is invalid", (_label, rawOverride) => {
		const resolved = resolveTransportCommandVector(CHANNEL, {
			TEST_TRANSPORT_COMMAND_JSON: rawOverride,
		});
		expect(resolved).toEqual({
			ok: false,
			reason: "invalid_override",
			message: "TEST_TRANSPORT_COMMAND_JSON entries must be non-empty strings.",
		});
	});
});

describe("runTransportCommand", () => {
	test("prefixes the resolved vector and passes args positionally", async () => {
		const { runtime, calls } = capturingRuntime({
			TEST_TRANSPORT_COMMAND_JSON: '["bunx","fake-transport"]',
		});
		const outcome = await runTransportCommand(
			CHANNEL,
			runtime,
			["call", "target", "--args", '{"a b":"c; rm -rf"}'],
			5000,
		);

		expect(outcome.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe("bunx");
		expect(calls[0].args).toEqual([
			"fake-transport",
			"call",
			"target",
			"--args",
			'{"a b":"c; rm -rf"}',
		]);
		expect(calls[0].timeoutMs).toBe(5000);
	});

	test("invalid override short-circuits without running a command", async () => {
		const { runtime, calls } = capturingRuntime({
			TEST_TRANSPORT_COMMAND_JSON: "not json",
		});
		const outcome = await runTransportCommand(CHANNEL, runtime, ["call"], 5000);

		expect(outcome).toMatchObject({ ok: false, reason: "invalid_override" });
		expect(calls).toHaveLength(0);
	});

	test("a spawn-failure throw maps to command_not_started", async () => {
		const error = Object.assign(new Error("spawn fake-transport ENOENT"), {
			code: "ENOENT",
		});
		const outcome = await runTransportCommand(
			CHANNEL,
			{
				env: {},
				runCommand: async () => {
					throw error;
				},
			},
			["call"],
			5000,
		);

		expect(outcome).toEqual({
			ok: false,
			reason: "command_not_started",
			command: "fake-transport",
			error,
		});
	});

	test("an opaque throw maps to execution_failed, not a missing binary", async () => {
		const error = new Error("runner cancelled mid-flight");
		const outcome = await runTransportCommand(
			CHANNEL,
			{
				env: {},
				runCommand: async () => {
					throw error;
				},
			},
			["call"],
			5000,
		);

		expect(outcome).toEqual({
			ok: false,
			reason: "execution_failed",
			command: "fake-transport",
			error,
		});
	});
});

describe("dependency-missing mapping", () => {
	test("exit 127 marks the binary missing", () => {
		expect(
			isMissingTransportCommandResult({ exitCode: 127, stdout: "", stderr: "" }),
		).toBe(true);
	});

	test("command-not-found text marks the binary missing", () => {
		expect(
			isMissingTransportCommandResult({
				exitCode: 1,
				stdout: "",
				stderr: "zsh: command not found: fake-transport",
			}),
		).toBe(true);
	});

	test("a clean non-zero exit is not a missing binary", () => {
		expect(
			isMissingTransportCommandResult({
				exitCode: 2,
				stdout: "",
				stderr: "usage: fake-transport call <target>",
			}),
		).toBe(false);
	});
});

describe("spawnTransportCommand", () => {
	test("an unresolvable binary surfaces as an exit-127 result, not a throw", async () => {
		const result = await spawnTransportCommand({
			command: "definitely-not-a-real-binary-b7c2e",
			args: [],
			timeoutMs: 5000,
		});

		expect(result.exitCode).toBe(127);
		expect(isMissingTransportCommandResult(result)).toBe(true);
	});

	test("enforces the bounded timeout with a timedOut result", async () => {
		const started = Date.now();
		const result = await spawnTransportCommand({
			command: "sleep",
			args: ["5"],
			timeoutMs: 100,
		});

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(Date.now() - started).toBeLessThan(4000);
	});

	test("passes argv positionally without shell evaluation", async () => {
		// A shell-metacharacter argument comes back verbatim: nothing evaluated it.
		const result = await spawnTransportCommand({
			command: "echo",
			args: ["$(rm -rf /); `whoami`"],
			timeoutMs: 5000,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("$(rm -rf /); `whoami`");
	});

	test("exactEnv without an env allowlist fails closed", async () => {
		await expect(
			spawnTransportCommand({
				command: "echo",
				args: [],
				exactEnv: true,
				timeoutMs: 5000,
			}),
		).rejects.toThrow("exactEnv requires an explicit env allowlist");
	});

	test("detached timeout kill reaps the child within the bound", async () => {
		const result = await spawnTransportCommand({
			command: "sleep",
			args: ["5"],
			detached: true,
			timeoutMs: 100,
		});

		expect(result).toEqual({
			exitCode: 1,
			stdout: "",
			stderr: "",
			timedOut: true,
		});
	});
});

describe("hint text", () => {
	test("dependency hint names the channel binary, env var, and examples", () => {
		const hint = transportDependencyHintText(CHANNEL, "fake-transport missing.");
		expect(hint).toBe(
			"fake-transport missing. Expose fake-transport on PATH, or set TEST_TRANSPORT_COMMAND_JSON to a JSON array command vector. Examples: " +
				'["bunx","fake-transport"] or ["npx","-y","fake-transport"]' +
				". Choose one; this transport does not auto-try package runners.",
		);
	});

	test("override-invalid hint quotes the channel examples", () => {
		const hint = transportOverrideInvalidHintText(CHANNEL, "Bad override.");
		expect(hint).toBe(
			"Bad override. Use a command vector such as " +
				'["bunx","fake-transport"] or ["npx","-y","fake-transport"]' +
				". This transport does not auto-try package runners.",
		);
	});
});

// Type-level check: a surface runtime whose runCommand accepts only the minimal
// input shape still satisfies TransportRuntime (parameter contravariance) —
// this is what lets browser-use's runtime seam consume the shared runner.
type MinimalInput = Pick<TransportCommandInput, "command" | "args" | "timeoutMs">;
const _minimalRuntimeIsAssignable: Parameters<typeof runTransportCommand>[1] = {
	env: {},
	runCommand: async (
		_input: MinimalInput,
	): Promise<TransportCommandResult> => ({ exitCode: 0, stdout: "", stderr: "" }),
};
void _minimalRuntimeIsAssignable;
