import { spawn } from "node:child_process";
import {
	chmod,
	mkdir,
	readlink,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { userInfo } from "node:os";
import { basename } from "node:path";

import {
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
	type WarmChromeRuntimeActionId,
} from "./model.ts";

/**
 * Numeric browser-entry exit code (plan U2 R3).
 *
 * @defaultValue 20
 */
export const WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER = Number(
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
);

/**
 * The one binary the real-Chrome identity check accepts (plan R6 vocabulary).
 */
export const REAL_GOOGLE_CHROME_BINARY =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" as const;

/**
 * Failure domains the warm-chrome envelopes report (plan U4 R12).
 */
export type WarmChromeFailureDomain =
	| "browser_entry_handoff"
	| "input"
	| "runtime_diagnostics";

/**
 * Envelope-shaping options a thrown runtime error carries to the emitter.
 */
export type WarmChromeRuntimeErrorOptions = {
	exitCode?: number;
	recoverability?: "none" | "change_input" | "repair_state";
	hintSummary?: string;
	hintAction?: "change_input" | "repair_state";
	hintDocsUrl?: string;
	severity?: "warning" | "error" | "fatal";
	failureDomain?: WarmChromeFailureDomain;
	// Override the per-run primary runtime action when the error code alone is
	// ambiguous. `endpoint_unreachable` means "launch" when nothing answers but
	// "inspect" when a real Chrome already occupies the port without CDP.
	primaryActionId?: "inspect_listener";
	/**
	 * Runtime actions appended after the primary. A post-spawn failure whose
	 * reason is a check-failure reason carries that check station's primary
	 * action here so the agent keeps a known-good repair action at the
	 * deepest point in the launch flow.
	 */
	secondaryActionIds?: readonly WarmChromeRuntimeActionId[];
	/**
	 * Structured payload for the error envelope `data` field. Listener detail
	 * must pass through {@link redactListenerDetail} before it lands here —
	 * the emitter trusts this payload as already redacted.
	 */
	data?: Record<string, unknown>;
};

/**
 * Runtime error every warm-chrome command handler throws (plan U4 R12).
 *
 * Defaults to the exit-20 browser-entry handoff; the CLI emitter maps it to a
 * structured error envelope with Runtime Continuation Guidance.
 */
export class WarmChromeRuntimeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly options: WarmChromeRuntimeErrorOptions = {},
	) {
		super(message);
		this.name = "WarmChromeRuntimeError";
	}

	get exitCode(): number {
		return this.options.exitCode ?? WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER;
	}
}

/**
 * Local process listening on a CDP port, as observed by the system probe.
 */
export type ListenerProcess = {
	pid: number;
	command: string;
};

/**
 * Resolved profile directory identity used by the proof chain.
 */
export type ProfileStat = {
	realPath: string;
	mode: string;
	owner: string;
};

/**
 * Handle for a Chrome the runtime spawned (plan U4 seam extension).
 */
export type SpawnedChrome = {
	pid: number;
	kill: () => Promise<boolean>;
};

/**
 * Parsed Chrome `SingletonLock` symlink content (`hostname-pid`), used by the
 * U6 launch pre-bind refusal.
 */
export type SingletonLock = {
	raw: string;
	hostname: string | null;
	pid: number | null;
};

/**
 * Launch input the spawn seam receives.
 */
export type LaunchChromeInput = {
	chromeBin: string;
	port: string;
	profileDir: string;
	startupUrl: string;
};

/**
 * Injectable runtime seam every warm-chrome station drives through (plan U4).
 *
 * Ported from the browser-use preflight `PreflightRuntime` with two deliberate
 * extensions: `spawnChrome` returns a {@link SpawnedChrome} handle instead of
 * `Promise<void>`, and `readSingletonLock` probes the profile lock for the U6
 * launch pre-bind refusal.
 */
export type WarmChromeRuntime = {
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
	spawnChrome: (input: LaunchChromeInput) => Promise<SpawnedChrome>;
	readSingletonLock: (profileDir: string) => Promise<SingletonLock | null>;
	sleep: (ms: number) => Promise<void>;
	isTemporaryPath: (path: string) => boolean;
};

/**
 * Build the default macOS runtime adapter.
 *
 * @param overrides - Seam hooks tests replace for deterministic execution
 * @returns Runtime seam bound to real system tools
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ now: () => 0 })
 * ```
 */
export function createDefaultRuntime(
	overrides: Partial<WarmChromeRuntime> = {},
): WarmChromeRuntime {
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
			const pid = child.pid;
			if (typeof pid !== "number") {
				throw new Error("Chrome spawn reported no pid.");
			}
			return {
				pid,
				kill: async () => child.kill("SIGTERM"),
			};
		},
		readSingletonLock: async (profileDir: string) =>
			readSingletonLock(profileDir),
		sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		isTemporaryPath: (path: string) =>
			path.startsWith("/tmp/") ||
			path.startsWith("/private/tmp/") ||
			path.startsWith("/var/folders/") ||
			path.startsWith("/private/var/folders/"),
		...overrides,
	};
}

/**
 * Expand a leading `~` against the runtime env HOME.
 */
export function expandHome(
	path: string,
	env: Record<string, string | undefined>,
): string {
	if (path === "~") return env.HOME ?? path;
	if (path.startsWith("~/")) {
		const home = env.HOME;
		return home ? `${home}/${path.slice(2)}` : path;
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

async function readSingletonLock(
	profileDir: string,
): Promise<SingletonLock | null> {
	let raw: string;
	try {
		raw = await readlink(`${profileDir}/SingletonLock`);
	} catch {
		return null;
	}
	const separator = raw.lastIndexOf("-");
	if (separator <= 0 || separator === raw.length - 1) {
		return { raw, hostname: null, pid: null };
	}
	const pidText = raw.slice(separator + 1);
	const pid = /^[0-9]+$/.test(pidText) ? Number(pidText) : null;
	return {
		raw,
		hostname: raw.slice(0, separator),
		pid,
	};
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
// full timeout. Reject on a pre-spawn exit so post-launch death surfaces now.
export function awaitChromeSpawn(child: SpawnableChild): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		child.once("error", (...args: unknown[]) => {
			if (settled) return;
			settled = true;
			reject(
				args[0] instanceof Error ? args[0] : new Error("Chrome spawn failed."),
			);
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

/**
 * Default listener probe: lsof for the pid, ps for the command line.
 */
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
			throw new WarmChromeRuntimeError(
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
		throw new WarmChromeRuntimeError(
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

/**
 * Parse a `ps -o command=` line into executable and argument text.
 */
export function parseProcessCommand(command: string): {
	executable: string;
	args: string;
} {
	const trimmed = command.trim();
	// Fast-path only on an exact match, or when the Chrome path is followed by
	// flag arguments (whitespace then a "--" token). Without this, a superstring
	// executable like `.../Google Chrome Helper` starts with the real binary and
	// would be pinned to it, certifying a non-stable binary as real Chrome. A
	// trailing bare word (`Helper`) means a different executable, so fall through
	// to the generic parse where the identity check fires.
	if (trimmed === REAL_GOOGLE_CHROME_BINARY) {
		return { executable: REAL_GOOGLE_CHROME_BINARY, args: "" };
	}
	if (trimmed.startsWith(REAL_GOOGLE_CHROME_BINARY)) {
		const rest = trimmed.slice(REAL_GOOGLE_CHROME_BINARY.length);
		if (/^\s+--/.test(rest)) {
			return { executable: REAL_GOOGLE_CHROME_BINARY, args: rest.trim() };
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

/**
 * Tokenize argument text with shell-style quoting and escapes.
 */
export function tokenizeCommandArgs(input: string): string[] {
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

/**
 * Read the last non-empty value of a repeated `--flag` in argument text
 * (Chrome resolves repeated switches last-wins).
 */
export function readCommandFlagValue(args: string, flag: string): string | null {
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
		if (
			/\s/.test(char) &&
			input.slice(skipWhitespace(input, index)).startsWith("--")
		) {
			return index;
		}
	}
	return null;
}

/**
 * Extract the observed `--user-data-dir` from a listener command line.
 */
export function extractUserDataDir(command: string): string | null {
	return readCommandFlagValue(
		parseProcessCommand(command).args,
		"--user-data-dir",
	);
}

/**
 * Redacted listener identity that is safe for envelopes and diagnostics.
 */
export type RedactedListenerDetail = {
	/** Listener process id. */
	pid: number;
	/** Executable basename only — never a path, never arguments. */
	process: string;
	/** True when the process identity fails the real-Chrome check. */
	foreign: boolean;
	/**
	 * Observed profile directory. Present only for non-foreign real-Chrome
	 * listeners, because the agent needs it to act on `inspect_listener`.
	 */
	user_data_dir?: string;
};

/**
 * Single redaction chokepoint for listener diagnostics (plan U4 R13).
 *
 * Foreign listeners (process identity fails the real-Chrome check) reduce to
 * pid + executable basename: no cmdline arguments, no foreign filesystem
 * paths. A real-Chrome listener with a mismatched profile or port stays
 * non-foreign, so its observed `--user-data-dir` may pass through — the agent
 * needs it to act on `inspect_listener`. All other argument text is dropped
 * for real Chrome too.
 */
export function redactListenerDetail(
	listener: ListenerProcess,
): RedactedListenerDetail {
	const parsed = parseProcessCommand(listener.command);
	if (parsed.executable !== REAL_GOOGLE_CHROME_BINARY) {
		return {
			pid: listener.pid,
			process: safeProcessBasename(parsed.executable),
			foreign: true,
		};
	}
	const userDataDir = extractUserDataDir(listener.command);
	return {
		pid: listener.pid,
		process: safeProcessBasename(REAL_GOOGLE_CHROME_BINARY),
		foreign: false,
		...(userDataDir === null ? {} : { user_data_dir: userDataDir }),
	};
}

function safeProcessBasename(executable: string): string {
	const name = basename(executable);
	return name === "" ? "unknown" : name;
}

const WS_URL_PATTERN = /wss?:\/\/[^\s"'\\)\]}]+/gi;

/**
 * Reduce a CDP `webSocketDebuggerUrl` to its path prefix (plan U4 R13).
 *
 * The trailing path segment is the browser capability token; diagnostic sinks
 * have weaker access control than the primary JSON output channel, so only
 * the prefix (e.g. `/devtools/browser/`) may enter a diagnostic event.
 */
export function redactWsUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "[redacted-ws-url]";
	}
	const pathname = parsed.pathname;
	const lastSlash = pathname.lastIndexOf("/");
	return pathname.slice(0, lastSlash + 1);
}

/**
 * Replace every websocket URL in free text with its redacted path prefix.
 */
export function redactWsUrlsInText(text: string): string {
	return text.replace(WS_URL_PATTERN, (match) => redactWsUrl(match));
}

/**
 * Deep-walk a diagnostic payload and redact every websocket URL string.
 *
 * Wired into the CLI diagnostic redactor so LogTape emits and post-mortem
 * buffer flushes can never carry a full `webSocketDebuggerUrl`, even when a
 * call site forgets to redact before emitting.
 */
export function redactWsUrlsDeep(value: unknown): unknown {
	if (typeof value === "string") return redactWsUrlsInText(value);
	if (Array.isArray(value)) {
		return value.map((entry) => redactWsUrlsDeep(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				redactWsUrlsDeep(entry),
			]),
		);
	}
	return value;
}
