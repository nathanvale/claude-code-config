import { afterEach, describe, expect, test } from "bun:test";
import { runForTest } from "./browser-use";
import { parseJson } from "./browser-use-test-helpers";
import {
	cleanupWarmRuntimePaths,
	commandVector,
	configStdout,
	okCommand,
	warmRuntime,
} from "./browser-use-warm-test-helpers";

afterEach(async () => {
	await cleanupWarmRuntimePaths();
});

describe("browser-use warm start", () => {
	test("emits a warm stack ready envelope for healthy Warm Chrome and adapter", async () => {
		const { runtime } = await warmRuntime();
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(envelope).toMatchObject({
			status: "ok",
			data: {
				action: "warm_stack_ready",
				contract: "browser-use.warm-start",
				schema_version: "1",
				endpoint: "http://127.0.0.1:9222",
				browser_pid: 12345,
				adapter: { id: "chrome-devtools", ready: true, page_count: 1 },
				page_count: 1,
			},
			continuation: { next_action_id: "warm-stack-ready" },
		});
	});

	test("honors an explicit current-run port without changing the default help", async () => {
		const { runtime } = await warmRuntime({ port: "9223" });
		const result = await runForTest(
			[
				"warm",
				"start",
				"--port",
				"9223",
				"--profile",
				runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
				"--json",
			],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			endpoint: "http://127.0.0.1:9223",
			port: "9223",
		});

		const help = await runForTest(["warm", "start", "--help"], runtime);
		expect(help.stdout).toContain("9222");
		expect(help.stdout).not.toContain("9223");
	});

	test("launch path records Chrome spawn when no listener exists yet", async () => {
		const { runtime, spawnChromeCalls } = await warmRuntime({
			listener: "after-spawn",
			endpointReady: "after-spawn",
		});
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			action: "warm_stack_ready",
			browser_pid: 12345,
		});
		expect(spawnChromeCalls).toHaveLength(1);
		expect(spawnChromeCalls[0]).toMatchObject({
			port: "9222",
			profileDir: runtime.env.BROWSER_USE_PROFILE_DIR,
		});
	});

	test("port-conflict listener fails before launching another browser", async () => {
		const { runtime, spawnChromeCalls } = await warmRuntime({
			endpointReady: "after-spawn",
			listener: {
				pid: 54321,
				command: "python3 -m http.server 9222",
			},
		});
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error).toMatchObject({
			code: "warm_start_browser_entry_required",
		});
		expect(envelope.continuation).toMatchObject({
			next_action_id: "launch-warm-chrome",
		});
		expect(spawnChromeCalls).toEqual([]);
	});

	test("returns repair-adapter-config without mutating stale mcporter config by default", async () => {
		const { runtime, calls } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
				],
			},
		});
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error).toMatchObject({
			code: "warm_start_adapter_config_stale",
			failure_domain: "browser_adapter_proof",
		});
		expect(envelope.continuation).toMatchObject({
			next_action_id: "repair-adapter-config",
		});
		expect(calls.map(commandVector)).not.toContain(
			"mcporter config set chrome-devtools --browserUrl http://127.0.0.1:9222 --json",
		);
	});

	test("--repair-adapter-config updates selected mcporter config and reruns proof", async () => {
		const { runtime, calls } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
					okCommand(configStdout("9223")),
					okCommand(configStdout("9222")),
				],
				"mcporter config set chrome-devtools --browserUrl http://127.0.0.1:9222 --json": [
					okCommand("{}"),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					okCommand(JSON.stringify({ pages: [{ id: "page-1" }] })),
				],
			},
		});
		const result = await runForTest(
			[
				"warm",
				"start",
				"--profile",
				runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
				"--repair-adapter-config",
				"--json",
			],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			action: "warm_stack_ready",
			repair_actions: ["adapter_config"],
		});
		expect(calls.map(commandVector)).toContain(
			"mcporter config set chrome-devtools --browserUrl http://127.0.0.1:9222 --json",
		);
	});

	test("--repair-adapter-config aborts when the selected binding cannot be re-confirmed", async () => {
		const { runtime, calls } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9223")),
					okCommand(JSON.stringify({ args: ["chrome-devtools-mcp"] })),
				],
			},
		});
		const result = await runForTest(
			[
				"warm",
				"start",
				"--profile",
				runtime.env.BROWSER_USE_PROFILE_DIR ?? "",
				"--repair-adapter-config",
				"--json",
			],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error).toMatchObject({
			code: "warm_start_adapter_config_repair_aborted",
		});
		expect(envelope.continuation).toMatchObject({
			next_action_id: "inspect-adapter-diagnostics",
		});
		expect(calls.map(commandVector)).not.toContain(
			"mcporter config set chrome-devtools --browserUrl http://127.0.0.1:9222 --json",
		);
	});

	test("sticky daemon class restarts mcporter once and retries adapter proof", async () => {
		const { runtime, calls } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9222")),
					okCommand(configStdout("9222")),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					{ exitCode: 1, stdout: "", stderr: "connection failed" },
					okCommand(JSON.stringify({ pages: [{ id: "page-1" }] })),
				],
				"mcporter daemon restart": [okCommand("{}")],
			},
		});
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			action: "warm_stack_ready",
			repair_actions: ["mcporter_daemon_restart"],
		});
		expect(calls.map(commandVector).filter((call) => call === "mcporter daemon restart")).toHaveLength(1);
	});

	test("timeout class does not restart mcporter daemon", async () => {
		const { runtime, calls } = await warmRuntime({
			commandResponses: {
				"mcporter config get chrome-devtools --json": [
					okCommand(configStdout("9222")),
				],
				"mcporter call chrome-devtools.list_pages --args {} --output json": [
					{ exitCode: 1, stdout: "", stderr: "", timedOut: true },
				],
			},
		});
		const result = await runForTest(
			["warm", "start", "--profile", runtime.env.BROWSER_USE_PROFILE_DIR ?? "", "--json"],
			runtime,
		);
		const envelope = parseJson(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error).toMatchObject({
			code: "warm_start_adapter_output_failed",
		});
		expect(envelope.continuation).toMatchObject({
			next_action_id: "inspect-adapter-diagnostics",
		});
		expect(calls.map(commandVector)).not.toContain("mcporter daemon restart");
	});
});
