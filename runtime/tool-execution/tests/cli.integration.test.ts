import { chmod, mkdir, mkdtemp, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	assertCommandHelpFlagSurface,
	parseCliProcessJson,
	runCliProcess,
} from "@side-quest/cli-command-facade/testing";
import {
	TOOL_EXECUTION_COMMANDS,
	TOOL_EXECUTION_COMMAND_CONTRACTS,
} from "../src/command-contract.ts";
import type { ExecutionReceipt } from "../src/model.ts";
import { readNativeObservation } from "../src/native-observation.ts";
import { createReceiptStore } from "../src/receipt-store.ts";

const packageRoot = new URL("..", import.meta.url).pathname;

test("contract --json exposes discovery through the real CLI process", async () => {
	const result = await runCliProcess({
		label: "tool-execution contract",
		argv: [process.execPath, "run", "src/cli.ts", "contract", "--json"],
		cwd: packageRoot,
	});
	const envelope = parseCliProcessJson<{
		status: string;
		data: { contract_id: string; commands: Record<string, unknown> };
	}>(result);

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	expect(envelope.status).toBe("ok");
	expect(envelope.data.contract_id).toBe("tool-execution.contract");
	expect(Object.keys(envelope.data.commands)).toHaveLength(8);
});

test("every command renders help aligned with its declared flags", async () => {
	for (const command of TOOL_EXECUTION_COMMANDS) {
		const result = await runCliProcess({
			label: `${command} help`,
			argv: [process.execPath, "run", "src/cli.ts", command, "--help"],
			cwd: packageRoot,
		});
		expect(result.exitCode).toBe(0);
		assertCommandHelpFlagSurface({
			command,
			contract: TOOL_EXECUTION_COMMAND_CONTRACTS[command],
			help: result.stdout,
		});
	}
});

test("public argv rejects a command-foreign flag with a structured usage error", async () => {
	const result = await runCliProcess({
		label: "foreign flag",
		argv: [process.execPath, "run", "src/cli.ts", "receipts", "--input", "-", "--json"],
		cwd: packageRoot,
	});
	const envelope = parseCliProcessJson<{
		status: string;
		error: { code: string; message: string };
	}>(result);

	expect(result.exitCode).toBe(2);
	expect(envelope.error.code).toBe("usage_error");
	expect(envelope.error.message).toContain("Unknown flag: --input");
});

test("public argv enforces required flags before command policy", async () => {
	const result = await runCliProcess({
		label: "missing required input",
		argv: [process.execPath, "run", "src/cli.ts", "prepare", "--json"],
		cwd: packageRoot,
	});
	const envelope = parseCliProcessJson<{
		status: string;
		error: { code: string; message: string };
	}>(result);

	expect(result.exitCode).toBe(2);
	expect(envelope.error.code).toBe("usage_error");
	expect(envelope.error.message).toContain("Missing required flag: --input");
});


test("no args includes dispatched work in the recovery count", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-dashboard-"));
	const receipt = {
		...executionReceiptFixture("unknown"),
		receipt_id: "dispatched-1",
		state: "dispatched" as const,
		terminal_reason: undefined,
		approval: {
			approval_surface: "task_policy" as const,
			approved_at: "2026-08-09T00:00:00.000Z",
			expires_at: "2026-08-09T00:05:00.000Z",
			request_fingerprint: `sha256:${"a".repeat(64)}`,
			route: "mcporter.firecrawl.search",
			attempt: 1,
			checkpoint_id: "u5",
		},
	};
	delete receipt.terminal_reason;
	await createReceiptStore(join(stateRoot, "tool-execution", "receipts")).write(
		receipt,
	);
	const result = await runCliProcess({
		label: "tool-execution dashboard",
		argv: [process.execPath, "run", "src/cli.ts"],
		cwd: packageRoot,
		env: { ...process.env, XDG_STATE_HOME: stateRoot },
	});

	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
	expect(result.stdout).toContain("Active checkpoint: none");
	expect(result.stdout).toContain("Recovery receipts: 1");
});

test("receipt filesystem failures are runtime failures, not usage errors", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-runtime-failure-"));
	await writeFile(join(stateRoot, "tool-execution"), "not-a-directory");
	const result = await runCliProcess({
		label: "receipt runtime failure",
		argv: [process.execPath, "run", "src/cli.ts", "receipts", "--json"],
		cwd: packageRoot,
		env: { ...process.env, XDG_STATE_HOME: stateRoot },
	});
	const envelope = parseCliProcessJson<{ error: { code: string } }>(result);

	expect(result.exitCode).toBe(1);
	expect(envelope.error.code).toBe("runtime_failure");
});

test("checkpoint writes one private active card through the public command", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-state-"));
	const inputPath = join(stateRoot, "checkpoint-input.json");
	await writeFile(
		inputPath,
		JSON.stringify({
			schema_version: 1,
			id: "u5",
			position: 5,
			total: 13,
			objective: "Prove deterministic tool execution.",
			owner: "runtime/tool-execution",
			expected: "Lifecycle tests pass.",
			stop: "Any result class overlaps.",
			rollback: "Abort the worktree.",
			next: "Implement provider packages.",
			active: true,
		}),
	);
	const result = await runCliProcess({
		label: "tool-execution checkpoint",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"checkpoint",
			"--input",
			inputPath,
			"--json",
		],
		cwd: packageRoot,
		env: { ...process.env, XDG_STATE_HOME: stateRoot },
	});
	const envelope = parseCliProcessJson<{
		status: string;
		data: { contract_id: string; checkpoint: { id: string } };
	}>(result);

	expect(result.exitCode).toBe(0);
	expect(envelope.status).toBe("ok");
	expect(envelope.data.contract_id).toBe("tool-execution.checkpoint");
	expect(envelope.data.checkpoint.id).toBe("u5");
});

test("observe records fresh native evidence without claiming dispatch", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-observe-"));
	const checkpointPath = join(stateRoot, "checkpoint.json");
	const observationPath = join(stateRoot, "observation.json");
	const invokedAt = new Date().toISOString();
	const cell = {
		lane: "codex_desktop",
		client: "codex-desktop",
		provider: "firecrawl",
		route: "native.firecrawl.search",
	};
	const binding = {
		qualification_cell: cell,
		client: "codex-desktop",
		process_identity: "fresh-process-1",
		query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		route: "native.firecrawl.search",
		evidence_source: "private-receipt-1",
		max_age_ms: 60_000,
	};
	await writeFile(
		checkpointPath,
		JSON.stringify({
			schema_version: 1,
			id: "native-v1",
			position: 10,
			total: 13,
			objective: "Prove one native qualification cell.",
			owner: "tool-execution",
			expected: "Fresh evidence is recorded.",
			stop: "Any provenance field differs.",
			rollback: "Preserve the private receipt and stop.",
			next: "Review the qualification result.",
			active: true,
			native_observation_binding: binding,
		}),
	);
	await writeFile(
		observationPath,
		JSON.stringify({
			qualification_cell: cell,
			client: "codex-desktop",
			process_identity: "fresh-process-1",
			invoked_at: invokedAt,
			query_fingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			route: "native.firecrawl.search",
			evidence_source: "private-receipt-1",
			result: {
				class: "successful_tool_result",
				result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			},
		}),
	);
	const env: Record<string, string | undefined> = {
		...process.env,
		XDG_STATE_HOME: stateRoot,
	};
	await runCliProcess({
		label: "set native checkpoint",
		argv: [process.execPath, "run", "src/cli.ts", "checkpoint", "--input", checkpointPath, "--json"],
		cwd: packageRoot,
		env,
	});
	const result = await runCliProcess({
		label: "observe native result",
		argv: [process.execPath, "run", "src/cli.ts", "observe", "--input", observationPath, "--json"],
		cwd: packageRoot,
		env,
	});
	const envelope = parseCliProcessJson<{
		status: string;
		data: {
			contract_id: string;
			observation_id: string;
			observation: { route: string };
			wrote: boolean;
			dispatched?: boolean;
		};
	}>(result);

	expect(result.exitCode).toBe(0);
	expect(envelope.data.contract_id).toBe("tool-execution.observe");
	expect(envelope.data.observation.route).toBe("native.firecrawl.search");
	expect(envelope.data.wrote).toBe(true);
	expect(envelope.data.dispatched).toBeUndefined();
	const observationRoot = join(stateRoot, "tool-execution", "observations");
	const persisted = await readNativeObservation(
		envelope.data.observation_id,
		observationRoot,
	);
	expect(persisted?.route).toBe("native.firecrawl.search");
	expect(persisted?.evidence_source).toBe("private-receipt-1");
	expect(
		(await stat(join(observationRoot, `${envelope.data.observation_id}.json`))).mode & 0o777,
	).toBe(0o600);

	const checkResult = await runCliProcess({
		label: "check native result",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"observe",
			"--input",
			observationPath,
			"--check",
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	const checkEnvelope = parseCliProcessJson<{
		data: { observation_id: string; wrote: boolean };
	}>(checkResult);
	expect(checkResult.exitCode).toBe(0);
	expect(checkEnvelope.data.wrote).toBe(false);
	expect(
		await readNativeObservation(checkEnvelope.data.observation_id, observationRoot),
	).toBeUndefined();
});

test("resume skips a terminal receipt through the real command", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-resume-"));
	const receipt: ExecutionReceipt = {
		schema_version: 1,
		receipt_id: "terminal-1",
		attempt: 1,
		adapter: "mcporter-cli",
		route: "mcporter.firecrawl.search",
		checkpoint_id: "u5",
		qualification_cell: {
			lane: "explicit_cli",
			client: "tool-execution",
			provider: "firecrawl",
			route: "mcporter.firecrawl.search",
		},
		request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		state: "terminal",
		created_at: "2026-08-09T00:00:00.000Z",
		updated_at: "2026-08-09T00:01:00.000Z",
		terminal_reason: "successful_tool_result",
		result: {
			class: "successful_tool_result",
			result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		},
	};
	await createReceiptStore(join(stateRoot, "tool-execution", "receipts")).write(
		receipt,
	);
	const result = await runCliProcess({
		label: "resume terminal",
		argv: [process.execPath, "run", "src/cli.ts", "resume", "--receipt", "terminal-1", "--json"],
		cwd: packageRoot,
		env: { ...process.env, XDG_STATE_HOME: stateRoot },
	});
	const envelope = parseCliProcessJson<{
		data: { contract_id: string; resume: { kind: string } };
	}>(result);

	expect(result.exitCode).toBe(0);
	expect(envelope.data.contract_id).toBe("tool-execution.resume");
	expect(envelope.data.resume.kind).toBe("noop");
});

test("prepare writes a fingerprint-only receipt without provider dispatch", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "tool-execution-prepare-"));
	const checkpointPath = join(stateRoot, "checkpoint.json");
	const requestPath = join(stateRoot, "request.json");
	await writeFile(
		checkpointPath,
		JSON.stringify({
			schema_version: 1,
			id: "u5",
			position: 5,
			total: 13,
			objective: "Prove deterministic tool execution.",
			owner: "runtime/tool-execution",
			expected: "Lifecycle tests pass.",
			stop: "Any result class overlaps.",
			rollback: "Abort the worktree.",
			next: "Implement provider packages.",
			active: true,
		}),
	);
	await writeFile(
		requestPath,
		JSON.stringify({
			adapter: "firecrawl-cli",
			route: "firecrawl.search",
			checkpoint_id: "u5",
			qualification_cell: {
				lane: "explicit_cli",
				client: "tool-execution",
				provider: "firecrawl",
				route: "firecrawl.search",
			},
			request: { operation: "search", query: "token=fixture-secret" },
		}),
	);
	const home = await installCanonicalWrapperFixture(
		stateRoot,
		"firecrawl",
		"exit 99",
	);
	await installCanonicalWrapperFixture(stateRoot, "mcporter-mac-mini", "exit 99");
	const env = { ...process.env, HOME: home, XDG_STATE_HOME: stateRoot };
	await runCliProcess({
		label: "set prepare checkpoint",
		argv: [process.execPath, "run", "src/cli.ts", "checkpoint", "--input", checkpointPath, "--json"],
		cwd: packageRoot,
		env,
	});
	const result = await runCliProcess({
		label: "prepare firecrawl search",
		argv: [process.execPath, "run", "src/cli.ts", "prepare", "--input", requestPath, "--json"],
		cwd: packageRoot,
		env,
	});
	const envelope = parseCliProcessJson<{
		status: string;
		data: {
			contract_id: string;
			receipt: {
				receipt_id: string;
				state: string;
				request_fingerprint: string;
				request?: unknown;
			};
		};
	}>(result);

	expect(result.exitCode).toBe(0);
	expect(envelope.data.contract_id).toBe("tool-execution.prepare");
	expect(envelope.data.receipt.state).toBe("prepared");
	expect(envelope.data.receipt.request_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
	expect(envelope.data.receipt.request).toBeUndefined();
	expect(result.stdout).not.toContain("token=fixture-secret");
	expect(
		(envelope.data as unknown as { command: { executable: string } }).command
			.executable,
	).toBe(await realpath(join(home, "code", "dotfiles", "bin", "firecrawl")));

	const missingDecision = await runCliProcess({
		label: "missing explicit approval decision",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"approve",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	const missingDecisionEnvelope = parseCliProcessJson<{
		status: string;
		error: { code: string; exit_code: number };
	}>(missingDecision);
	expect(missingDecision.exitCode).toBe(2);
	expect(missingDecisionEnvelope.status).toBe("error");
	expect(missingDecisionEnvelope.error.code).toBe("usage_error");

	const deniedCheck = await runCliProcess({
		label: "preview explicit task denial",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"approve",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--deny",
			"--check",
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	const deniedCheckEnvelope = parseCliProcessJson<{
		data: { decision: string; wrote: boolean };
	}>(deniedCheck);
	expect(deniedCheck.exitCode).toBe(0);
	expect(deniedCheckEnvelope.data).toMatchObject({
		decision: "deny",
		wrote: false,
	});
	expect(
		(await createReceiptStore(
			join(stateRoot, "tool-execution", "receipts"),
		).read(envelope.data.receipt.receipt_id))?.state,
	).toBe("prepared");

	const call = await runCliProcess({
		label: "missing task approval refusal",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"call",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--input",
			requestPath,
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	const callEnvelope = parseCliProcessJson<{
		status: string;
		error: { code: string };
	}>(call);
	expect(call.exitCode).toBe(3);
	expect(callEnvelope.error.code).toBe("approval_required");

	const approval = await runCliProcess({
		label: "explicit task approval",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"approve",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--approve",
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	expect(approval.exitCode).toBe(0);

	const receipts = await runCliProcess({
		label: "list receipts",
		argv: [process.execPath, "run", "src/cli.ts", "receipts", "--state", "prepared", "--json"],
		cwd: packageRoot,
		env,
	});
	const receiptsEnvelope = parseCliProcessJson<{
		data: { contract_id: string; receipts: Array<Record<string, unknown>> };
	}>(receipts);
	expect(receipts.exitCode).toBe(0);
	expect(receiptsEnvelope.data.contract_id).toBe("tool-execution.receipts");
	expect(receiptsEnvelope.data.receipts.map((entry) => entry.receipt_id)).toContain(
		envelope.data.receipt.receipt_id,
	);
	const listed = receiptsEnvelope.data.receipts.find(
		(entry) => entry.receipt_id === envelope.data.receipt.receipt_id,
	);
	expect(listed?.approval_status).toBe("approved");
	expect(listed?.approval).toBeUndefined();
	expect(listed?.request_fingerprint).toBeUndefined();
	expect(listed?.config_fingerprint).toBeUndefined();

	const checkedCall = await runCliProcess({
		label: "approved call check",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"call",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--input",
			requestPath,
			"--check",
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	expect(checkedCall.exitCode).toBe(0);
	expect(
		(await createReceiptStore(
			join(stateRoot, "tool-execution", "receipts"),
		).read(envelope.data.receipt.receipt_id))?.state,
	).toBe("prepared");

	await writeFile(
		join(home, "code", "dotfiles", "bin", "firecrawl"),
		"#!/bin/sh\nexit 98\n",
	);
	const driftedCall = await runCliProcess({
		label: "approved call with changed canonical configuration",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"call",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--input",
			requestPath,
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	expect(driftedCall.exitCode).toBe(1);
	expect(driftedCall.stdout).toContain("configuration_drift");
	expect(
		(await createReceiptStore(
			join(stateRoot, "tool-execution", "receipts"),
		).read(envelope.data.receipt.receipt_id))?.state,
	).toBe("prepared");
	await installCanonicalWrapperFixture(stateRoot, "firecrawl", "exit 99");

	await unlink(join(home, "code", "dotfiles", "bin", "firecrawl"));
	const missingCommandCall = await runCliProcess({
		label: "approved call with missing canonical command",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"call",
			"--receipt",
			envelope.data.receipt.receipt_id,
			"--input",
			requestPath,
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	expect(missingCommandCall.exitCode).toBe(1);
	expect(
		(await createReceiptStore(
			join(stateRoot, "tool-execution", "receipts"),
		).read(envelope.data.receipt.receipt_id))?.state,
	).toBe("terminal");

	await writeFile(
		requestPath,
		JSON.stringify({
			adapter: "mcporter-cli",
			route: "mcporter.firecrawl.search",
			checkpoint_id: "u5",
			qualification_cell: {
				lane: "explicit_cli",
				client: "tool-execution",
				provider: "firecrawl",
				route: "mcporter.firecrawl.search",
			},
			request: {
				server: "firecrawl",
				tool: "firecrawl_search",
				arguments: { query: "agent tool discovery" },
			},
		}),
	);
	const mcporter = await runCliProcess({
		label: "prepare MCPorter explicit-config wrapper",
		argv: [
			process.execPath,
			"run",
			"src/cli.ts",
			"prepare",
			"--input",
			requestPath,
			"--check",
			"--json",
		],
		cwd: packageRoot,
		env,
	});
	const mcporterEnvelope = parseCliProcessJson<{
		data: { command: { executable: string; argument_count: number }; wrote: boolean };
	}>(mcporter);
	expect(mcporter.exitCode).toBe(0);
	expect(mcporterEnvelope.data.command).toEqual({
		executable: await realpath(
			join(home, "code", "dotfiles", "bin", "mcporter-mac-mini"),
		),
		argument_count: 7,
	});
	expect(mcporterEnvelope.data.wrote).toBe(false);
});

async function installCanonicalWrapperFixture(
	stateRoot: string,
	name: "firecrawl" | "mcporter-mac-mini",
	script: string,
): Promise<string> {
	const home = join(stateRoot, "fixture-home");
	const bin = join(home, "code", "dotfiles", "bin");
	await mkdir(bin, { recursive: true });
	const executable = join(bin, name);
	await writeFile(executable, `#!/bin/sh\n${script}\n`);
	await chmod(executable, 0o700);
	return home;
}

function executionReceiptFixture(
	state: "terminal" | "unknown",
): ExecutionReceipt {
	return {
		schema_version: 1,
		receipt_id: `catalog-${state}`,
		attempt: 1,
		adapter: "mcporter-cli",
		route: "mcporter.firecrawl.search",
		checkpoint_id: "u5",
		qualification_cell: {
			lane: "explicit_cli",
			client: "tool-execution",
			provider: "firecrawl",
			route: "mcporter.firecrawl.search",
		},
		request_fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		config_fingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		state,
		created_at: "2026-08-09T00:00:00.000Z",
		updated_at: "2026-08-09T00:01:00.000Z",
		...(state === "terminal"
			? {
					terminal_reason: "successful_tool_result",
					result: {
						class: "successful_tool_result" as const,
						result_fingerprint: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
					},
				}
			: { terminal_reason: "post_dispatch_interruption" }),
	};
}
