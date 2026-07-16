#!/usr/bin/env bun

// Shared mcporter transport runner (plan 2026-06-04-001, U4).
//
// One source of truth for the `mcporter` command-vector contract that Browser
// Operation execution (browser-use.ts) runs through. AE10: every consuming
// surface resolves and prefixes the command vector with identical semantics.
//
// Hard contract:
//   - The only override channel is BROWSER_USE_MCPORTER_COMMAND_JSON, a JSON
//     array of non-empty strings. No shell strings, no automatic package-runner
//     fallback, never shell-eval command input.
//   - Default command is the bare `mcporter` vector.
//
// This module stays surface-neutral: resolution and execution return
// discriminated unions, never throw a surface-specific error class. Each caller
// maps a neutral reason onto its own runtime-error envelope so Adapter Proof and
// Browser Operation keep their distinct failure taxonomies while sharing the
// transport semantics.

// Native Chrome DevTools MCP transport — parity checklist for V2 (plan U4).
//
// MVP ships ONE transport: the mcporter command vector below. Native transport
// selection (running Chrome DevTools MCP directly, without mcporter as the
// runner) is explicitly deferred. Before adding a native transport in V2, prove
// each item so the two transports cannot silently diverge:
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
//      auto-connect path that bypasses Adapter Proof binding checks.
//   4. No-shell-eval parity — native launch passes argv positionally; override
//      and argument input are never shell-evaluated.
//   5. Privacy parity — native output redaction matches mcporter output: no raw
//      adapter page ids, CDP target ids, WebSocket debugger URLs, query strings,
//      or fragments in JSON, logs, or diagnostics.
//   6. Selection determinism — when both transports are configured, selection is
//      explicit and evidence-driven, not implicit "latest" or PATH probing.
//   7. Parity tests — both surfaces (Adapter Proof, Browser Operation) exercise
//      the native transport through the same shared seam, the way they share this
//      mcporter transport today.
//
// Until all seven hold, native transport selection stays out of scope.

export const MCPORTER_COMMAND_ENV_VAR = "BROWSER_USE_MCPORTER_COMMAND_JSON";
export const MCPORTER_DEFAULT_COMMAND = ["mcporter"] as const;
export const MCPORTER_COMMAND_EXAMPLES =
	'["bunx","mcporter"], ["npx","-y","mcporter"], or ["pnpm","dlx","mcporter"]';

export type McporterCommandVector = readonly [string, ...string[]];

export type McporterCommandInput = {
	command: string;
	args: readonly string[];
	timeoutMs: number;
};

export type McporterCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
};

// Structural minimum both surface runtimes already satisfy. Keeps the transport
// from depending on the heavier AdapterProofRuntime / BrowserUseRuntime shapes.
export type McporterRuntime = {
	env: Record<string, string | undefined>;
	runCommand: (input: McporterCommandInput) => Promise<McporterCommandResult>;
};

export type ResolveMcporterCommandResult =
	| { ok: true; vector: McporterCommandVector }
	| { ok: false; reason: "invalid_override"; message: string };

// Parse the JSON-array override into a command vector, or report why it is
// invalid. Pure over env: no side effects, never throws. A missing override
// resolves to the default `mcporter` vector. Every malformed shape (non-JSON,
// non-array, empty array, non-string member, blank member) yields a stable
// invalid_override reason so both surfaces emit the same diagnostic family.
export function resolveMcporterCommandVector(
	env: Record<string, string | undefined>,
): ResolveMcporterCommandResult {
	const rawOverride = env[MCPORTER_COMMAND_ENV_VAR];
	if (rawOverride === undefined) {
		return { ok: true, vector: MCPORTER_DEFAULT_COMMAND };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawOverride);
	} catch {
		return {
			ok: false,
			reason: "invalid_override",
			message: `${MCPORTER_COMMAND_ENV_VAR} must be a JSON array of non-empty strings.`,
		};
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return {
			ok: false,
			reason: "invalid_override",
			message: `${MCPORTER_COMMAND_ENV_VAR} must be a non-empty JSON array of strings.`,
		};
	}
	const vector: string[] = [];
	for (const value of parsed) {
		if (typeof value !== "string" || value.trim() === "") {
			return {
				ok: false,
				reason: "invalid_override",
				message: `${MCPORTER_COMMAND_ENV_VAR} entries must be non-empty strings.`,
			};
		}
		vector.push(value.trim());
	}
	const [command, ...args] = vector;
	return { ok: true, vector: [command, ...args] };
}

export type RunMcporterResult =
	| { ok: true; result: McporterCommandResult }
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

// Resolve the override, prefix the command vector, and run the mcporter
// subcommand through the runtime's structured command runner. The argv vector is
// passed positionally to the runtime — it is never joined into a shell string,
// so override or argument input is never shell-evaluated.
//
// The default runtime (spawnMcporterCommand) never throws: a missing binary
// becomes an exit-127 result and a timeout a timedOut result, both handled by
// callers from the ok:true branch. A custom McporterRuntime.runCommand override
// may still throw, so a throw is classified rather than collapsed: a definitive
// spawn/start failure is command_not_started (route to dependency recovery);
// any other throw (an override bug, cancellation, unexpected I/O fault) is
// execution_failed and carries the original error rather than being mislabelled
// as a missing binary.
export async function runMcporter(
	runtime: McporterRuntime,
	args: readonly string[],
	timeoutMs: number,
): Promise<RunMcporterResult> {
	const resolved = resolveMcporterCommandVector(runtime.env);
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
// found, rather than a clean non-zero exit. Shared so both surfaces route a
// missing mcporter to dependency recovery identically.
export function isMissingCommandResult(result: McporterCommandResult): boolean {
	const text = `${result.stderr}\n${result.stdout}`;
	return (
		result.exitCode === 127 ||
		/(command not found|not found|ENOENT|No such file or directory)/i.test(text)
	);
}

// Diagnostic hint text shared by both surfaces. Keeping the wording here means
// the "choose one; does not auto-try package runners" guidance and the override
// examples cannot drift between Adapter Proof and Browser Operation.
export function mcporterDependencyHintText(problem: string): string {
	return `${problem} Expose mcporter on PATH, or set ${MCPORTER_COMMAND_ENV_VAR} to a JSON array command vector. Examples: ${MCPORTER_COMMAND_EXAMPLES}. Choose one; this transport does not auto-try package runners.`;
}

export function mcporterOverrideInvalidHintText(message: string): string {
	return `${message} Use a command vector such as ${MCPORTER_COMMAND_EXAMPLES}. This transport does not auto-try package runners.`;
}

// Spawn a command without a shell. Mirrors the bounded-timeout, piped-output
// runner both surfaces use as their default runtime.runCommand. Lives here so a
// single implementation backs both Adapter Proof and Browser Operation.
export async function spawnMcporterCommand(
	input: McporterCommandInput,
): Promise<McporterCommandResult> {
	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([input.command, ...input.args], {
			stdout: "pipe",
			stderr: "pipe",
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
	const timeoutResult = new Promise<McporterCommandResult>((resolve) => {
		timeout = setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				// Best effort. Timeout result still preserves bounded CLI behavior.
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
