// U7 run wrapper mechanics: the `--`-boundary parser, endpoint injection into the
// wrapped command, and the spawn-and-wait passthrough (R1/R14/R17/R18; KTD4/KTD5).
//
// This module owns the NET-NEW, no-repo-precedent pieces of `run`:
//   - splitRunArgv: split argv at the FIRST `--`. The head is browser-connect's
//     own argv (adapter id + flags); the tail is the wrapped command VERBATIM and
//     is never scanned for --help/--version/unknown flags (the dispatcher must
//     split before those global checks, cli.ts).
//   - applyInjection: apply the Adapter Definition's `inject(endpoint)` result
//     (`{ argv, env? }`) into the wrapped command's invocation — argv prepended
//     after the wrapped executable, env merged over the base env. Pure.
//   - runWrappedCommand: spawn-and-wait with full stdio inheritance including
//     stdin, SIGINT/SIGTERM forwarded to the child, signal-death mapped to
//     128+signal, and the child's exit code passed through unchanged (R17). Bun
//     exposes no exec(2) process replacement, so this is spawn-and-wait.
//
// The wrapped command runs with the caller's authority, uninspected (R18): its
// argv is NEVER echoed into an envelope or diagnostic (R14/KTD10). Only run-exec's
// own diagnostic text (the spawn-failure line) is authored here, and the caller
// routes it through browser-connect's redactor.

/**
 * Result of splitting a `run` argv at the first `--` boundary.
 *
 * - `split`: `head` is browser-connect's argv (adapter id + its flags); `tail`
 *   is the wrapped command verbatim (may be empty — a bare `--`).
 * - `missing-separator`: no `--` was present; the caller maps this to the
 *   `run-missing-separator` failure class (exit 2).
 */
export type RunArgvSplit =
	| { kind: "split"; head: readonly string[]; tail: readonly string[] }
	| { kind: "missing-separator" };

/**
 * Split a `run` argv at the FIRST `--`.
 *
 * Everything before the first `--` is the head (parsed as browser-connect argv);
 * everything after is the tail, verbatim — a wrapped command may legitimately
 * contain `--`, `--help`, `--version`, or unknown flags, and the split never
 * scans the tail. Absence of any `--` yields `missing-separator`.
 *
 * @param argv - The argv AFTER the `run` command word (adapter id onward)
 * @returns A split (head + verbatim tail) or a missing-separator marker
 */
export function splitRunArgv(argv: readonly string[]): RunArgvSplit {
	const boundary = argv.indexOf("--");
	if (boundary === -1) {
		return { kind: "missing-separator" };
	}
	return {
		kind: "split",
		head: argv.slice(0, boundary),
		tail: argv.slice(boundary + 1),
	};
}

/**
 * A wrapped-command invocation after endpoint injection: the executable, its
 * argv (injection flags prepended, caller args following), and the full env.
 */
export type InjectedInvocation = {
	command: string;
	args: readonly string[];
	env: Record<string, string>;
};

/**
 * Apply an Adapter Definition's endpoint injection into the wrapped command.
 *
 * The wrapped executable stays first; the adapter's injection argv is inserted
 * immediately after it, then the caller's own args follow. The adapter's
 * injection env (if any) merges over the base env. Pure — no side effects, no
 * shell strings.
 *
 * @param tail - The wrapped command verbatim (`[executable, ...args]`)
 * @param injection - The adapter's `{ argv, env? }` from `inject(endpoint)`
 * @param baseEnv - The base environment to merge the injection env over
 * @returns The injected invocation ready to spawn
 * @throws When the tail is empty (no wrapped executable to run)
 */
export function applyInjection(
	tail: readonly string[],
	injection: { argv: readonly string[]; env?: Record<string, string> },
	baseEnv: Record<string, string | undefined>,
): InjectedInvocation {
	const [command, ...callerArgs] = tail;
	if (command === undefined) {
		throw new Error("run has no wrapped command to inject an endpoint into.");
	}
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (value !== undefined) env[key] = value;
	}
	if (injection.env) {
		for (const [key, value] of Object.entries(injection.env)) {
			env[key] = value;
		}
	}
	return {
		command,
		args: [...injection.argv, ...callerArgs],
		env,
	};
}

/**
 * The outcome of spawning and waiting on the wrapped command.
 *
 * - `exited`: the child ran and exited; `exitCode` is passed through unchanged.
 *   Signal-death is already mapped to `128 + signal` here (passthrough contract,
 *   R17).
 * - `spawn-failed`: the wrapped binary could not be started (missing / not
 *   executable). The caller maps this to `wrapped-command-not-found` (exit 127
 *   plus the spawn-failure diagnostic line, KTD4).
 */
export type RunSpawnResult =
	| { outcome: "exited"; exitCode: number }
	| { outcome: "spawn-failed"; detail: string };

/**
 * Spawner seam for the wrapped command (R17/R18). Injected so unit tests supply
 * a fake child WITHOUT spawning a real process. The production spawner
 * ({@link spawnRunWrappedCommand}) inherits stdio, forwards SIGINT/SIGTERM, and
 * maps signal-death to `128 + signal`.
 */
export type RunSpawner = (input: InjectedInvocation) => Promise<RunSpawnResult>;

/**
 * Apply injection, then spawn-and-wait the wrapped command through the injected
 * spawner (R1/R17/R18).
 *
 * Pure orchestration over the spawner seam: it never touches an envelope or a
 * diagnostic. The caller emits the verified handoff envelope on stderr BEFORE
 * calling this (KTD5), then maps the result — a passed-through exit code or a
 * spawn failure — onto the run station.
 *
 * @param tail - The wrapped command verbatim (`[executable, ...args]`)
 * @param injection - The adapter's endpoint injection
 * @param baseEnv - The base environment
 * @param spawn - The injectable spawner (tests supply a fake)
 * @returns The spawn result (exit passthrough or spawn failure)
 */
export async function runWrappedCommand(
	tail: readonly string[],
	injection: { argv: readonly string[]; env?: Record<string, string> },
	baseEnv: Record<string, string | undefined>,
	spawn: RunSpawner,
): Promise<RunSpawnResult> {
	const invocation = applyInjection(tail, injection, baseEnv);
	return spawn(invocation);
}

/**
 * Production spawner (KTD5/R17): spawn-and-wait with full stdio inheritance
 * INCLUDING stdin, so the wrapped command owns stdout/stdin/stderr end-to-end
 * (the envelope is already on stderr before this runs). SIGINT/SIGTERM are
 * forwarded to the child; signal-death maps to `128 + signal`. Bun exposes no
 * exec(2) process replacement, so this is spawn-and-wait, not process
 * replacement.
 *
 * A spawn failure (missing / non-executable binary) resolves to `spawn-failed`
 * rather than throwing, so the caller can author the KTD4 spawn-failure
 * diagnostic line and exit 127.
 */
export async function spawnRunWrappedCommand(
	input: InjectedInvocation,
): Promise<RunSpawnResult> {
	// Signal-forwarding race window (R17/U7): register the SIGINT/SIGTERM handlers
	// BEFORE Bun.spawn. A termination signal delivered to browser-connect between
	// spawn and handler-registration would otherwise run the default handler
	// (browser-connect dies) WITHOUT forwarding, orphaning the child — the exact
	// scenario a programmatic `kill <pid> SIGTERM` hits (interactive Ctrl-C masks
	// it via process-group delivery). The guard below handles a signal that lands
	// before `proc` exists: buffer the intent so the child is killed the moment it
	// comes up; if it never came up (spawn threw / no child), exit cleanly.
	let proc: ReturnType<typeof Bun.spawn> | undefined;
	let pendingSignal: NodeJS.Signals | undefined;
	const forward = (signal: NodeJS.Signals) => {
		if (proc === undefined) {
			// The child is not up yet. Buffer the intent to kill it once it exists.
			pendingSignal = signal;
			return;
		}
		try {
			proc.kill(signal);
		} catch {
			// Best effort: the child may have already exited.
		}
	};
	const onSigint = () => forward("SIGINT");
	const onSigterm = () => forward("SIGTERM");
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);

	try {
		try {
			proc = Bun.spawn([input.command, ...input.args], {
				// Full stdio inheritance: the wrapped command owns all three streams.
				// The envelope was already written to this process's stderr before spawn.
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
				env: input.env,
			});
		} catch (error) {
			// Spawn failed → no child exists. A signal that arrived in the window
			// buffered a pending intent; there is nothing to kill, so drop it and
			// report the spawn failure (the finally removes the handlers).
			return {
				outcome: "spawn-failed",
				detail: error instanceof Error ? error.message : String(error ?? ""),
			};
		}

		// If a signal landed before the child was up, forward it now so we never
		// orphan the just-spawned child.
		if (pendingSignal !== undefined) {
			forward(pendingSignal);
		}

		const exitCode = await proc.exited;
		// Signal-death → 128 + signal (passthrough contract, R17). Bun's
		// `await proc.exited` ALREADY returns the correct 128+signal (143 for
		// SIGTERM, 138 for SIGUSR1, …), so PREFER it whenever it is already in the
		// 128+ band — the manual signalNumber() table covers only ~5 signals and
		// would mis-attribute uncommon ones, overriding an already-correct code.
		// Fall back to the manual mapping only when Bun did not surface a usable
		// 128+ code but DID flag signal-death via proc.signalCode.
		if (exitCode > 128) {
			return { outcome: "exited", exitCode };
		}
		const signalCode = proc.signalCode;
		if (signalCode) {
			return {
				outcome: "exited",
				exitCode: 128 + signalNumber(signalCode),
			};
		}
		return { outcome: "exited", exitCode };
	} finally {
		process.removeListener("SIGINT", onSigint);
		process.removeListener("SIGTERM", onSigterm);
	}
}

/**
 * POSIX signal number for the common termination signals the passthrough maps.
 * Unknown signals fall back to `SIGTERM` (15) so the mapped code stays in the
 * 128+ band.
 */
function signalNumber(signal: NodeJS.Signals | number): number {
	if (typeof signal === "number") return signal;
	const table: Record<string, number> = {
		SIGHUP: 1,
		SIGINT: 2,
		SIGQUIT: 3,
		SIGKILL: 9,
		SIGTERM: 15,
	};
	return table[signal] ?? 15;
}
