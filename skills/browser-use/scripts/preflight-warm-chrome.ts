#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	CliUsageError,
	type CliWriter,
	type ParsedCliDiagnosticArgv,
	type RuntimeActionGuidance,
	type RuntimeContinuationGuidance,
	configureCliDiagnostics,
	createCliDiagnosticContext,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	emitCliDiagnostic,
	getCliDiagnosticDurationMs,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	resetCliDiagnostics,
	usageError,
	validateStructuredRuntimeError,
	withCliDiagnosticContext,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	WARM_CHROME_PREFLIGHT_CONTRACT_ID,
	WARM_CHROME_PREFLIGHT_SCHEMA_VERSION,
	type WarmChromePreflightCommand,
	warmChromeFailureActions,
	warmChromePreflightContracts,
	warmChromeSuccessActions,
} from "./command-contract";

const VERSION = "0.2.0";
const DEFAULT_PORT = "9222";
const DEFAULT_PROFILE_DIR = "~/.agent-warm-profile";
const DEFAULT_CHROME =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_STARTUP_URL = "https://example.com/";
const CHROME_REMOTE_DEBUGGING_DOCS_URL =
	"https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session";
const BROWSER_ENTRY_EXIT_CODE = 20;
const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const quietDiagnosticWriter: CliWriter = {
	write: () => true,
};

type OutputMode = "json" | "plain";
type CommandToExecute = Exclude<WarmChromePreflightCommand, "status">;
type WarmChromeFailureDomain =
	| "browser_entry_handoff"
	| "input"
	| "runtime_diagnostics";
type WarmChromeRuntimeActionId =
	| (typeof warmChromeFailureActions)[number]["id"]
	| (typeof warmChromeSuccessActions)[number]["id"];
type WarmChromeRuntimeActionGuidance = RuntimeActionGuidance & {
	id: WarmChromeRuntimeActionId;
};
const warmChromeRuntimeActions = [
	...warmChromeFailureActions,
	...warmChromeSuccessActions,
] as const;
const warmChromeRuntimeActionById = new Map(
	warmChromeRuntimeActions.map((action) => [action.id, action]),
);

export type ListenerProcess = {
	pid: number;
	command: string;
};

export type ProfileStat = {
	realPath: string;
	mode: string;
	owner: string;
};

export type PreflightRuntime = {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	now: () => number;
	fetchJson: (url: string) => Promise<unknown>;
	findListener: (port: string) => Promise<ListenerProcess | null>;
	currentUser: () => Promise<string>;
	statProfile: (path: string) => Promise<ProfileStat>;
	ensureProfileDir: (path: string) => Promise<string>;
	chmod: (path: string, mode: number) => Promise<void>;
	writeTextFile: (path: string, content: string) => Promise<void>;
	spawnChrome: (input: LaunchChromeInput) => Promise<void>;
	sleep: (ms: number) => Promise<void>;
	isTemporaryPath: (path: string) => boolean;
};

type LaunchChromeInput = {
	chromeBin: string;
	port: string;
	profileDir: string;
	startupUrl: string;
};

type ParsedPreflightCommand =
	| { kind: "help"; command?: WarmChromePreflightCommand }
	| { kind: "version" }
	| {
			kind: "execute";
			commandName: CommandToExecute;
			displayCommandName: WarmChromePreflightCommand;
			outputMode: OutputMode;
			endpoint: string;
			port: string;
			profileInput?: string;
			chromeBin: string;
	  };

type WarmChromeProof = {
	ok: true;
	action: "browser_ready";
	contract: typeof WARM_CHROME_PREFLIGHT_CONTRACT_ID;
	schema_version: typeof WARM_CHROME_PREFLIGHT_SCHEMA_VERSION;
	command: WarmChromePreflightCommand;
	endpoint: string;
	port: string;
	browser: string;
	user_agent: string;
	web_socket_debugger_url: string;
	browser_pid: number;
	profile_dir: string;
	profile_owner: string;
	profile_permissions: string;
	target_count: number;
	repair_actions: string[];
	launch_performed: boolean;
};

type VerifyWarmChromeOptions = {
	command: WarmChromePreflightCommand;
	endpoint: string;
	port: string;
	profileInput?: string;
	runtime: PreflightRuntime;
	repair: boolean;
	launchPerformed: boolean;
};

type PreflightRuntimeErrorOptions = {
	exitCode?: number;
	recoverability?: "none" | "retry" | "change_input" | "repair_state";
	hintSummary?: string;
	hintAction?: "retry" | "change_input" | "repair_state";
	hintDocsUrl?: string;
	severity?: "warning" | "error" | "fatal";
	failureDomain?: WarmChromeFailureDomain;
	// Override the per-run primary runtime action when the error code alone is
	// ambiguous. `endpoint_unreachable` means "launch" when nothing answers but
	// "inspect" when a real Chrome already occupies the port without CDP.
	primaryActionId?: "inspect_listener";
};

type ProfilePathValidationOptions = {
	failureDomain?: WarmChromeFailureDomain;
};

function inputChangeOptions(
	hintSummary: string,
): Pick<
	PreflightRuntimeErrorOptions,
	"failureDomain" | "hintAction" | "hintSummary" | "recoverability"
> {
	return {
		failureDomain: "input",
		hintSummary,
		hintAction: "change_input",
		recoverability: "change_input",
	};
}

class PreflightRuntimeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly options: PreflightRuntimeErrorOptions = {},
	) {
		super(message);
		this.name = "PreflightRuntimeError";
	}

	get exitCode(): number {
		return this.options.exitCode ?? BROWSER_ENTRY_EXIT_CODE;
	}
}

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

export function createDefaultRuntime(
	overrides: Partial<PreflightRuntime> = {},
): PreflightRuntime {
	const env = overrides.env ?? process.env;
	return {
		env,
		platform: process.platform,
		now: () => Date.now(),
		fetchJson: async (url: string) => {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(2000),
			});
			if (!response.ok) {
				throw new Error(`request failed: ${response.status}`);
			}
			return response.json();
		},
		findListener: async (port: string) => findListenerWithSystemTools(port),
		currentUser: async () => String(userInfo().uid),
		statProfile: async (path: string) => statProfile(path),
		ensureProfileDir: async (path: string) => ensureProfileDir(path),
		chmod: async (path: string, mode: number) => {
			await chmod(path, mode);
		},
		writeTextFile: async (path: string, content: string) => {
			await writeFile(path, content, "utf-8");
		},
		spawnChrome: async (input: LaunchChromeInput) => {
			const child = spawn(
				input.chromeBin,
				[
					`--remote-debugging-port=${input.port}`,
					`--user-data-dir=${input.profileDir}`,
					"--no-first-run",
					"--no-default-browser-check",
					input.startupUrl,
				],
				{ detached: true, stdio: "ignore" },
			);
			await awaitChromeSpawn(child);
		},
		sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		isTemporaryPath: (path: string) =>
			path.startsWith("/tmp/") ||
			path.startsWith("/private/tmp/") ||
			path.startsWith("/var/folders/") ||
			path.startsWith("/private/var/folders/"),
		...overrides,
	};
}

export async function runPreflightWarmChromeCli(
	argv: readonly string[],
	options: {
		runtime?: PreflightRuntime;
		stdout?: CliWriter;
		stderr?: CliWriter;
	} = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRuntime();
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const diagnosticInput = applyEnvRunId(argv, runtime.env.BROWSER_USE_RUN_ID);
	let diagnosticArgv: ParsedCliDiagnosticArgv;

	try {
		diagnosticArgv = parseCliDiagnosticArgv(diagnosticInput);
	} catch (error) {
		diagnosticArgv = parseCliDiagnosticFallbackArgv(diagnosticInput);
		const outputMode = inferOutputMode(argv);
		configureCliDiagnostics({
			categoryRoot: "browser-use.warm-chrome",
			options: diagnosticArgv.options,
			diagnosticWriter: diagnosticArgv.options.quiet
				? quietDiagnosticWriter
				: stderr,
		});
		try {
			return emitCliError({
				error:
					error instanceof Error
						? usageError(error.message)
						: usageError("invalid diagnostic flags"),
				outputMode,
				stdout,
				stderr,
				runId: diagnosticArgv.options.runId,
				durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
			});
		} finally {
			resetCliDiagnostics();
		}
	}

	configureCliDiagnostics({
		categoryRoot: "browser-use.warm-chrome",
		options: diagnosticArgv.options,
		diagnosticWriter: diagnosticArgv.options.quiet
			? quietDiagnosticWriter
			: stderr,
	});

	try {
		const context = createCliDiagnosticContext(diagnosticArgv.options);
		return await withCliDiagnosticContext(context, async () => {
			const outputMode = inferOutputMode(diagnosticArgv.argv);
			try {
				const parsed = parsePreflightArgv(diagnosticArgv.argv, runtime);
				if (parsed.kind === "help") {
					stdout.write(renderHelp(parsed.command));
					return 0;
				}
				if (parsed.kind === "version") {
					stdout.write(`preflight-warm-chrome ${VERSION}\n`);
					return 0;
				}

				emitCliDiagnostic("browser-use.warm-chrome", "info", "command-start", {
					command: parsed.displayCommandName,
					phase: "start",
					port: parsed.port,
				});
				const proof = await executePreflight(parsed, runtime);
				writeSuccess(stdout, proof, parsed.outputMode, {
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				});
				return 0;
			} catch (error) {
				return emitCliError({
					error,
					outputMode,
					stdout,
					stderr,
					runId: diagnosticArgv.options.runId,
					durationMs: runtime.now() - diagnosticArgv.options.startedAtMs,
				});
			}
		});
	} finally {
		resetCliDiagnostics();
	}
}

function inferOutputMode(argv: readonly string[]): OutputMode {
	let outputMode: OutputMode = argv[0] === "status" ? "plain" : "json";
	for (const arg of argv) {
		if (arg === "--json") outputMode = "json";
		if (arg === "--plain") outputMode = "plain";
	}
	return outputMode;
}

function applyEnvRunId(
	argv: readonly string[],
	envRunId: string | undefined,
): readonly string[] {
	if (!envRunId || argv.some((arg) => arg === "--run-id" || arg.startsWith("--run-id="))) {
		return argv;
	}
	return ["--run-id", envRunId, ...argv];
}

function parsePreflightArgv(
	argv: readonly string[],
	runtime: PreflightRuntime,
): ParsedPreflightCommand {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { kind: "help", command: findCommand(argv) };
	}
	if (argv.includes("--version")) {
		return { kind: "version" };
	}

	const args = [...argv];
	let displayCommandName: WarmChromePreflightCommand = "check";
	if (args[0] && !args[0].startsWith("-")) {
		const candidate = args.shift();
		if (candidate === "help") {
			return { kind: "help", command: findCommand(args) };
		}
		if (!isWarmChromeCommand(candidate)) {
			throw usageError(`unknown command: ${candidate}`);
		}
		displayCommandName = candidate;
	}

	const commandName: CommandToExecute =
		displayCommandName === "status" ? "check" : displayCommandName;
	let outputMode: OutputMode =
		displayCommandName === "status" ? "plain" : "json";
	let port = "";
	let endpoint = "";
	let profileInput =
		typeof runtime.env.BROWSER_USE_PROFILE_DIR === "string"
			? runtime.env.BROWSER_USE_PROFILE_DIR
			: undefined;
	let chromeBin = runtime.env.CHROME_BIN ?? DEFAULT_CHROME;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		switch (arg) {
			case "--json":
				outputMode = "json";
				break;
			case "--plain":
				outputMode = "plain";
				break;
			case "--port":
				port = requireNext(args, index, "--port");
				index += 1;
				break;
			case "--endpoint":
				endpoint = requireNext(args, index, "--endpoint");
				index += 1;
				break;
			case "--profile":
				profileInput = requireNext(args, index, "--profile");
				index += 1;
				break;
			case "--chrome":
				chromeBin = requireNext(args, index, "--chrome");
				index += 1;
				break;
			default:
				if (arg.startsWith("--port=")) {
					port = requireInlineValue(arg, "--port");
				} else if (arg.startsWith("--endpoint=")) {
					endpoint = requireInlineValue(arg, "--endpoint");
				} else if (arg.startsWith("--profile=")) {
					profileInput = requireInlineValue(arg, "--profile");
				} else if (arg.startsWith("--chrome=")) {
					chromeBin = requireInlineValue(arg, "--chrome");
				} else if (arg.startsWith("-")) {
					throw usageError(`unknown option: ${arg}`);
				} else {
					throw usageError(`unexpected argument: ${arg}`);
				}
		}
	}

	if (commandName !== "launch" && hasChromeFlag(args)) {
		throw usageError("--chrome is only valid with launch");
	}

	const normalized = normalizeEndpoint({
		port: port || (endpoint ? "" : runtime.env.BROWSER_USE_CDP_PORT || DEFAULT_PORT),
		endpoint,
	});

	if (commandName === "launch" && !profileInput) {
		profileInput = DEFAULT_PROFILE_DIR;
	}

	return {
		kind: "execute",
		commandName,
		displayCommandName,
		outputMode,
		...normalized,
		profileInput,
		chromeBin: expandHome(chromeBin, runtime),
	};
}

function hasChromeFlag(args: readonly string[]): boolean {
	return args.some((arg) => arg === "--chrome" || arg.startsWith("--chrome="));
}

function requireNext(args: readonly string[], index: number, flag: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function requireInlineValue(arg: string, flag: string): string {
	const value = arg.slice(`${flag}=`.length);
	if (value === "") {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

function normalizeEndpoint(input: {
	port: string;
	endpoint: string;
}): { endpoint: string; port: string } {
	if (!input.endpoint) {
		assertPort(input.port, "port");
		return { endpoint: `http://127.0.0.1:${input.port}`, port: input.port };
	}

	let parsed: URL;
	try {
		parsed = new URL(input.endpoint);
	} catch {
		throw usageError("--endpoint must be a valid URL");
	}
	if (parsed.protocol !== "http:") {
		throw usageError("--endpoint must use http");
	}
	if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
		throw new PreflightRuntimeError(
			"non_loopback_endpoint",
			"Warm Chrome CDP endpoint must be loopback.",
		);
	}
	if (!parsed.port) {
		throw usageError("--endpoint must include a port");
	}
	assertPort(parsed.port, "endpoint port");
	if (input.port && input.port !== parsed.port) {
		throw usageError("--port does not match --endpoint");
	}
	return {
		endpoint: `http://${parsed.hostname}:${parsed.port}`,
		port: parsed.port,
	};
}

function assertPort(value: string, label: string): void {
	if (!/^[0-9]+$/.test(value)) {
		throw usageError(`${label} must be numeric`);
	}
	const numeric = Number(value);
	if (numeric < 1 || numeric > 65535) {
		throw usageError(`${label} must be between 1 and 65535`);
	}
}

async function executePreflight(
	parsed: Extract<ParsedPreflightCommand, { kind: "execute" }>,
	runtime: PreflightRuntime,
): Promise<WarmChromeProof> {
	if (runtime.platform !== "darwin") {
		throw new PreflightRuntimeError(
			"unsupported_platform",
			"Warm Chrome Preflight currently supports macOS only.",
			{ exitCode: RUNTIME_FAILURE_EXIT_CODE },
		);
	}

	let launchPerformed = false;
	if (parsed.commandName === "launch") {
		launchPerformed = await launchIfNeeded(parsed, runtime);
	}

	return verifyWarmChrome({
		command: parsed.displayCommandName,
		endpoint: parsed.endpoint,
		port: parsed.port,
		profileInput: parsed.profileInput,
		runtime,
		repair: parsed.commandName === "repair",
		launchPerformed,
	});
}

async function launchIfNeeded(
	parsed: Extract<ParsedPreflightCommand, { kind: "execute" }>,
	runtime: PreflightRuntime,
): Promise<boolean> {
	// Validate the requested launch binary before any reuse early return. A
	// healthy endpoint proves the *running* Chrome is usable, but it does not
	// prove the operator-supplied --chrome / CHROME_BIN value is safe; reusing
	// the endpoint without this check would silently accept Canary/Beta/CfT.
	validateLaunchChromeBinary(parsed.chromeBin);
	if (await endpointAnswers(parsed.endpoint, runtime)) {
		emitCliDiagnostic("browser-use.warm-chrome", "debug", "launch-reuse", {
			command: "launch",
			phase: "launch",
			port: parsed.port,
		});
		return false;
	}
	if (parsed.port !== DEFAULT_PORT) {
		await assertNoHealthyDefaultWarmChrome(runtime);
	}
	if (!parsed.profileInput) {
		throw usageError("--profile is required for launch");
	}
	const expandedProfile = expandHome(parsed.profileInput, runtime);
	await validateProfilePath(expandedProfile, runtime, { failureDomain: "input" });

	const listener = await runtime.findListener(parsed.port);
	if (listener) {
		emitListenerDetected({
			command: parsed.displayCommandName,
			port: parsed.port,
			listener,
		});
		validateChromeCommand(listener.command, parsed.port);
		throw new PreflightRuntimeError(
			"endpoint_unreachable",
			"Existing Google Chrome listener did not expose a DevTools endpoint.",
			{
				hintSummary:
					"Stop and inspect the existing listener before launching another Chrome.",
				hintAction: "repair_state",
				recoverability: "repair_state",
				primaryActionId: "inspect_listener",
			},
		);
	}

	let profileDir: string;
	try {
		profileDir = await runtime.ensureProfileDir(expandedProfile);
	} catch {
		throw new PreflightRuntimeError(
			"invalid_profile_path",
			"Warm Chrome launch profile must be a directory path that can be created.",
			inputChangeOptions("Choose a dedicated persistent profile directory."),
		);
	}
	await validateProfilePath(profileDir, runtime, { failureDomain: "input" });
	await runtime.spawnChrome({
		chromeBin: parsed.chromeBin,
		port: parsed.port,
		profileDir,
		startupUrl: DEFAULT_STARTUP_URL,
	});
	emitCliDiagnostic("browser-use.warm-chrome", "info", "launch-started", {
		command: "launch",
		phase: "launch",
		port: parsed.port,
	});

	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (await endpointAnswers(parsed.endpoint, runtime)) {
			return true;
		}
		await runtime.sleep(500);
	}

	throw new PreflightRuntimeError(
		"endpoint_unreachable",
		"Real Google Chrome did not expose a DevTools endpoint in time.",
		{
			// Chrome already spawned; relaunching is wrong. Inspect the listener
			// that came up but never exposed CDP rather than fall through to the
			// default launch_warm_chrome action.
			hintSummary:
				"Inspect the spawned Chrome's listener before relaunching.",
			hintAction: "repair_state",
			recoverability: "repair_state",
			primaryActionId: "inspect_listener",
		},
	);
}

async function assertNoHealthyDefaultWarmChrome(
	runtime: PreflightRuntime,
): Promise<void> {
	try {
		const defaultEndpoint = normalizeEndpoint({ port: DEFAULT_PORT, endpoint: "" });
		await verifyWarmChrome({
			command: "check",
			endpoint: defaultEndpoint.endpoint,
			port: defaultEndpoint.port,
			profileInput: DEFAULT_PROFILE_DIR,
			runtime,
			repair: false,
			launchPerformed: false,
		});
	} catch (error) {
		if (
			error instanceof PreflightRuntimeError &&
			error.code === "profile_mismatch"
		) {
			throw error;
		}
		return;
	}

	throw new PreflightRuntimeError(
		"warm_chrome_already_running",
		"Primary Warm Chrome is already running; refusing to spawn a competing instance.",
		{
			hintSummary: `Use --port ${DEFAULT_PORT}, or stop and inspect the requested port before launching another Chrome.`,
			hintAction: "change_input",
			recoverability: "change_input",
			failureDomain: "input",
		},
	);
}

async function endpointAnswers(
	endpoint: string,
	runtime: PreflightRuntime,
): Promise<boolean> {
	try {
		await runtime.fetchJson(`${endpoint}/json/version`);
		return true;
	} catch {
		return false;
	}
}

function emitListenerDetected(input: {
	command: WarmChromePreflightCommand;
	port: string;
	listener: ListenerProcess;
}): void {
	emitCliDiagnostic("browser-use.warm-chrome", "debug", "listener-detected", {
		command: input.command,
		phase: "inspect_listener",
		port: input.port,
		listener_pid: input.listener.pid,
	});
}

async function verifyWarmChrome(
	options: VerifyWarmChromeOptions,
): Promise<WarmChromeProof> {
	const { endpoint, port, runtime } = options;
	emitCliDiagnostic("browser-use.warm-chrome", "debug", "preflight-check", {
		command: options.command,
		phase: "verify",
		endpoint_host: endpointHost(endpoint),
		port,
		profile: options.profileInput ? "provided" : "inferred",
	});
	const version = await fetchObject(
		`${endpoint}/json/version`,
		runtime,
		"endpoint_unreachable",
		"No Chrome DevTools endpoint answered.",
		options.profileInput
			? {}
			: port === DEFAULT_PORT
				? {}
			: inputChangeOptions(
					"Set --profile or BROWSER_USE_PROFILE_DIR before launching Warm Chrome.",
				),
	);
	const browser = stringField(version, "Browser", "invalid_cdp_version");
	const userAgent = stringField(version, "User-Agent", "invalid_cdp_version");
	const webSocketDebuggerUrl = stringField(
		version,
		"webSocketDebuggerUrl",
		"invalid_cdp_version",
	);
	validateLoopbackWebSocket(webSocketDebuggerUrl, port);

	const listener = await runtime.findListener(port);
	if (!listener) {
		throw new PreflightRuntimeError(
			"listener_missing",
			"No local process is listening on the requested CDP port.",
		);
	}
	emitListenerDetected({
		command: options.command,
		port,
		listener,
	});
	validateChromeCommand(listener.command, port);

	const inferredProfile = extractUserDataDir(listener.command);
	if (!inferredProfile) {
		throw new PreflightRuntimeError(
			"missing_profile",
			"Warm Chrome must use a dedicated profile directory.",
		);
	}
	const profile = await requireProfileStat(
		expandHome(inferredProfile, runtime),
		runtime,
		"Chrome profile directory does not exist.",
	);

	if (options.profileInput) {
		const provided = await requireProfileStat(
			expandHome(options.profileInput, runtime),
			runtime,
			"Provided profile directory does not exist.",
			{
				hintSummary: "Correct --profile or choose the matching CDP port.",
				hintAction: "change_input",
				recoverability: "change_input",
				failureDomain: "input",
			},
		);
		if (provided.realPath !== profile.realPath) {
			throw new PreflightRuntimeError(
				"profile_mismatch",
				"Provided profile does not match the listener profile.",
			);
		}
	}

	await validateProfilePath(
		profile.realPath,
		runtime,
		options.profileInput ? { failureDomain: "input" } : {},
	);
	const repairActions: string[] = [];
	if (options.repair) {
		await assertCurrentUserOwnsProfile(profile, runtime);
	}
	if (profile.mode !== "700") {
		if (!options.repair) {
			throw new PreflightRuntimeError(
				"unsafe_profile_permissions",
				"Warm Chrome profile must be owner-only.",
				{
					hintSummary:
						"Use preflight-warm-chrome repair with the same port and profile.",
				},
			);
		}
		await runtime.chmod(profile.realPath, 0o700);
		repairActions.push("profile_permissions");
	}

	if (options.repair || options.command === "launch") {
		await writeDevToolsActivePort({
			profileDir: profile.realPath,
			port,
			webSocketDebuggerUrl,
			runtime,
		});
		repairActions.push("devtools_active_port");
	}
	if (repairActions.length > 0) {
		emitCliDiagnostic("browser-use.warm-chrome", "info", "repair-actions", {
			command: options.command,
			phase: "repair",
			port,
			repair_actions: repairActions,
		});
	}

	const finalProfile = await runtime.statProfile(profile.realPath);
	if (finalProfile.mode !== "700") {
		throw new PreflightRuntimeError(
			"unsafe_profile_permissions",
			"Warm Chrome profile must be owner-only.",
		);
	}

	const targets = await fetchTargetList(endpoint, runtime);
	emitCliDiagnostic("browser-use.warm-chrome", "debug", "preflight-ready", {
		command: options.command,
		phase: "ready",
		port,
		browser_pid: listener.pid,
		profile: "verified",
		target_count: targets.length,
	});
	return {
		ok: true,
		action: "browser_ready",
		contract: WARM_CHROME_PREFLIGHT_CONTRACT_ID,
		schema_version: WARM_CHROME_PREFLIGHT_SCHEMA_VERSION,
		command: options.command,
		endpoint,
		port,
		browser,
		user_agent: userAgent,
		web_socket_debugger_url: webSocketDebuggerUrl,
		browser_pid: listener.pid,
		profile_dir: finalProfile.realPath,
		profile_owner: finalProfile.owner,
		profile_permissions: finalProfile.mode,
		target_count: targets.length,
		repair_actions: repairActions,
		launch_performed: options.launchPerformed,
	};
}

async function assertCurrentUserOwnsProfile(
	profile: ProfileStat,
	runtime: PreflightRuntime,
): Promise<void> {
	const currentUser = await runtime.currentUser();
	if (profile.owner === currentUser) return;
	throw new PreflightRuntimeError(
		"unsafe_profile_permissions",
		"Profile repair requires a profile owned by the current user.",
		{
			hintSummary: "Choose a Warm Chrome profile owned by the current user.",
			hintAction: "change_input",
			recoverability: "change_input",
			failureDomain: "input",
		},
	);
}

function endpointHost(endpoint: string): string {
	try {
		return new URL(endpoint).hostname;
	} catch {
		return "unknown";
	}
}

async function fetchObject(
	url: string,
	runtime: PreflightRuntime,
	code: string,
	message: string,
	options: PreflightRuntimeErrorOptions = {},
): Promise<Record<string, unknown>> {
	let value: unknown;
	try {
		value = await runtime.fetchJson(url);
	} catch {
		throw new PreflightRuntimeError(code, message, options);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new PreflightRuntimeError(
			"invalid_cdp_version",
			"CDP response was not a JSON object.",
		);
	}
	return value as Record<string, unknown>;
}

async function fetchTargetList(
	endpoint: string,
	runtime: PreflightRuntime,
): Promise<unknown[]> {
	try {
		const value = await runtime.fetchJson(`${endpoint}/json/list`);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

function stringField(
	value: Record<string, unknown>,
	key: string,
	code: string,
): string {
	const field = value[key];
	if (typeof field !== "string" || field.trim() === "") {
		throw new PreflightRuntimeError(code, `CDP response is missing ${key}.`);
	}
	return field;
}

function validateLoopbackWebSocket(url: string, port: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new PreflightRuntimeError(
			"invalid_cdp_version",
			"CDP websocket URL is invalid.",
		);
	}
	if (
		parsed.protocol !== "ws:" ||
		(parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
		parsed.port !== port
	) {
		throw new PreflightRuntimeError(
			"non_loopback_websocket",
			"CDP websocket URL is not pinned to the requested loopback port.",
		);
	}
	// /json/version must advertise the browser-level DevTools target. A page
	// target (/devtools/page/<id>) or any other endpoint is a loopback socket
	// but not browser readiness proof; accepting it would certify a non-browser
	// connection as Warm Chrome.
	if (!parsed.pathname.startsWith("/devtools/browser/")) {
		throw new PreflightRuntimeError(
			"invalid_cdp_version",
			"CDP websocket URL is not a browser-level DevTools target.",
		);
	}
}

function validateChromeCommand(command: string, port: string): void {
	const parsed = parseProcessCommand(command);
	if (isForbiddenChromeBinary(parsed.executable)) {
		throw new PreflightRuntimeError(
			"chrome_for_testing",
			"Warm Chrome requires real Google Chrome, not Chrome for Testing.",
		);
	}
	if (parsed.executable !== DEFAULT_CHROME) {
		throw new PreflightRuntimeError(
			"not_real_google_chrome",
			"CDP listener is not the real Google Chrome app binary.",
		);
	}
	if (!hasRemoteDebuggingPort(parsed.args, port)) {
		throw new PreflightRuntimeError(
			"port_mismatch",
			"Google Chrome listener does not use the requested CDP port.",
		);
	}
}

function validateLaunchChromeBinary(chromeBin: string): void {
	if (isForbiddenChromeBinary(chromeBin)) {
		throw new PreflightRuntimeError(
			"chrome_for_testing",
			"Warm Chrome requires real Google Chrome, not Chrome for Testing.",
			{
				hintSummary: "Use the stable Google Chrome app binary.",
				hintAction: "change_input",
				recoverability: "change_input",
				failureDomain: "input",
			},
		);
	}
	if (chromeBin !== DEFAULT_CHROME) {
		throw new PreflightRuntimeError(
			"not_real_google_chrome",
			"Warm Chrome launch requires the stable Google Chrome app binary.",
			{
				hintSummary: "Use the stable Google Chrome app binary.",
				hintAction: "change_input",
				recoverability: "change_input",
				failureDomain: "input",
			},
		);
	}
}

function isForbiddenChromeBinary(value: string): boolean {
	return (
		value.includes("Chrome for Testing") ||
		value.includes("Chromium.app") ||
		value.includes("chromium") ||
		value.includes("chrome-mac")
	);
}

function extractUserDataDir(command: string): string | null {
	return readCommandFlagValue(
		parseProcessCommand(command).args,
		"--user-data-dir",
	);
}

function readCommandFlagValue(args: string, flag: string): string | null {
	// Chrome resolves repeated switches last-wins, so scan every occurrence and
	// keep the last non-empty value rather than returning on the first match.
	let searchFrom = 0;
	let resolved: string | null = null;
	while (searchFrom < args.length) {
		const flagIndex = args.indexOf(flag, searchFrom);
		if (flagIndex === -1) break;
		const before = args[flagIndex - 1];
		const after = args[flagIndex + flag.length];
		const startsToken = flagIndex === 0 || /\s/.test(before);
		if (startsToken && (after === "=" || (after && /\s/.test(after)))) {
			if (after === "=") {
				// Equals form: the bytes after = are the value verbatim, even if
				// they begin with "--" (a profile path may legitimately do so).
				const value = readCommandValue(args, flagIndex + flag.length + 1);
				if (value !== "") resolved = value;
			} else {
				// Space-separated form: if the next token is itself a "--" flag,
				// the flag had no value (e.g. `--user-data-dir --no-first-run`).
				// Do not consume the following flag as the value.
				const valueStart = skipWhitespace(args, flagIndex + flag.length);
				if (!args.slice(valueStart).startsWith("--")) {
					const value = readCommandValue(args, valueStart);
					if (value !== "") resolved = value;
				}
			}
		}
		searchFrom = flagIndex + flag.length;
	}
	return resolved;
}

function skipWhitespace(input: string, index: number): number {
	let current = index;
	while (current < input.length && /\s/.test(input[current])) {
		current += 1;
	}
	return current;
}

function readCommandValue(input: string, start: number): string {
	const quote = input[start];
	if (quote === '"' || quote === "'") {
		let value = "";
		let escaping = false;
		for (let index = start + 1; index < input.length; index += 1) {
			const char = input[index];
			if (escaping) {
				value += char;
				escaping = false;
				continue;
			}
			if (char === "\\") {
				escaping = true;
				continue;
			}
			if (char === quote) return value;
			value += char;
		}
		return value;
	}
	const nextFlagIndex = findNextCommandFlag(input, start);
	return input.slice(start, nextFlagIndex ?? input.length).trim();
}

function findNextCommandFlag(input: string, start: number): number | null {
	let quote: '"' | "'" | null = null;
	let escaping = false;
	for (let index = start; index < input.length; index += 1) {
		const char = input[index];
		if (escaping) {
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char) && input.slice(skipWhitespace(input, index)).startsWith("--")) {
			return index;
		}
	}
	return null;
}

function hasRemoteDebuggingPort(args: string, port: string): boolean {
	const tokens = tokenizeCommandArgs(args);
	return tokens.some((token, index) => {
		if (token === `--remote-debugging-port=${port}`) return true;
		return token === "--remote-debugging-port" && tokens[index + 1] === port;
	});
}

function parseProcessCommand(command: string): { executable: string; args: string } {
	const trimmed = command.trim();
	// Fast-path only on an exact match, or when the Chrome path is followed by
	// flag arguments (whitespace then a "--" token). Without this, a superstring
	// executable like `.../Google Chrome Helper` starts with DEFAULT_CHROME and
	// would be pinned to DEFAULT_CHROME, certifying a non-stable binary as real
	// Chrome. A trailing bare word (`Helper`) means a different executable, so
	// fall through to the generic parse where the `!== DEFAULT_CHROME` check fires.
	if (trimmed === DEFAULT_CHROME) {
		return { executable: DEFAULT_CHROME, args: "" };
	}
	if (trimmed.startsWith(DEFAULT_CHROME)) {
		const rest = trimmed.slice(DEFAULT_CHROME.length);
		if (/^\s+--/.test(rest)) {
			return { executable: DEFAULT_CHROME, args: rest.trim() };
		}
	}
	const quoted = parseQuotedCommandExecutable(trimmed);
	if (quoted) return quoted;
	const firstOptionIndex = trimmed.search(/\s--/);
	if (firstOptionIndex >= 0) {
		return {
			executable: trimmed.slice(0, firstOptionIndex).trim(),
			args: trimmed.slice(firstOptionIndex).trim(),
		};
	}
	const [firstToken = ""] = tokenizeCommandArgs(trimmed);
	return {
		executable: firstToken,
		args: trimmed.slice(firstToken.length).trim(),
	};
}

function parseQuotedCommandExecutable(
	command: string,
): { executable: string; args: string } | null {
	const quote = command[0];
	if (quote !== '"' && quote !== "'") return null;
	let executable = "";
	for (let index = 1; index < command.length; index += 1) {
		const char = command[index];
		if (char === quote) {
			return {
				executable,
				args: command.slice(index + 1).trim(),
			};
		}
		executable += char;
	}
	return null;
}

function tokenizeCommandArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let escaping = false;
	const pushCurrent = () => {
		if (current !== "") {
			tokens.push(current);
			current = "";
		}
	};

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			pushCurrent();
			continue;
		}
		current += char;
	}
	if (escaping) current += "\\";
	pushCurrent();
	return tokens;
}

async function validateProfilePath(
	profilePath: string,
	runtime: PreflightRuntime,
	options: ProfilePathValidationOptions = {},
): Promise<void> {
	const comparisonPath = await pathForComparison(profilePath, runtime);
	const home = runtime.env.HOME;
	let errorOptions: PreflightRuntimeErrorOptions = {};
	if (options.failureDomain === "input") {
		errorOptions = inputChangeOptions(
			"Choose a dedicated persistent Warm Chrome profile.",
		);
	} else if (options.failureDomain) {
		errorOptions = { failureDomain: options.failureDomain };
	}
	if (home) {
		const defaultProfileRoot = await pathForComparison(
			join(home, "Library/Application Support/Google/Chrome"),
			runtime,
		);
		if (
			comparisonPath === defaultProfileRoot ||
			comparisonPath.startsWith(`${defaultProfileRoot}/`)
		) {
			throw new PreflightRuntimeError(
				"default_profile",
				"Warm Chrome cannot use the everyday default Chrome profile.",
				errorOptions,
			);
		}
	}
	if (runtime.isTemporaryPath(profilePath) || runtime.isTemporaryPath(comparisonPath)) {
		throw new PreflightRuntimeError(
			"throwaway_profile",
			"Warm Chrome profile must be persistent.",
			errorOptions,
		);
	}
}

async function pathForComparison(
	path: string,
	runtime: PreflightRuntime,
): Promise<string> {
	const profile = await maybeStatProfile(path, runtime);
	if (profile) return profile.realPath;
	return pathThroughExistingParent(path, runtime);
}

async function pathThroughExistingParent(
	path: string,
	runtime: PreflightRuntime,
): Promise<string> {
	const absolutePath = resolve(path);
	let current = absolutePath;
	const missingSegments: string[] = [];

	while (true) {
		const parent = await maybeStatProfile(current, runtime);
		if (parent) {
			return join(parent.realPath, ...missingSegments.reverse());
		}
		const next = dirname(current);
		if (next === current) return absolutePath;
		missingSegments.push(basename(current));
		current = next;
	}
}

async function maybeStatProfile(
	path: string,
	runtime: PreflightRuntime,
): Promise<ProfileStat | null> {
	try {
		return await runtime.statProfile(path);
	} catch {
		return null;
	}
}

async function requireProfileStat(
	path: string,
	runtime: PreflightRuntime,
	message: string,
	options: PreflightRuntimeErrorOptions = {},
): Promise<ProfileStat> {
	try {
		return await runtime.statProfile(path);
	} catch {
		throw new PreflightRuntimeError("profile_missing", message, options);
	}
}

async function writeDevToolsActivePort(input: {
	profileDir: string;
	port: string;
	webSocketDebuggerUrl: string;
	runtime: PreflightRuntime;
}): Promise<void> {
	const path = new URL(input.webSocketDebuggerUrl).pathname;
	if (!path.startsWith("/devtools/browser/")) {
		throw new PreflightRuntimeError(
			"invalid_cdp_version",
			"CDP websocket path is not a browser endpoint.",
		);
	}
	await input.runtime.writeTextFile(
		join(input.profileDir, "DevToolsActivePort"),
		`${input.port}\n${path}\n`,
	);
}

function writeSuccess(
	stdout: CliWriter,
	proof: WarmChromeProof,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(
			[
				"browser_ready",
				`command=${proof.command}`,
				`port=${proof.port}`,
				`profile=${proof.profile_dir}`,
				`targets=${proof.target_count}`,
				`repaired=${proof.repair_actions.length > 0}`,
				`launched=${proof.launch_performed}`,
				`run_id=${runtime.runId}`,
				`duration_ms=${runtime.durationMs}`,
			].join(" ") + "\n",
		);
		return;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: proof,
			runtime_actions: [
				runtimeAction("use_verified_endpoint"),
				runtimeAction("rerun_preflight_before_adapter_action"),
			],
			continuation: {
				next_action_id: "use_verified_endpoint",
			},
		}),
		runtime,
	);
}

function emitCliError(input: {
	error: unknown;
	outputMode: OutputMode;
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	durationMs: number;
}): number {
	const error = normalizeError(input.error);
	emitCliDiagnostic("browser-use.warm-chrome", "error", error.code, {
		code: error.code,
		exit_code: error.exitCode,
		duration_ms: getCliDiagnosticDurationMs(),
	});
	const guidance = guidanceForError(error);

	if (input.outputMode === "plain") {
		const line = `${guidance.failureDomain} ${error.code}: ${error.message} action=${guidance.continuation.next_action_id} (run_id=${input.runId})\n`;
		input.stderr.write(line);
		return error.exitCode;
	}

	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeErrorEnvelope({
			run_id: input.runId,
			process_exit_code: error.exitCode,
			error: {
				run_id: input.runId,
				code: error.code,
				message: error.message,
				exit_code: error.exitCode,
				severity: error.severity,
				recoverability: error.recoverability,
				retryable: false,
				failure_domain: guidance.failureDomain,
				hint: {
					summary: error.hintSummary,
					action: error.hintAction,
					...(error.hintDocsUrl ? { docs_url: error.hintDocsUrl } : {}),
				},
			},
			runtime_actions: guidance.runtimeActions,
			continuation: guidance.continuation,
		}),
		{ runId: input.runId, durationMs: input.durationMs },
	);
	return error.exitCode;
}

// Last-resort net for a rejection or exception that escapes the run boundary.
// The tool's contract is "every outcome is a structured envelope"; a raw stack
// dump from an unhandled rejection would break it. Funnel the stray error
// through the same normalize/guidance machinery so even a catastrophic escape
// still emits a runtime_failure envelope and a deterministic non-zero exit.
export function emitUnhandledFailureEnvelope(
	error: unknown,
	options: { runId: string; stdout: CliWriter; stderr?: CliWriter },
): number {
	return emitCliError({
		error,
		outputMode: "json",
		stdout: options.stdout,
		stderr: options.stderr ?? quietDiagnosticWriter,
		runId: options.runId,
		durationMs: 0,
	});
}

function normalizeError(error: unknown): {
	code: string;
	message: string;
	exitCode: number;
	severity: "warning" | "error" | "fatal";
	recoverability: "none" | "retry" | "change_input" | "repair_state";
	hintSummary: string;
	hintAction: "retry" | "change_input" | "repair_state" | undefined;
	hintDocsUrl?: string;
	failureDomain: WarmChromeFailureDomain;
	primaryActionId?: "inspect_listener";
	runtimeActions: RuntimeActionGuidance[];
} {
	if (error instanceof CliUsageError) {
		return {
			code: "invalid_usage",
			message: error.options.showMessage
				? sanitizeUsageMessage(error.message)
				: "help requested",
			exitCode: error.options.exitCode ?? USAGE_EXIT_CODE,
			severity: "warning",
			recoverability: "change_input",
			hintSummary: "Fix CLI arguments, then rerun preflight.",
			hintAction: "change_input",
			failureDomain: "input",
			runtimeActions: [],
		};
	}
	if (error instanceof PreflightRuntimeError) {
		const hint = hintForPreflightError(error);
		const recoverability = error.options.recoverability ?? hint.recoverability;
		const failureDomain =
			error.options.failureDomain ?? failureDomainForPreflightError(error);
		const exitCode =
			error.options.exitCode ??
			(failureDomain === "input" ? USAGE_EXIT_CODE : error.exitCode);
		return {
			code: error.code,
			message: error.message,
			exitCode,
			severity: error.options.severity ?? "error",
			recoverability,
			hintSummary: error.options.hintSummary ?? hint.summary,
			hintAction: error.options.hintAction ?? hint.action,
			hintDocsUrl: error.options.hintDocsUrl ?? hint.docsUrl,
			failureDomain,
			primaryActionId: error.options.primaryActionId,
			runtimeActions: [],
		};
	}
	return {
		code: "runtime_failure",
		message: "Warm Chrome Preflight hit an unexpected runtime failure.",
		exitCode: RUNTIME_FAILURE_EXIT_CODE,
		severity: "fatal",
		recoverability: "none",
		hintSummary: "Stop and inspect diagnostics.",
		hintAction: undefined,
		failureDomain: "runtime_diagnostics",
		runtimeActions: [
			runtimeAction("inspect_diagnostics"),
		],
	};
}

function failureDomainForPreflightError(
	error: PreflightRuntimeError,
): WarmChromeFailureDomain {
	if (error.exitCode === RUNTIME_FAILURE_EXIT_CODE) {
		return "runtime_diagnostics";
	}
	switch (error.code) {
		case "non_loopback_endpoint":
		case "profile_mismatch":
			return "input";
		default:
			return "browser_entry_handoff";
	}
}

function sanitizeUsageMessage(message: string): string {
	if (message.startsWith("unexpected argument: ")) {
		return `unexpected argument: ${sanitizeUsageValue(
			message.slice("unexpected argument: ".length),
		)}`;
	}
	if (message.startsWith("unknown option: ")) {
		return `unknown option: ${sanitizeUsageValue(
			message.slice("unknown option: ".length),
		)}`;
	}
	return redactUnsafeText(message);
}

function sanitizeUsageValue(value: string): string {
	if (isUnsafeUsageValue(value)) return "[redacted]";
	return redactUnsafeText(value);
}

function isUnsafeUsageValue(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveOptionName(value)
	);
}

function redactUnsafeText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveOptionName(match) ? "[redacted]" : match,
		)
		.replace(/(^|[\s:(])(?:~\/|\/)\S+/g, "$1[redacted]");
}

function hasSensitiveOptionName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}

function hintForPreflightError(error: PreflightRuntimeError): {
	summary: string;
	action: "retry" | "change_input" | "repair_state" | undefined;
	docsUrl?: string;
	recoverability: "none" | "retry" | "change_input" | "repair_state";
} {
	switch (error.code) {
		case "unsupported_platform":
			return {
				summary: "Stop; Warm Chrome Preflight currently supports macOS only.",
				action: undefined,
				recoverability: "none",
			};
		case "non_loopback_endpoint":
			return {
				summary: "Use a loopback CDP endpoint such as http://127.0.0.1:<port>.",
				action: "change_input",
				recoverability: "change_input",
			};
		case "profile_mismatch":
			return {
				summary: "Use the profile attached to the listener, or choose the matching CDP port.",
				action: "change_input",
				recoverability: "change_input",
			};
		case "default_profile":
		case "throwaway_profile":
			return {
				summary: "Choose a dedicated persistent Warm Chrome profile.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		case "unsafe_profile_permissions":
			return {
				summary: "Run preflight-warm-chrome repair with the same port and profile.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		case "chrome_for_testing":
		case "not_real_google_chrome":
		case "missing_profile":
		case "port_mismatch":
			return {
				summary: "Stop; attach to real Google Chrome with a dedicated persistent profile.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		case "listener_missing":
			return {
				summary: "Inspect the requested port; CDP answered but no local listener was found.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		case "endpoint_unreachable":
			return {
				summary:
					"Remote debugging is off; enable it in chrome://inspect/#remote-debugging, then rerun preflight.",
				action: "repair_state",
				docsUrl: CHROME_REMOTE_DEBUGGING_DOCS_URL,
				recoverability: "repair_state",
			};
		case "profile_missing":
			return {
				summary: "Use preflight-warm-chrome launch with a dedicated persistent profile.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		case "invalid_cdp_version":
		case "non_loopback_websocket":
		case "listener_uninspectable":
			return {
				summary: "Stop and inspect the CDP listener before adapter work.",
				action: "repair_state",
				recoverability: "repair_state",
			};
		default:
			return {
				summary: "Use browser-use to prepare Warm Chrome, then rerun preflight.",
				action: "repair_state",
				recoverability: "repair_state",
			};
	}
}

// Wrong-browser readiness failures: a non-Google Chrome is the thing the agent
// would run. These can land in the `input` domain (the caller supplied a bad
// --chrome/CHROME_BIN) yet still carry the same cold-browser/adapter-fallback
// temptation as a browser_entry_handoff. Guard them regardless of domain so an
// agent never reads "input was wrong" as permission to drive the wrong Chrome.
const WRONG_BROWSER_CODES = new Set(["chrome_for_testing", "not_real_google_chrome"]);

// Single predicate that owns the no_adapter_fallback decision. The constraint
// is a property of "preflight failed and there's a tempting wrong browser to
// fall back to", not of the failure_domain label alone.
function forbidsAdapterFallback(error: ReturnType<typeof normalizeError>): boolean {
	return (
		error.failureDomain === "browser_entry_handoff" ||
		WRONG_BROWSER_CODES.has(error.code)
	);
}

function guidanceForError(error: ReturnType<typeof normalizeError>): {
	failureDomain: WarmChromeFailureDomain;
	runtimeActions: RuntimeActionGuidance[];
	continuation: RuntimeContinuationGuidance & { next_action_id: string };
} {
	const runtimeActions =
		error.runtimeActions.length > 0
			? error.runtimeActions
			: [primaryRuntimeActionForError(error)];
	const nextActionId = runtimeActions[0]?.id;
	if (!nextActionId) {
		throw new Error("Warm Chrome guidance must emit one runtime action.");
	}
	return {
		failureDomain: error.failureDomain,
		runtimeActions,
		continuation: {
			next_action_id: nextActionId,
			...(forbidsAdapterFallback(error)
				? {
						constraints: [
							{
								id: "no_adapter_fallback",
								summary:
									"Do not switch adapters or use a cold browser after Warm Chrome preflight failure.",
								forbidden_action_ids: [
									"adapter_fallback",
									"cold_browser_fallback",
								],
							},
						],
					}
				: {}),
		},
	};
}

function runtimeAction(
	id: WarmChromeRuntimeActionId,
): WarmChromeRuntimeActionGuidance {
	const action = warmChromeRuntimeActionById.get(id);
	if (!action) {
		throw new Error(`Unknown Warm Chrome runtime action: ${id}`);
	}
	return {
		id,
		summary: action.summary,
		side_effects: [...action.sideEffects] as RuntimeActionGuidance["side_effects"],
	};
}

function primaryRuntimeActionForError(error: ReturnType<typeof normalizeError>): {
	id: WarmChromeRuntimeActionId;
	summary: string;
	side_effects: RuntimeActionGuidance["side_effects"];
} {
	if (error.failureDomain === "runtime_diagnostics") {
		return runtimeAction("inspect_diagnostics");
	}
	// An explicit per-error override wins when the code alone is ambiguous
	// (e.g. endpoint_unreachable after Chrome spawned: inspect that listener).
	if (error.primaryActionId === "inspect_listener") {
		return runtimeAction("inspect_listener");
	}
	if (
		error.recoverability === "change_input" &&
		error.failureDomain === "input"
	) {
		return runtimeAction("change_input");
	}
	switch (error.code) {
		case "endpoint_unreachable":
			return runtimeAction("enable_remote_debugging");
		case "unsafe_profile_permissions":
			return runtimeAction("repair_profile");
		case "profile_mismatch":
		case "non_loopback_endpoint":
			return runtimeAction("change_input");
		case "listener_missing":
		case "chrome_for_testing":
		case "default_profile":
		case "throwaway_profile":
		case "invalid_cdp_version":
		case "missing_profile":
		case "non_loopback_websocket":
		case "listener_uninspectable":
		case "not_real_google_chrome":
		case "port_mismatch":
			return runtimeAction("inspect_listener");
		default:
			return runtimeAction("launch_warm_chrome");
	}
}

function renderHelp(command?: WarmChromePreflightCommand): string {
	if (command) return renderCommandUsage(warmChromePreflightContracts[command]);
	const commandLines = Object.entries(warmChromePreflightContracts).map(
		([name, contract]) => `  ${name.padEnd(8)} ${contract.summary}`,
	);
	return [
		"Usage: preflight-warm-chrome <command> [flags]",
		"",
		"Commands:",
		...commandLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
	].join("\n");
}

function findCommand(
	argv: readonly string[],
): WarmChromePreflightCommand | undefined {
	return argv.find(isWarmChromeCommand);
}

function isWarmChromeCommand(
	value: string | undefined,
): value is WarmChromePreflightCommand {
	return (
		value === "check" ||
		value === "repair" ||
		value === "launch" ||
		value === "status"
	);
}

function expandHome(path: string, runtime: PreflightRuntime): string {
	if (path === "~") return runtime.env.HOME ?? path;
	if (path.startsWith("~/")) {
		const home = runtime.env.HOME;
		return home ? join(home, path.slice(2)) : path;
	}
	return path;
}

async function statProfile(path: string): Promise<ProfileStat> {
	const realPath = await realpath(path);
	const info = await stat(realPath);
	if (!info.isDirectory()) {
		throw new Error("profile is not a directory");
	}
	return {
		realPath,
		mode: (info.mode & 0o777).toString(8),
		owner: String(info.uid),
	};
}

async function ensureProfileDir(path: string): Promise<string> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const realPath = await realpath(path);
	await chmod(realPath, 0o700);
	return realPath;
}

// Minimal slice of ChildProcess we depend on, so a plain EventEmitter can drive
// the lifecycle under test without spawning a real process.
type SpawnableChild = {
	once(event: string, listener: (...args: unknown[]) => void): unknown;
	unref?(): void;
};

// `child.once("error")` only fires for spawn *failure* (ENOENT, EACCES). A Chrome
// that spawns then dies milliseconds later emits "exit", not "error" — without an
// exit listener that death is silent and the caller polls a dead endpoint for the
// full 15s timeout. Reject on a pre-spawn exit so post-launch death surfaces now.
export function awaitChromeSpawn(child: SpawnableChild): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		child.once("error", (...args: unknown[]) => {
			if (settled) return;
			settled = true;
			reject(args[0] instanceof Error ? args[0] : new Error("Chrome spawn failed."));
		});
		child.once("exit", (...args: unknown[]) => {
			if (settled) return;
			settled = true;
			const code = args[0];
			reject(
				new Error(
					`Chrome exited before its DevTools endpoint came up (exit code ${
						typeof code === "number" ? code : "unknown"
					}).`,
				),
			);
		});
		child.once("spawn", () => {
			if (settled) return;
			settled = true;
			child.unref?.();
			resolve();
		});
	});
}

type ExecText = (command: string, args: string[]) => Promise<string>;

// An lsof/ps that cannot even run (binary missing, permission denied) is an
// environmental fault, not the operational "nothing is listening" answer.
// Collapsing both into null would let a missing lsof masquerade as a free port
// and poison every downstream decision, so probe failures branch on err.code.
function isProbeUnavailableError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

export async function findListenerWithSystemTools(
	port: string,
	exec: ExecText = execText,
): Promise<ListenerProcess | null> {
	let pidOutput = "";
	try {
		pidOutput = await exec("lsof", [
			"-nP",
			`-iTCP:${port}`,
			"-sTCP:LISTEN",
			"-t",
		]);
	} catch (error) {
		// lsof exits non-zero with no error code when nothing is listening — the
		// expected negative result. A real ENOENT/EACCES means we never inspected.
		if (isProbeUnavailableError(error)) {
			throw new PreflightRuntimeError(
				"listener_uninspectable",
				"Could not run the CDP listener probe.",
			);
		}
		return null;
	}
	const pidText = pidOutput
		.split("\n")
		.map((line) => line.trim())
		.find(Boolean);
	if (!pidText) return null;
	let command = "";
	try {
		command = await exec("ps", ["-p", pidText, "-o", "command="]);
	} catch {
		throw new PreflightRuntimeError(
			"listener_uninspectable",
			"Could not inspect the CDP listener process.",
		);
	}
	return { pid: Number(pidText), command: command.trim() };
}

async function execText(command: string, args: string[]): Promise<string> {
	const proc = Bun.spawn([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new Error(stderr || `${command} exited ${exitCode}`);
	}
	return stdout;
}

export async function runForTest(
	argv: readonly string[],
	runtime: PreflightRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const exitCode = await runPreflightWarmChromeCli(argv, {
		runtime,
		stdout,
		stderr,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

export function validateErrorEnvelopeForTest(envelope: unknown): string[] {
	if (
		!envelope ||
		typeof envelope !== "object" ||
		Array.isArray(envelope) ||
		!("error" in envelope)
	) {
		return ["envelope.error missing"];
	}
	const error = (envelope as { error: unknown }).error;
	const runId =
		"run_id" in envelope && typeof envelope.run_id === "string"
			? envelope.run_id
			: undefined;
	const exitCode =
		error && typeof error === "object" && "exit_code" in error
			? (error as { exit_code: unknown }).exit_code
			: undefined;
	return validateStructuredRuntimeError(error, {
		run_id: runId,
		process_exit_code: typeof exitCode === "number" ? exitCode : undefined,
	});
}

function handleUnhandledFailure(error: unknown): never {
	// Configure a minimal diagnostic context so the shared error machinery has a
	// sink; without it emitCliDiagnostic would throw inside the last-resort net.
	try {
		configureCliDiagnostics({
			categoryRoot: "browser-use.warm-chrome",
			options: parseCliDiagnosticFallbackArgv([]).options,
			diagnosticWriter: quietDiagnosticWriter,
		});
	} catch {
		// best effort — never let net-of-last-resort setup mask the real error
	}
	const runId = process.env.BROWSER_USE_RUN_ID ?? "unhandled";
	const exitCode = emitUnhandledFailureEnvelope(error, {
		runId,
		stdout: process.stdout,
		stderr: process.stderr,
	});
	process.exit(exitCode);
}

if (import.meta.main) {
	// Safety net: a rejection or exception escaping runPreflightWarmChromeCli must
	// still emit the structured envelope this tool's contract promises, not a raw
	// stack dump with an ambiguous exit code. CLI, not a server — we always exit.
	process.on("unhandledRejection", (reason) => handleUnhandledFailure(reason));
	process.on("uncaughtException", (error) => handleUnhandledFailure(error));
	const exitCode = await runPreflightWarmChromeCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
