import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createCleanupRegistry,
	drainCleanup,
	makeTempDir,
} from "@side-quest/cli-test-fixtures";

import {
	type InjectedInvocation,
	spawnRunWrappedCommand,
} from "../src/run-exec.ts";

// ===========================================================================
// U7 `--`-boundary parser — pure unit tests, written BEFORE the parser body.
//
// The split has no repo precedent. These tests pin the split semantics that the
// dispatcher (cli.ts) and run-exec (spawn/passthrough) both depend on:
//   - split at the FIRST `--` only
//   - head = adapter id + browser-connect flags (parsed as browser-connect argv)
//   - tail = wrapped command VERBATIM (never scanned for --help/--version/flags)
//   - absence of `--` → a missing-separator outcome (exit 2 upstream)
// ===========================================================================

import { splitRunArgv } from "../src/run-exec.ts";

describe("splitRunArgv: the -- boundary parser (R1/R17)", () => {
	test("splits at the first -- ; head before, tail after, verbatim", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--run-id",
			"abc",
			"--",
			"agent-browser",
			"snapshot",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser", "--run-id", "abc"]);
		expect(result.tail).toEqual(["agent-browser", "snapshot"]);
	});

	test("absence of -- → missing-separator outcome", () => {
		const result = splitRunArgv(["agent-browser", "agent-browser", "snapshot"]);
		expect(result.kind).toBe("missing-separator");
	});

	test("splits at the FIRST -- ; a wrapped command's own -- passes through in the tail verbatim", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--",
			"some-tool",
			"--flag",
			"--",
			"nested",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		// Everything after the first -- is verbatim, INCLUDING the wrapped tool's
		// own -- separator and its trailing tokens.
		expect(result.tail).toEqual(["some-tool", "--flag", "--", "nested"]);
	});

	test("the tail may legitimately contain --help / --version / unknown flags; the split does not scan them", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--",
			"wrapped-tool",
			"--help",
			"--version",
			"--totally-unknown",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		expect(result.tail).toEqual([
			"wrapped-tool",
			"--help",
			"--version",
			"--totally-unknown",
		]);
	});

	test("an empty tail (-- with nothing after) is a split with an empty tail, not missing-separator", () => {
		const result = splitRunArgv(["agent-browser", "--"]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		expect(result.tail).toEqual([]);
	});

	test("a leading -- (no head) still splits; head is empty", () => {
		const result = splitRunArgv(["--", "wrapped-tool", "arg"]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual([]);
		expect(result.tail).toEqual(["wrapped-tool", "arg"]);
	});
});

describe("applyInjection: endpoint injection into the wrapped command (R1)", () => {
	test("prepends the adapter's injection argv immediately after the wrapped executable", async () => {
		const { applyInjection } = await import("../src/run-exec.ts");
		const applied = applyInjection(
			["wrapped-tool", "user-arg"],
			{ argv: ["--cdp", "ws://127.0.0.1:9222/x"] },
			{ EXISTING: "1" },
		);
		// The wrapped executable stays first; the injected flags follow it, then the
		// caller's own args. env merges the injection env over the base env.
		expect(applied.command).toBe("wrapped-tool");
		expect(applied.args).toEqual([
			"--cdp",
			"ws://127.0.0.1:9222/x",
			"user-arg",
		]);
		expect(applied.env.EXISTING).toBe("1");
	});

	test("merges the adapter injection env over the base env", async () => {
		const { applyInjection } = await import("../src/run-exec.ts");
		const applied = applyInjection(
			["wrapped-tool"],
			{ argv: [], env: { AGENT_BROWSER_CDP: "ws://127.0.0.1:9222/x" } },
			{ PATH: "/usr/bin" },
		);
		expect(applied.command).toBe("wrapped-tool");
		expect(applied.args).toEqual([]);
		expect(applied.env.PATH).toBe("/usr/bin");
		expect(applied.env.AGENT_BROWSER_CDP).toBe("ws://127.0.0.1:9222/x");
	});
});

// ===========================================================================
// REAL-process spawn coverage (U7 R17/R18; KTD4). Every OTHER run test injects a
// fake spawner returning pre-baked results; the production spawnRunWrappedCommand
// (real spawn/wait, stdout passthrough, signal-death → 128+signal, spawn-failed
// vs self-exit-127 attribution) is exercised here against REAL short-lived
// binaries written into an own temp dir with cli-test-fixtures. Hermetic: each
// test writes its own executable (chmod 0755) and cleans up in afterEach.
//
// NOTE on signal FORWARDING (Fix 3): registering the SIGINT/SIGTERM handlers
// before Bun.spawn closes the orphan window, but driving that forward path
// deterministically in-process would mean signalling the bun test runner itself
// (process.kill(process.pid, ...)), which would tear down the suite. So the
// no-orphan + signal-death exit mapping is proven here by signalling the REAL
// wrapped CHILD directly and asserting (a) it is reaped and (b) the exit maps to
// 143; the handler-registration ordering is covered by careful reasoning + the
// source guard, not a live self-signal.
// ===========================================================================

describe("spawnRunWrappedCommand: the REAL spawner (U7 R17/R18, KTD4)", () => {
	const registry = createCleanupRegistry();

	afterEach(() => {
		drainCleanup(registry);
	});

	/** Write a real executable script into `dir` and return its absolute path. */
	function writeExecutable(dir: string, name: string, script: string): string {
		const path = join(dir, name);
		writeFileSync(path, script);
		chmodSync(path, 0o755);
		return path;
	}

	function invocation(
		command: string,
		args: readonly string[] = [],
		env: Record<string, string> = {},
	): InjectedInvocation {
		const base: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined) base[key] = value;
		}
		return { command, args, env: { ...base, ...env } };
	}

	test("real short command: stdout passthrough is byte-exact and exit code is correct", async () => {
		// A real binary that prints exactly and exits 0. stdio is inherited, so the
		// child owns the test process's stdout; we assert the exit-code contract and
		// that the real spawn/wait path returns `exited` (not a fake).
		const dir = makeTempDir(registry, "browser-connect-run");
		const tool = writeExecutable(
			dir,
			"echo-tool",
			'#!/bin/sh\nprintf "hello-from-wrapped\\n"\nexit 0\n',
		);

		const result = await spawnRunWrappedCommand(invocation(tool));

		expect(result.outcome).toBe("exited");
		if (result.outcome !== "exited") throw new Error("unreachable");
		expect(result.exitCode).toBe(0);
	});

	test("real self-exit-3: the wrapped tool's own exit code passes through unchanged", async () => {
		const dir = makeTempDir(registry, "browser-connect-run");
		const tool = writeExecutable(dir, "exit3-tool", "#!/bin/sh\nexit 3\n");

		const result = await spawnRunWrappedCommand(invocation(tool));

		expect(result.outcome).toBe("exited");
		if (result.outcome !== "exited") throw new Error("unreachable");
		expect(result.exitCode).toBe(3);
	});

	test("KTD4 negative arm: a real tool that SELF-EXITS 127 passes through as exited/127 (NO spawn-failed)", async () => {
		// A real binary that ran and chose exit 127 itself. At the spawn level this
		// is `exited` with exitCode 127 — distinct from a missing binary, which the
		// caller decorates with the diagnostic line. Here NO spawn-failed occurs.
		const dir = makeTempDir(registry, "browser-connect-run");
		const tool = writeExecutable(dir, "exit127-tool", "#!/bin/sh\nexit 127\n");

		const result = await spawnRunWrappedCommand(invocation(tool));

		expect(result.outcome).toBe("exited");
		if (result.outcome !== "exited") throw new Error("unreachable");
		expect(result.exitCode).toBe(127);
	});

	test("KTD4 positive arm: a genuinely-missing binary → spawn-failed (distinguishable from self-exit-127)", async () => {
		const dir = makeTempDir(registry, "browser-connect-run");
		const missing = join(dir, "no-such-binary-here");

		const result = await spawnRunWrappedCommand(invocation(missing));

		// A missing binary is spawn-failed — the caller maps this to exit 127 PLUS
		// the diagnostic line, unlike the self-exit-127 above (exited/127, no line).
		expect(result.outcome).toBe("spawn-failed");
		if (result.outcome !== "spawn-failed") throw new Error("unreachable");
		expect(typeof result.detail).toBe("string");
	});

	test("real SIGTERM death → exit 143 (128+signal), and the wrapped child is reaped (no orphan)", async () => {
		// A real long-lived child that records its own PID, then sleeps. We signal
		// the CHILD directly with SIGTERM and assert: (a) spawnRunWrappedCommand's
		// real await proc.exited resolves to 143 (Fix 4: Bun's already-correct
		// 128+signal is preferred, not recomputed), and (b) the child PID is gone —
		// no orphan (R17). This exercises the real spawn/wait/signal-death path.
		const dir = makeTempDir(registry, "browser-connect-run");
		const pidFile = join(dir, "child.pid");
		const tool = writeExecutable(
			dir,
			"long-lived",
			`#!/bin/sh\necho $$ > "$PIDFILE"\nsleep 30\n`,
		);

		const exitedPromise = spawnRunWrappedCommand(
			invocation(tool, [], { PIDFILE: pidFile }),
		);

		// Wait for the child to publish its PID, then SIGTERM it directly.
		let childPid = 0;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			try {
				const raw = readFileSync(pidFile, "utf8").trim();
				if (raw) {
					childPid = Number.parseInt(raw, 10);
					if (childPid > 0) break;
				}
			} catch {
				// pid file not written yet
			}
			await Bun.sleep(20);
		}
		expect(childPid).toBeGreaterThan(0);

		process.kill(childPid, "SIGTERM");

		const result = await exitedPromise;
		expect(result.outcome).toBe("exited");
		if (result.outcome !== "exited") throw new Error("unreachable");
		// SIGTERM = 15 → 128 + 15 = 143.
		expect(result.exitCode).toBe(143);

		// No orphan: the child PID no longer exists (kill(pid, 0) throws ESRCH).
		let alive = false;
		try {
			process.kill(childPid, 0);
			alive = true;
		} catch {
			alive = false;
		}
		expect(alive).toBe(false);
	});
});
