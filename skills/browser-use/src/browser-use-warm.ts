import {
	type CliWriter,
	type RuntimeActionGuidance,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_WARM_START_CONTRACT_ID,
	BROWSER_USE_WARM_START_SCHEMA_VERSION,
	browserUseWarmStartFailureActions,
	browserUseWarmStartSuccessActions,
} from "./command-contract";
import type { OutputMode } from "./browser-use-core";
import type { ParsedBrowserUseCommand } from "./browser-use-parser";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	isMissingCommandResult,
	runMcporter,
} from "./mcporter-transport";
import { runPreflightBrowserAdapterCli } from "./preflight-browser-adapter";
import { runPreflightWarmChromeCli } from "./preflight-warm-chrome";

const DEFAULT_WARM_START_PORT = "9222";
const DEFAULT_WARM_START_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_WARM_START_PROFILE = "~/.agent-warm-profile";
const DEFAULT_WARM_START_ADAPTER = "chrome-devtools";
const MCPORTER_TIMEOUT_MS = 8000;

type WarmStartActionId =
	| (typeof browserUseWarmStartFailureActions)[number]["id"]
	| (typeof browserUseWarmStartSuccessActions)[number]["id"];

type ProofRun = {
	exitCode: number;
	stdout: string;
	stderr: string;
	envelope: Record<string, unknown>;
};

type WarmStartOptions = {
	port: string;
	endpoint: string;
	profile: string;
	adapter: string;
	repairAdapterConfig: boolean;
};

type WarmStartReadyData = {
	ok: true;
	action: "warm_stack_ready";
	contract: typeof BROWSER_USE_WARM_START_CONTRACT_ID;
	schema_version: typeof BROWSER_USE_WARM_START_SCHEMA_VERSION;
	command: "warm-start";
	endpoint: string;
	port: string;
	profile: string;
	browser_pid: number | null;
	adapter: {
		id: string;
		ready: true;
		page_count: number;
	};
	page_count: number;
	repair_actions: string[];
};

type WarmStartFailureData = {
	ok: false;
	action:
		| "browser_entry_required"
		| "adapter_config_repair_available"
		| "adapter_config_repair_aborted"
		| "adapter_dependency_missing"
		| "adapter_diagnostics_required";
	contract: typeof BROWSER_USE_WARM_START_CONTRACT_ID;
	schema_version: typeof BROWSER_USE_WARM_START_SCHEMA_VERSION;
	command: "warm-start";
	endpoint: string;
	port: string;
	adapter: {
		id: string;
		ready: false;
	};
	repair_actions: string[];
	upstream?: {
		code?: string;
		message?: string;
	};
};

class BufferWriter implements CliWriter {
	private chunks: string[] = [];

	write(chunk: string): true {
		this.chunks.push(chunk);
		return true;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

/**
 * Run the agent-facing Warm Chrome front door.
 *
 * Coordinates lower-level proof owners and maps their envelopes into one current
 * run continuation, keeping primary machine output on stdout.
 *
 * @param input - Parsed warm start command and runtime writers.
 * @returns Process exit code for the CLI invocation.
 */
export async function runWarmStart(input: {
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
}): Promise<number> {
	const options = warmStartOptions(input.parsed);
	const warmChrome = await runWarmChromeProof({
		options,
		runtime: input.runtime,
		runId: childRunId(input.runId, "w"),
	});
	if (warmChrome.exitCode !== 0) {
		return emitWarmStartError({
			...input,
			options,
			code: "warm_start_browser_entry_required",
			message: upstreamMessage(
				warmChrome.envelope,
				"Warm Chrome proof did not reach a browser-ready state.",
			),
			nextActionId: "launch-warm-chrome",
			exitCode: warmChrome.exitCode,
			data: failureData({
				options,
				action: "browser_entry_required",
				upstream: upstreamError(warmChrome.envelope),
			}),
		});
	}

	const adapter = await runAdapterProof({
		options,
		runtime: input.runtime,
		runId: childRunId(input.runId, "a"),
	});
	if (adapter.exitCode === 0) {
		return emitWarmStartReady({
			...input,
			options,
			warmChrome,
			adapter,
			repairActions: [],
		});
	}

	const adapterCode = upstreamCode(adapter.envelope);
	if (isAdapterConfigRepair(adapterCode)) {
		if (!options.repairAdapterConfig) {
			return emitWarmStartError({
				...input,
				options,
				code: "warm_start_adapter_config_stale",
				message:
					"Selected chrome-devtools config is stale or mismatched; rerun with --repair-adapter-config to update selected mcporter config.",
				nextActionId: "repair-adapter-config",
				exitCode: 20,
				data: failureData({
					options,
					action: "adapter_config_repair_available",
					upstream: upstreamError(adapter.envelope),
				}),
			});
		}

		const repair = await repairSelectedMcporterConfig({
			runtime: input.runtime,
			adapter: options.adapter,
			endpoint: options.endpoint,
			expectedObservedPort: observedPort(adapter.stderr),
		});
		if (!repair.ok) {
			return emitWarmStartError({
				...input,
				options,
				code: "warm_start_adapter_config_repair_aborted",
				message: repair.message,
				nextActionId: repair.nextActionId,
				exitCode: repair.exitCode,
				data: failureData({
					options,
					action: "adapter_config_repair_aborted",
					upstream: upstreamError(adapter.envelope),
					repairActions: repair.repairActions,
				}),
			});
		}

		const retried = await runAdapterProof({
			options,
			runtime: input.runtime,
			runId: childRunId(input.runId, "ar"),
		});
		if (retried.exitCode === 0) {
			return emitWarmStartReady({
				...input,
				options,
				warmChrome,
				adapter: retried,
				repairActions: ["adapter_config"],
			});
		}
		return emitAdapterDiagnostics({ ...input, options, adapter: retried });
	}

	if (adapterCode === "adapter_command_failed") {
		const restart = await restartMcporterDaemon(input.runtime);
		if (!restart.ok) {
			return emitWarmStartError({
				...input,
				options,
				code: "warm_start_daemon_restart_failed",
				message: restart.message,
				nextActionId: "inspect-adapter-diagnostics",
				exitCode: restart.exitCode,
				data: failureData({
					options,
					action: "adapter_diagnostics_required",
					upstream: upstreamError(adapter.envelope),
				}),
			});
		}
		const retried = await runAdapterProof({
			options,
			runtime: input.runtime,
			runId: childRunId(input.runId, "ad"),
		});
		if (retried.exitCode === 0) {
			return emitWarmStartReady({
				...input,
				options,
				warmChrome,
				adapter: retried,
				repairActions: ["mcporter_daemon_restart"],
			});
		}
		return emitWarmStartError({
			...input,
			options,
			code: "warm_start_adapter_sticky_daemon_retry_failed",
			message: "Adapter Proof still failed after one mcporter daemon restart.",
			nextActionId: "inspect-adapter-diagnostics",
			exitCode: 20,
			data: failureData({
				options,
				action: "adapter_diagnostics_required",
				upstream: upstreamError(retried.envelope),
				repairActions: ["mcporter_daemon_restart"],
			}),
		});
	}

	return emitAdapterDiagnostics({ ...input, options, adapter });
}

function childRunId(runId: string, label: string): string {
	return `${runId.slice(0, 48)}-${label}`;
}

function warmStartOptions(
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>,
): WarmStartOptions {
	const endpoint = parsed.flagValues["--endpoint"];
	const port =
		parsed.flagValues["--port"] ??
		(endpoint ? portFromEndpoint(endpoint) : DEFAULT_WARM_START_PORT);
	return {
		port,
		endpoint: endpoint ?? `http://127.0.0.1:${port}`,
		profile: parsed.flagValues["--profile"] ?? DEFAULT_WARM_START_PROFILE,
		adapter: parsed.flagValues["--adapter"] ?? DEFAULT_WARM_START_ADAPTER,
		repairAdapterConfig: parsed.flagValues["--repair-adapter-config"] !== undefined,
	};
}

function portFromEndpoint(endpoint: string): string {
	try {
		return new URL(endpoint).port || DEFAULT_WARM_START_PORT;
	} catch {
		return DEFAULT_WARM_START_PORT;
	}
}

async function runWarmChromeProof(input: {
	options: WarmStartOptions;
	runtime: BrowserUseRuntime;
	runId: string;
}): Promise<ProofRun> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const argv = [
		"launch",
		"--endpoint",
		input.options.endpoint,
		"--profile",
		input.options.profile,
		"--json",
		"--quiet",
		"--run-id",
		input.runId,
	];
	const exitCode = await runPreflightWarmChromeCli(argv, {
		runtime: input.runtime,
		stdout,
		stderr,
	});
	return proofRun(exitCode, stdout.toString(), stderr.toString());
}

async function runAdapterProof(input: {
	options: WarmStartOptions;
	runtime: BrowserUseRuntime;
	runId: string;
}): Promise<ProofRun> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runPreflightBrowserAdapterCli(
		[
			"check",
			"--adapter",
			input.options.adapter,
			"--endpoint",
			input.options.endpoint,
			"--json",
			"--run-id",
			input.runId,
		],
		{
			runtime: input.runtime,
			stdout,
			stderr,
		},
	);
	return proofRun(exitCode, stdout.toString(), stderr.toString());
}

function proofRun(exitCode: number, stdout: string, stderr: string): ProofRun {
	return {
		exitCode,
		stdout,
		stderr,
		envelope: parseEnvelope(stdout),
	};
}

function parseEnvelope(stdout: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(stdout);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

async function repairSelectedMcporterConfig(input: {
	runtime: BrowserUseRuntime;
	adapter: string;
	endpoint: string;
	expectedObservedPort?: string;
}): Promise<
	| { ok: true; repairActions: string[] }
	| {
			ok: false;
			message: string;
			nextActionId: WarmStartActionId;
			exitCode: number;
			repairActions: string[];
	  }
> {
	const current = await runMcporter(
		input.runtime,
		["config", "get", input.adapter, "--json"],
		MCPORTER_TIMEOUT_MS,
	);
	if (!current.ok) {
		return {
			ok: false,
			message: `Cannot inspect selected mcporter ${input.adapter} config.`,
			nextActionId: "inspect-adapter-diagnostics",
			exitCode: 20,
			repairActions: [],
		};
	}
	if (current.result.timedOut || current.result.exitCode !== 0) {
		return {
			ok: false,
			message: `Cannot inspect selected mcporter ${input.adapter} config before repair.`,
			nextActionId: "inspect-adapter-diagnostics",
			exitCode: 20,
			repairActions: [],
		};
	}
	const currentPort = observedBrowserUrlPort(current.result.stdout);
	if (input.expectedObservedPort && currentPort !== input.expectedObservedPort) {
		return {
			ok: false,
			message:
				`Selected mcporter ${input.adapter} binding changed before repair; aborting config write.`,
			nextActionId: "inspect-adapter-diagnostics",
			exitCode: 20,
			repairActions: [],
		};
	}

	const update = await runMcporter(
		input.runtime,
		[
			"config",
			"set",
			input.adapter,
			"--browserUrl",
			input.endpoint,
			"--json",
		],
		MCPORTER_TIMEOUT_MS,
	);
	if (!update.ok || update.result.timedOut || update.result.exitCode !== 0) {
		return {
			ok: false,
			message: `Failed to update selected mcporter ${input.adapter} config.`,
			nextActionId: "inspect-adapter-diagnostics",
			exitCode: 20,
			repairActions: [],
		};
	}
	return { ok: true, repairActions: ["adapter_config"] };
}

async function restartMcporterDaemon(runtime: BrowserUseRuntime): Promise<
	| { ok: true }
	| {
			ok: false;
			message: string;
			exitCode: number;
	  }
> {
	const result = await runMcporter(
		runtime,
		["daemon", "restart"],
		MCPORTER_TIMEOUT_MS,
	);
	if (!result.ok) {
		return {
			ok: false,
			message: "Could not start mcporter daemon restart command.",
			exitCode: 20,
		};
	}
	if (result.result.timedOut || isMissingCommandResult(result.result)) {
		return {
			ok: false,
			message: "mcporter daemon restart did not complete.",
			exitCode: 20,
		};
	}
	if (result.result.exitCode !== 0) {
		return {
			ok: false,
			message: "mcporter daemon restart failed.",
			exitCode: 20,
		};
	}
	return { ok: true };
}

function emitWarmStartReady(input: {
	options: WarmStartOptions;
	warmChrome: ProofRun;
	adapter: ProofRun;
	repairActions: string[];
	stdout: CliWriter;
	runId: string;
	durationMs: () => number;
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
	stderr: CliWriter;
}): number {
	const data = readyData(input);
	if (input.parsed.outputMode === "plain") {
		input.stdout.write(
			[
				"warm_stack_ready",
				`endpoint=${data.endpoint}`,
				`browser_pid=${data.browser_pid ?? "unknown"}`,
				`adapter=${data.adapter.id}`,
				`pages=${data.page_count}`,
				"action=warm-stack-ready",
				`run_id=${input.runId}`,
				`duration_ms=${input.durationMs()}`,
			].join(" ") + "\n",
		);
		return 0;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data,
			runtime_actions: [runtimeAction("warm-stack-ready")],
			continuation: { next_action_id: "warm-stack-ready" },
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return 0;
}

function readyData(input: {
	options: WarmStartOptions;
	warmChrome: ProofRun;
	adapter: ProofRun;
	repairActions: string[];
}): WarmStartReadyData {
	const warmData = objectField(input.warmChrome.envelope, "data");
	const adapterData = objectField(input.adapter.envelope, "data");
	const pageCount = numberField(adapterData, "page_count") ?? 0;
	return {
		ok: true,
		action: "warm_stack_ready",
		contract: BROWSER_USE_WARM_START_CONTRACT_ID,
		schema_version: BROWSER_USE_WARM_START_SCHEMA_VERSION,
		command: "warm-start",
		endpoint: stringField(warmData, "endpoint") ?? input.options.endpoint,
		port: stringField(warmData, "port") ?? input.options.port,
		profile: stringField(warmData, "profile_dir") ?? input.options.profile,
		browser_pid: numberField(warmData, "browser_pid"),
		adapter: {
			id: stringField(adapterData, "adapter") ?? input.options.adapter,
			ready: true,
			page_count: pageCount,
		},
		page_count: pageCount,
		repair_actions: input.repairActions,
	};
}

function emitAdapterDiagnostics(input: {
	options: WarmStartOptions;
	adapter: ProofRun;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
}): number {
	const code =
		upstreamCode(input.adapter.envelope) === "adapter_dependency_missing"
			? "warm_start_adapter_dependency_missing"
			: "warm_start_adapter_output_failed";
	return emitWarmStartError({
		...input,
		code,
		message: upstreamMessage(
			input.adapter.envelope,
			"Adapter Proof failed; inspect adapter diagnostics.",
		),
		nextActionId: "inspect-adapter-diagnostics",
		exitCode: input.adapter.exitCode,
		data: failureData({
			options: input.options,
			action:
				upstreamCode(input.adapter.envelope) === "adapter_dependency_missing"
					? "adapter_dependency_missing"
					: "adapter_diagnostics_required",
			upstream: upstreamError(input.adapter.envelope),
		}),
	});
}

function emitWarmStartError(input: {
	options: WarmStartOptions;
	code: string;
	message: string;
	nextActionId: WarmStartActionId;
	exitCode: number;
	data: WarmStartFailureData;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: () => number;
	parsed: Extract<ParsedBrowserUseCommand, { kind: "command" }>;
	runtime: BrowserUseRuntime;
}): number {
	if (input.parsed.outputMode === "plain") {
		input.stderr.write(
			`warm_start ${input.code}: ${input.message} action=${input.nextActionId} (run_id=${input.runId})\n`,
		);
		return input.exitCode;
	}
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: input.exitCode,
			data: input.data,
			error: createCliRuntimeError({
				run_id: input.runId,
				code: input.code,
				message: input.message,
				exit_code: input.exitCode,
				severity: "error",
				recoverability: "repair_state",
				retryable: false,
				failure_domain:
					input.nextActionId === "launch-warm-chrome"
						? "browser_entry_handoff"
						: "browser_adapter_proof",
				hint: {
					summary: input.message,
					action: "repair_state",
				},
			}),
			runtime_actions: [runtimeAction(input.nextActionId)],
			continuation: {
				next_action_id: input.nextActionId,
				constraints: [
					{
						id: "no_cold_browser_fallback",
						summary:
							"Do not use Chrome for Testing, throwaway profiles, everyday default profiles, Playwright launch, AppleScript, or cold-browser fallback.",
						forbidden_action_ids: [
							"cold_browser_fallback",
							"playwright_launch",
							"apple_script_browser_launch",
						],
					},
				],
			},
		}),
		{ runId: input.runId, durationMs: input.durationMs() },
	);
	return input.exitCode;
}

function failureData(input: {
	options: WarmStartOptions;
	action: WarmStartFailureData["action"];
	upstream?: WarmStartFailureData["upstream"];
	repairActions?: string[];
}): WarmStartFailureData {
	return {
		ok: false,
		action: input.action,
		contract: BROWSER_USE_WARM_START_CONTRACT_ID,
		schema_version: BROWSER_USE_WARM_START_SCHEMA_VERSION,
		command: "warm-start",
		endpoint: input.options.endpoint,
		port: input.options.port,
		adapter: {
			id: input.options.adapter,
			ready: false,
		},
		repair_actions: input.repairActions ?? [],
		...(input.upstream ? { upstream: input.upstream } : {}),
	};
}

function runtimeAction(id: WarmStartActionId): RuntimeActionGuidance {
	const action = [
		...browserUseWarmStartSuccessActions,
		...browserUseWarmStartFailureActions,
	].find((candidate) => candidate.id === id);
	if (!action) throw new Error(`Unknown warm start action: ${id}`);
	return {
		id,
		summary: action.summary,
		side_effects: [...action.sideEffects] as RuntimeActionGuidance["side_effects"],
	};
}

function isAdapterConfigRepair(code: string | undefined): boolean {
	return code === "adapter_config_stale" || code === "adapter_binding_mismatch";
}

function upstreamCode(envelope: Record<string, unknown>): string | undefined {
	return stringField(objectField(envelope, "error"), "code");
}

function upstreamMessage(
	envelope: Record<string, unknown>,
	fallback: string,
): string {
	return stringField(objectField(envelope, "error"), "message") ?? fallback;
}

function upstreamError(
	envelope: Record<string, unknown>,
): WarmStartFailureData["upstream"] | undefined {
	const error = objectField(envelope, "error");
	const code = stringField(error, "code");
	const message = stringField(error, "message");
	if (!code && !message) return undefined;
	return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
}

function observedPort(stderr: string): string | undefined {
	const match = stderr.match(/"observed_port":"([^"]+)"/);
	return match?.[1];
}

function observedBrowserUrlPort(stdout: string): string | undefined {
	try {
		const parsed = JSON.parse(stdout);
		const text = JSON.stringify(parsed);
		const match = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
		return match?.[1];
	} catch {
		const match = stdout.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
		return match?.[1];
	}
}

function objectField(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const value = record[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function numberField(
	record: Record<string, unknown>,
	key: string,
): number | null {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
