#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	getCliDiagnosticDurationMs,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	withCliDiagnosticContext,
	writeJsonEnvelope,
	type CliWriter,
} from "@side-quest/cli-command-facade";
import {
	TOOL_EXECUTION_COMMANDS,
	TOOL_EXECUTION_COMMAND_CONTRACTS,
	TOOL_EXECUTION_DISCOVERY,
	TOOL_EXECUTION_INPUT_CONTRACTS,
	type ToolExecutionCommand,
} from "./command-contract.ts";
import {
	TOOL_EXECUTION_BRANCH_STATIONS,
	TOOL_EXECUTION_STATION_CONTINUATIONS,
} from "./branch-station-catalog.ts";
import {
	defineCheckpoint,
	readActiveCheckpoint,
	renderCheckpoint,
	writeActiveCheckpoint,
} from "./checkpoint.ts";
import { prepareFirecrawlCliInvocation } from "./adapters/firecrawl-cli.ts";
import { prepareMcporterCliInvocation } from "./adapters/mcporter-cli.ts";
import type { ExecutionReceipt, PreparedRequest } from "./model.ts";
import {
	validateNativeObservation,
	writeNativeObservation,
} from "./native-observation.ts";
import { captureFilePreImage, fingerprintValue } from "./pre-image.ts";
import {
	approvePreparedReceipt,
	createPreparedReceipt,
	createReceiptStore,
	dispatchApprovedInvocation,
	isOutcomeUnknownError,
	settleIncompleteAttempt,
	validateDispatchApproval,
	validatePreparedRequest,
	validatePreparedRequestBinding,
} from "./receipt-store.ts";
import { resumeReceipt } from "./resume.ts";

export type ToolExecutionCliIo = {
	stdout: CliWriter;
	stderr: CliWriter;
};

const DEFAULT_IO: ToolExecutionCliIo = {
	stdout: process.stdout,
	stderr: process.stderr,
};

class CliUsageError extends Error {}

export async function runToolExecutionCli(
	argv: readonly string[],
	io: ToolExecutionCliIo = DEFAULT_IO,
): Promise<number> {
	let parsed: ReturnType<typeof parseCliDiagnosticArgv>;
	try {
		parsed = parseCliDiagnosticArgv(argv);
	} catch (error) {
		parsed = parseCliDiagnosticFallbackArgv(argv);
		return writeUsageFailure(errorMessage(error), parsed.options, io);
	}

	configureCliDiagnostics({
		categoryRoot: ["tool-execution"],
		options: parsed.options,
		diagnosticWriter: io.stderr,
	});
	try {
		return await withCliDiagnosticContext(
			createCliDiagnosticContext(parsed.options),
			async () => dispatch(parsed.argv, parsed.options.runId, parsed.options.json, io),
		);
	} finally {
		resetCliDiagnostics();
	}
}

async function dispatch(
	argv: readonly string[],
	runId: string,
	json: boolean,
	io: ToolExecutionCliIo,
): Promise<number> {
	const command = argv.find((arg) => !arg.startsWith("--"));
	if (
		command &&
		TOOL_EXECUTION_COMMANDS.includes(command as ToolExecutionCommand) &&
		(argv.includes("--help") || argv.includes("-h"))
	) {
		io.stdout.write(renderCommandHelp(command as ToolExecutionCommand));
		return 0;
	}
	if (command && TOOL_EXECUTION_COMMANDS.includes(command as ToolExecutionCommand)) {
		try {
			validateCommandArgv(command as ToolExecutionCommand, argv);
		} catch (error) {
			return writeUsageFailure(errorMessage(error), { runId, json }, io);
		}
	}
	if (command === "contract") {
		const unknown = argv.filter(
			(arg) => arg !== "contract" && arg !== "--json" && arg !== "--help" && arg !== "-h",
		);
		if (unknown.length > 0) {
			return writeUsageFailure(`Unknown contract argument: ${unknown[0]}`, { runId, json }, io);
		}
		if (argv.includes("--help") || argv.includes("-h")) {
			io.stdout.write(renderCommandHelp("contract"));
			return 0;
		}
		const data = createCommandResultData(
			TOOL_EXECUTION_COMMAND_CONTRACTS.contract,
			{
				commands: TOOL_EXECUTION_DISCOVERY.commands,
				input_contracts: TOOL_EXECUTION_INPUT_CONTRACTS,
				stations: TOOL_EXECUTION_BRANCH_STATIONS.map((station) => ({
					...station,
					next_action: TOOL_EXECUTION_STATION_CONTINUATIONS[station.id],
				})),
			},
		);
		if (json) {
			writeSuccessJson(io.stdout, runId, data);
		} else {
			io.stdout.write(
				`${TOOL_EXECUTION_COMMANDS.map((name) => `${name}: ${TOOL_EXECUTION_COMMAND_CONTRACTS[name].summary}`).join("\n")}\n`,
			);
		}
		return 0;
	}
	if (command === "checkpoint") {
		try {
			const inputPath = valueFlag(argv, "--input");
			const checkpoint = inputPath
				? await readUsageInput(inputPath, defineCheckpoint)
				: await readActiveCheckpoint();
			if (!checkpoint) {
				return writeUsageFailure("No active checkpoint exists.", { runId, json }, io);
			}
			if (inputPath && !argv.includes("--check")) {
				await writeActiveCheckpoint(checkpoint);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.checkpoint,
				{ checkpoint, wrote: Boolean(inputPath && !argv.includes("--check")) },
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else io.stdout.write(`${renderCheckpoint(checkpoint)}\n`);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "prepare") {
		try {
			const inputPath = valueFlag(argv, "--input");
			if (!inputPath) throw new CliUsageError("--input is required");
			const request = await readUsageInput(
				inputPath,
				validatePreparedRequestValue,
			);
			const activeCheckpoint = await readActiveCheckpoint();
			if (!activeCheckpoint || activeCheckpoint.id !== request.checkpoint_id) {
				return writeRuntimeFailure(
					"checkpoint_mismatch",
					"Request checkpoint does not match the active checkpoint.",
					1,
					runId,
					json,
					io,
				);
			}
			const preparedInvocation = await prepareAdapterInvocation(request);
			if (!preparedInvocation.ok) {
				return writeRuntimeFailure(
					"request_refused",
					preparedInvocation.failure.class ===
						"transport_or_client_policy_failure"
						? preparedInvocation.failure.message
						: "Request was refused before dispatch.",
					1,
					runId,
					json,
					io,
				);
			}
			const receipt = createPreparedReceipt(request, {
				receiptId: randomUUID(),
				now: new Date().toISOString(),
				configFingerprint: await fingerprintAdapterConfiguration(
					request,
					preparedInvocation.invocation,
				),
			});
			if (!argv.includes("--check")) {
				await createReceiptStore().write(receipt);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.prepare,
				{
					receipt,
					command: {
						executable: preparedInvocation.invocation.command,
						argument_count: preparedInvocation.invocation.args.length,
					},
					wrote: !argv.includes("--check"),
				},
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else {
				io.stdout.write(
					`Prepared ${receipt.receipt_id}\nRoute: ${receipt.route}\nFingerprint: ${receipt.request_fingerprint}\n`,
				);
			}
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "approve") {
		try {
			const receiptId = valueFlag(argv, "--receipt");
			if (!receiptId) throw new CliUsageError("--receipt is required");
			const store = createReceiptStore();
			const receipt = await store.read(receiptId);
			if (!receipt) {
				return writeRuntimeFailure(
					"receipt_missing",
					"Prepared receipt was not found.",
					1,
					runId,
					json,
					io,
				);
			}
			const now = new Date();
			const updated = approvePreparedReceipt(receipt, {
				taskApproved: true,
				decision: argv.includes("--deny") ? "deny" : "approve",
				now: now.toISOString(),
				expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
			});
			if (!argv.includes("--check")) {
				await store.replacePrepared(receipt, updated);
			}
			if (argv.includes("--check")) {
				const data = createCommandResultData(
					TOOL_EXECUTION_COMMAND_CONTRACTS.approve,
					{
						decision: argv.includes("--deny") ? "deny" : "approve",
						receipt: updated,
						wrote: false,
					},
				);
				if (json) writeSuccessJson(io.stdout, runId, data);
				else io.stdout.write(`Validated ${updated.receipt_id}\n`);
				return 0;
			}
			if (updated.state === "terminal") {
				return writeRuntimeFailure(
					"approval_denied",
					"Task policy denied the prepared request.",
					1,
					runId,
					json,
					io,
				);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.approve,
				{ receipt: updated, wrote: true },
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else io.stdout.write(`Approved ${updated.receipt_id}\n`);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "call") {
		try {
			const receiptId = valueFlag(argv, "--receipt");
			const inputPath = valueFlag(argv, "--input");
			if (!receiptId || !inputPath) {
				throw new CliUsageError("--receipt and --input are required");
			}
			const store = createReceiptStore();
			const receipt = await store.read(receiptId);
			if (!receipt) throw new Error("Receipt was not found.");
			const request = await readUsageInput(
				inputPath,
				validatePreparedRequestValue,
			);
			const binding = validatePreparedRequestBinding(receipt, request);
			if (!binding.ok) {
				return writeRuntimeFailure(
					binding.reason,
					"Call input does not match the prepared receipt.",
					3,
					runId,
					json,
					io,
				);
			}
			const requestFingerprint = fingerprintValue(request.request);
			const activeCheckpoint = await readActiveCheckpoint();
			if (!activeCheckpoint || activeCheckpoint.id !== receipt.checkpoint_id) {
				return writeRuntimeFailure(
					"checkpoint_mismatch",
					"Receipt checkpoint does not match the active checkpoint.",
					1,
					runId,
					json,
					io,
				);
			}
			const approval = validateDispatchApproval(receipt, {
				now: new Date().toISOString(),
				requestFingerprint,
				route: request.route,
				attempt: receipt.attempt,
				checkpointId: activeCheckpoint.id,
			});
			if (!approval.ok) {
				return writeRuntimeFailure(
					"approval_required",
					"An exact unexpired task approval is required.",
					3,
					runId,
					json,
					io,
				);
			}
			const preparedInvocation = await prepareAdapterInvocation(request);
			if (!preparedInvocation.ok) {
				if (
					preparedInvocation.failure.class ===
						"transport_or_client_policy_failure" &&
					preparedInvocation.failure.code === "command_resolution_failed"
				) {
					const terminal = settleIncompleteAttempt(receipt, {
						kind: "interruption",
						updatedAt: new Date().toISOString(),
					});
					if (!argv.includes("--check")) await store.write(terminal);
				}
				return writeRuntimeFailure(
					"request_refused",
					"Request was refused before dispatch.",
					1,
					runId,
					json,
					io,
				);
			}
			const liveConfigFingerprint = await fingerprintAdapterConfiguration(
				request,
				preparedInvocation.invocation,
			);
			if (liveConfigFingerprint !== receipt.config_fingerprint) {
				return writeRuntimeFailure(
					"configuration_drift",
					"Canonical provider configuration changed after preparation.",
					1,
					runId,
					json,
					io,
				);
			}
			if (argv.includes("--check")) {
				const data = createCommandResultData(
					TOOL_EXECUTION_COMMAND_CONTRACTS.call,
					{ dispatch_ready: true, receipt_id: receipt.receipt_id },
				);
				if (json) writeSuccessJson(io.stdout, runId, data);
				else io.stdout.write(`Ready ${receipt.receipt_id}\n`);
				return 0;
			}
			const outcome = await dispatchApprovedInvocation({
				receipt,
				store,
				invocation: preparedInvocation.invocation,
				requestFingerprint,
				now: () => new Date().toISOString(),
				timeoutMs: request.deadline_ms ?? 30_000,
				childEnv: minimalProviderEnvironment(),
			});
			if (outcome.receipt.state === "unknown") {
				return writeRuntimeFailure(
					"outcome_unknown",
					"Provider outcome is unknown; automatic continuation stopped.",
					4,
					runId,
					json,
					io,
				);
			}
			if (outcome.classification.class !== "successful_tool_result") {
				const code =
					outcome.classification.class === "jsonrpc_protocol_or_server_error"
						? "jsonrpc_error"
						: outcome.classification.class === "tool_error"
							? "tool_error"
							: "transport_failure";
				return writeRuntimeFailure(
					code,
					"Provider execution completed with a classified failure.",
					1,
					runId,
					json,
					io,
				);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.call,
				{
					receipt: outcome.receipt,
					classification: outcome.classification.class,
					provider_data: outcome.provider_data,
					trust: "untrusted_provider_data",
				},
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else io.stdout.write(`Completed ${outcome.receipt.receipt_id}\n`);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "observe") {
		try {
			const inputPath = valueFlag(argv, "--input");
			if (!inputPath) throw new CliUsageError("--input is required");
			const observation = await readUsageInput(inputPath, (value) => value);
			const checkpoint = await readActiveCheckpoint();
			const binding = checkpoint?.native_observation_binding;
			if (!binding) {
				return writeRuntimeFailure(
					"observation_mismatch",
					"Active checkpoint has no matching native observation binding.",
					1,
					runId,
					json,
					io,
				);
			}
			const validation = validateNativeObservation(observation, {
				qualificationCell: binding.qualification_cell,
				client: binding.client,
				processIdentity: binding.process_identity,
				queryFingerprint: binding.query_fingerprint,
				configFingerprint: binding.config_fingerprint,
				route: binding.route,
				evidenceSource: binding.evidence_source,
				now: new Date().toISOString(),
				maxAgeMs: binding.max_age_ms,
			});
			if (!validation.ok) {
				return writeRuntimeFailure(
					"observation_mismatch",
					"Native observation is stale or mismatched.",
					1,
					runId,
					json,
					io,
				);
			}
			const observationId = randomUUID();
			if (!argv.includes("--check")) {
				await writeNativeObservation(observationId, validation.observation);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.observe,
				{
					observation_id: observationId,
					observation: validation.observation,
					wrote: !argv.includes("--check"),
				},
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else io.stdout.write(`Observed ${observationId}\n`);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "receipts") {
		try {
			const state = valueFlag(argv, "--state");
			if (
				state !== undefined &&
				!["prepared", "dispatched", "terminal", "unknown"].includes(state)
			) {
				throw new CliUsageError("--state is invalid");
			}
			const receipts = (await createReceiptStore().list()).filter(
				(receipt) => state === undefined || receipt.state === state,
			);
			const projected = receipts.map(projectReceiptForGovernance);
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.receipts,
				{ receipts: projected },
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else {
				io.stdout.write(
					`${receipts.map((receipt) => `${receipt.receipt_id}\t${receipt.state}\t${receipt.route}`).join("\n")}${receipts.length ? "\n" : ""}`,
				);
			}
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	if (command === "resume") {
		try {
			const receiptId = valueFlag(argv, "--receipt");
			if (!receiptId) throw new CliUsageError("--receipt is required");
			const store = createReceiptStore();
			const receipt = await store.read(receiptId);
			if (!receipt) throw new Error("Receipt was not found.");
			const now = new Date();
			const taskRetryApproval = argv.includes("--approve-retry")
				? {
						approved: true as const,
						expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
					}
				: undefined;
			const result = resumeReceipt(receipt, {
				now: now.toISOString(),
				newReceiptId: randomUUID(),
				...(taskRetryApproval === undefined ? {} : { taskRetryApproval }),
			});
			if (result.kind === "blocked") {
				return writeRuntimeFailure(
					result.reason === "unknown_outcome_requires_task_retry_approval"
						? "unknown_outcome_blocked"
						: "resume_blocked",
					"Durable work cannot continue automatically.",
					result.reason.startsWith("unknown") ? 4 : 1,
					runId,
					json,
					io,
				);
			}
			if (result.kind === "retry_prepared" && !argv.includes("--check")) {
				await store.write(result.receipt);
			}
			const data = createCommandResultData(
				TOOL_EXECUTION_COMMAND_CONTRACTS.resume,
				{ resume: result },
			);
			if (json) writeSuccessJson(io.stdout, runId, data);
			else io.stdout.write(`${result.kind}\n`);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}

	if (command === undefined) {
		try {
			const [receipts, checkpoint] = await Promise.all([
				createReceiptStore().list(),
				readActiveCheckpoint(),
			]);
			const recovery = receipts.filter(
				(receipt) =>
					receipt.state === "prepared" ||
					receipt.state === "dispatched" ||
					receipt.state === "unknown",
			);
			io.stdout.write(
				[
					"tool-execution",
					"",
					checkpoint
						? `Active checkpoint: ${checkpoint.id} (${checkpoint.position} of ${checkpoint.total})`
						: "Active checkpoint: none",
					`Recovery receipts: ${recovery.length}`,
					`Latest receipts: ${receipts.slice(-3).map((receipt) => receipt.receipt_id).join(", ") || "none"}`,
					"Next: tool-execution contract",
					"",
				].join("\n"),
			);
			return 0;
		} catch (error) {
			return writeCaughtFailure(error, { runId, json }, io);
		}
	}
	return writeUsageFailure(`Unknown command: ${command}`, { runId, json }, io);
}

function writeSuccessJson(stdout: CliWriter, runId: string, data: unknown): void {
	const envelope = createCliRuntimeSuccessEnvelope({ run_id: runId, data });
	writeJsonEnvelope(stdout, envelope, {
		runId,
		durationMs: getCliDiagnosticDurationMs() ?? 0,
	});
}

function writeUsageFailure(
	message: string,
	options: { runId: string; json: boolean },
	io: ToolExecutionCliIo,
): number {
	if (!options.json) {
		io.stderr.write(`${message}\n`);
		return 2;
	}
	const error = createCliUsageRuntimeError({
		run_id: options.runId,
		message,
		failure_domain: "command_input",
	});
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: options.runId,
		error,
		process_exit_code: 2,
	});
	writeJsonEnvelope(io.stdout, envelope, {
		runId: options.runId,
		durationMs: getCliDiagnosticDurationMs() ?? 0,
	});
	return 2;
}

function writeRuntimeFailure(
	code: string,
	message: string,
	exitCode: number,
	runId: string,
	json: boolean,
	io: ToolExecutionCliIo,
): number {
	if (!json) {
		io.stderr.write(`${message}\n`);
		return exitCode;
	}
	const error = createCliRuntimeError({
		run_id: runId,
		code,
		message,
		exit_code: exitCode,
		recoverability: "none",
		retryable: false,
		failure_domain: "execution_policy",
	});
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: runId,
		error,
		process_exit_code: exitCode,
	});
	writeJsonEnvelope(io.stdout, envelope, {
		runId,
		durationMs: getCliDiagnosticDurationMs() ?? 0,
	});
	return exitCode;
}

function writeCaughtFailure(
	error: unknown,
	options: { runId: string; json: boolean },
	io: ToolExecutionCliIo,
): number {
	if (error instanceof CliUsageError) {
		return writeUsageFailure(error.message, options, io);
	}
	if (isOutcomeUnknownError(error)) {
		return writeRuntimeFailure(
			"outcome_unknown",
			"Provider outcome is unknown because its settled receipt was not durable.",
			4,
			options.runId,
			options.json,
			io,
		);
	}
	return writeRuntimeFailure(
		"runtime_failure",
		"Runtime operation failed; inspect private state before retrying.",
		1,
		options.runId,
		options.json,
		io,
	);
}

function renderCommandHelp(command: ToolExecutionCommand): string {
	return renderCommandUsage(TOOL_EXECUTION_COMMAND_CONTRACTS[command]);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function valueFlag(argv: readonly string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	if (index < 0) return undefined;
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

async function readJsonInput(path: string): Promise<unknown> {
	const text =
		path === "-"
			? await new Response(Bun.stdin.stream()).text()
			: await Bun.file(path).text();
	return JSON.parse(text) as unknown;
}

async function readUsageInput<T>(
	path: string,
	validate: (value: unknown) => T,
): Promise<T> {
	try {
		return validate(await readJsonInput(path));
	} catch (error) {
		throw new CliUsageError(errorMessage(error));
	}
}

function validatePreparedRequestValue(value: unknown): PreparedRequest {
	validatePreparedRequest(value);
	return value;
}

function validateCommandArgv(
	command: ToolExecutionCommand,
	argv: readonly string[],
): void {
	if (argv[0] !== command) {
		throw new Error("Command must be the first argument.");
	}
	if (
		command === "approve" &&
		argv.includes("--approve") === argv.includes("--deny")
	) {
		throw new Error("Exactly one of --approve or --deny is required.");
	}
	const flags = TOOL_EXECUTION_COMMAND_CONTRACTS[command].flags;
	for (const [flag, metadata] of Object.entries(flags)) {
		if (
			"required" in metadata &&
			metadata.required === true &&
			!argv.includes(flag)
		) {
			throw new Error(`Missing required flag: ${flag}`);
		}
	}
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "-h" || arg === "--help") continue;
		if (!arg.startsWith("--")) {
			throw new Error(`Unexpected argument: ${arg}`);
		}
		const metadata = flags[arg];
		if (!metadata) throw new Error(`Unknown flag: ${arg}`);
		if (metadata.type !== "boolean") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${arg} requires a value`);
			}
			index += 1;
		}
	}
}

function minimalProviderEnvironment(): Record<string, string> {
	return Object.fromEntries(
		["PATH", "HOME", "TMPDIR", "LANG"].flatMap((name) => {
			const value = process.env[name];
			return value === undefined ? [] : [[name, value]];
		}),
	);
}

async function prepareAdapterInvocation(request: PreparedRequest) {
	try {
		return request.adapter === "firecrawl-cli"
			? await prepareFirecrawlCliInvocation(request.request, async () => [
					await resolveCanonicalDotfilesWrapper("firecrawl"),
				])
			: await prepareMcporterCliInvocation(request.request, async () => [
					await resolveCanonicalDotfilesWrapper("mcporter-mac-mini"),
				]);
	} catch {
		return {
			ok: false as const,
			failure: {
				class: "transport_or_client_policy_failure" as const,
				code: "command_resolution_failed",
				message: "Canonical provider wrapper is unavailable or not executable.",
			},
		};
	}
}

async function resolveCanonicalDotfilesWrapper(
	name: "firecrawl" | "mcporter-mac-mini",
): Promise<string> {
	const home = process.env.HOME ?? homedir();
	const candidate = join(home, "code", "dotfiles", "bin", name);
	await access(candidate, constants.X_OK);
	return realpath(candidate);
}

async function fingerprintAdapterConfiguration(
	request: PreparedRequest,
	invocation: { command: string; args: readonly string[]; stdinText?: string },
): Promise<string> {
	const dotfilesRoot = dirname(dirname(invocation.command));
	const relativePaths = [
		"package.json",
		"bun.lock",
		"bin/with-one-password-token",
		...(request.adapter === "mcporter-cli"
			? ["bin/firecrawl-mcp", "config/mcporter/mac-mini.json"]
			: []),
	];
	const preImages = Object.fromEntries(
		await Promise.all(
			relativePaths.map(async (path) => [
				path,
				await captureFilePreImage(join(dotfilesRoot, path)),
			]),
		),
	);
	return fingerprintValue({
		adapter: request.adapter,
		invocation: {
			command: invocation.command,
			args: invocation.args,
			...(invocation.stdinText === undefined
				? {}
				: { stdin_fingerprint: fingerprintValue(invocation.stdinText) }),
		},
		pre_images: {
			wrapper: await captureFilePreImage(invocation.command),
			...preImages,
		},
	});
}

function projectReceiptForGovernance(receipt: ExecutionReceipt) {
	const {
		approval: _approval,
		request_fingerprint: _requestFingerprint,
		config_fingerprint: _configFingerprint,
		...safe
	} = receipt;
	return {
		...safe,
		approval_status: receipt.approval ? "approved" : "none",
	};
}

if (import.meta.main) {
	process.exitCode = await runToolExecutionCli(process.argv.slice(2));
}
