// @side-quest/mcporter-transport — the one owner of the no-shell argv
// transport contract (browser-use migration plan KTD5).
//
// One source of truth for the command-vector contract every consuming surface
// (browser-use Browser Operations, browser-connect adapter probes/installer)
// runs external commands through:
//   - Command vectors are JSON arrays of non-empty strings resolved through an
//     explicit per-surface env channel. No shell strings, no automatic
//     package-runner fallback, never shell-eval command input.
//   - Spawn passes argv positionally with a bounded timeout; a missing binary
//     surfaces as an exit-127 result mapped to dependency-missing recovery.
//
// This module stays surface-neutral: resolution and execution return
// discriminated unions, never throw a surface-specific error class. Each caller
// maps a neutral reason onto its own runtime-error envelope so each consuming
// surface keeps its distinct failure taxonomy while sharing the transport
// semantics. The env channel itself (variable name, default command, override
// examples) is caller-owned input — browser-use keeps
// BROWSER_USE_MCPORTER_COMMAND_JSON; nothing here hardcodes it.

// Native Chrome DevTools MCP transport — parity checklist for V2 (plan U4).
//
// MVP ships ONE transport: the mcporter command vector consumers configure via
// their channel. Native transport selection (running Chrome DevTools MCP
// directly, without mcporter as the runner) is explicitly deferred. Before
// adding a native transport in V2, prove each item so the two transports cannot
// silently diverge:
//
//   1. Command-vector parity — native selection resolves a launch vector through
//      the same JSON-array override contract (no shell strings, no auto package
//      runner). A new env channel, if any, mirrors this validation exactly.
//   2. Diagnostic parity — missing native binary maps to the same
//      dependency-missing recovery family (never Warm Chrome repair or adapter
//      fallback); a malformed native override maps to the same override-invalid
//      family.
//   3. Loopback/binding parity — native selection still binds to the verified
//      loopback Warm Chrome endpoint; it does not introduce a non-loopback or
//      auto-connect path that bypasses the verified-handoff binding checks.
//   4. No-shell-eval parity — native launch passes argv positionally; override
//      and argument input are never shell-evaluated.
//   5. Privacy parity — native output redaction matches mcporter output: no raw
//      adapter page ids, CDP target ids, WebSocket debugger URLs, query strings,
//      or fragments in JSON, logs, or diagnostics.
//   6. Selection determinism — when both transports are configured, selection is
//      explicit and evidence-driven, not implicit "latest" or PATH probing.
//   7. Parity tests — every consuming surface exercises the native transport
//      through the same shared seam, the way Browser Operation shares this
//      mcporter transport today.
//
// Until all seven hold, native transport selection stays out of scope.

export type TransportCommandVector = readonly [string, ...string[]];

/**
 * A surface-owned override channel: which env variable carries the JSON-array
 * command-vector override, what the default vector is when the variable is
 * unset, and the override examples diagnostics quote. Each consuming surface
 * declares its own channel (browser-use owns BROWSER_USE_MCPORTER_COMMAND_JSON)
 * so the shared contract never hardcodes one surface's variable.
 */
export type TransportCommandChannel = {
	envVarName: string;
	defaultCommand: TransportCommandVector;
	overrideExamples: string;
};

/**
 * Bounded, no-shell command invocation. `command` + `args` are passed
 * positionally to the runtime spawner; nothing is ever joined into a shell
 * string, so injected endpoints and arguments are never shell-evaluated.
 * `cwd`, `env`, `exactEnv`, and `detached` are optional knobs the
 * browser-connect isolated-installer boundary uses; plain transports omit them.
 */
export type TransportCommandInput = {
	command: string;
	args: readonly string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
	/**
	 * When true, `env` is the child's EXACT environment — never merged over
	 * `process.env` (R28: an installer's allowlist is authoritative). Default
	 * false: `env` merges over the inherited environment.
	 */
	exactEnv?: boolean;
	/**
	 * When true, the child becomes its own process-group leader and the timeout
	 * kill reaps the ENTIRE group, so no straggler child outlives the SIGKILL.
	 * Default false: the timeout kills only the direct child.
	 */
	detached?: boolean;
	timeoutMs: number;
};

/**
 * Result of a bounded command invocation. `exitCode` 127 (or a
 * spawn-failure-shaped result) signals the resolved binary was not found.
 */
export type TransportCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

// Structural minimum every consuming surface's runtime already satisfies.
// Keeps the transport from depending on heavier surface runtime shapes.
export type TransportRuntime = {
	env: Record<string, string | undefined>;
	runCommand: (input: TransportCommandInput) => Promise<TransportCommandResult>;
};

export type ResolveTransportCommandResult =
	| { ok: true; vector: TransportCommandVector }
	| { ok: false; reason: "invalid_override"; message: string };

// Parse the channel's JSON-array override into a command vector, or report why
// it is invalid. Pure over env: no side effects, never throws. A missing
// override resolves to the channel's default vector. Every malformed shape
// (non-JSON, non-array, empty array, non-string member, blank member) yields a
// stable invalid_override reason so every surface emits the same diagnostic
// family.
export function resolveTransportCommandVector(
	channel: TransportCommandChannel,
	env: Record<string, string | undefined>,
): ResolveTransportCommandResult {
	const rawOverride = env[channel.envVarName];
	if (rawOverride === undefined) {
		return { ok: true, vector: channel.defaultCommand };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawOverride);
	} catch {
		return {
			ok: false,
			reason: "invalid_override",
			message: `${channel.envVarName} must be a JSON array of non-empty strings.`,
		};
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return {
			ok: false,
			reason: "invalid_override",
			message: `${channel.envVarName} must be a non-empty JSON array of strings.`,
		};
	}
	const vector: string[] = [];
	for (const value of parsed) {
		if (typeof value !== "string" || value.trim() === "") {
			return {
				ok: false,
				reason: "invalid_override",
				message: `${channel.envVarName} entries must be non-empty strings.`,
			};
		}
		vector.push(value.trim());
	}
	const [command, ...args] = vector;
	return { ok: true, vector: [command, ...args] };
}

export type RunTransportCommandResult =
	| { ok: true; result: TransportCommandResult }
	| { ok: false; reason: "invalid_override"; message: string }
	| { ok: false; reason: "command_not_started"; command: string; error: unknown }
	| { ok: false; reason: "execution_failed"; command: string; error: unknown };

// True when a thrown error definitively signals the resolved command could not
// be started (missing binary / spawn failure), versus an opaque failure raised
// while the command was already running. Node/Bun surface start failures as
// ENOENT (and related spawn errnos); the message fallback covers runtimes that
// throw a plain Error.
function isStartFailureError(error: unknown): boolean {
	if (error && typeof error === "object") {
		const code = (error as { code?: unknown }).code;
		if (
			code === "ENOENT" ||
			code === "EACCES" ||
			code === "ENOTDIR" ||
			code === "EPERM"
		) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error ?? "");
	return /(command not found|not found|ENOENT|No such file or directory|spawn\b)/i.test(
		message,
	);
}

// Resolve the channel's override, prefix the command vector, and run the
// subcommand through the runtime's structured command runner. The argv vector is
// passed positionally to the runtime — it is never joined into a shell string,
// so override or argument input is never shell-evaluated.
//
// The default runtime (spawnTransportCommand) never throws: a missing binary
// becomes an exit-127 result and a timeout a timedOut result, both handled by
// callers from the ok:true branch. A custom TransportRuntime.runCommand override
// may still throw, so a throw is classified rather than collapsed: a definitive
// spawn/start failure is command_not_started (route to dependency recovery);
// any other throw (an override bug, cancellation, unexpected I/O fault) is
// execution_failed and carries the original error rather than being mislabelled
// as a missing binary.
export async function runTransportCommand(
	channel: TransportCommandChannel,
	runtime: TransportRuntime,
	args: readonly string[],
	timeoutMs: number,
): Promise<RunTransportCommandResult> {
	const resolved = resolveTransportCommandVector(channel, runtime.env);
	if (!resolved.ok) return resolved;

	const [command, ...baseArgs] = resolved.vector;
	try {
		const result = await runtime.runCommand({
			command,
			args: [...baseArgs, ...args],
			timeoutMs,
		});
		return { ok: true, result };
	} catch (error) {
		if (isStartFailureError(error)) {
			return { ok: false, reason: "command_not_started", command, error };
		}
		return { ok: false, reason: "execution_failed", command, error };
	}
}

// True when a command result signals the resolved binary (or its runner) was not
// found, rather than a clean non-zero exit. Shared so every surface routes a
// missing binary to dependency recovery identically.
export function isMissingTransportCommandResult(
	result: TransportCommandResult,
): boolean {
	const text = `${result.stderr}\n${result.stdout}`;
	return (
		result.exitCode === 127 ||
		/(command not found|not found|ENOENT|No such file or directory)/i.test(text)
	);
}

// Diagnostic hint text shared by every consuming surface. Keeping the wording
// here means the "choose one; does not auto-try package runners" guidance and
// the override examples cannot drift between consumers.
export function transportDependencyHintText(
	channel: TransportCommandChannel,
	problem: string,
): string {
	return `${problem} Expose ${channel.defaultCommand[0]} on PATH, or set ${channel.envVarName} to a JSON array command vector. Examples: ${channel.overrideExamples}. Choose one; this transport does not auto-try package runners.`;
}

export function transportOverrideInvalidHintText(
	channel: TransportCommandChannel,
	message: string,
): string {
	return `${message} Use a command vector such as ${channel.overrideExamples}. This transport does not auto-try package runners.`;
}

// Spawn a command without a shell. Mirrors the bounded-timeout, piped-output
// runner consumers use as their default runtime.runCommand. Lives here so a
// single implementation backs every consuming surface.
export async function spawnTransportCommand(
	input: TransportCommandInput,
): Promise<TransportCommandResult> {
	if (input.exactEnv === true && input.env === undefined) {
		// Fail closed (R28): exactEnv with no env would fall through to full
		// process.env inheritance — the exact leak the flag exists to prevent.
		throw new Error(
			"spawnTransportCommand: exactEnv requires an explicit env allowlist",
		);
	}
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([input.command, ...input.args], {
			stdout: "pipe",
			stderr: "pipe",
			// An isolated installer passes a neutral cwd and an EXACT allowlisted
			// environment (`exactEnv`, R28) — never merged over process.env, so no
			// inherited registry, auth, or proxy value can leak. Probes keep the
			// merge-over-inherited behavior. stdin is never inherited: no prompt.
			...(input.cwd === undefined ? {} : { cwd: input.cwd }),
			env: input.env
				? input.exactEnv === true
					? stripUndefined(input.env)
					: { ...process.env, ...stripUndefined(input.env) }
				: undefined,
			stdin: "ignore",
			// Own process group (POSIX `setsid` via Bun >= 1.3 `detached`): the
			// timeout kill below can then reap the ENTIRE group — an installer's
			// own children included — so no straggler outlives the SIGKILL and
			// keeps writing into staging during cleanup. Completion still awaits
			// only the direct child; the trade-off is that a detached child no
			// longer receives the parent terminal's signals (e.g. Ctrl-C), which
			// bounded timeouts already cover.
			...(input.detached === true ? { detached: true } : {}),
		});
	} catch {
		return {
			exitCode: 127,
			stdout: "",
			stderr: `${input.command}: command not found`,
		};
	}
	const completion = Promise.all([
		new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
		new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
		proc.exited,
	]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = new Promise<TransportCommandResult>((resolve) => {
		timeout = setTimeout(() => {
			if (input.detached === true) {
				// The child is its own process-group leader (`detached` above), so
				// signal the GROUP (negative pid): the child's own children die with
				// it instead of surviving a direct-child-only SIGKILL. Fall back to
				// the direct child if the group signal fails (already exited).
				try {
					process.kill(-proc.pid, "SIGKILL");
				} catch {
					try {
						proc.kill("SIGKILL");
					} catch {
						// Best effort. Timeout result still preserves bounded CLI behavior.
					}
				}
			} else {
				try {
					proc.kill("SIGKILL");
				} catch {
					// Best effort. Timeout result still preserves bounded CLI behavior.
				}
			}
			resolve({ exitCode: 1, stdout: "", stderr: "", timedOut: true });
		}, input.timeoutMs);
	});
	try {
		return await Promise.race([completion, timeoutResult]);
	} finally {
		if (timeout) clearTimeout(timeout);
		completion.catch(() => undefined);
	}
}

function stripUndefined(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}
