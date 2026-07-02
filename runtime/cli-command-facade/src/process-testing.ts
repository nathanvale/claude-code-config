import { spawn } from "node:child_process";

/**
 * Default subprocess timeout for facade-backed CLI integration tests.
 *
 * Long enough for local command startup, short enough that a hung child reports
 * the invocation that stalled before a test block times out.
 *
 * @defaultValue 15000
 */
export const DEFAULT_CLI_PROCESS_TIMEOUT_MS = 15_000;

/**
 * Input for one package-owned CLI process invocation.
 *
 * @example
 * ```typescript
 * const result = await runCliProcess({
 *   label: "demo --json",
 *   argv: ["bun", "run", "src/demo.ts", "--json"],
 *   cwd: process.cwd(),
 * })
 * ```
 */
export interface CliProcessCommand {
	/** Human-readable case label included in failure annotations. */
	label: string;
	/** Full executable argv, including the command at index 0. */
	argv: readonly string[];
	/** Working directory used for the child process. */
	cwd: string;
	/** Optional text or bytes written to stdin before waiting for exit. */
	stdin?: string | Uint8Array;
	/** Per-process timeout in milliseconds. @defaultValue 15000 */
	timeoutMs?: number;
	/** Environment passed to the child. @defaultValue process.env */
	env?: NodeJS.ProcessEnv;
	/** Signal used when the timeout fires. @defaultValue "SIGKILL" */
	killSignal?: NodeJS.Signals;
}

/**
 * Captured result from one package-owned CLI process invocation.
 *
 * @example
 * ```typescript
 * if (result.timedOut) throw new Error(describeCliProcessRun(result))
 * ```
 */
export interface CliProcessResult {
	/** Human-readable case label supplied by the caller. */
	label: string;
	/** Full executable argv, including the command at index 0. */
	argv: readonly string[];
	/** Working directory used for the child process. */
	cwd: string;
	/** Process exit code, or null when the helper killed a timeout. */
	exitCode: number | null;
	/** Captured stdout as UTF-8 text. */
	stdout: string;
	/** Captured stderr as UTF-8 text. */
	stderr: string;
	/** True when the timeout fired and the helper killed the process. */
	timedOut: boolean;
	/** Signal reported by the child process, when available. */
	signal: NodeJS.Signals | null;
	/** Timeout budget applied to this invocation. */
	timeoutMs: number;
}

/**
 * Run a CLI subprocess and return captured streams plus timeout state.
 *
 * The helper captures process-boundary mechanics only. Package tests still own
 * command builders, fixtures, setup, and domain assertions.
 *
 * @param command - Command label, argv, cwd, stdin, and timeout settings
 * @returns Captured process result; non-zero exits and timeouts do not throw
 * @throws When `argv` is empty
 *
 * @example
 * ```typescript
 * const result = await runCliProcess({
 *   label: "health --json",
 *   argv: ["bun", "run", "src/health.ts", "--json"],
 *   cwd: process.cwd(),
 *   stdin: "",
 * })
 * ```
 */
export async function runCliProcess(
	command: CliProcessCommand,
): Promise<CliProcessResult> {
	const [executable, ...args] = command.argv;
	if (!executable) {
		throw new Error("CLI process command argv must include an executable.");
	}
	const timeoutMs = command.timeoutMs ?? DEFAULT_CLI_PROCESS_TIMEOUT_MS;
	const killSignal = command.killSignal ?? "SIGKILL";
	const child = spawn(executable, args, {
		cwd: command.cwd,
		env: command.env ?? process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let spawnError: Error | null = null;
	const timeout =
		timeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					child.kill(killSignal);
				}, timeoutMs)
			: null;

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		stderr += String(chunk);
	});
	child.on("error", (error) => {
		spawnError = error;
	});
	child.stdin.on("error", () => {
		// Child exits can race stdin writes. The exit code/stderr remain the signal.
	});

	if (command.stdin === undefined) {
		child.stdin.end();
	} else {
		child.stdin.end(command.stdin);
	}

	return new Promise((resolve) => {
		child.on("close", (exitCode, signal) => {
			if (timeout) clearTimeout(timeout);
			const spawnErrorText = spawnError ? formatSpawnError(spawnError) : "";
			resolve({
				label: command.label,
				argv: [...command.argv],
				cwd: command.cwd,
				exitCode: timedOut ? null : exitCode,
				stdout,
				stderr: spawnErrorText ? appendWithNewline(stderr, spawnErrorText) : stderr,
				timedOut,
				signal,
				timeoutMs,
			});
		});
	});
}

/**
 * Return a compact process context block for assertion failures.
 *
 * @param result - Captured process result
 * @param options - Output excerpt settings
 * @returns Multiline context block with label, cwd, argv, exit, and streams
 *
 * @example
 * ```typescript
 * expect(result.exitCode, describeCliProcessRun(result)).toBe(0)
 * ```
 */
export function describeCliProcessRun(
	result: CliProcessResult,
	options: { excerptLimit?: number } = {},
): string {
	const excerptLimit = options.excerptLimit ?? 600;
	return [
		`label=${result.label}`,
		`cwd=${result.cwd}`,
		`argv=${JSON.stringify(result.argv)}`,
		`exit=${result.exitCode}`,
		result.timedOut ? "timedOut=true" : null,
		result.signal ? `signal=${result.signal}` : null,
		`stdout=${JSON.stringify(excerpt(result.stdout, excerptLimit))}`,
		`stderr=${JSON.stringify(excerpt(result.stderr, excerptLimit))}`,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Parse a JSON envelope from process stdout with process context on failure.
 *
 * @param result - Captured process result with stdout to parse
 * @returns Parsed JSON value
 * @throws SyntaxError wrapped with process context when stdout is not valid JSON
 *
 * @example
 * ```typescript
 * const envelope = parseCliProcessJson<{ status: string }>(result)
 * ```
 */
export function parseCliProcessJson<T = unknown>(result: CliProcessResult): T {
	try {
		return JSON.parse(result.stdout) as T;
	} catch (error) {
		throw new Error(
			`Failed to parse CLI process JSON:\n${describeCliProcessRun(result)}\nparseError=${errorMessage(
				error,
			)}`,
			{ cause: error },
		);
	}
}

function excerpt(value: string, limit: number): string {
	const trimmed = value.trimEnd();
	if (trimmed.length <= limit) return trimmed;
	return `${trimmed.slice(0, limit)}... [${trimmed.length - limit} more chars]`;
}

function appendWithNewline(value: string, suffix: string): string {
	const separator = value === "" || value.endsWith("\n") ? "" : "\n";
	return `${value}${separator}${suffix}`;
}

function formatSpawnError(error: Error): string {
	return `spawnError=${error.message}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
