import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-auth-u0",
);
const RUN_FIXTURE = join(FIXTURE_ROOT, "run-fixture.ts");
const SENTINEL_MARKER = "U0S-";
const TEST_TIMEOUT_MS = 60_000;

type ProbeReceipt = {
	scenario: string;
	signed: boolean;
	app_sandbox_entitlement: boolean;
	xpc_connected: boolean;
	secret_pipe_transferred: boolean;
	browser_descriptor_transferred: boolean;
	new_network_denied: boolean;
	unrelated_file_denied: boolean;
	origin_reproved: boolean;
	delivery_started: boolean;
	write_ahead_events: string[];
	submitted: boolean;
	field_cleared: boolean;
	replay_denied: boolean;
};

async function runScenario(scenario: string): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
	receipt: ProbeReceipt;
}> {
	const child = Bun.spawn([process.execPath, RUN_FIXTURE, "--scenario", scenario], {
		cwd: FIXTURE_ROOT,
		env: {
			PATH: process.env.PATH,
			TMPDIR: process.env.TMPDIR,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return {
		exitCode,
		stdout,
		stderr,
		receipt: JSON.parse(stdout) as ProbeReceipt,
	};
}

describe("Browser auth U0 research fixture", () => {
	test(
		"signed sandboxed XPC transfers only pre-opened descriptors and emits redacted evidence",
		async () => {
			const result = await runScenario("deliver");
			expect(result.exitCode).toBe(0);
			expect(result.receipt).toMatchObject({
				scenario: "deliver",
				signed: true,
				app_sandbox_entitlement: true,
				xpc_connected: true,
				secret_pipe_transferred: true,
				browser_descriptor_transferred: true,
				new_network_denied: true,
				unrelated_file_denied: true,
				origin_reproved: true,
				delivery_started: true,
				submitted: false,
				replay_denied: true,
			});
			expect(result.stdout).not.toContain(SENTINEL_MARKER);
			expect(result.stderr).not.toContain(SENTINEL_MARKER);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"origin drift refuses delivery before the secret pipe is consumed",
		async () => {
			const result = await runScenario("origin-drift");
			expect(result.exitCode).toBe(0);
			expect(result.receipt).toMatchObject({
				scenario: "origin-drift",
				origin_reproved: false,
				delivery_started: false,
				submitted: false,
			});
			expect(result.stdout).not.toContain(SENTINEL_MARKER);
			expect(result.stderr).not.toContain(SENTINEL_MARKER);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"submission writes durable intent before dispatch",
		async () => {
			const result = await runScenario("submit");
			expect(result.exitCode).toBe(0);
			expect(result.receipt.write_ahead_events).toEqual([
				"submission_started",
				"submission_dispatched",
			]);
			expect(result.receipt.submitted).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"failed delivery clears the field before returning",
		async () => {
			const result = await runScenario("failure-cleanup");
			expect(result.exitCode).toBe(0);
			expect(result.receipt).toMatchObject({
				delivery_started: true,
				submitted: true,
				field_cleared: true,
			});
		},
		TEST_TIMEOUT_MS,
	);
});
